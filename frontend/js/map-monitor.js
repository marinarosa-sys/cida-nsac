// js/map-monitor.js
document.addEventListener('DOMContentLoaded', () => {
  const cards = document.querySelectorAll('.plot-card');
  const pins = document.querySelectorAll('.map-pin');
  const coordBadge = document.getElementById('selectedPlotCoord');
  const noticeBox = document.querySelector('.map-api-notice');

  function extrairLatLon(card) {
    if (card.dataset.lat && card.dataset.lon) {
      return { lat: parseFloat(card.dataset.lat), lon: parseFloat(card.dataset.lon) };
    }
    const match = (card.dataset.coord || '').match(/Lat:\s*([-\d.]+)\s*\|\s*Lng:\s*([-\d.]+)/i);
    return match
      ? { lat: parseFloat(match[1]), lon: parseFloat(match[2]) }
      : { lat: -22.9068, lon: -47.0616 };
  }

  function formatarUmidadePct(val) {
    if (val === null || val === undefined || Number.isNaN(Number(val))) return '--';
    return `${Math.round(Number(val) * 100)}%`;
  }

  function atualizarCardTalhao(card, dados) {
    if (!dados || !dados.atuais) return;

    const solo = dados.atuais.fator_solo || {};
    const hidrico = dados.atuais.fator_hidrico || {};
    const clima = (dados.atuais.fator_ambiente || {}).clima || {};
    const cruzamento = (dados.expectativas || {}).cruzamento_solo || {};

    const umidadeRaiz =
      (solo.umidade_zona_raizes || {}).umidade_raiz_0_100cm_m3m3 ??
      (hidrico.umidade_smap || {}).umidade_m3m3 ??
      (hidrico.umidade_solo || {}).atual_m3m3;

    const tempMedia = clima.temperatura_media_c;
    const declividade = (solo.relevo || {}).declividade_pct;
    const classeRelevo = (solo.relevo || {}).classe_relevo;
    const insights = cruzamento.insights_rpd || [];

    // Atualiza os dois valores na linha inferior do card (Umidade e Temp)
    const strongs = card.querySelectorAll('div:last-child strong');
    if (strongs[0]) strongs[0].textContent = formatarUmidadePct(umidadeRaiz);
    if (strongs[1]) strongs[1].textContent = tempMedia != null ? `${tempMedia.toFixed(1)}°C` : '--';

    // Atualiza badge de status conforme severidade do RPD
    const badge = card.querySelector('.badge');
    if (badge) {
      const temAlta = insights.some((i) => i.severidade === 'Alta');
      badge.className = temAlta ? 'badge badge-orange' : 'badge badge-green';
      badge.textContent = temAlta ? 'Atenção RPD' : 'Ótimo';
    }

    // Atualiza o painel central com o diagnóstico real da NASA + RPD
    if (noticeBox) {
      const nomeTalhao = card.querySelector('strong')?.textContent || 'Talhão Selecionado';
      const diagHtml = insights.length
        ? insights
            .map(
              (item) =>
                `<div style="margin-top:8px;padding:8px;background:var(--bg-body);border-radius:8px;text-align:left;font-size:0.78rem;">
                  <strong>${item.eixo} (${item.severidade}):</strong> ${item.diagnostico}<br/>
                  <span style="color:var(--green);"><em>Ação: ${item.acao_rotacao}</em></span>
                </div>`
            )
            .join('')
        : `<p style="margin-top:6px;">Relevo: <strong>${classeRelevo || '--'} (${declividade ?? '--'}%)</strong> • Chuva 30d: <strong>${(hidrico.precipitacao || {}).chuva_30d_mm ?? '--'} mm</strong></p>`;

      noticeBox.innerHTML = `
        <h3>Telemetria NASA RPD — ${nomeTalhao}</h3>
        <p>Umidade Raiz (0–100 cm): <strong>${formatarUmidadePct(umidadeRaiz)}</strong> • Temp. Média: <strong>${tempMedia ?? '--'}°C</strong> • ET₀ 30d: <strong>${clima.et0_30d_mm ?? '--'} mm</strong></p>
        ${diagHtml}
        <div style="margin-top:10px;">
          <span class="badge badge-green">${card.dataset.coord || ''}</span>
        </div>
      `;
    }
  }

  async function selecionarTalhao(card) {
    cards.forEach((c) => c.classList.remove('active'));
    pins.forEach((p) => p.classList.remove('selected'));
    card.classList.add('active');

    const plotId = card.dataset.plot;
    const pin = document.querySelector(`.map-pin[data-plot="${plotId}"]`);
    if (pin) pin.classList.add('selected');

    if (coordBadge) {
      coordBadge.textContent = `${card.dataset.coord || ''} (Consultando NASA...)`;
    }

    const { lat, lon } = extrairLatLon(card);
    const dados = await buscarAnaliseNASA(lat, lon);

    if (coordBadge) {
      coordBadge.textContent = card.dataset.coord || `Lat: ${lat} | Lng: ${lon}`;
    }

    if (dados) {
      atualizarCardTalhao(card, dados);
    }
  }

  cards.forEach((card) => {
    card.addEventListener('click', () => selecionarTalhao(card));
  });

  pins.forEach((pin) => {
    pin.style.cursor = 'pointer';
    pin.addEventListener('click', () => {
      const targetCard = document.querySelector(`.plot-card[data-plot="${pin.dataset.plot}"]`);
      if (targetCard) selecionarTalhao(targetCard);
    });
  });

  // Carrega automaticamente o primeiro talhão ativo ao abrir a página
  const ativoInicial = document.querySelector('.plot-card.active') || cards[0];
  if (ativoInicial) selecionarTalhao(ativoInicial);
});