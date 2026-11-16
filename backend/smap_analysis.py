"""
RPD (Klein) - Recognition: PISTAS vindas da NASA, uma classe por fator.

Fontes (todas da lista oficial do desafio):
  FatorHidrico : GLDAS (umidade do solo), SMAP L3 (umidade, observacao direta de satelite),
                 GPM IMERG (chuva), NASA POWER (contexto historico da chuva)
  FatorAmbiente: NASA POWER (temperatura, umidade relativa, vento, radiacao -> ET0 FAO-56),
                 MODIS MOD13Q1 NDVI (via servico de subsets do ORNL DAAC / NASA)
  FatorSolo    : GLDAS (comportamento hidrico/dry-down), SRTM (declividade), FAO GAEZ (raster opcional)
  FatorPraga   : derivado dos outros fatores (regra heuristica, sem dado proprio)

Principios:
  - Valor bruto nao e pista; ANOMALIA contra o historico e (a "experiencia" do Klein).
  - Sem dado -> status "indisponivel". Nunca inventar valor.
  - Nenhum arquivo da NASA e baixado: tudo e lido da nuvem (streaming / range requests).
    O cache em disco (./cache_nasa) guarda apenas VALORES ja extraidos (alguns KB).
  - Cache por DIA (GLDAS/IMERG): cada dia lido uma vez nunca e lido de novo.
  - Limiares marcados como HEURISTICA devem ser calibrados com agronomo local.
"""
import math
import os
import re
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta

import numpy as np
import pandas as pd
import requests

import logging
logging.getLogger("earthaccess").setLevel(logging.CRITICAL)

CACHE_DIR = "./cache_nasa"
INDISPONIVEL = {"status": "indisponivel", "mensagem": "Sem dados. Consulte um agronomo local."}

# Download so existe como ULTIMO recurso do SMAP e apenas se voce ligar explicitamente:
#   PowerShell: $env:RPD_PERMITIR_DOWNLOAD = "1"
PERMITIR_DOWNLOAD = os.environ.get("RPD_PERMITIR_DOWNLOAD", "0") == "1"

# Threads para leitura paralela de granulos (compare 1 contra 6 para ver o ganho real)
WORKERS = int(os.environ.get("RPD_WORKERS", "6"))

AVISO_403 = ("  -> 403/Forbidden = sua conta Earthdata ainda nao autorizou o app 'NASA GESDISC DATA ARCHIVE'.\n"
             "     Va em https://urs.earthdata.nasa.gov/profile > Applications > Authorized Apps >\n"
             "     'Approve More Applications' > 'NASA GESDISC DATA ARCHIVE'. Depois rode de novo.")


# =============================================================================
# Login e busca (Earthdata)
# =============================================================================
_LOGIN_FEITO = False


def login_earthdata():
    """Token em EARTHDATA_TOKEN (backend/servidor) se existir; senao login normal (persist). Faz 1x por processo."""
    global _LOGIN_FEITO
    if _LOGIN_FEITO:
        return
    import earthaccess
    if os.environ.get("EARTHDATA_TOKEN"):
        try:
            earthaccess.login(strategy="environment")
            _LOGIN_FEITO = True
            return
        except Exception as e:
            print(f"Login por token falhou ({e}); tentando login normal.")
    earthaccess.login(persist=True)
    _LOGIN_FEITO = True


def buscar_granulos(**kw):
    """Prefere granulos hospedados na nuvem (Earthdata Cloud); se nao houver, busca sem o filtro."""
    import earthaccess
    res = earthaccess.search_data(cloud_hosted=True, **kw)
    return res if res else earthaccess.search_data(**kw)


# =============================================================================
# Utilitarios compartilhados
# =============================================================================
def _chave(*partes):
    return "_".join(str(p).replace("/", "-") for p in partes)


def com_cache(chave, buscar, ttl_horas=12):
    """Cache em disco. Se a busca falhar, usa o cache antigo (se existir) e avisa. None nunca e gravado."""
    os.makedirs(CACHE_DIR, exist_ok=True)
    caminho = os.path.join(CACHE_DIR, chave + ".pkl")
    if os.path.exists(caminho) and (time.time() - os.path.getmtime(caminho)) / 3600 < ttl_horas:
        return pd.read_pickle(caminho)
    try:
        obj = buscar()
        if obj is not None:
            pd.to_pickle(obj, caminho)
        return obj
    except Exception as e:
        print(f"Aviso [{chave}]: {e}")
        if os.path.exists(caminho):
            print("  -> usando cache antigo")
            return pd.read_pickle(caminho)
        return None


def anomalia_janela(serie, dias=30, agg="mean", min_anos=15):
    """
    Compara a janela atual (ultimos `dias` ate o ultimo dado) com a MESMA janela
    nos anos anteriores. Retorna z-score e percentil historico.
    """
    s = serie.dropna()
    if s.empty:
        return None
    fim = s.index[-1]

    def janela(ano):
        try:
            f = fim.replace(year=ano)
        except ValueError:  # 29/fev
            f = fim.replace(year=ano, day=28)
        w = serie.loc[f - pd.Timedelta(days=dias - 1): f].dropna()
        if len(w) < 0.8 * dias:
            return np.nan
        return w.mean() if agg == "mean" else w.sum() * dias / len(w)

    atual = janela(fim.year)
    hist = pd.Series({a: janela(a) for a in range(s.index[0].year + 1, fim.year)}).dropna()
    if np.isnan(atual) or len(hist) < min_anos:
        return None
    desvio = hist.std()
    return {
        "data_fim": fim.strftime("%Y-%m-%d"),
        "atual": round(float(atual), 2),
        "media_historica": round(float(hist.mean()), 2),
        "z": round(float((atual - hist.mean()) / desvio), 2) if desvio > 0 else None,
        "percentil": round(float((hist <= atual).mean() * 100), 0),
        "anos_no_historico": int(len(hist)),
    }


def et0_penman_monteith(tmax, tmin, rh, u2, rs, lat, elev, doy):
    """FAO-56 Penman-Monteith diario (mm/dia). rs em MJ/m2/dia, u2 em m/s a 2 m, rh em %."""
    tmax, tmin, rh, u2, rs, doy = (np.asarray(x, dtype=float) for x in (tmax, tmin, rh, u2, rs, doy))
    tmean = (tmax + tmin) / 2
    e0 = lambda t: 0.6108 * np.exp(17.27 * t / (t + 237.3))
    es = (e0(tmax) + e0(tmin)) / 2
    ea = es * rh / 100
    phi = math.radians(lat)
    dr = 1 + 0.033 * np.cos(2 * np.pi * doy / 365)
    dec = 0.409 * np.sin(2 * np.pi * doy / 365 - 1.39)
    ws = np.arccos(np.clip(-np.tan(phi) * np.tan(dec), -1, 1))
    ra = (24 * 60 / np.pi) * 0.0820 * dr * (ws * np.sin(phi) * np.sin(dec) + np.cos(phi) * np.cos(dec) * np.sin(ws))
    rso = (0.75 + 2e-5 * elev) * ra
    ratio = np.clip(rs / np.where(rso > 0, rso, np.nan), 0.3, 1.0)
    rnl = 4.903e-9 * (((tmax + 273.16) ** 4 + (tmin + 273.16) ** 4) / 2) * (0.34 - 0.14 * np.sqrt(ea)) * (1.35 * ratio - 0.35)
    rn = 0.77 * rs - rnl
    delta = 4098 * e0(tmean) / (tmean + 237.3) ** 2
    gamma = 0.000665 * 101.3 * ((293 - 0.0065 * elev) / 293) ** 5.26
    et0 = (0.408 * delta * rn + gamma * 900 / (tmean + 273) * u2 * (es - ea)) / (delta + gamma * (1 + 0.34 * u2))
    return np.maximum(et0, 0)


# =============================================================================
# Clientes de dados NASA (compartilhados entre os fatores)
# =============================================================================
class NasaPower:
    PARAMS = "T2M,T2M_MAX,T2M_MIN,PRECTOTCORR,ALLSKY_SFC_SW_DWN,RH2M,WS2M"

    @staticmethod
    def serie(lat, lon, inicio="19810101"):
        """Serie diaria desde 1981 (uma unica requisicao, em cache). Retorna {'df', 'elevacao_m'}."""
        def buscar():
            r = requests.get(
                "https://power.larc.nasa.gov/api/temporal/daily/point",
                params=dict(parameters=NasaPower.PARAMS, community="AG", latitude=lat, longitude=lon,
                            start=inicio, end=datetime.utcnow().strftime("%Y%m%d"), format="JSON"),
                timeout=90)
            r.raise_for_status()
            j = r.json()
            df = pd.DataFrame(j["properties"]["parameter"])
            df.index = pd.to_datetime(df.index, format="%Y%m%d")
            df = df.where(df > -900).dropna(how="all")
            coords = j.get("geometry", {}).get("coordinates", [])
            return {"df": df, "elevacao_m": float(coords[2]) if len(coords) > 2 else 0.0}
        return com_cache(_chave("power", round(lat, 3), round(lon, 3)), buscar)


def _data_do_granulo(g):
    """Data (AAAAMMDD) no nome do arquivo do granulo. GLDAS: ...A20260101.1200...; IMERG: ...3IMERG.20260101-S..."""
    m = re.search(r"\d{8}", os.path.basename(g.data_links()[0]))
    return pd.Timestamp(m.group()) if m else None


def extrair_serie_pontual(res, var, lat, lon, chave, workers=None):
    """
    Valor da variavel `var` no ponto (lat, lon) para cada granulo, lendo da NUVEM (sem baixar).
      - Cache POR DIA em disco: dias ja lidos nunca sao lidos de novo.
      - Leitura em paralelo (threads) dos dias pendentes.
    Retorna (dict {data: valor}, acesso) onde acesso = 's3-direto' | 'https-streaming' | None.
    """
    import earthaccess
    import xarray as xr
    workers = workers or WORKERS
    os.makedirs(CACHE_DIR, exist_ok=True)
    caminho = os.path.join(CACHE_DIR, chave + "_dias.pkl")
    vals = pd.read_pickle(caminho) if os.path.exists(caminho) else {}
    acesso = vals.pop("_acesso", None)

    datas_g = [(_data_do_granulo(g), g) for g in res]
    datas_g = [(d, g) for d, g in datas_g if d is not None]
    pendentes = [(d, g) for d, g in datas_g if d not in vals]
    print(f"  {chave}: {len(datas_g) - len(pendentes)} dias em cache, {len(pendentes)} a ler")

    if pendentes:
        try:
            arquivos = earthaccess.open([g for _, g in pendentes])
        except Exception as e:
            print(f"  Falha ao abrir granulos ({str(e) or 'sem mensagem'}).")
            print(AVISO_403)
            arquivos = []
        if not arquivos:
            print("  Nenhum granulo acessivel.")
            print(AVISO_403)
        else:
            if len(arquivos) < len(pendentes):
                print(f"  Apenas {len(arquivos)} de {len(pendentes)} granulos acessiveis.")
                print(AVISO_403)
            acesso = "s3-direto" if "S3" in type(arquivos[0]).__name__ else "https-streaming"

            def ler(arq, data):
                ds = xr.open_dataset(arq, engine="h5netcdf", decode_times=False)
                try:
                    return data, float(ds[var].sel(lat=lat, lon=lon, method="nearest").values.item())
                finally:
                    ds.close()

            t0 = time.time()
            falhas = 0
            with ThreadPoolExecutor(workers) as ex:
                futs = [ex.submit(ler, a, d) for a, (d, _) in zip(arquivos, pendentes)]
                for k, f in enumerate(as_completed(futs), 1):
                    try:
                        d, v = f.result()
                        vals[d] = v
                    except Exception as e:
                        falhas += 1
                        if falhas == 1:
                            print(f"  granulo ignorado: {e}")
                            print(AVISO_403)
                    if k % 10 == 0 or k == len(futs):
                        print(f"  {k}/{len(futs)} lidos ({time.time() - t0:.0f}s)")
            if falhas > 1:
                print(f"  ... e mais {falhas - 1} granulos ignorados.")
            pd.to_pickle({**vals, "_acesso": acesso}, caminho)

    alvo = {d for d, _ in datas_g}
    return {d: v for d, v in vals.items() if d in alvo}, acesso


class Gldas:
    @staticmethod
    def serie_diaria(lat, lon, dias=30):
        """
        Umidade do solo 0-10 cm (m3/m3) do GLDAS Noah 2.1, 1 granulo por dia (12 UTC).
        A latencia do GLDAS e de meses: se nao houver dados recentes, recua a janela e informa a defasagem.
        """
        def buscar():
            login_earthdata()
            for atraso in (3, 30, 60, 120, 240):
                fim = datetime.utcnow() - timedelta(days=atraso)
                ini = fim - timedelta(days=dias)
                res = buscar_granulos(
                    short_name="GLDAS_NOAH025_3H", version="2.1",
                    temporal=(ini.strftime("%Y-%m-%d"), fim.strftime("%Y-%m-%d")),
                    bounding_box=(lon - 0.25, lat - 0.25, lon + 0.25, lat + 0.25))
                res = [g for g in res if any(".1200." in l for l in g.data_links())]
                if len(res) >= 15:
                    print(f"GLDAS: janela terminando em {fim:%Y-%m-%d} ({len(res)} dias)")
                    break
            else:
                print("GLDAS: nenhum conjunto de granulos suficiente encontrado")
                return None
            vals, acesso = extrair_serie_pontual(
                res, "SoilMoi0_10cm_inst", lat, lon, _chave("gldas", round(lat, 3), round(lon, 3)))
            if not vals:
                return None
            # kg/m2 em camada de 100 mm -> m3/m3
            df = pd.DataFrame({"umidade_m3m3": pd.Series(vals).sort_index() / 100.0})
            df.attrs["acesso"] = acesso
            return df
        # dado com meses de atraso: refazer a busca a cada 12 h nao traz nada novo
        return com_cache(_chave("gldas3", round(lat, 3), round(lon, 3), dias), buscar, ttl_horas=24 * 7)


class Imerg:
    @staticmethod
    def chuva_diaria(lat, lon, dias=30):
        """Chuva diaria (mm/dia) do GPM IMERG Late (GPM_3IMERGDL v07)."""
        def buscar():
            login_earthdata()
            fim = datetime.utcnow() - timedelta(days=1)
            ini = fim - timedelta(days=dias)
            res = buscar_granulos(
                short_name="GPM_3IMERGDL", version="07",
                temporal=(ini.strftime("%Y-%m-%d"), fim.strftime("%Y-%m-%d")),
                bounding_box=(lon - 0.2, lat - 0.2, lon + 0.2, lat + 0.2))
            if not res:
                print("IMERG: nenhum granulo encontrado")
                return None
            vals, acesso = extrair_serie_pontual(
                res, "precipitation", lat, lon, _chave("imerg", round(lat, 3), round(lon, 3)))
            if not vals:
                return None
            s = pd.Series(vals).sort_index().where(lambda x: x >= 0)
            s.attrs["acesso"] = acesso
            return s
        return com_cache(_chave("imerg3", round(lat, 3), round(lon, 3), dias), buscar, ttl_horas=6)


# =============================================================================
# FATOR HIDRICO
# =============================================================================
class FatorHidrico:
    def __init__(self, lat, lon):
        self.lat, self.lon = lat, lon

    def _smap_l3(self, permitir_download=None):
        """
        SMAP L3 (36 km) lido DIRETO DA NUVEM (Earthdata Cloud / AWS), sem baixar o arquivo do dia.
          - Rodando em AWS us-west-2: o earthaccess usa S3 direto.
          - Fora da regiao (ex.: seu PC): HTTPS com leitura parcial (range requests), tambem sem baixar.
        Le so 3 datasets (latitude, longitude, umidade). Mascara -9999 antes do pixel mais proximo.
        """
        import earthaccess
        import h5py
        login_earthdata()
        fim = datetime.utcnow()
        res = buscar_granulos(
            short_name="SPL3SMP",
            temporal=((fim - timedelta(days=10)).strftime("%Y-%m-%d"), fim.strftime("%Y-%m-%d")),
            bounding_box=(self.lon - 0.5, self.lat - 0.5, self.lon + 0.5, self.lat + 0.5))
        if not res:
            print("SMAP: nenhum granulo hospedado na nuvem encontrado na janela")
            return None

        def ler(src):
            with h5py.File(src, "r") as f:
                g = f["Soil_Moisture_Retrieval_Data_AM"]
                return g["latitude"][:], g["longitude"][:], g["soil_moisture"][:]

        liberar = PERMITIR_DOWNLOAD if permitir_download is None else permitir_download
        for gran in reversed(res[-3:]):
            nome = os.path.basename(gran.data_links()[0])
            try:
                fobj = earthaccess.open([gran])[0]
                modo = "s3-direto" if "S3" in type(fobj).__name__ else "https-streaming"
                lats, lons, sm = ler(fobj)
            except Exception as e:
                if not liberar:
                    print(f"SMAP: falha no acesso em nuvem ({str(e) or 'sem mensagem'}); download desativado.")
                    continue
                arq = earthaccess.download([gran], "./temp_smap")
                if not arq:
                    continue
                modo = "download"
                lats, lons, sm = ler(arq[0])
            ok = (sm != -9999.0) & ~np.isnan(sm) & (lats != -9999.0) & (lons != -9999.0)
            if not ok.any():
                continue
            dist = np.where(ok, (lats - self.lat) ** 2 + (lons - self.lon) ** 2, np.inf)
            i = np.unravel_index(np.argmin(dist), dist.shape)
            if math.sqrt(dist[i]) > 0.5:     # pixel valido longe demais
                continue
            return {"umidade_m3m3": round(float(sm[i]), 4), "arquivo": nome, "acesso": modo}
        return None

    def obter_dados_hidricos(self, et0_30d_mm=None):
        out = {"status": "indisponivel"}

        # --- Umidade do solo (GLDAS) ---
        g = Gldas.serie_diaria(self.lat, self.lon)
        if g is not None and g["umidade_m3m3"].notna().sum() >= 15:
            u = g["umidade_m3m3"].dropna()
            out["umidade_solo"] = {
                "status": "sucesso", "data": u.index[-1].strftime("%Y-%m-%d"),
                "atual_m3m3": round(float(u.iloc[-1]), 3),
                "percentil_na_janela_pct": round(float((u <= u.iloc[-1]).mean() * 100), 0),
                "janela_dias": int(len(u)),
                "defasagem_dias": int((pd.Timestamp.today().normalize() - u.index[-1]).days),
                "fonte": "GLDAS Noah 2.1 (modelo assimilado, NASA GES DISC)",
                "acesso": g.attrs.get("acesso"),
            }
            if out["umidade_solo"]["defasagem_dias"] > 15:
                out["umidade_solo"]["aviso"] = (
                    f"Dado do GLDAS com {out['umidade_solo']['defasagem_dias']} dias de atraso; "
                    "para a condicao ATUAL use umidade_smap.")
        else:
            out["umidade_solo"] = INDISPONIVEL

        # --- SMAP: observacao direta de satelite (para comparar com o modelo) ---
        smap = com_cache(_chave("smap", round(self.lat, 3), round(self.lon, 3)), self._smap_l3, ttl_horas=24)
        out["umidade_smap"] = ({"status": "sucesso", "fonte": "SMAP L3 (observacao de satelite)", **smap}
                               if smap else INDISPONIVEL)

        # --- Precipitacao: observado (IMERG) + contexto historico (POWER) ---
        imerg = Imerg.chuva_diaria(self.lat, self.lon)
        power = NasaPower.serie(self.lat, self.lon)
        prec = {"status": "indisponivel"}
        if imerg is not None and imerg.notna().sum() >= 20:
            prec.update(status="sucesso", fonte_observado="GPM IMERG Late", acesso=imerg.attrs.get("acesso"),
                        chuva_7d_mm=round(float(imerg.iloc[-7:].sum()), 1),
                        chuva_30d_mm=round(float(imerg.iloc[-30:].sum()), 1))
        if power is not None:
            an = anomalia_janela(power["df"]["PRECTOTCORR"], dias=30, agg="sum")
            if an:
                prec["contexto_historico_30d"] = {**an, "fonte": "NASA POWER (desde 1981)"}
                if prec["status"] == "indisponivel":    # IMERG falhou: usa POWER como observado
                    p = power["df"]["PRECTOTCORR"]
                    prec.update(status="sucesso", fonte_observado="NASA POWER (fallback)",
                                chuva_7d_mm=round(float(p.iloc[-7:].sum()), 1),
                                chuva_30d_mm=round(float(p.iloc[-30:].sum()), 1))
        out["precipitacao"] = prec

        # --- Balanco hidrico (chuva - ET0) em 30 dias ---
        if prec.get("chuva_30d_mm") is not None and et0_30d_mm is not None:
            saldo = prec["chuva_30d_mm"] - et0_30d_mm
            classe = "Deficit" if saldo < -30 else ("Excedente" if saldo > 30 else "Equilibrado")  # HEURISTICA
            out["balanco_hidrico_30d"] = {"status": "sucesso", "saldo_mm": round(saldo, 1), "classe": classe}
        else:
            out["balanco_hidrico_30d"] = INDISPONIVEL

        est = [out[k].get("status") for k in ("umidade_solo", "umidade_smap", "precipitacao")]
        n_ok = sum(e == "sucesso" for e in est)
        out["status"] = "sucesso" if n_ok == len(est) else ("parcial" if n_ok else "indisponivel")
        return out


# =============================================================================
# FATOR AMBIENTE
# =============================================================================
class FatorAmbiente:
    ORNL = "https://modis.ornl.gov/rst/api/v1/MOD13Q1"

    def __init__(self, lat, lon):
        self.lat, self.lon = lat, lon

    def obter_clima_nasa_power(self):
        p = NasaPower.serie(self.lat, self.lon)
        if p is None:
            return {"status": "indisponivel"}
        df, elev = p["df"], p["elevacao_m"]
        base = df.dropna(subset=["T2M_MAX", "T2M_MIN", "RH2M", "WS2M", "ALLSKY_SFC_SW_DWN"])
        df["ET0"] = np.nan
        df.loc[base.index, "ET0"] = et0_penman_monteith(
            base["T2M_MAX"], base["T2M_MIN"], base["RH2M"], base["WS2M"], base["ALLSKY_SFC_SW_DWN"],
            self.lat, elev, base.index.dayofyear)

        df = df.loc[:base.index[-1]]     # corta dias recentes ainda incompletos no POWER
        rec = df.iloc[-30:]
        return {
            "status": "sucesso",
            "janela_dias": 30, "data_fim": df.index[-1].strftime("%Y-%m-%d"),
            "temperatura_media_c": round(float(rec["T2M"].mean()), 2),
            "umidade_relativa_media_pct": round(float(rec["RH2M"].mean()), 1),
            "radiacao_solar_mj_m2_dia": round(float(rec["ALLSKY_SFC_SW_DWN"].mean()), 2),
            "et0_media_mm_dia": round(float(rec["ET0"].mean()), 2),
            "et0_30d_mm": round(float(rec["ET0"].sum()), 1),
            "dias_tmin_abaixo_3c": int((rec["T2M_MIN"] < 3).sum()),     # risco de geada (HEURISTICA)
            "dias_tmax_acima_35c": int((rec["T2M_MAX"] > 35).sum()),    # onda de calor (HEURISTICA)
            "anomalia_temperatura": anomalia_janela(df["T2M"], 30, "mean"),
            "anomalia_et0": anomalia_janela(df["ET0"], 30, "mean"),
            "anomalia_radiacao": anomalia_janela(df["ALLSKY_SFC_SW_DWN"], 30, "mean"),
            "metodo_et0": "FAO-56 Penman-Monteith (entradas NASA POWER)",
            "fonte": "NASA POWER (desde 1981)",
        }

    def obter_vegetacao(self, anos=5):
        """NDVI MODIS MOD13Q1 (250 m, 16 dias) -> estresse da vegetacao / possivel solo exposto."""
        def buscar():
            hdr = {"Accept": "application/json"}
            # O servico so aceita datas de composites MODIS validas: pedimos a lista primeiro.
            r = requests.get(f"{self.ORNL}/dates", params=dict(latitude=self.lat, longitude=self.lon),
                             headers=hdr, timeout=60)
            if not r.ok:
                raise RuntimeError(f"ORNL /dates {r.status_code}: {r.text[:300]}")
            limite = pd.Timestamp.today() - pd.Timedelta(days=365 * anos)
            comps = [(pd.Timestamp(x["calendar_date"]), x["modis_date"]) for x in r.json()["dates"]]
            comps = [c for c in comps if c[0] >= limite]
            datas, vals = [], []
            for i in range(0, len(comps), 10):          # servico limita ~10 composites por requisicao
                lote = comps[i:i + 10]
                r = requests.get(f"{self.ORNL}/subset", params=dict(
                    latitude=self.lat, longitude=self.lon, band="250m_16_days_NDVI",
                    startDate=lote[0][1], endDate=lote[-1][1], kmAboveBelow=0, kmLeftRight=0),
                    headers=hdr, timeout=60)
                if not r.ok:
                    raise RuntimeError(f"ORNL /subset {r.status_code}: {r.text[:300]}")
                j = r.json()
                escala = float(j.get("scale", 0.0001))
                for item in j.get("subset", []):
                    v = [x for x in item["data"] if x > -2000]      # -3000 = fill
                    if v:
                        datas.append(pd.Timestamp(item["calendar_date"]))
                        vals.append(float(np.mean(v)) * escala)
            return pd.Series(vals, index=datas).sort_index() if vals else None

        s = com_cache(_chave("ndvi", round(self.lat, 3), round(self.lon, 3), anos), buscar, ttl_horas=48)
        if s is None or len(s) < 20:
            return {"status": "indisponivel", "mensagem": INDISPONIVEL["mensagem"]}

        ult, data = float(s.iloc[-1]), s.index[-1]
        dd = np.abs(s.index.dayofyear - data.dayofyear)
        mesma_epoca = s[(np.minimum(dd, 365 - dd) <= 8) & (s.index.year < data.year)]
        z = None
        if len(mesma_epoca) >= 3 and mesma_epoca.std() > 0:
            z = round(float((ult - mesma_epoca.mean()) / mesma_epoca.std()), 2)
        return {
            "status": "sucesso", "data": data.strftime("%Y-%m-%d"), "ndvi_atual": round(ult, 3),
            "ndvi_mesma_epoca_media": round(float(mesma_epoca.mean()), 3) if len(mesma_epoca) else None,
            "z_vs_mesma_epoca": z,
            "possivel_solo_exposto": ult < 0.25,                                  # HEURISTICA
            "possivel_estresse": (z is not None and z < -1.0),                    # HEURISTICA
            "fonte": "MODIS MOD13Q1 via ORNL DAAC (NASA)",
            "aviso": "Pixel de 250 m: pode misturar talhoes vizinhos.",
        }


# =============================================================================
# FATOR SOLO
# =============================================================================
def analisar_drydown(umidade, chuva_mm, limiar_chuva=1.0):
    """Faixa de umidade e taxa media de secagem (fracao/dia) em dias consecutivos sem chuva."""
    u, p = np.asarray(umidade, float), np.asarray(chuva_mm, float)
    ok = ~np.isnan(u) & ~np.isnan(p)
    if ok.sum() < 15:
        return None
    taxas = [(u[i - 1] - u[i]) / u[i - 1] for i in range(1, len(u))
             if ok[i] and ok[i - 1] and p[i] < limiar_chuva and p[i - 1] < limiar_chuva
             and u[i - 1] > 0 and u[i] <= u[i - 1]]
    if len(taxas) < 5:
        return None
    uv = u[ok]
    return {"umidade_p10": round(float(np.percentile(uv, 10)), 3),
            "umidade_p50": round(float(np.percentile(uv, 50)), 3),
            "umidade_p90": round(float(np.percentile(uv, 90)), 3),
            "taxa_secagem_dia": round(float(np.mean(taxas)), 4), "dias_usados_na_taxa": len(taxas)}


def classificar_retencao(taxa):
    """HEURISTICA: solo que seca rapido -> baixa retencao / drenagem alta."""
    if taxa > 0.03:
        return "Baixa", "Alta (seca rapido apos a chuva)"
    if taxa > 0.015:
        return "Moderada", "Moderada"
    return "Alta", "Baixa a moderada (fica umido por mais tempo)"


def nome_tile_hgt(lat, lon):
    la, lo = math.floor(lat), math.floor(lon)
    return f"{'N' if la >= 0 else 'S'}{abs(la):02d}{'E' if lo >= 0 else 'W'}{abs(lo):03d}"


def ler_hgt(conteudo):
    n = int(math.sqrt(len(conteudo) // 2))
    return np.frombuffer(conteudo, dtype=">i2").reshape((n, n)).astype(float)


def declividade_de_janela(sub, passo_graus, lat):
    """Declividade media (%) de uma janela de elevacoes (m). passo_graus = espacamento da grade em graus."""
    sub = np.array(sub, dtype=float)
    sub[sub <= -32000] = np.nan
    if sub.shape[0] < 3 or sub.shape[1] < 3 or np.isnan(sub).mean() > 0.3:
        return None
    dy = passo_graus * 111_320.0
    dx = dy * math.cos(math.radians(lat))
    gy, gx = np.gradient(sub, dy, dx)
    return float(np.nanmean(np.hypot(gx, gy)) * 100.0)


def declividade_no_ponto(grade, lat, lon, janela=5):
    """Declividade (%) no ponto a partir de um tile .hgt inteiro (1 grau x 1 grau)."""
    n = grade.shape[0]
    passo = 1.0 / (n - 1)
    linha = int(round((math.floor(lat) + 1 - lat) / passo))
    col = int(round((lon - math.floor(lon)) / passo))
    r = janela // 2
    sub = grade[max(linha - r, 0): linha + r + 1, max(col - r, 0): col + r + 1]
    return declividade_de_janela(sub, passo, lat)


def classificar_relevo(d):
    """Classes de relevo no estilo EMBRAPA."""
    if d < 3:
        return "Plano", "Baixo"
    if d < 8:
        return "Suave ondulado", "Moderado"
    if d < 20:
        return "Ondulado", "Alto"
    return "Forte ondulado a montanhoso", "Muito alto"


class FatorSolo:
    def __init__(self, lat, lon, caminho_gaez=None):
        self.lat, self.lon, self.caminho_gaez = lat, lon, caminho_gaez

    def _declividade_srtm(self):
        """
        SRTM sem gravar nada em disco.
          A) SRTMGL1_NC (NetCDF): streaming, le so a janelinha ao redor do ponto (poucos KB).
          B) SRTMGL1 (.hgt.zip): lido em memoria (~25 MB de RAM), nada vai para o disco.
        """
        import earthaccess
        import xarray as xr
        login_earthdata()
        box = (self.lon - 0.01, self.lat - 0.01, self.lon + 0.01, self.lat + 0.01)

        # --- Opcao A ---
        try:
            res = earthaccess.search_data(short_name="SRTMGL1_NC", version="003", bounding_box=box)
            if res:
                f = earthaccess.open(res[:1])[0]
                ds = xr.open_dataset(f, engine="h5netcdf")
                try:
                    cands = [v for v in ds.data_vars if "DEM" in v.upper()] or list(ds.data_vars)
                    var = cands[0]
                    lats, lons = ds["lat"].values, ds["lon"].values
                    i = int(np.abs(lats - self.lat).argmin())
                    j = int(np.abs(lons - self.lon).argmin())
                    r = 3
                    sub = ds[var].isel(lat=slice(max(i - r, 0), i + r + 1),
                                       lon=slice(max(j - r, 0), j + r + 1)).values
                    passo = abs(float(lats[1] - lats[0]))
                finally:
                    ds.close()
                d = declividade_de_janela(sub, passo, self.lat)
                if d is not None:
                    return d
        except Exception as e:
            print(f"SRTM NetCDF falhou ({e}); tentando .hgt.zip em memoria.")

        # --- Opcao B ---
        res = earthaccess.search_data(short_name="SRTMGL1", version="003", bounding_box=box)
        if not res:
            return None
        f = earthaccess.open(res[:1])[0]
        with zipfile.ZipFile(f) as z:
            nome = [n for n in z.namelist() if n.lower().endswith(".hgt")][0]
            return declividade_no_ponto(ler_hgt(z.read(nome)), self.lat, self.lon)

    def _gaez(self):
        if not self.caminho_gaez:
            return None
        import rasterio
        with rasterio.open(self.caminho_gaez) as src:
            v = next(src.sample([(self.lon, self.lat)]))[0]
            return None if (src.nodata is not None and v == src.nodata) else float(v)

    def obter_propriedades_solo(self):
        out = {"fonte": [], "avisos": []}

        g = Gldas.serie_diaria(self.lat, self.lon)
        dd = None
        if g is not None:
            p = NasaPower.serie(self.lat, self.lon)
            if p is not None:
                g = g.asfreq("D")                                   # dias faltantes viram NaN
                chuva = p["df"]["PRECTOTCORR"].reindex(g.index)
                dd = analisar_drydown(g["umidade_m3m3"].values, chuva.values)
        if dd:
            ret, dren = classificar_retencao(dd["taxa_secagem_dia"])
            out["comportamento_hidrico"] = {"status": "inferido", **dd,
                                            "capacidade_retencao": ret, "drenagem": dren}
            out["fonte"].append("GLDAS Noah 2.1")
            out["avisos"].append("Retencao/drenagem sao INFERIDAS do comportamento da umidade "
                                 "(satelite/modelo), nao de analise de solo em campo.")
        else:
            out["comportamento_hidrico"] = INDISPONIVEL

        # Se a declividade falhar, devolve None (com_cache nao grava None): nao "cacheia" o erro por 90 dias.
        def buscar_srtm():
            d = self._declividade_srtm()
            return {"d": d} if d is not None else None

        d = com_cache(_chave("srtm", round(self.lat, 3), round(self.lon, 3)), buscar_srtm, ttl_horas=24 * 90)
        if d and d.get("d") is not None:
            relevo, risco = classificar_relevo(d["d"])
            out["relevo"] = {"status": "sucesso", "declividade_pct": round(d["d"], 1),
                             "classe_relevo": relevo, "risco_erosao": risco}
            out["fonte"].append("SRTM")
        else:
            out["relevo"] = INDISPONIVEL

        try:
            v = self._gaez()
        except Exception as e:
            print(f"Aviso GAEZ: {e}")
            v = None
        out["aptidao_gaez"] = {"status": "sucesso", "valor_raster": v} if v is not None else INDISPONIVEL
        if v is not None:
            out["fonte"].append("FAO GAEZ")

        estados = [out[k]["status"] for k in ("comportamento_hidrico", "relevo", "aptidao_gaez")]
        out["status"] = ("indisponivel" if all(s == "indisponivel" for s in estados)
                         else "parcial" if "indisponivel" in estados else "sucesso")
        return out


# =============================================================================
# FATOR PRAGA / DOENCA (derivado - sem dado proprio)
# =============================================================================
class FatorPraga:
    def __init__(self, dados_hidricos, dados_ambientais):
        self.hidrico = dados_hidricos or {}
        self.ambiente = dados_ambientais or {}

    def avaliar_risco_pragas(self):
        temp = self.ambiente.get("temperatura_media_c")
        rh = self.ambiente.get("umidade_relativa_media_pct")
        chuva_7d = self.hidrico.get("precipitacao", {}).get("chuva_7d_mm")
        if temp is None or rh is None:
            return {"status": "indisponivel", "mensagem": INDISPONIVEL["mensagem"]}
        chuva_7d = chuva_7d or 0.0

        # HEURISTICA geral de favorabilidade a fungos/pragas; NAO e especifica de cultura ou praga.
        if 22 <= temp <= 30 and rh >= 80 and chuva_7d >= 20:
            nivel, msg = "Alto", ("Calor, ar umido e chuva recente formam microclima favoravel a doencas fungicas "
                                  "e ao desenvolvimento rapido de pragas. Priorize monitoramento em campo.")
        elif 20 <= temp <= 32 and (rh >= 70 or chuva_7d >= 10):
            nivel, msg = "Moderado", "Condicoes parcialmente favoraveis. Monitorar a lavoura de forma preventiva."
        else:
            nivel, msg = "Baixo", "Condicoes pouco favoraveis a surtos expressivos neste momento."
        return {"status": "sucesso", "nivel_risco": nivel, "mensagem_alerta": msg,
                "aviso": "Regra heuristica geral; validar com agronomo local."}


# =============================================================================
# Orquestracao + testes offline
# =============================================================================
def coletar_pistas(lat, lon, caminho_gaez=None):
    ambiente = FatorAmbiente(lat, lon)
    clima = ambiente.obter_clima_nasa_power()
    vegetacao = ambiente.obter_vegetacao()
    hidrico = FatorHidrico(lat, lon).obter_dados_hidricos(et0_30d_mm=clima.get("et0_30d_mm"))
    solo = FatorSolo(lat, lon, caminho_gaez).obter_propriedades_solo()
    praga = FatorPraga(hidrico, clima).avaliar_risco_pragas()
    return {"fator_hidrico": hidrico, "fator_ambiente": {"clima": clima, "vegetacao": vegetacao},
            "fator_solo": solo, "fator_praga_doenca": praga}


def _testes_offline():
    # ET0: FAO-56 exemplo 18 (Uccle, 6 jul): resultado de referencia ~3.9 mm/dia
    et = float(et0_penman_monteith(21.5, 12.3, 73.5, 2.078, 22.07, 50.80, 100, 187))
    print("ET0 exemplo FAO-56:", round(et, 2), "(ref ~3.9)")
    assert 3.3 < et < 4.3

    # anomalia: serie sintetica com 2026 mais quente que o historico
    idx = pd.date_range("1990-01-01", "2026-06-30")
    rng = np.random.default_rng(1)
    s = pd.Series(20 + rng.normal(0, 1, len(idx)), index=idx)
    s.loc["2026-06-01":] += 3
    a = anomalia_janela(s, 30, "mean")
    print("anomalia:", a)
    assert a["z"] > 2 and a["percentil"] == 100

    # drydown
    u, p, x = [], [], 0.30
    for d in range(60):
        c = 25.0 if d in (5, 25, 45) else 0.0
        x = min(0.42, x + c * 0.004) if c else x * (1 - 0.02 + rng.normal(0, 0.002))
        u.append(x); p.append(c)
    dd = analisar_drydown(u, p)
    print("drydown:", dd, classificar_retencao(dd["taxa_secagem_dia"]))

    # relevo: rampa de 10%
    n = 3601
    passo_m = 111_320.0 / (n - 1)
    grade = ((np.arange(n)[:, None] * passo_m * 0.10) * np.ones((1, n)))[::-1]
    dec = declividade_no_ponto(grade, -22.9056, -47.0608)
    print("tile:", nome_tile_hgt(-22.9056, -47.0608), "| declividade %:", round(dec, 1), classificar_relevo(dec))
    assert 9 < dec < 11

    # janela de declividade (mesmo resultado esperado pela funcao compartilhada)
    sub = grade[1000:1007, 1000:1007]
    dec2 = declividade_de_janela(sub, 1.0 / (n - 1), -22.9056)
    print("declividade (janela):", round(dec2, 1))
    assert 9 < dec2 < 11

    # data do nome de arquivo (GLDAS e IMERG)
    class G:
        def __init__(self, nome): self.nome = nome
        def data_links(self): return [self.nome]
    assert _data_do_granulo(G("https://x/GLDAS_NOAH025_3H.A20260101.1200.021.nc4")) == pd.Timestamp("2026-01-01")
    assert _data_do_granulo(G("https://x/3B-DAY-L.MS.MRG.3IMERG.20260315-S000000-E235959.V07B.nc4")) == pd.Timestamp("2026-03-15")

    # praga
    r = FatorPraga({"precipitacao": {"chuva_7d_mm": 40}},
                   {"temperatura_media_c": 26, "umidade_relativa_media_pct": 85}).avaliar_risco_pragas()
    print("praga:", r["nivel_risco"])
    assert r["nivel_risco"] == "Alto"
    assert FatorPraga({}, {}).avaliar_risco_pragas()["status"] == "indisponivel"
    print("OK - testes offline passaram")


if __name__ == "__main__":
    import json
    import sys
    if "--teste" in sys.argv:
        _testes_offline()
    else:
        lat, lon = -22.9056, -47.0608          # Campinas (troque pelo seu terreno)
        print("Coletando pistas NASA para o RPD...")
        t0 = time.time()
        pistas = coletar_pistas(lat, lon)
        print(json.dumps(pistas, indent=2, ensure_ascii=False,
                         default=lambda o: float(o) if isinstance(o, (np.floating, np.integer)) else str(o)))
        print(f"Tempo total: {time.time() - t0:.0f}s")