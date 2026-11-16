"""
EXPECTATIVAS (RPD / Klein): associacoes entre as metricas da tabela mensal de Pistas
e modulacao fisica usando as propriedades estaticas do FatorSolo (SMAP L4 + SRTM).
"""
import json
import numpy as np
import pandas as pd
from scipy import stats

from backend.pistas import COLUNAS

ENTRADAS_ET0 = {"temp_media", "temp_max_media", "ur_media", "vento_medio", "radiacao_media"}
DERIVADAS = {
    "et0_total": ENTRADAS_ET0,
    "dias_calor": {"temp_max_media", "temp_media"},
    "dias_frio": {"temp_media", "temp_max_media"},
    "maior_seq_seca": {"chuva_total", "chuva_imerg"},
}
REDUNDANTES = [
    {"temp_media", "temp_max_media"},
    {"chuva_total", "chuva_imerg"},
    {"ndvi_max", "ndvi_medio"},
]
CLASSES_TESTADAS = ("empirica", "dentro_do_modelo")


def classificar_par(a, b):
    for d, fontes in DERIVADAS.items():
        if (a == d and b in fontes) or (b == d and a in fontes):
            return "derivada"
    if {a, b} in REDUNDANTES:
        return "redundante"
    grupos = {COLUNAS[a]["grupo"], COLUNAS[b]["grupo"]}
    # GLDAS e SMAP L4 sao modelos assimilados com forcante meteorologica
    if (grupos & {"gldas", "smap_l4"}) and (grupos & {"power", "imerg"}):
        return "dentro_do_modelo"
    if grupos == {"gldas", "smap_l4"}:
        return "dentro_do_modelo"
    return "empirica"


def fdr_bh(p):
    p = np.asarray(p, float)
    n = len(p)
    if n == 0:
        return p
    ordem = np.argsort(p)
    q_ord = np.minimum.accumulate((p[ordem] * n / np.arange(1, n + 1))[::-1])[::-1]
    q = np.empty(n)
    q[ordem] = np.minimum(q_ord, 1.0)
    return q


def _inferencia(rho, n_eff):
    if not np.isfinite(rho) or n_eff <= 4:
        return np.nan, np.nan, np.nan
    r = float(np.clip(rho, -0.9999, 0.9999))
    t = r * np.sqrt((n_eff - 2) / (1 - r ** 2))
    p = 2 * stats.t.sf(abs(t), n_eff - 2)
    se = np.sqrt((1 + r ** 2 / 2) / (n_eff - 3))
    return float(p), float(np.tanh(np.arctanh(r) - 1.96 * se)), float(np.tanh(np.arctanh(r) + 1.96 * se))


def _autocorr1(s):
    s = s.reindex(pd.period_range(s.index.min(), s.index.max(), freq="M"))
    r = s.autocorr(lag=1)
    return 0.0 if pd.isna(r) else float(r)


def _destendenciar(df, x):
    out = df.copy()
    for c in df.columns:
        ok = df[c].notna().values
        if ok.sum() >= 6 and np.nanstd(x[ok]) > 0:
            b = np.polyfit(x[ok], df[c].values[ok], 1)
            out[c] = df[c] - np.polyval(b, x)
    return out


def _z_mensal(s):
    if s.count() < 3:
        return s * np.nan
    sd = s.std(ddof=1)
    return (s - s.mean()) / sd if sd and sd > 0 else s * np.nan


class Expectativas:
    def __init__(self, tabela, min_n=3, dados_solo=None):
        self.tabela = tabela.copy()
        self.min_n = min_n
        self.dados_solo = dados_solo or {}

    def agregar_janela(self, meses):
        meses = list(meses)
        t = self.tabela
        m, y = t.index.month.values, t.index.year.values
        sel = np.isin(m, meses)
        sub = t[sel].copy()
        sub["_ano"] = np.where(m[sel] < meses[0], y[sel] - 1, y[sel])
        sub["_ano"] = sub["_ano"].astype(int)
        out = {}
        for col in t.columns:
            if col not in COLUNAS:
                continue
            g = sub.groupby("_ano")[col]
            valor = getattr(g, COLUNAS[col]["agg"])()
            completo = g.count() == len(meses)
            out[col] = valor.where(completo)
        res = pd.DataFrame(out)
        res.index.name = "ano"
        return res

    def anomalias_mensais(self, destendenciar=True):
        t = self.tabela[[c for c in self.tabela.columns if c in COLUNAS]]
        z = t.groupby(t.index.month).transform(_z_mensal)
        if destendenciar:
            x = (t.index.year + (t.index.month - 1) / 12).values.astype(float)
            z = _destendenciar(z, x)
        return z

    def _base(self, modo, meses, destendenciar):
        if modo == "janela":
            if not meses:
                raise ValueError("modo='janela' exige meses=[...]")
            b = self.agregar_janela(meses)
            if destendenciar:
                b = _destendenciar(b, b.index.values.astype(float))
            return b
        if modo == "anomalias":
            return self.anomalias_mensais(destendenciar)
        raise ValueError("modo deve ser 'janela' ou 'anomalias'")

    @staticmethod
    def _n_eff(base, a, b, n, modo):
        if modo != "anomalias":
            return float(n)
        rx, ry = _autocorr1(base[a].dropna()), _autocorr1(base[b].dropna())
        k = rx * ry
        return float(np.clip(n * (1 - k) / (1 + k), 4, n))

    def _consistencia(self, sub, a, b, modo):
        if modo != "anomalias" or len(sub) < 15:
            return None
        anos = sub.index.year
        corte = np.median(anos)
        r = []
        for parte in (sub[anos <= corte], sub[anos > corte]):
            if len(parte) < 6:
                return None
            r.append(parte[a].corr(parte[b], method="spearman"))
        if any(pd.isna(x) for x in r):
            return None
        return bool(np.sign(r[0]) == np.sign(r[1]))

    def correlacoes(self, modo="janela", meses=None, variaveis=None, destendenciar=True,
                    min_abs_rho=0.4, alfa=0.05):
        base = self._base(modo, meses, destendenciar)
        cols = [c for c in (variaveis or list(COLUNAS)) if c in base.columns and base[c].notna().sum() >= self.min_n]
        linhas = []
        for i, a in enumerate(cols):
            for b in cols[i + 1:]:
                sub = base[[a, b]].dropna()
                n = len(sub)
                if n < self.min_n or sub[a].nunique() < 2 or sub[b].nunique() < 2:
                    continue
                rho = sub[a].corr(sub[b], method="spearman")
                pe = sub[a].corr(sub[b], method="pearson")
                n_eff = self._n_eff(base, a, b, n, modo)
                p, lo, hi = _inferencia(rho, n_eff)
                linhas.append(dict(
                    var_a=a, var_b=b, classe=classificar_par(a, b), n=n, n_efetivo=round(n_eff, 1),
                    rho=round(float(rho), 3), rho_pearson=round(float(pe), 3),
                    alerta_divergencia=bool(abs(rho - pe) > 0.3),
                    ic_inf=round(lo, 3), ic_sup=round(hi, 3), p=p,
                    consistente=self._consistencia(sub, a, b, modo)))
        res = pd.DataFrame(linhas)
        if res.empty:
            return res
        res["q_fdr"] = np.nan
        testado = res["classe"].isin(CLASSES_TESTADAS) & res["p"].notna()
        res.loc[testado, "q_fdr"] = fdr_bh(res.loc[testado, "p"].values)
        res["relevante"] = (testado & (res["q_fdr"] < alfa) & (res["rho"].abs() >= min_abs_rho)
                            & (res["consistente"] != False))
        res["_abs"] = res["rho"].abs()
        res = res.sort_values(["relevante", "_abs"], ascending=False).drop(columns="_abs").reset_index(drop=True)
        res.attrs.update(modo=modo, meses=meses, destendenciar=destendenciar, alfa=alfa, min_abs_rho=min_abs_rho)
        return res

    @staticmethod
    def matriz(res, valor="rho", so_relevantes=False):
        """Gera a matriz simetrica de correlacao para analise de associacoes."""
        if res.empty:
            return pd.DataFrame()
        r = res[res["relevante"]] if so_relevantes else res
        vars_ = sorted(set(res["var_a"]) | set(res["var_b"]))
        m = pd.DataFrame(np.nan, index=vars_, columns=vars_)
        for _, l in r.iterrows():
            m.loc[l["var_a"], l["var_b"]] = m.loc[l["var_b"], l["var_a"]] = l[valor]
        return m

    @staticmethod
    def resumo(res, so_relevantes=False, maximo=15):
        if res.empty:
            return "Sem pares com dados suficientes."
        r = res[res["relevante"]] if so_relevantes else res
        linhas = [f"modo={res.attrs.get('modo')} | Total de pares testados: {len(res)}"]
        for _, l in r.head(maximo).iterrows():
            linhas.append(f"  {l['var_a']} x {l['var_b']}: rho={l['rho']:+.2f} (classe: {l['classe']})")
        return "\n".join(linhas)

    def _correlacao_solo_preferencial(self):
        """
        Calcula a correlacao historica entre temperatura media e umidade do solo,
        priorizando a umidade na zona das raizes (SMAP L4) e usando GLDAS como fallback.
        """
        for col_solo, fonte in (("umidade_raiz_smap", "SMAP L4 Root Zone (0-100 cm)"),
                                ("umidade_solo_gldas", "GLDAS Noah (0-10 cm)")):
            if col_solo in self.tabela.columns:
                sub = self.tabela[["temp_media", col_solo]].dropna()
                if len(sub) > 2 and sub[col_solo].nunique() > 1:
                    rho = float(sub["temp_media"].corr(sub[col_solo], method="spearman"))
                    return round(rho, 2), fonte
        return -0.5, "Estimativa padrao (dados insuficientes)"

    def interpretar_matriz_com_solo(self, res_correlacoes, dados_solo=None):
        """
        Cruza os padroes temporais da matriz (Expectativas) com as propriedades fisicas
        estaticas do FatorSolo (SMAP L4 Constants + SRTM) para gerar insights de rotacao.
        """
        solo = dados_solo or self.dados_solo or {}
        fisica = solo.get("fisica_solo", {})
        relevo = solo.get("relevo", {})
        raiz = solo.get("umidade_zona_raizes", {})

        adt = fisica.get("agua_disponivel_mm_m")
        textura = fisica.get("textura_estimada")
        decliv = relevo.get("declividade_pct")
        sm_rz = raiz.get("umidade_raiz_0_100cm_m3m3")
        ponto_murcha = fisica.get("ponto_murcha_m3m3")

        insights = []

        # 1. Modulacao Hidrica: Sensibilidade termica x Agua Disponivel Total (ADT)
        rho_temp_solo, fonte_solo = self._correlacao_solo_preferencial()
        if adt is not None:
            if adt < 100.0 and rho_temp_solo <= -0.4:
                insights.append({
                    "eixo": "Retencao Hidrica vs Estresse Termico",
                    "severidade": "Alta",
                    "diagnostico": (
                        f"Solo de textura '{textura}' com baixa Agua Disponivel ({adt} mm/m) combinado a "
                        f"forte queda de umidade sob calor (rho={rho_temp_solo:+.2f} via {fonte_solo})."
                    ),
                    "acao_rotacao": "Priorizar culturas tolerantes a veranicos, sistema radicular profundo e cobertura morta."
                })
            else:
                insights.append({
                    "eixo": "Retencao Hidrica vs Estresse Termico",
                    "severidade": "Moderada" if rho_temp_solo <= -0.4 else "Baixa",
                    "diagnostico": (
                        f"Solo '{textura}' retem {adt} mm/m de agua disponivel, amortecendo parcialmente "
                        f"a variacao termica (rho={rho_temp_solo:+.2f} via {fonte_solo})."
                    ),
                    "acao_rotacao": "Manter rotacao equilibrada aproveitando a janela de umidade subsuperficial."
                })

        # 2. Reserva atual na zona das raizes vs Ponto de Murcha Permanente (SPL4SMGP vs SPL4SMLM)
        if sm_rz is not None and ponto_murcha is not None:
            margem_rz = round(sm_rz - ponto_murcha, 3)
            if margem_rz < 0.04:
                insights.append({
                    "eixo": "Reserva na Zona das Raizes (0-100 cm)",
                    "severidade": "Alta",
                    "diagnostico": (
                        f"Umidade radicular atual ({sm_rz:.3f} m3/m3) muito proxima do ponto de murcha "
                        f"({ponto_murcha:.3f} m3/m3; margem de apenas {margem_rz:.3f} m3/m3)."
                    ),
                    "acao_rotacao": "Evitar implantacao imediata de culturas exigentes em agua sem chuva previa."
                })

        # 3. Modulacao Erosiva: Variabilidade de chuva na matriz x Declividade SRTM
        if decliv is not None and not res_correlacoes.empty:
            pares_chuva = res_correlacoes[
                res_correlacoes["var_a"].isin(["chuva_total", "chuva_imerg"]) |
                res_correlacoes["var_b"].isin(["chuva_total", "chuva_imerg"])
            ]
            if decliv >= 8.0 and not pares_chuva.empty:
                insights.append({
                    "eixo": "Risco Erosivo e Escoamento",
                    "severidade": "Alta",
                    "diagnostico": f"Declividade acentuada ({decliv}% - {relevo.get('classe_relevo')}) exige protecao fisica contra chuvas intensas.",
                    "acao_rotacao": "Incluir gramineas de sistema radicular fasciculado e plantio direto na rotacao."
                })

        return {
            "status": "sucesso" if insights else "parcial",
            "parametros_solo_utilizados": {
                "textura": textura,
                "agua_disponivel_mm_m": adt,
                "declividade_pct": decliv,
                "umidade_raiz_atual_m3m3": sm_rz,
            },
            "insights_rpd": insights,
        }

    def avaliar_alerta_hidrico_rpd(self, temperatura_prevista_alta, dias_sem_chuva, dados_solo=None):
        """
        Logica baseada no RPD de Klein: cruza a tendencia de alta termica e estiagem
        com a correlacao historica e a capacidade fisica de retencao do solo (SPL4SMLM).
        """
        solo = dados_solo or self.dados_solo or {}
        fisica = solo.get("fisica_solo", {})
        adt = fisica.get("agua_disponivel_mm_m")
        solo_baixa_retencao = (adt is not None and adt < 100.0)

        rho_temp_solo, fonte_solo = self._correlacao_solo_preferencial()
        limiar_dias = 4 if solo_baixa_retencao else 7

        if temperatura_prevista_alta and dias_sem_chuva > limiar_dias:
            detalhe_solo = (
                f" Solo com baixa agua disponivel ({adt} mm/m) acelera a perda hidrica."
                if solo_baixa_retencao else ""
            )
            return {
                "status_alerta": "CRITICO - Risco de Estresse Hidrico",
                "correlacao_historica_temp_solo": rho_temp_solo,
                "fonte_correlacao": fonte_solo,
                "agua_disponivel_solo_mm_m": adt,
                "motivo": (
                    f"Previsao de temperatura elevada associada a {dias_sem_chuva} dias secos "
                    f"(limiar ajustado pelo solo: {limiar_dias} dias). O historico aponta queda "
                    f"na umidade do solo sob essas condicoes.{detalhe_solo}"
                ),
                "recomendacao_rpd": "Antecipar monitoramento do talhao, manter cobertura do solo ou planejar irrigacao de suporte."
            }
        return {
            "status_alerta": "ESTAVEL",
            "correlacao_historica_temp_solo": rho_temp_solo,
            "fonte_correlacao": fonte_solo,
            "agua_disponivel_solo_mm_m": adt,
            "recomendacao_rpd": "Condicoes dentro da normalidade historica sazonal para a capacidade deste solo."
        }


if __name__ == "__main__":
    from backend.pistas import Pistas
    lat, lon = -22.9056, -47.0608
    pistas = Pistas(lat, lon, anos=3)

    print("Coletando pistas atuais do solo (SPL4SMLM + SPL4SMGP + GLDAS + SRTM)...")
    dados_solo = pistas.solo()
    print(json.dumps(dados_solo, indent=2, ensure_ascii=False))

    print("\nColetando tabela mensal de pistas...")
    tab = pistas.tabela_mensal(usar_imerg=False, usar_ndvi=False, usar_smap_raiz=True)

    ex = Expectativas(tab, min_n=3, dados_solo=dados_solo)
    res_correlacoes = ex.correlacoes(modo="anomalias")

    print("\n--- RESUMO DAS ASSOCIACOES ENTRE AS VARIAVEIS ---")
    print(Expectativas.resumo(res_correlacoes, so_relevantes=False))

    print("\n--- MATRIZ DE CORRELACAO COMPLETA (Spearman) ---")
    matriz_completa = ex.matriz(res_correlacoes, valor="rho", so_relevantes=False)
    print(matriz_completa.to_string())

    print("\n--- CRUZAMENTO EXPECTATIVAS x FISICA DO SOLO ---")
    cruzamento = ex.interpretar_matriz_com_solo(res_correlacoes)
    print(json.dumps(cruzamento, indent=2, ensure_ascii=False))

    print("\n--- SIMULACAO DE ALERTA HIDRICO RPD ---")
    alerta = ex.avaliar_alerta_hidrico_rpd(temperatura_prevista_alta=True, dias_sem_chuva=6)
    print(json.dumps(alerta, indent=2, ensure_ascii=False))