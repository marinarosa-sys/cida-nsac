"""
PISTAS (RPD / Klein - Recognition): toda a coleta de dados NASA numa classe so.

  Pistas(lat, lon).hidrico() / .ambiente() / .solo() / .praga()   -> pistas ATUAIS (JSON por fator)
  Pistas(lat, lon).atuais()                                         -> as quatro juntas
  Pistas(lat, lon).tabela_mensal()                                  -> historico MENSAL (ano x mes) para as Expectativas
"""
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

import numpy as np
import pandas as pd
import requests

from backend.fatores_rpd import (AVISO_403, CACHE_DIR, WORKERS, FatorAmbiente, FatorHidrico, FatorPraga, FatorSolo,
                         NasaPower, _chave, _indice_pixel_ease, buscar_granulos, com_cache,
                         et0_penman_monteith, login_earthdata)

# -----------------------------------------------------------------------------
# Metadados da tabela mensal.
# -----------------------------------------------------------------------------
COLUNAS = {
    "temp_media":         dict(agg="mean", grupo="power",   unidade="C",         rotulo="Temperatura media"),
    "temp_max_media":     dict(agg="mean", grupo="power",   unidade="C",         rotulo="Temperatura maxima media"),
    "ur_media":           dict(agg="mean", grupo="power",   unidade="%",         rotulo="Umidade relativa"),
    "vento_medio":        dict(agg="mean", grupo="power",   unidade="m/s",       rotulo="Vento a 2 m"),
    "radiacao_media":     dict(agg="mean", grupo="power",   unidade="MJ/m2/dia", rotulo="Radiacao solar"),
    "chuva_total":        dict(agg="sum",  grupo="power",   unidade="mm",        rotulo="Chuva (POWER)"),
    "et0_total":          dict(agg="sum",  grupo="power",   unidade="mm",        rotulo="ET0 FAO-56"),
    "dias_calor":         dict(agg="sum",  grupo="power",   unidade="dias",      rotulo="Dias com Tmax > 35 C"),
    "dias_frio":          dict(agg="sum",  grupo="power",   unidade="dias",      rotulo="Dias com Tmin < 3 C"),
    "maior_seq_seca":     dict(agg="max",  grupo="power",   unidade="dias",      rotulo="Maior sequencia sem chuva"),
    "umidade_solo_gldas": dict(agg="mean", grupo="gldas",   unidade="m3/m3",     rotulo="Umidade do solo 0-10 cm (GLDAS)"),
    "umidade_raiz_smap":  dict(agg="mean", grupo="smap_l4", unidade="m3/m3",     rotulo="Umidade zona das raizes 0-100 cm (SMAP L4)"),
    "chuva_imerg":        dict(agg="sum",  grupo="imerg",   unidade="mm",        rotulo="Chuva (IMERG)"),
    "ndvi_max":           dict(agg="max",  grupo="modis",   unidade="-",         rotulo="NDVI maximo do mes"),
    "ndvi_medio":         dict(agg="mean", grupo="modis",   unidade="-",         rotulo="NDVI medio do mes"),
}


def maior_sequencia(condicao):
    out = {}
    for per, s in condicao.groupby(condicao.index.to_period("M")):
        melhor = atual = 0
        for v in s.values:
            atual = atual + 1 if v else 0
            melhor = max(melhor, atual)
        out[per] = melhor
    return pd.Series(out, dtype=float)


def agregar_power_mensal(df, min_cobertura=0.9):
    df = df.copy()
    for c in ("T2M", "T2M_MAX", "T2M_MIN", "RH2M", "WS2M", "ALLSKY_SFC_SW_DWN", "PRECTOTCORR", "ET0"):
        if c not in df.columns:
            df[c] = np.nan
    per = df.index.to_period("M")
    cont = df.groupby(per).count()
    dim = pd.Series(cont.index.days_in_month, index=cont.index)
    ok = cont.div(dim, axis=0) >= min_cobertura
    media = df.groupby(per).mean().where(ok)
    soma = df.groupby(per).sum(min_count=1).mul(dim, axis=0).div(cont.where(cont > 0), axis=0).where(ok)

    def contagem(cond, base_col):
        x = cond.astype(float).where(df[base_col].notna())
        return x.groupby(per).sum().where(ok[base_col])

    out = pd.DataFrame(index=cont.index)
    out["temp_media"] = media["T2M"]
    out["temp_max_media"] = media["T2M_MAX"]
    out["ur_media"] = media["RH2M"]
    out["vento_medio"] = media["WS2M"]
    out["radiacao_media"] = media["ALLSKY_SFC_SW_DWN"]
    out["chuva_total"] = soma["PRECTOTCORR"]
    out["et0_total"] = soma["ET0"]
    out["dias_calor"] = contagem(df["T2M_MAX"] > 35, "T2M_MAX")
    out["dias_frio"] = contagem(df["T2M_MIN"] < 3, "T2M_MIN")
    seq = maior_sequencia((df["PRECTOTCORR"] < 1.0))
    out["maior_seq_seca"] = seq.reindex(out.index).where(ok["PRECTOTCORR"])
    out.index.name = "mes"
    return out


def _mes_do_granulo(g):
    nome = os.path.basename(g.data_links()[0])
    m = re.search(r"(?<!\d)(\d{8})(?!\d)", nome)
    if m:
        s = m.group(1)
        return pd.Period(year=int(s[:4]), month=int(s[4:6]), freq="M")
    m = re.search(r"(?<!\d)(\d{6})(?!\d)", nome)
    if m:
        s = m.group(1)
        return pd.Period(year=int(s[:4]), month=int(s[4:6]), freq="M")
    return None


def _coord(ds, nomes):
    return next((n for n in nomes if n in ds.coords or n in ds.dims), None)


def _extrair_mensal(res, candidatos, lat, lon, chave, workers=None):
    import earthaccess
    import xarray as xr
    workers = workers or WORKERS
    os.makedirs(CACHE_DIR, exist_ok=True)
    caminho = os.path.join(CACHE_DIR, chave + "_meses.pkl")
    vals = pd.read_pickle(caminho) if os.path.exists(caminho) else {}
    acesso = vals.pop("_acesso", None)
    unidade = vals.pop("_unidade", None)

    pares = [(_mes_do_granulo(g), g) for g in res]
    pares = [(m, g) for m, g in pares if m is not None]
    pendentes = [(m, g) for m, g in pares if m not in vals]
    print(f"  {chave}: {len(pares) - len(pendentes)} meses em cache, {len(pendentes)} a ler")

    if pendentes:
        try:
            arquivos = earthaccess.open([g for _, g in pendentes])
        except Exception as e:
            print(f"  Falha ao abrir granulos ({str(e) or 'sem mensagem'}).")
            print(AVISO_403)
            arquivos = []
        if not arquivos:
            print("  Nenhum granulo acessivel.")
        else:
            if len(arquivos) < len(pendentes):
                print(f"  Apenas {len(arquivos)} de {len(pendentes)} granulos acessiveis.")
            acesso = "s3-direto" if "S3" in type(arquivos[0]).__name__ else "https-streaming"

            def ler(arq, mes):
                for kw in ({}, {"group": "Grid"}):
                    try:
                        ds = xr.open_dataset(arq, engine="h5netcdf", decode_times=False, **kw)
                    except Exception:
                        continue
                    var = next((v for v in candidatos if v in ds.data_vars), None)
                    if var is None:
                        ds.close()
                        continue
                    try:
                        da = ds[var]
                        la, lo = _coord(ds, ("lat", "latitude")), _coord(ds, ("lon", "longitude"))
                        v = float(da.sel({la: lat, lo: lon}, method="nearest").values.item())
                        return mes, v, da.attrs.get("units")
                    finally:
                        ds.close()
                raise KeyError(f"variavel {candidatos} nao encontrada no arquivo")

            t0, falhas = time.time(), 0
            with ThreadPoolExecutor(workers) as ex:
                futs = [ex.submit(ler, a, m) for a, (m, _) in zip(arquivos, pendentes)]
                for k, f in enumerate(as_completed(futs), 1):
                    try:
                        m, v, u = f.result()
                        vals[m] = v
                        unidade = unidade or u
                    except Exception as e:
                        falhas += 1
                        if falhas == 1:
                            print(f"  granulo ignorado: {e}")
                    if k % 20 == 0 or k == len(futs):
                        print(f"  {k}/{len(futs)} lidos ({time.time() - t0:.0f}s)")
            if falhas > 1:
                print(f"  ... e mais {falhas - 1} granulos ignorados.")
            pd.to_pickle({**vals, "_acesso": acesso, "_unidade": unidade}, caminho)

    alvo = {m for m, _ in pares}
    s = pd.Series({m: v for m, v in vals.items() if m in alvo}, dtype=float).sort_index()
    return s, acesso, unidade


class Pistas:
    def __init__(self, lat, lon, anos=3, caminho_gaez=None):
        self.lat, self.lon, self.anos, self.caminho_gaez = lat, lon, anos, caminho_gaez
        self.ano_ini = datetime.utcnow().year - anos

    def ambiente(self):
        amb = FatorAmbiente(self.lat, self.lon)
        return {"clima": amb.obter_clima_nasa_power(), "vegetacao": amb.obter_vegetacao()}

    def hidrico(self, et0_30d_mm=None):
        return FatorHidrico(self.lat, self.lon).obter_dados_hidricos(et0_30d_mm=et0_30d_mm)

    def solo(self):
        return FatorSolo(self.lat, self.lon, self.caminho_gaez).obter_propriedades_solo()

    def praga(self, hidrico, clima):
        return FatorPraga(hidrico, clima).avaliar_risco_pragas()

    def atuais(self):
        amb = self.ambiente()
        hid = self.hidrico(et0_30d_mm=amb["clima"].get("et0_30d_mm"))
        return {"fator_hidrico": hid, "fator_ambiente": amb, "fator_solo": self.solo(),
                "fator_praga_doenca": self.praga(hid, amb["clima"])}

    def _power_mensal(self):
        p = NasaPower.serie(self.lat, self.lon)
        if p is None:
            print("POWER: indisponivel")
            return None
        df, elev = p["df"].copy(), p["elevacao_m"]
        base = df.dropna(subset=["T2M_MAX", "T2M_MIN", "RH2M", "WS2M", "ALLSKY_SFC_SW_DWN"])
        df["ET0"] = np.nan
        df.loc[base.index, "ET0"] = et0_penman_monteith(
            base["T2M_MAX"], base["T2M_MIN"], base["RH2M"], base["WS2M"], base["ALLSKY_SFC_SW_DWN"],
            self.lat, elev, base.index.dayofyear)
        return agregar_power_mensal(df)

    def _gldas_mensal(self):
        def buscar():
            login_earthdata()
            d = 0.25
            res = buscar_granulos(
                short_name="GLDAS_NOAH025_M", version="2.1",
                temporal=(f"{self.ano_ini}-01-01", datetime.utcnow().strftime("%Y-%m-%d")),
                bounding_box=(self.lon - d, self.lat - d, self.lon + d, self.lat + d))
            if not res:
                print("GLDAS mensal: nenhum granulo encontrado")
                return None
            s, acesso, unidade = _extrair_mensal(
                res, ("SoilMoi0_10cm_inst",), self.lat, self.lon, _chave("gldasM", round(self.lat, 3), round(self.lon, 3)))
            if s.empty:
                return None
            df = pd.DataFrame({"umidade_solo_gldas": s / 100.0})
            df.attrs.update(acesso=acesso, unidade_original=unidade)
            return df
        return com_cache(_chave("gldasM2", round(self.lat, 3), round(self.lon, 3), self.ano_ini), buscar, ttl_horas=24 * 7)

    def _smap_raiz_mensal(self):
        """
        Media mensal da umidade na zona das raizes (0-100 cm) via SMAP L4 (SPL4SMGP).
        Usa 1 amostra representativa por mes (dia 15, 12 UTC) para leitura ultrarrapida em nuvem.
        """
        def buscar():
            import earthaccess
            import h5py
            login_earthdata()
            d = 0.15
            res = buscar_granulos(
                short_name="SPL4SMGP",
                temporal=(f"{self.ano_ini}-01-01", datetime.utcnow().strftime("%Y-%m-%d")),
                bounding_box=(self.lon - d, self.lat - d, self.lon + d, self.lat + d),
            )
            if not res:
                print("SMAP L4 mensal: nenhum granulo encontrado")
                return None

            por_mes = {}
            for g in res:
                nome = os.path.basename(g.data_links()[0])
                if "T1200" not in nome and ".1200." not in nome:
                    continue
                m_dt = re.search(r"(\d{8})", nome)
                if not m_dt:
                    continue
                dt_str = m_dt.group(1)
                per = pd.Period(year=int(dt_str[:4]), month=int(dt_str[4:6]), freq="M")
                dia = int(dt_str[6:8])
                if per not in por_mes or abs(dia - 15) < abs(por_mes[per][0] - 15):
                    por_mes[per] = (dia, g)

            if not por_mes:
                return None

            chave = _chave("smapRzM", round(self.lat, 3), round(self.lon, 3))
            os.makedirs(CACHE_DIR, exist_ok=True)
            caminho = os.path.join(CACHE_DIR, chave + "_meses.pkl")
            vals = pd.read_pickle(caminho) if os.path.exists(caminho) else {}

            pendentes = [(per, item[1]) for per, item in sorted(por_mes.items()) if per not in vals]
            print(f"  {chave}: {len(por_mes) - len(pendentes)} meses em cache, {len(pendentes)} a ler")

            if pendentes:
                arquivos = earthaccess.open([g for _, g in pendentes])
                def ler(arq, per):
                    with h5py.File(arq, "r") as f:
                        idx = _indice_pixel_ease(f, self.lat, self.lon)
                        v = float(f["Geophysical_Data"]["sm_rootzone"][idx])
                        return per, v if (v >= 0 and not np.isnan(v)) else np.nan

                with ThreadPoolExecutor(WORKERS) as ex:
                    futs = [ex.submit(ler, a, p) for a, (p, _) in zip(arquivos, pendentes)]
                    for f in as_completed(futs):
                        try:
                            p, v = f.result()
                            vals[p] = v
                        except Exception:
                            pass
                pd.to_pickle(vals, caminho)

            s = pd.Series({p: vals.get(p, np.nan) for p in sorted(por_mes)}, dtype=float).dropna()
            if s.empty:
                return None
            return pd.DataFrame({"umidade_raiz_smap": s})

        return com_cache(_chave("smapRzM2", round(self.lat, 3), round(self.lon, 3), self.ano_ini), buscar, ttl_horas=24 * 7)

    def _imerg_mensal(self):
        def buscar():
            login_earthdata()
            d = 0.2
            res = buscar_granulos(
                short_name="GPM_3IMERGM", version="07",
                temporal=(f"{self.ano_ini}-01-01", datetime.utcnow().strftime("%Y-%m-%d")),
                bounding_box=(self.lon - d, self.lat - d, self.lon + d, self.lat + d))
            if not res:
                print("IMERG mensal: nenhum granulo encontrado")
                return None
            s, acesso, unidade = _extrair_mensal(
                res, ("precipitation",), self.lat, self.lon, _chave("imergM", round(self.lat, 3), round(self.lon, 3)))
            if s.empty:
                return None
            dim = pd.Series(s.index.days_in_month, index=s.index)
            u = (unidade or "").lower()
            if "day" in u:
                s = s * dim
            else:
                if "hr" not in u and "hour" not in u:
                    print(f"  IMERG: unidade '{unidade}' desconhecida; assumindo mm/hr")
                s = s * 24 * dim
            df = pd.DataFrame({"chuva_imerg": s})
            df.attrs.update(acesso=acesso, unidade_original=unidade)
            return df
        return com_cache(_chave("imergM2", round(self.lat, 3), round(self.lon, 3), self.ano_ini), buscar, ttl_horas=24 * 7)

    def _ndvi_mensal(self):
        ornl = FatorAmbiente.ORNL
        def buscar():
            hdr = {"Accept": "application/json"}
            r = requests.get(f"{ornl}/dates", params=dict(latitude=self.lat, longitude=self.lon), headers=hdr, timeout=20)
            if not r.ok:
                raise RuntimeError(f"ORNL /dates {r.status_code}: {r.text[:300]}")
            limite = pd.Timestamp(year=self.ano_ini, month=1, day=1)
            comps = [(pd.Timestamp(x["calendar_date"]), x["modis_date"]) for x in r.json()["dates"]]
            comps = [c for c in comps if c[0] >= limite]
            datas, vals = [], []
            for i in range(0, len(comps), 10):
                lote = comps[i:i + 10]
                r = requests.get(f"{ornl}/subset", params=dict(
                    latitude=self.lat, longitude=self.lon, band="250m_16_days_NDVI",
                    startDate=lote[0][1], endDate=lote[-1][1], kmAboveBelow=0, kmLeftRight=0),
                    headers=hdr, timeout=20)
                if not r.ok:
                    raise RuntimeError(f"ORNL /subset {r.status_code}: {r.text[:300]}")
                j = r.json()
                escala = float(j.get("scale", 0.0001))
                for item in j.get("subset", []):
                    v = [x for x in item["data"] if x > -2000]
                    if v:
                        datas.append(pd.Timestamp(item["calendar_date"]))
                        vals.append(float(np.mean(v)) * escala)
            if not vals:
                return None
            s = pd.Series(vals, index=datas).sort_index()
            g = s.groupby(s.index.to_period("M"))
            return pd.DataFrame({"ndvi_max": g.max(), "ndvi_medio": g.mean()})
        return com_cache(_chave("ndviM", round(self.lat, 3), round(self.lon, 3), self.ano_ini), buscar, ttl_horas=48)

    def tabela_mensal(self, usar_gldas=True, usar_imerg=True, usar_ndvi=True, usar_smap_raiz=True):
        partes = {"power": self._power_mensal()}
        if usar_gldas:
            partes["gldas"] = self._gldas_mensal()
        if usar_smap_raiz:
            partes["smap_l4"] = self._smap_raiz_mensal()
        if usar_imerg:
            partes["imerg"] = self._imerg_mensal()
        if usar_ndvi:
            partes["modis"] = self._ndvi_mensal()

        base = partes["power"]
        if base is None:
            base = pd.DataFrame(index=pd.period_range(f"{self.ano_ini}-01", datetime.utcnow().strftime("%Y-%m"), freq="M"))
        tab = base.copy()
        for nome, parte in partes.items():
            if nome == "power":
                continue
            if parte is None:
                print(f"Aviso: fonte '{nome}' indisponivel; colunas ficam vazias.")
                continue
            tab = tab.join(parte, how="outer")
        tab = tab.reindex(columns=list(COLUNAS))
        tab = tab[tab.index >= pd.Period(f"{self.ano_ini}-01", freq="M")]
        tab.index.name = "mes"
        return tab

    def salvar_tabela(self, caminho="tabela_mensal.csv", **kw):
        tab = self.tabela_mensal(**kw)
        tab.to_csv(caminho, float_format="%.4f")
        print(f"Tabela mensal salva em {caminho} ({len(tab)} meses)")
        return tab