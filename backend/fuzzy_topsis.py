import math
import urllib.request
import json

# Calibrated agronomic parameters from FAO EcoCrop
CROPS_ECOCROP = {
    "arroz": {
        "nome": "Irrigated / Lowland Rice",
        "slug_openfarm": "rice",
        "temp_otima": (22.0, 32.0),
        "temp_abs": (12.0, 40.0),
        "chuva_30d_ideal": (130.0, 260.0),
        "umidade_ideal": (0.30, 0.45),
        "decliv_max": 3.5,
        "ciclo_dias": 120,
        "demanda_hidrica": "High",
        "beneficio_solo": "Dense ground cover in flat floodplains",
        "manejo": "Requires standing water or consistently high soil moisture; avoid steep slopes or drought windows.",
    },
    "milho": {
        "nome": "Grain / Silage Corn",
        "slug_openfarm": "corn",
        "temp_otima": (20.0, 30.0),
        "temp_abs": (10.0, 38.0),
        "chuva_30d_ideal": (90.0, 180.0),
        "umidade_ideal": (0.22, 0.35),
        "decliv_max": 12.0,
        "ciclo_dias": 130,
        "demanda_hidrica": "Moderate",
        "beneficio_solo": "High biomass residue for no-till systems",
        "manejo": "Sensitive to water deficit during silking/flowering; ideal in rotation with legumes.",
    },
    "soja": {
        "nome": "Early-Maturity Soybean",
        "slug_openfarm": "soybean",
        "temp_otima": (20.0, 30.0),
        "temp_abs": (12.0, 37.0),
        "chuva_30d_ideal": (85.0, 170.0),
        "umidade_ideal": (0.20, 0.33),
        "decliv_max": 10.0,
        "ciclo_dias": 115,
        "demanda_hidrica": "Moderate",
        "beneficio_solo": "Biological Nitrogen Fixation (BNF)",
        "manejo": "Enriches soil nitrogen reserves; requires well-drained root zones.",
    },
    "feijao": {
        "nome": "Cowpea / Common Bean",
        "slug_openfarm": "common-bean",
        "temp_otima": (18.0, 29.0),
        "temp_abs": (10.0, 35.0),
        "chuva_30d_ideal": (65.0, 130.0),
        "umidade_ideal": (0.17, 0.28),
        "decliv_max": 14.0,
        "ciclo_dias": 80,
        "demanda_hidrica": "Low",
        "beneficio_solo": "Short cycle and rapid nitrogen fixation",
        "manejo": "Great short-window crop with lower water footprint.",
    },
    "sorgo": {
        "nome": "Grain / Forage Sorghum",
        "slug_openfarm": "sorghum",
        "temp_otima": (22.0, 34.0),
        "temp_abs": (12.0, 42.0),
        "chuva_30d_ideal": (45.0, 120.0),
        "umidade_ideal": (0.13, 0.26),
        "decliv_max": 15.0,
        "ciclo_dias": 105,
        "demanda_hidrica": "Low",
        "beneficio_solo": "Deep fibrous root system that alleviates compaction",
        "manejo": "Superior water-use efficiency and high tolerance to heat stress.",
    },
    "trigo": {
        "nome": "Wheat / Winter Cereal",
        "slug_openfarm": "wheat",
        "temp_otima": (14.0, 23.0),
        "temp_abs": (4.0, 30.0),
        "chuva_30d_ideal": (55.0, 120.0),
        "umidade_ideal": (0.18, 0.30),
        "decliv_max": 12.0,
        "ciclo_dias": 115,
        "demanda_hidrica": "Low",
        "beneficio_solo": "Erosion control during off-season windows",
        "manejo": "Suited for cooler windows; yield drops sharply above 28°C.",
    },
    "mandioca": {
        "nome": "Cassava / Manioc",
        "slug_openfarm": "cassava",
        "temp_otima": (21.0, 31.0),
        "temp_abs": (14.0, 38.0),
        "chuva_30d_ideal": (50.0, 140.0),
        "umidade_ideal": (0.14, 0.28),
        "decliv_max": 16.0,
        "ciclo_dias": 270,
        "demanda_hidrica": "Low",
        "beneficio_solo": "High resilience in lower-fertility soils",
        "manejo": "Tolerates prolonged dry spells after establishment; avoid waterlogging.",
    },
}

PESOS_LINGUISTICOS_TFN = {
    "muito_baixa": {"label": "Very Low",  "tfn": (0.00, 0.10, 0.25)},
    "baixa":       {"label": "Low",       "tfn": (0.15, 0.30, 0.45)},
    "media":       {"label": "Medium",    "tfn": (0.35, 0.50, 0.65)},
    "alta":        {"label": "High",      "tfn": (0.60, 0.78, 0.92)},
    "muito_alta":  {"label": "Very High", "tfn": (0.80, 0.95, 1.00)},
}


def buscar_detalhes_openfarm(slug: str) -> dict:
    url = f"https://openfarm.cc/api/v1/crops/{slug}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "FieldShift-RPD/1.0"})
        with urllib.request.urlopen(req, timeout=3) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
            attrs = payload.get("data", {}).get("attributes", {})
            return {
                "fonte": "OpenFarm + FAO EcoCrop",
                "descricao": attrs.get("description") or "",
                "sol": attrs.get("sun_requirements") or "Full Sun",
                "solo_tipo": attrs.get("soil_type") or "Well-drained",
            }
    except Exception:
        return {
            "fonte": "FAO EcoCrop",
            "descricao": "",
            "sol": "Full Sun",
            "solo_tipo": "Well-drained loamy soil",
        }


def _resolver_peso_fuzzy(valor) -> tuple:
    if isinstance(valor, str):
        chave = valor.strip().lower()
        if chave in PESOS_LINGUISTICOS_TFN:
            item = PESOS_LINGUISTICOS_TFN[chave]
            return item["tfn"], item["label"]
    try:
        num = float(valor)
        if num >= 85:
            return PESOS_LINGUISTICOS_TFN["muito_alta"]["tfn"], "Very High"
        if num >= 68:
            return PESOS_LINGUISTICOS_TFN["alta"]["tfn"], "High"
        if num >= 45:
            return PESOS_LINGUISTICOS_TFN["media"]["tfn"], "Medium"
        if num >= 25:
            return PESOS_LINGUISTICOS_TFN["baixa"]["tfn"], "Low"
        return PESOS_LINGUISTICOS_TFN["muito_baixa"]["tfn"], "Very Low"
    except Exception:
        return PESOS_LINGUISTICOS_TFN["media"]["tfn"], "Medium"


def _pertinencia_trapezoidal(val: float, min_abs: float, opt_min: float, opt_max: float, max_abs: float) -> float:
    if val is None or math.isnan(val):
        return 0.5
    if opt_min <= val <= opt_max:
        return 1.0
    if val < opt_min:
        if val <= min_abs:
            return 0.08
        return max(0.08, (val - min_abs) / max(opt_min - min_abs, 1e-6))
    if val >= max_abs:
        return 0.08
    return max(0.08, (max_abs - val) / max(max_abs - opt_max, 1e-6))


def _distancia_tfn(a: tuple, b: tuple) -> float:
    return math.sqrt(((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2) / 3.0)


def executar_fuzzy_topsis(
    atuais: dict,
    pesos: dict,
    cultura_escolhida: str = "milho",
    janela_dias: int = 0,
) -> dict:
    amb = (atuais.get("fator_ambiente") or {}).get("clima") or {}
    hid = (atuais.get("fator_hidrico") or {}).get("precipitacao") or {}
    solo = atuais.get("fator_solo") or {}
    raiz = solo.get("umidade_zona_raizes") or {}
    relevo = solo.get("relevo") or {}

    temp_atual = float(amb.get("temperatura_media_c") or 24.5)
    chuva_30d = float(hid.get("chuva_30d_mm") or 95.0)
    umid_raiz = float(raiz.get("umidade_raiz_0_100cm_m3m3") or 0.24)
    declividade = float(relevo.get("declividade_pct") or 4.0)

    fator_janela = 1.0
    if janela_dias == 30:
        fator_janela = 0.92
    elif janela_dias == 60:
        fator_janela = 0.85

    chuva_proj = chuva_30d * fator_janela
    umid_proj = umid_raiz * (0.95 if janela_dias > 0 else 1.0)
    temp_proj = temp_atual + (0.6 if janela_dias >= 30 else 0.0)

    w_amb, lbl_amb = _resolver_peso_fuzzy(pesos.get("ambiente", "media"))
    w_hid, lbl_hid = _resolver_peso_fuzzy(pesos.get("hidrico", "alta"))
    w_sol, lbl_sol = _resolver_peso_fuzzy(pesos.get("solo", "media"))

    matriz_ponderada = {}
    detalhes_criterios = {}

    for cid, crop in CROPS_ECOCROP.items():
        s_amb = _pertinencia_trapezoidal(
            temp_proj,
            crop["temp_abs"][0],
            crop["temp_otima"][0],
            crop["temp_otima"][1],
            crop["temp_abs"][1],
        )

        s_chuva = _pertinencia_trapezoidal(
            chuva_proj,
            crop["chuva_30d_ideal"][0] * 0.35,
            crop["chuva_30d_ideal"][0],
            crop["chuva_30d_ideal"][1],
            crop["chuva_30d_ideal"][1] * 1.65,
        )
        s_umid = _pertinencia_trapezoidal(
            umid_proj,
            crop["umidade_ideal"][0] * 0.55,
            crop["umidade_ideal"][0],
            crop["umidade_ideal"][1],
            crop["umidade_ideal"][1] * 1.45,
        )
        s_hid = (s_chuva * 0.5) + (s_umid * 0.5)

        if lbl_hid in ("High", "Very High") and crop["demanda_hidrica"] == "High" and umid_proj < 0.28:
            s_hid *= 0.55

        if declividade <= crop["decliv_max"]:
            s_sol = 1.0 - (declividade / max(crop["decliv_max"] * 2.2, 1.0)) * 0.25
        else:
            excesso = declividade - crop["decliv_max"]
            s_sol = max(0.12, 0.72 - excesso * 0.06)

        x_amb = (max(0.02, s_amb - 0.08), s_amb, min(1.0, s_amb + 0.08))
        x_hid = (max(0.02, s_hid - 0.08), s_hid, min(1.0, s_hid + 0.08))
        x_sol = (max(0.02, s_sol - 0.08), s_sol, min(1.0, s_sol + 0.08))

        v_amb = tuple(x_amb[k] * w_amb[k] for k in range(3))
        v_hid = tuple(x_hid[k] * w_hid[k] for k in range(3))
        v_sol = tuple(x_sol[k] * w_sol[k] for k in range(3))

        matriz_ponderada[cid] = (v_amb, v_hid, v_sol)
        detalhes_criterios[cid] = {
            "ambiente_pct": round(s_amb * 100),
            "hidrico_pct": round(s_hid * 100),
            "solo_pct": round(s_sol * 100),
        }

    fpis = []
    fnis = []
    for j in range(3):
        fpis.append(tuple(max(matriz_ponderada[c][j][k] for c in CROPS_ECOCROP) for k in range(3)))
        fnis.append(tuple(min(matriz_ponderada[c][j][k] for c in CROPS_ECOCROP) for k in range(3)))

    ranking = []
    for cid, crop in CROPS_ECOCROP.items():
        d_pos = sum(_distancia_tfn(matriz_ponderada[cid][j], fpis[j]) for j in range(3))
        d_neg = sum(_distancia_tfn(matriz_ponderada[cid][j], fnis[j]) for j in range(3))
        cc = d_neg / max(d_pos + d_neg, 1e-6)
        score_pct = round(cc * 100, 1)

        if score_pct >= 68:
            status_cor = "verde"
            status_texto = "High Suitability (Recommended)"
        elif score_pct >= 45:
            status_cor = "laranja"
            status_texto = "Moderate Suitability (Management Required)"
        else:
            status_cor = "vermelho"
            status_texto = "Low Suitability (High Risk)"

        ranking.append({
            "id": cid,
            "nome": crop["nome"],
            "score_topsis": score_pct,
            "cor_mapa": status_cor,
            "status": status_texto,
            "demanda_hidrica": crop["demanda_hidrica"],
            "ciclo_dias": crop["ciclo_dias"],
            "beneficio_solo": crop["beneficio_solo"],
            "manejo": crop["manejo"],
            "criterios": detalhes_criterios[cid],
        })

    ranking.sort(key=lambda item: item["score_topsis"], reverse=True)

    escolhida_id = cultura_escolhida.lower() if cultura_escolhida.lower() in CROPS_ECOCROP else "milho"
    analise_escolhida = next((r for r in ranking if r["id"] == escolhida_id), ranking[0])
    melhor_opcao = ranking[0]

    consideracoes = []
    if analise_escolhida["id"] != melhor_opcao["id"] and analise_escolhida["score_topsis"] < 55:
        consideracoes.append(
            f"Conflict detected for {analise_escolhida['nome']} ({analise_escolhida['score_topsis']}%): "
            f"with water priority '{lbl_hid}', {melhor_opcao['nome']} ({melhor_opcao['score_topsis']}%) provides higher agronomic resilience."
        )
    else:
        consideracoes.append(
            f"{analise_escolhida['nome']} shows {analise_escolhida['score_topsis']}% alignment with current orbital cues."
        )

    info_extra = buscar_detalhes_openfarm(CROPS_ECOCROP[escolhida_id]["slug_openfarm"])

    return {
        "janela_dias": janela_dias,
        "pesos_fuzzy_aplicados": {
            "water": {"term": lbl_hid, "tfn": w_hid},
            "environment": {"term": lbl_amb, "tfn": w_amb},
            "soil": {"term": lbl_sol, "tfn": w_sol},
        },
        "projecao_ambiental": {
            "temp_projetada_c": round(temp_proj, 1),
            "chuva_projetada_mm": round(chuva_proj, 1),
            "umidade_projetada_pct": round(umid_proj * 100, 1),
            "declividade_pct": round(declividade, 1),
        },
        "cultura_avaliada": {
            **analise_escolhida,
            "detalhes_botanicos": info_extra,
        },
        "melhor_alternativa": melhor_opcao,
        "ranking_topsis": ranking,
        "consideracoes_rpd": consideracoes,
    }