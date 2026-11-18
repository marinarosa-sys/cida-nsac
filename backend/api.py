import glob
import json
import os
import threading
import traceback
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import numpy as np
import pandas as pd

from backend.pistas import Pistas
from backend.expectativas import Expectativas
from backend.fuzzy_topsis import executar_fuzzy_topsis, CROPS_ECOCROP

app = FastAPI(title="Field Shift — NASA RPD + Fuzzy TOPSIS API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_origin_regex=".*",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

_LOCKS = {}
_GLOBAL_LOCK = threading.Lock()


def _get_lock(chave: str):
    with _GLOBAL_LOCK:
        if chave not in _LOCKS:
            _LOCKS[chave] = threading.Lock()
        return _LOCKS[chave]


def _limpar_tipos(obj):
    if isinstance(obj, dict):
        return {k: _limpar_tipos(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_limpar_tipos(v) for v in obj]
    if isinstance(obj, (np.floating, np.integer)):
        return float(obj)
    if isinstance(obj, np.bool_):
        return bool(obj)
    return obj


def _obter_tabela_historica(p: Pistas):
    for nome_metodo in ("tabela", "serie_historica", "coletar_historico", "df", "dados"):
        attr = getattr(p, nome_metodo, None)
        if callable(attr):
            res = attr()
            if isinstance(res, pd.DataFrame) and not res.empty:
                return res
        elif isinstance(attr, pd.DataFrame) and not attr.empty:
            return attr

    for pasta in ("./cache_nasa", "./backend/cache_nasa"):
        arquivos = sorted(glob.glob(f"{pasta}/**/*.csv", recursive=True), key=os.path.getmtime, reverse=True)
        for arq in arquivos:
            try:
                df = pd.read_csv(arq)
                if len(df) >= 10:
                    return df
            except Exception:
                continue
    return None


def _carregar_ou_coletar_nasa(lat: float, lon: float, anos: int = 1) -> dict:
    chave = f"{round(lat, 3)}_{round(lon, 3)}_{anos}"
    os.makedirs("./backend/cache_nasa", exist_ok=True)
    cache_json = f"./backend/cache_nasa/resposta_{chave}.json"

    with _get_lock(chave):
        if os.path.exists(cache_json):
            with open(cache_json, "r", encoding="utf-8") as f:
                return json.load(f)

        p = Pistas(lat, lon, anos=anos)
        atuais = p.atuais()
        tab = _obter_tabela_historica(p)

        if tab is not None:
            ex = Expectativas(tab, solo=atuais.get("fator_solo"))
            expectativas_data = {
                "top_correlacoes": ex.resumo(so_relevantes=False)[:10],
                "cruzamento_solo": ex.cruzamento_solo(),
                "alerta_hidrico": ex.simular_alerta_hidrico(anomalia_temp_atual=1.2),
            }
        else:
            expectativas_data = {
                "top_correlacoes": [],
                "cruzamento_solo": {"insights_rpd": []},
                "alerta_hidrico": {"status_alerta": "STABLE"},
            }

        resultado = _limpar_tipos({
            "coordenadas": {"lat": lat, "lon": lon},
            "anos_analisados": anos,
            "atuais": atuais,
            "expectativas": expectativas_data,
        })

        with open(cache_json, "w", encoding="utf-8") as f:
            json.dump(resultado, f, ensure_ascii=False, indent=2)

        return resultado


@app.get("/api/health")
def health():
    return {"status": "online", "available_crops": list(CROPS_ECOCROP.keys())}


@app.get("/api/analise")
def analisar_terreno(
    lat: float = Query(-23.0205),
    lon: float = Query(-45.5555),
    anos: int = Query(1),
    cultura: str = Query("milho"),
    janela_dias: int = Query(0),
    peso_ambiente: str = Query("media"),
    peso_hidrico: str = Query("alta"),
    peso_solo: str = Query("media"),
):
    try:
        base_nasa = _carregar_ou_coletar_nasa(lat, lon, anos=anos)
        topsis = executar_fuzzy_topsis(
            atuais=base_nasa.get("atuais", {}),
            pesos={
                "ambiente": peso_ambiente,
                "hidrico": peso_hidrico,
                "solo": peso_solo,
            },
            cultura_escolhida=cultura,
            janela_dias=janela_dias,
        )
        return _limpar_tipos({
            **base_nasa,
            "topsis": topsis,
        })
    except Exception as exc:
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={"erro": str(exc)},
            headers={"Access-Control-Allow-Origin": "*"},
        )


@app.get("/api/historico-fator")
def historico_fator(
    lat: float = Query(-23.0205),
    lon: float = Query(-45.5555),
    fator: str = Query("hidrico"),
    anos: int = Query(1),
):
    try:
        base = _carregar_ou_coletar_nasa(lat, lon, anos=anos)
        p = Pistas(lat, lon, anos=anos)
        tab = _obter_tabela_historica(p)

        serie_mensal = []
        estatisticas = {}

        if tab is not None and not tab.empty:
            df = tab.copy()
            col_data = next((c for c in df.columns if "data" in c.lower() or "date" in c.lower() or "time" in c.lower()), None)
            if col_data:
                dt = pd.to_datetime(df[col_data], errors="coerce")
                df["ano_mes"] = dt.dt.to_period("M").astype(str)
                df["mes_num"] = dt.dt.month
            else:
                periodos = pd.period_range(end=pd.Timestamp.today(), periods=anos * 12, freq="M")
                idx = np.linspace(0, len(periodos) - 1, len(df)).astype(int)
                df["ano_mes"] = periodos[idx].astype(str)
                df["mes_num"] = periodos[idx].month

            df = df.dropna(subset=["ano_mes"])
            cols_num = [c for c in df.select_dtypes(include=[np.number]).columns if c not in ("ano", "mes_num")]

            for col in cols_num[:6]:
                vals = df[col].dropna()
                if len(vals) > 1:
                    estatisticas[col] = {
                        "media": round(float(vals.mean()), 2),
                        "desvio_padrao": round(float(vals.std()), 2),
                        "variancia": round(float(vals.var()), 3),
                        "minimo": round(float(vals.min()), 2),
                        "maximo": round(float(vals.max()), 2),
                        "cv_pct": round(float((vals.std() / max(abs(vals.mean()), 1e-6)) * 100), 1),
                    }

            for ano_mes, grupo in df.groupby("ano_mes", sort=True):
                item = {
                    "ano_mes": str(ano_mes),
                    "mes_num": int(grupo["mes_num"].iloc[0]),
                }
                for col in cols_num[:6]:
                    item[col] = round(float(grupo[col].mean()), 2)
                    item[f"{col}_std"] = round(float(grupo[col].std() or 0), 2)
                    item[f"{col}_var"] = round(float(grupo[col].var() or 0), 3)
                serie_mensal.append(item)

        return _limpar_tipos({
            "fator": fator,
            "janela_anos": anos,
            "agrupamento": "monthly",
            "coordenadas": {"lat": lat, "lon": lon},
            "atuais": base.get("atuais", {}),
            "expectativas": base.get("expectativas", {}),
            "estatisticas": estatisticas,
            "serie_mensal": serie_mensal[-(anos * 12):],
        })
    except Exception as exc:
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={"erro": str(exc)},
            headers={"Access-Control-Allow-Origin": "*"},
        )


@app.get("/api/safra-nasa")
def extrair_clima_safra(
    lat: float = Query(-23.0205),
    lon: float = Query(-45.5555),
    start_month: str = Query("2025-10"),
    end_month: str = Query("2026-02"),
    anos_comparacao: int = Query(1),
):
    try:
        base = _carregar_ou_coletar_nasa(lat, lon, anos=anos_comparacao)
        p = Pistas(lat, lon, anos=anos_comparacao)
        tab = _obter_tabela_historica(p)

        atuais = base.get("atuais", {})
        rain_cur = float((atuais.get("fator_hidrico") or {}).get("precipitacao", {}).get("chuva_30d_mm") or 110.0)
        temp_cur = float((atuais.get("fator_ambiente") or {}).get("clima", {}).get("temperatura_media_c") or 24.2)
        soil_cur = float((atuais.get("fator_solo") or {}).get("umidade_zona_raizes", {}).get("umidade_raiz_0_100cm_m3m3") or 0.25) * 100

        p_ini = pd.Period(start_month, freq="M")
        p_fim = pd.Period(end_month, freq="M")
        if p_fim < p_ini:
            p_fim = p_ini

        duracao_meses = (p_fim.year - p_ini.year) * 12 + (p_fim.month - p_ini.month) + 1
        meses_alvo = sorted(list({(p_ini + i).month for i in range(duracao_meses)}))

        rain_safra = round(rain_cur * duracao_meses, 1)
        temp_safra = round(temp_cur, 1)
        soil_safra = round(soil_cur, 1)
        homogeneidade_pct = 84.0
        std_interanual_rain = 24.5

        if tab is not None and not tab.empty:
            df = tab.copy()
            col_data = next((c for c in df.columns if "data" in c.lower() or "date" in c.lower() or "time" in c.lower()), None)
            if col_data:
                dt = pd.to_datetime(df[col_data], errors="coerce")
                df["periodo"] = dt.dt.to_period("M")
                df["mes"] = dt.dt.month
                df["ano"] = dt.dt.year
                df = df.dropna(subset=["periodo"])

                col_rain = next((c for c in df.columns if "chuva" in c.lower() or "precip" in c.lower()), None)
                col_temp = next((c for c in df.columns if "temp" in c.lower()), None)
                col_soil = next((c for c in df.columns if "umid" in c.lower() or "soil" in c.lower()), None)

                df_safra = df[(df["periodo"] >= p_ini) & (df["periodo"] <= p_fim)]
                if not df_safra.empty:
                    if col_rain:
                        rain_safra = round(float(df_safra[col_rain].sum()), 1)
                    if col_temp:
                        temp_safra = round(float(df_safra[col_temp].mean()), 1)
                    if col_soil:
                        val_s = float(df_safra[col_soil].mean())
                        soil_safra = round(val_s * 100 if val_s <= 1.0 else val_s, 1)

                df_mesma_epoca = df[df["mes"].isin(meses_alvo)]
                if not df_mesma_epoca.empty and col_rain:
                    por_ano = df_mesma_epoca.groupby("ano")[col_rain].sum()
                    if len(por_ano) > 1 and por_ano.mean() > 0:
                        cv = float(por_ano.std() / por_ano.mean())
                        std_interanual_rain = round(float(por_ano.std()), 1)
                        homogeneidade_pct = round(max(15.0, min(99.0, (1.0 - min(cv, 0.85)) * 100)), 1)

        return _limpar_tipos({
            "start_month": str(p_ini),
            "end_month": str(p_fim),
            "duracao_meses": duracao_meses,
            "meses_calendario": meses_alvo,
            "nasa_rain_mm": rain_safra,
            "nasa_temp_c": temp_safra,
            "nasa_soil_pct": soil_safra,
            "homogeneity_pct": homogeneidade_pct,
            "interannual_std_mm": std_interanual_rain,
        })
    except Exception as exc:
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={"erro": str(exc)},
            headers={"Access-Control-Allow-Origin": "*"},
        )