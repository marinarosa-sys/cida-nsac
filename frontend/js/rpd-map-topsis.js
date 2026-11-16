// js/rpd-map-topsis.js
document.addEventListener('DOMContentLoaded', () => {
  const TERRAIN_KEY = 'agromonitor_terrain_config';
  const GOAL_KEY = 'fieldshift_fuzzy_priorities';
  const CUSTOM_CROPS_KEY = 'fieldshift_custom_crops';
  const YEARS_KEY = 'fieldshift_history_years';

  // ROTATING AGRONOMIC CROP FACTS FOR BACKEND LOADING STATE
  const CROP_FACTS = [
    {
      tag: '🌾 Sorghum • Drought Resilience',
      text: 'Grain sorghum features a waxy leaf cuticle and deep fibrous roots up to 1.8 m, requiring 30–40% less water than corn to produce comparable biomass.',
    },
    {
      tag: '🌱 Soybean • Nitrogen Fixation',
      text: 'Through symbiosis with Bradyrhizobium bacteria, soybeans fix up to 150–200 kg/ha of atmospheric nitrogen, enriching soil fertility for the subsequent crop.',
    },
    {
      tag: '🌽 Grain Corn • Critical Flowering Window',
      text: 'Corn is most sensitive to water stress during tasseling and silking (R1 stage); just 4 days of severe moisture deficit can reduce grain yield by up to 40%.',
    },
    {
      tag: '🫘 Cowpea • Fast-Cycle Cover',
      text: 'With a 70–85 day cycle, cowpea thrives in warm windows and rapidly establishes canopy cover, suppressing weeds and reducing soil evaporation.',
    },
    {
      tag: '🌾 Winter Wheat • Thermal Sensitivity',
      text: 'Wheat achieves peak tillering between 14°C and 22°C; temperatures above 28°C during grain filling accelerate senescence and reduce kernel weight.',
    },
    {
      tag: '🥔 Cassava • Low-Input Hardiness',
      text: 'Cassava tolerates acidic, low-phosphorus soils and survives months of dry weather by shedding older leaves and resuming growth when rains return.',
    },
    {
      tag: '🍚 Lowland Rice • Slope & Water Demand',
      text: 'Irrigated rice performs best on flat terrain (< 3.5% slope) where bunded fields maintain uniform water depth and minimize runoff losses.',
    },
  ];

  const loaderOverlay = document.getElementById('nasaLoaderOverlay');
  const loaderSubTitle = document.getElementById('loaderSubTitle');
  const cropFactCategory = document.getElementById('cropFactCategory');
  const cropFactText = document.getElementById('cropFactText');
  let factInterval = null;
  let factIdx = 0;

  function showLoader(anos) {
    if (!loaderOverlay) return;
    if (loaderSubTitle) {
      loaderSubTitle.textContent = `Fetching ${anos}-year NASA POWER & SMAP series (${anos * 12} monthly buckets) and computing Fuzzy TOPSIS rankings...`;
    }
    const renderFact = () => {
      const item = CROP_FACTS[factIdx % CROP_FACTS.length];
      if (cropFactCategory) cropFactCategory.textContent = item.tag;
      if (cropFactText) cropFactText.textContent = item.text;
      factIdx++;
    };
    renderFact();
    clearInterval(factInterval);
    factInterval = setInterval(renderFact, 3800);
    loaderOverlay.classList.add('active');
  }

  function hideLoader() {
    clearInterval(factInterval);
    if (loaderOverlay) loaderOverlay.classList.remove('active');
  }

  // 1. LINGUISTIC FUZZY PRIORITIES
  const LABELS_FUZZY = {
    muito_baixa: 'Very Low',
    baixa: 'Low',
    media: 'Medium',
    alta: 'High',
    muito_alta: 'Very High',
  };

  const goalModal = document.getElementById('goalOnboardingModal');
  const savedGoalBadge = document.getElementById('savedGoalBadge');
  const savedGoalLabel = document.getElementById('savedGoalLabel');
  const saveGoalBtn = document.getElementById('saveGoalBtn');

  const selHid = document.getElementById('fuzzySelectHidrico');
  const selAmb = document.getElementById('fuzzySelectAmbiente');
  const selSol = document.getElementById('fuzzySelectSolo');

  let fuzzyPrefs = JSON.parse(localStorage.getItem(GOAL_KEY) || 'null');
  let activeFuzzy = fuzzyPrefs || {
    hidrico: 'alta',
    ambiente: 'media',
    solo: 'media',
  };

  function sincronizarSelectsFuzzy(prefs) {
    if (selHid) selHid.value = prefs.hidrico;
    if (selAmb) selAmb.value = prefs.ambiente;
    if (selSol) selSol.value = prefs.solo;

    const resumo = `Water: ${LABELS_FUZZY[prefs.hidrico]} • Climate: ${LABELS_FUZZY[prefs.ambiente]} • Soil: ${LABELS_FUZZY[prefs.solo]}`;
    if (savedGoalLabel) savedGoalLabel.textContent = resumo;
    if (document.getElementById('headerObjectiveTag')) {
      document.getElementById('headerObjectiveTag').textContent = `Water: ${LABELS_FUZZY[prefs.hidrico]}`;
    }
  }

  sincronizarSelectsFuzzy(activeFuzzy);
  if (!fuzzyPrefs && goalModal) goalModal.classList.add('open');

  if (saveGoalBtn) {
    saveGoalBtn.addEventListener('click', () => {
      activeFuzzy = {
        hidrico: selHid.value,
        ambiente: selAmb.value,
        solo: selSol.value,
      };
      localStorage.setItem(GOAL_KEY, JSON.stringify(activeFuzzy));
      sincronizarSelectsFuzzy(activeFuzzy);
      goalModal.classList.remove('open');
      consultarBackendComParametros();
    });
  }
  if (savedGoalBadge) savedGoalBadge.addEventListener('click', () => goalModal.classList.add('open'));

  // 2. HISTORICAL YEARS SELECTOR & CUE LINKS SYNC
  const historyYearsSelect = document.getElementById('historyYearsSelect');
  const yearsDisclaimerText = document.getElementById('yearsDisclaimerText');
  const savedYears = localStorage.getItem(YEARS_KEY) || '1';
  if (historyYearsSelect) historyYearsSelect.value = savedYears;

  function atualizarLinksPistas(anos) {
    const cropAtual = cropSelect?.value || 'milho';
    const lH = document.getElementById('linkPistaHidrico');
    const lA = document.getElementById('linkPistaAmbiente');
    const lS = document.getElementById('linkPistaSolo');
    if (lH) lH.href = `pista-detalhe.html?fator=hidrico&anos=${anos}&cultura=${cropAtual}`;
    if (lA) lA.href = `pista-detalhe.html?fator=ambiente&anos=${anos}&cultura=${cropAtual}`;
    if (lS) lS.href = `pista-detalhe.html?fator=solo&anos=${anos}&cultura=${cropAtual}`;

    if (yearsDisclaimerText) {
      if (Number(anos) >= 5) {
        yearsDisclaimerText.innerHTML = `⚠️ <strong>Extended series (${anos} yrs / ${anos * 12} mos):</strong> Processing large multi-year NASA POWER &amp; SMAP archives can take <strong>20 to 45 seconds</strong> on the first query.`;
      } else {
        yearsDisclaimerText.innerHTML = `⏱️ <strong>Processing notice:</strong> Analyzing <strong>${anos} year(s) (${anos * 12} months)</strong>. Longer series (5–10 yrs) take 15–45s on first load.`;
      }
    }
  }

  // 3. CUSTOM CROPS
  const cropSelect = document.getElementById('cropSelect');
  const windowSelect = document.getElementById('windowSelect');
  const newCropModal = document.getElementById('newCropModal');
  const closeNewCropBtn = document.getElementById('closeNewCropBtn');
  const customCropForm = document.getElementById('customCropForm');

  function carregarCulturasPersonalizadasNoSelect() {
    const lista = JSON.parse(localStorage.getItem(CUSTOM_CROPS_KEY) || '[]');
    cropSelect.querySelectorAll('option[data-custom="1"]').forEach((opt) => opt.remove());
    const optNova = cropSelect.querySelector('option[value="__nova__"]');

    lista.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = `Plant: ${c.nome} (Custom)`;
      opt.dataset.custom = '1';
      cropSelect.insertBefore(opt, optNova);
    });
  }
  carregarCulturasPersonalizadasNoSelect();

  if (closeNewCropBtn) {
    closeNewCropBtn.addEventListener('click', () => {
      newCropModal.classList.remove('open');
      if (cropSelect.value === '__nova__') cropSelect.value = 'milho';
    });
  }

  if (customCropForm) {
    customCropForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const nome = document.getElementById('customCropName').value.trim();
      if (!nome) return;
      const nova = {
        id: 'custom_' + Date.now(),
        nome,
        demanda_hidrica: document.getElementById('customCropWater').value,
        temp_min: Number(document.getElementById('customCropTempMin').value),
        temp_max: Number(document.getElementById('customCropTempMax').value),
        decliv_max: Number(document.getElementById('customCropSlopeMax').value),
        ciclo_dias: Number(document.getElementById('customCropCycle').value),
      };
      const atuais = JSON.parse(localStorage.getItem(CUSTOM_CROPS_KEY) || '[]');
      atuais.push(nova);
      localStorage.setItem(CUSTOM_CROPS_KEY, JSON.stringify(atuais));
      carregarCulturasPersonalizadasNoSelect();
      cropSelect.value = nova.id;
      newCropModal.classList.remove('open');
      consultarBackendComParametros();
    });
  }

  // 4. SATELLITE MAP
  const salvoTerreno = JSON.parse(localStorage.getItem(TERRAIN_KEY) || 'null') || {
    lat: -22.7336,
    lon: -45.1252,
    label: 'Lorena, SP',
    address: 'Lorena, SP',
  };

  const addressInput = document.getElementById('terrainAddressInput');
  if (addressInput && salvoTerreno.address) addressInput.value = salvoTerreno.address;

  const map = L.map('aptitudeMap', { zoomControl: false }).setView([salvoTerreno.lat, salvoTerreno.lon], 15);
  L.control.zoom({ position: 'bottomleft' }).addTo(map);

  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri &mdash; NASA',
    maxZoom: 19,
  }).addTo(map);

  function gerarCoordsTalhao(lat, lon) {
    const dLat = 0.0032;
    const dLon = 0.0042;
    return [
      [lat + dLat, lon - dLon * 0.7],
      [lat + dLat * 0.6, lon + dLon],
      [lat - dLat, lon + dLon * 0.6],
      [lat - dLat * 0.7, lon - dLon],
    ];
  }

  const talhaoPolygon = L.polygon(gerarCoordsTalhao(salvoTerreno.lat, salvoTerreno.lon), {
    color: '#ffffff',
    weight: 2.5,
    dashArray: '6, 6',
    fillColor: '#22c55e',
    fillOpacity: 0.42,
  }).addTo(map);

  let dadosGlobais = null;

  // 5. SEMANTIC CLASSIFICATION IN ENGLISH
  function classificarNivelSemantico(scorePct) {
    if (scorePct >= 82) return { nivel: 'Optimal', propicio: 'Favorable', clsLvl: 'lvl-otimo', clsBg: 'bg-otimo' };
    if (scorePct >= 66) return { nivel: 'Good', propicio: 'Favorable', clsLvl: 'lvl-bom', clsBg: 'bg-bom' };
    if (scorePct >= 50) return { nivel: 'Moderate', propicio: 'Manageable', clsLvl: 'lvl-mediano', clsBg: 'bg-mediano' };
    if (scorePct >= 34) return { nivel: 'Warning', propicio: 'Unfavorable', clsLvl: 'lvl-alerta', clsBg: 'bg-alerta' };
    return { nivel: 'Critical', propicio: 'Unfavorable', clsLvl: 'lvl-critico', clsBg: 'bg-critico' };
  }

  function paletaCor(corNome) {
    if (corNome === 'verde') return { fill: '#22c55e', text: '#16a34a', badge: 'badge-green' };
    if (corNome === 'laranja') return { fill: '#f97316', text: '#ea580c', badge: 'badge-warning' };
    return { fill: '#ef4444', text: '#dc2626', badge: 'badge-danger' };
  }

  function avaliarCulturaCustomizada(customCrop, dados) {
    const amb = (dados.atuais?.fator_ambiente?.clima) || {};
    const hid = (dados.atuais?.fator_hidrico?.precipitacao) || {};
    const solo = dados.atuais?.fator_solo || {};
    const temp = Number(amb.temperatura_media_c || 24);
    const chuva = Number(hid.chuva_30d_mm || 90);
    const decliv = Number(solo.relevo?.declividade_pct || 4);

    const sAmb = temp >= customCrop.temp_min && temp <= customCrop.temp_max ? 92 : 55;
    let sHid = chuva >= 75 ? 85 : 58;
    if (customCrop.demanda_hidrica === 'High' && chuva < 110) sHid = 38;
    if (customCrop.demanda_hidrica === 'Low' && chuva >= 45) sHid = 90;
    const sSol = decliv <= customCrop.decliv_max ? 88 : 42;

    const pesoNum = { muito_baixa: 0.1, baixa: 0.3, media: 0.5, alta: 0.78, muito_alta: 0.95 };
    const wH = pesoNum[activeFuzzy.hidrico] || 0.78;
    const wA = pesoNum[activeFuzzy.ambiente] || 0.5;
    const wS = pesoNum[activeFuzzy.solo] || 0.5;
    const score = Math.round((sHid * wH + sAmb * wA + sSol * wS) / (wH + wA + wS));
    const cor_mapa = score >= 68 ? 'verde' : score >= 45 ? 'laranja' : 'vermelho';

    return {
      id: customCrop.id,
      nome: customCrop.nome,
      score_topsis: score,
      cor_mapa,
      status: score >= 68 ? 'High Suitability' : score >= 45 ? 'Moderate Suitability' : 'High Risk',
      demanda_hidrica: customCrop.demanda_hidrica,
      ciclo_dias: customCrop.ciclo_dias,
      manejo: `Custom crop profile: optimal thermal range ${customCrop.temp_min}°C–${customCrop.temp_max}°C and ${customCrop.demanda_hidrica.toLowerCase()} water demand.`,
      criterios: { ambiente_pct: sAmb, hidrico_pct: sHid, solo_pct: sSol },
    };
  }

  function renderizarBarraSegmentada(scorePct, corNome) {
    const container = document.getElementById('segmentedPredictionBar');
    if (!container) return;
    const total = 36;
    const ativos = Math.round((scorePct / 100) * total);
    let html = '';
    for (let i = 0; i < total; i++) {
      let cor = '#e2e8f0';
      if (i < ativos) {
        if (i < total * 0.33) cor = '#ef4444';
        else if (i < total * 0.66) cor = '#f59e0b';
        else cor = '#22c55e';
      }
      html += `<span class="seg-tick" style="background:${cor};opacity:${i < ativos ? 1 : 0.35};"></span>`;
    }
    container.innerHTML = html;

    const statusEl = document.getElementById('meterStatusText');
    if (statusEl) {
      statusEl.textContent = corNome === 'verde' ? 'Favorable for planting' : corNome === 'laranja' ? 'Favorable with management' : 'Unfavorable right now';
      statusEl.style.color = paletaCor(corNome).text;
    }
  }

  function renderizarPainelRPD(dados, cfg) {
    if (!dados) return;
    dadosGlobais = dados;

    const topsis = dados.topsis || {};
    let ranking = [...(topsis.ranking_topsis || [])];
    const selId = cropSelect?.value || 'milho';

    const customList = JSON.parse(localStorage.getItem(CUSTOM_CROPS_KEY) || '[]');
    const customMatch = customList.find((c) => c.id === selId);
    let avaliada = topsis.cultura_avaliada;

    if (customMatch) {
      avaliada = avaliarCulturaCustomizada(customMatch, dados);
      ranking.push(avaliada);
      ranking.sort((a, b) => b.score_topsis - a.score_topsis);
    }

    if (!avaliada) return;

    const pal = paletaCor(avaliada.cor_mapa);
    talhaoPolygon.setStyle({ color: '#ffffff', fillColor: pal.fill, fillOpacity: 0.44 });
    document.getElementById('panelLocationTitle').textContent = cfg.label;
    document.getElementById('floatingCropTitle').textContent = `Plot 1: ${avaliada.nome}`;
    document.getElementById('floatingCoordsTag').textContent = `#RPD-NASA • ${cfg.label}`;

    const fBadge = document.getElementById('floatingTopsisScore');
    fBadge.textContent = `${avaliada.score_topsis}%`;
    fBadge.className = `badge ${pal.badge}`;

    const aptLabel = document.getElementById('floatingAptitudeLabel');
    const aptBar = document.getElementById('floatingAptitudeBar');
    aptLabel.textContent = avaliada.cor_mapa === 'verde' ? 'Favorable' : avaliada.cor_mapa === 'laranja' ? 'Moderate' : 'Critical';
    aptLabel.style.color = pal.text;
    aptBar.style.width = `${avaliada.score_topsis}%`;
    aptBar.style.background = pal.fill;
    document.getElementById('floatingDarkInsight').textContent = avaliada.manejo;

    renderizarBarraSegmentada(avaliada.score_topsis, avaliada.cor_mapa);

    // === CUES ===
    const crit = avaliada.criterios || { hidrico_pct: 75, ambiente_pct: 80, solo_pct: 78 };
    const semHid = classificarNivelSemantico(crit.hidrico_pct);
    const semAmb = classificarNivelSemantico(crit.ambiente_pct);
    const semSol = classificarNivelSemantico(crit.solo_pct);

    const elHN = document.getElementById('pistaHidricoNivel');
    const elHS = document.getElementById('pistaHidricoStatus');
    elHN.textContent = semHid.nivel;
    elHN.className = `pista-level ${semHid.clsLvl}`;
    elHS.textContent = semHid.propicio;
    elHS.className = `pista-propicio ${semHid.clsBg}`;

    const elAN = document.getElementById('pistaAmbienteNivel');
    const elAS = document.getElementById('pistaAmbienteStatus');
    elAN.textContent = semAmb.nivel;
    elAN.className = `pista-level ${semAmb.clsLvl}`;
    elAS.textContent = semAmb.propicio;
    elAS.className = `pista-propicio ${semAmb.clsBg}`;

    const elSN = document.getElementById('pistaSoloNivel');
    const elSS = document.getElementById('pistaSoloStatus');
    elSN.textContent = semSol.nivel;
    elSN.className = `pista-level ${semSol.clsLvl}`;
    elSS.textContent = semSol.propicio;
    elSS.className = `pista-propicio ${semSol.clsBg}`;

    // === EXPECTATIONS ===
    const janelaVal = windowSelect?.value || '0';
    const janelaTexto = janelaVal === '0' ? 'Current Window' : `+${janelaVal} Days Projection`;
    document.getElementById('expWindowTag').textContent = `Expectation • ${janelaTexto}`;

    const expectativaAtendida = avaliada.score_topsis >= 65 && crit.hidrico_pct >= 55 && crit.ambiente_pct >= 55;
    const expBadge = document.getElementById('expStatusBadge');
    const expText = document.getElementById('expSemanticText');

    if (expectativaAtendida) {
      expBadge.textContent = '✓ Expectation Met';
      expBadge.className = 'exp-semantic-tag bg-otimo';
      expText.innerHTML = `<strong>Projected Scenario:</strong> Moisture reserves and thermal stability match the physiological needs of <strong>${avaliada.nome}</strong>. Crop establishment without severe abiotic stress is expected.`;
    } else {
      const gargalo =
        crit.hidrico_pct <= crit.ambiente_pct && crit.hidrico_pct <= crit.solo_pct
          ? 'projected water deficit relative to crop water demand'
          : crit.ambiente_pct <= crit.solo_pct
          ? 'thermal discomfort during the selected window'
          : 'topographic or root-zone soil constraints';

      expBadge.textContent = '⚠ Expectation Not Met';
      expBadge.className = 'exp-semantic-tag bg-alerta';
      expText.innerHTML = `<strong>Projected Scenario:</strong> Risk of <strong>${gargalo}</strong> detected for <strong>${avaliada.nome}</strong>. Full yield performance is not expected under this window and priority weighting.`;
    }

    // === SUGGESTIONS ===
    const leadEl = document.getElementById('topsisContextLead');
    const listEl = document.getElementById('topsisSuggestionsList');
    const outrasBoas = ranking.filter((r) => r.id !== avaliada.id && r.score_topsis >= 60).slice(0, 3);

    if (!expectativaAtendida) {
      leadEl.innerHTML = `Since the <strong>expectation for ${avaliada.nome} was not met</strong>, Fuzzy TOPSIS recommends these higher-resilience alternatives:`;
    } else {
      leadEl.innerHTML = `Since the <strong>expectation for ${avaliada.nome} is met</strong>, it is validated. For crop rotation or diversification, consider:`;
    }

    listEl.innerHTML = (outrasBoas.length ? outrasBoas : ranking.slice(0, 3))
      .map((item, idx) => {
        const sem = classificarNivelSemantico(item.score_topsis);
        return `
          <div class="suggestion-crop-row" data-sim-crop="${item.id}">
            <div>
              <strong>#${idx + 1} ${item.nome}</strong>
              <span style="display:block;font-size:0.68rem;color:#64748b;">Water demand: ${item.demanda_hidrica} • Cycle ${item.ciclo_dias}d</span>
            </div>
            <span class="pista-propicio ${sem.clsBg}">${sem.nivel} (${item.score_topsis}%)</span>
          </div>`;
      })
      .join('');

    listEl.querySelectorAll('[data-sim-crop]').forEach((row) => {
      row.addEventListener('click', () => {
        cropSelect.value = row.dataset.simCrop;
        consultarBackendComParametros();
      });
    });

    // Check if user has past harvests for this crop and predict yield/profit
    if (window.FieldShiftStore) {
      window.FieldShiftStore.listHarvests().then((rows) => {
        const proj = dados.topsis?.projecao_ambiental || {};
        const pred = window.FieldShiftStore.predictFromHistory(rows, selId, {
          rain: proj.chuva_projetada_mm || 95,
          temp: proj.temp_projetada_c || 24.5,
          soil: proj.umidade_projetada_pct || 24,
        });
        const box = document.getElementById('personalForecastBox');
        const txt = document.getElementById('personalForecastText');
        if (box && txt && pred) {
          box.style.display = 'block';
          txt.innerHTML = `Based on your <strong>${pred.samples} past harvest(s)</strong> (correlated with <em>${pred.bestDriver}</em>, r=${pred.correlationR}), expected average output is <strong>${pred.predictedYield} t/ha</strong> and net profit of <strong>$${pred.predictedProfit}/ha</strong>.`;
        } else if (box) {
          box.style.display = 'none';
        }
      });
    }
  }

  // DETAIL MODAL FOR EXPECTATIONS / FUZZY MATH
  const detailModal = document.getElementById('factorDetailModal');
  const closeDetailBtn = document.getElementById('closeFactorDetailBtn');
  if (closeDetailBtn) closeDetailBtn.addEventListener('click', () => detailModal.classList.remove('open'));

  function abrirDetalhesFator(tipo) {
    if (!dadosGlobais || !detailModal) return;
    detailModal.classList.add('open');
    const topsis = dadosGlobais.topsis || {};

    document.getElementById('detailModalTag').textContent = 'RPD + Fuzzy TOPSIS Transparency';
    document.getElementById('detailModalTitle').textContent =
      tipo === 'expectativas' ? 'RPD Scenario Projection & Correlations' : 'Triangular Fuzzy Numbers (TFN) & Full Ranking';
    document.getElementById('detailModalDesc').textContent =
      'Closeness coefficients (CCᵢ) computed from your linguistic priorities and NASA orbital indicators.';

    const canvas = document.getElementById('detailModalCanvas');
    const rect = canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const barras = (topsis.ranking_topsis || []).slice(0, 6).map((r) => ({
      lbl: r.nome,
      val: r.score_topsis,
      max: 100,
      cor: r.cor_mapa === 'verde' ? '#22c55e' : r.cor_mapa === 'laranja' ? '#f59e0b' : '#ef4444',
    }));

    const labelW = 195;
    const maxW = rect.width - labelW - 60;
    const stepY = rect.height / Math.max(barras.length, 1);

    barras.forEach((b, i) => {
      const y = i * stepY + stepY * 0.22;
      const bh = Math.min(20, stepY * 0.52);
      ctx.fillStyle = '#0f172a';
      ctx.font = '600 11px Poppins, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(b.lbl, 4, y + bh * 0.78);

      ctx.fillStyle = '#e2e8f0';
      ctx.beginPath();
      ctx.roundRect(labelW, y, maxW, bh, 6);
      ctx.fill();

      ctx.fillStyle = b.cor;
      ctx.beginPath();
      ctx.roundRect(labelW, y, Math.max(8, Math.min(1, b.val / b.max) * maxW), bh, 6);
      ctx.fill();

      ctx.fillStyle = '#0f172a';
      ctx.font = '700 11px Poppins, sans-serif';
      ctx.fillText(`${b.val}%`, labelW + maxW + 10, y + bh * 0.78);
    });

    document.getElementById('detailModalCriteriaBox').innerHTML = `<pre style="background:#f8fafc;color:#0f172a;padding:12px;border-radius:10px;font-size:0.74rem;overflow-x:auto;">${JSON.stringify(
      topsis.pesos_fuzzy_aplicados || {},
      null,
      2
    )}</pre>`;
  }

  document.querySelectorAll('[data-open-factor]').forEach((el) => {
    el.addEventListener('click', () => abrirDetalhesFator(el.dataset.openFactor));
  });

  if (cropSelect) {
    cropSelect.addEventListener('change', () => {
      if (cropSelect.value === '__nova__') {
        newCropModal.classList.add('open');
        return;
      }
      consultarBackendComParametros();
    });
  }
  if (windowSelect) windowSelect.addEventListener('change', consultarBackendComParametros);

  async function consultarBackendComParametros() {
    const cfg = JSON.parse(localStorage.getItem(TERRAIN_KEY) || 'null') || salvoTerreno;
    const sel = cropSelect?.value || 'milho';
    const culturaApi = sel.startsWith('custom_') ? 'milho' : sel;
    const janela = windowSelect?.value || '0';
    const anos = historyYearsSelect?.value || '3';

    showLoader(anos);
    const url = `${API_BASE}/api/analise?lat=${cfg.lat}&lon=${cfg.lon}&anos=${anos}&cultura=${culturaApi}&janela_dias=${janela}&peso_ambiente=${activeFuzzy.ambiente}&peso_hidrico=${activeFuzzy.hidrico}&peso_solo=${activeFuzzy.solo}`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const dados = await res.json();
      renderizarPainelRPD(dados, cfg);
    } catch (err) {
      console.warn('Waiting for Python backend:', err.message);
    } finally {
      hideLoader();
    }
  }

  // Geocoding & GPS
  const terrainForm = document.getElementById('terrainConfigForm');
  const gpsBtn = document.getElementById('useGpsBtn');

  async function geocodificarEndereco(endereco) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(endereco)}`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    const lista = await res.json();
    if (!lista.length) throw new Error('Location not found.');
    return {
      lat: parseFloat(lista[0].lat),
      lon: parseFloat(lista[0].lon),
      label: lista[0].display_name.split(',').slice(0, 2).join(',').trim(),
    };
  }

  function moverMapaPara(cfg) {
    map.setView([cfg.lat, cfg.lon], 15);
    talhaoPolygon.setLatLngs(gerarCoordsTalhao(cfg.lat, cfg.lon));
  }

  if (gpsBtn) {
    gpsBtn.addEventListener('click', () => {
      if (!navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition((pos) => {
        const cfg = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          label: 'GPS Coordinates',
          address: `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`,
        };
        if (addressInput) addressInput.value = cfg.address;
        localStorage.setItem(TERRAIN_KEY, JSON.stringify(cfg));
        moverMapaPara(cfg);
        consultarBackendComParametros();
      });
    });
  }

  if (terrainForm) {
    terrainForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const end = (addressInput?.value || '').trim();
      if (!end) return;
      try {
        const match = end.match(/^([-\d.]+)\s*,\s*([-\d.]+)$/);
        const coords = match
          ? { lat: parseFloat(match[1]), lon: parseFloat(match[2]), label: 'Manual Coordinates' }
          : await geocodificarEndereco(end);
        const cfg = { ...coords, address: end };
        localStorage.setItem(TERRAIN_KEY, JSON.stringify(cfg));
        moverMapaPara(cfg);
        consultarBackendComParametros();
      } catch (err) {
        alert(err.message);
      }
    });
  }

  consultarBackendComParametros();
});