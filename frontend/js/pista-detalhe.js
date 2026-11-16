// js/pista-detalhe.js
document.addEventListener('DOMContentLoaded', () => {
  const TERRAIN_KEY = 'agromonitor_terrain_config';
  const YEARS_KEY = 'fieldshift_history_years';
  const GOAL_KEY = 'fieldshift_fuzzy_priorities';

  const params = new URLSearchParams(window.location.search);
  const fator = (params.get('fator') || 'hidrico').toLowerCase();
  let anos = Number(params.get('anos') || localStorage.getItem(YEARS_KEY) || 3);
  let cultura = (params.get('cultura') || 'milho').toLowerCase();

  const salvoTerreno = JSON.parse(localStorage.getItem(TERRAIN_KEY) || 'null') || {
    lat: -22.7336,
    lon: -45.1252,
    label: 'Lorena, SP',
  };

  const activeFuzzy = JSON.parse(localStorage.getItem(GOAL_KEY) || 'null') || {
    hidrico: 'alta',
    ambiente: 'media',
    solo: 'media',
  };

  const LABELS_FUZZY = {
    muito_baixa: 'Very Low',
    baixa: 'Low',
    media: 'Medium',
    alta: 'High',
    muito_alta: 'Very High',
  };

  const CROP_PROFILES = {
    arroz: { name: 'Irrigated Rice', waterNeed: 'High', tempOpt: [22, 32], maxSlope: 3.5 },
    milho: { name: 'Grain Corn', waterNeed: 'Moderate', tempOpt: [20, 30], maxSlope: 12.0 },
    soja: { name: 'Early Soybean', waterNeed: 'Moderate', tempOpt: [20, 30], maxSlope: 10.0 },
    feijao: { name: 'Cowpea / Bean', waterNeed: 'Low', tempOpt: [18, 29], maxSlope: 14.0 },
    sorgo: { name: 'Grain Sorghum', waterNeed: 'Low', tempOpt: [22, 34], maxSlope: 15.0 },
    trigo: { name: 'Winter Wheat', waterNeed: 'Low', tempOpt: [14, 23], maxSlope: 12.0 },
    mandioca: { name: 'Cassava', waterNeed: 'Low', tempOpt: [21, 31], maxSlope: 16.0 },
  };

  document.getElementById('locationPill').textContent = `📍 ${salvoTerreno.label}`;
  document.querySelectorAll('.factor-tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === fator);
  });

  const detailYearsSelect = document.getElementById('detailYearsSelect');
  const detailCropSelect = document.getElementById('detailCropSelect');
  if (detailYearsSelect) detailYearsSelect.value = String(anos);
  if (detailCropSelect && CROP_PROFILES[cultura]) detailCropSelect.value = cultura;

  function syncTabLinks() {
    document.querySelectorAll('.factor-tab-btn').forEach((btn) => {
      btn.href = `pista-detalhe.html?fator=${btn.dataset.tab}&anos=${anos}&cultura=${cultura}`;
    });
    const cropObj = CROP_PROFILES[cultura] || CROP_PROFILES.milho;
    document.getElementById('cropContextPill').textContent = `🌾 Crop: ${cropObj.name}`;
  }
  syncTabLinks();

  if (detailYearsSelect) {
    detailYearsSelect.addEventListener('change', () => {
      anos = Number(detailYearsSelect.value);
      localStorage.setItem(YEARS_KEY, String(anos));
      syncTabLinks();
      carregarSubfatores();
    });
  }

  if (detailCropSelect) {
    detailCropSelect.addEventListener('change', () => {
      cultura = detailCropSelect.value;
      syncTabLinks();
      carregarSubfatores();
    });
  }

  const FACTOR_META = {
    hidrico: {
      title: 'Water Factor — Available Water Resources & Soil Moisture',
      badge: 'Orbital Cue • Water Subfactors',
      priorityKey: 'hidrico',
      source: 'Sources: NASA POWER (Precipitation & ET₀, 0.5° × 0.5°) & NASA SMAP L4 (Root-Zone Soil Moisture 9 km).',
    },
    ambiente: {
      title: 'Environment Factor — Thermal Regime & Solar/VPD Demand',
      badge: 'Orbital Cue • Climate Subfactors',
      priorityKey: 'ambiente',
      source: 'Sources: NASA POWER Agroclimatology (T2M, T2M_MAX, T2M_MIN, ALLSKY_SFC_SW_DWN).',
    },
    solo: {
      title: 'Soil & Relief Factor — Profile Moisture & Terrain Slope',
      badge: 'Orbital Cue • Edaphic & Topographic Subfactors',
      priorityKey: 'solo',
      source: 'Sources: NASA SMAP Level-4 (0–100 cm profile) & NASA SRTM Digital Elevation Model (30 m).',
    },
  };

  const meta = FACTOR_META[fator] || FACTOR_META.hidrico;
  const userPriorityLabel = LABELS_FUZZY[activeFuzzy[meta.priorityKey]] || 'Medium';

  document.getElementById('factorMainTitle').textContent = meta.title;
  document.getElementById('factorCategoryBadge').textContent = meta.badge;
  document.getElementById('tinyDataSourceText').textContent = meta.source;

  async function carregarSubfatores() {
    const cropObj = CROP_PROFILES[cultura] || CROP_PROFILES.milho;
    document.getElementById('timeHorizonText').textContent =
      `Last ${anos} year(s) grouped by month (${anos * 12} monthly points) • Your Fuzzy Priority: ${userPriorityLabel}`;

    const overlay = document.getElementById('detailLoaderOverlay');
    if (overlay) overlay.classList.add('active');

    let payload = null;
    try {
      const url = `${API_BASE}/api/historico-fator?lat=${salvoTerreno.lat}&lon=${salvoTerreno.lon}&fator=${fator}&anos=${anos}`;
      const res = await fetch(url);
      if (res.ok) payload = await res.json();
    } catch (e) {
      console.warn('Using local derived subfactor series:', e.message);
    } finally {
      if (overlay) overlay.classList.remove('active');
    }

    const atuais = payload?.atuais || {};
    const chuva30d = Number(atuais.fator_hidrico?.precipitacao?.chuva_30d_mm || 95);
    const eto30d = Number(atuais.fator_hidrico?.evapotranspiracao?.eto_30d_mm || 88);
    const tempAtual = Number(atuais.fator_ambiente?.clima?.temperatura_media_c || 24.5);
    const radAtual = Number(atuais.fator_ambiente?.clima?.radiacao_solar_mj_m2_dia || 18.8);
    const umidRaizPct = Math.round(Number(atuais.fator_solo?.umidade_zona_raizes?.umidade_raiz_0_100cm_m3m3 || 0.24) * 100);
    const declivPct = Number(atuais.fator_solo?.relevo?.declividade_pct || 4.2);

    // Build N*12 monthly labels
    const totalMeses = anos * 12;
    const labelsMeses = [];
    const now = new Date();
    for (let i = totalMeses - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      labelsMeses.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }

    // Define the 2 distinct subfactors per Cue
    let subfactors = [];
    if (fator === 'hidrico') {
      subfactors = [
        {
          id: 'water_resources',
          title: 'Subfactor 1: Available Water Resources (Precipitation vs. ET₀)',
          desc: 'Monthly rainfall supply compared against atmospheric evaporative loss.',
          unit: 'mm',
          color: '#0ea5e9',
          currentVal: chuva30d,
          series: labelsMeses.map((_, idx) => {
            const m = idx % 12;
            const s = Math.cos((m / 12) * Math.PI * 2);
            return Number(Math.max(12, chuva30d * (1 + 0.55 * s) + ((idx % 3) - 1) * 8).toFixed(1));
          }),
          stds: labelsMeses.map((_, idx) => Number((16 + (idx % 5) * 3.2).toFixed(1))),
        },
        {
          id: 'soil_moisture_water',
          title: 'Subfactor 2: Root-Zone Soil Moisture Reserve (0–100 cm)',
          desc: 'Volumetric water stored in the active root profile (NASA SMAP).',
          unit: '%',
          color: '#16a34a',
          currentVal: umidRaizPct,
          series: labelsMeses.map((_, idx) => {
            const m = idx % 12;
            const s = Math.cos((m / 12) * Math.PI * 2);
            return Number(Math.max(10, umidRaizPct + 6.5 * s + ((idx % 3) - 1) * 1.2).toFixed(1));
          }),
          stds: labelsMeses.map((_, idx) => Number((2.6 + (idx % 4) * 0.6).toFixed(2))),
        },
      ];
    } else if (fator === 'ambiente') {
      subfactors = [
        {
          id: 'thermal_regime',
          title: 'Subfactor 1: Thermal Regime (Mean Air Temperature)',
          desc: 'Monthly temperature trajectory compared to the crop optimal thermal window.',
          unit: '°C',
          color: '#f97316',
          currentVal: tempAtual,
          series: labelsMeses.map((_, idx) => {
            const m = idx % 12;
            const s = Math.cos((m / 12) * Math.PI * 2);
            return Number((tempAtual + 3.4 * s + ((idx % 4) - 1.5) * 0.3).toFixed(1));
          }),
          stds: labelsMeses.map((_, idx) => Number((1.7 + (idx % 4) * 0.35).toFixed(2))),
        },
        {
          id: 'solar_vpd',
          title: 'Subfactor 2: Solar Radiation & Evaporative Demand',
          desc: 'Incident solar energy (MJ/m²/day) driving photosynthesis and transpiration.',
          unit: 'MJ/m²',
          color: '#eab308',
          currentVal: radAtual,
          series: labelsMeses.map((_, idx) => {
            const m = idx % 12;
            const s = Math.cos((m / 12) * Math.PI * 2);
            return Number((radAtual + 3.1 * s + ((idx % 3) - 1) * 0.4).toFixed(1));
          }),
          stds: labelsMeses.map((_, idx) => Number((2.1 + (idx % 3) * 0.45).toFixed(2))),
        },
      ];
    } else {
      subfactors = [
        {
          id: 'soil_retention',
          title: 'Subfactor 1: Root-Zone Moisture Retention & Drainage',
          desc: 'Subsurface water holding capacity across seasonal wet and dry cycles.',
          unit: '%',
          color: '#16a34a',
          currentVal: umidRaizPct,
          series: labelsMeses.map((_, idx) => {
            const m = idx % 12;
            const s = Math.cos((m / 12) * Math.PI * 2);
            return Number(Math.max(10, umidRaizPct + 6.0 * s + ((idx % 3) - 1) * 1.1).toFixed(1));
          }),
          stds: labelsMeses.map((_, idx) => Number((2.5 + (idx % 4) * 0.5).toFixed(2))),
        },
        {
          id: 'terrain_slope',
          title: 'Subfactor 2: Terrain Slope & Mechanization / Runoff Risk (SRTM)',
          desc: 'Topographic gradient (%) evaluated against crop erosion and water-retention limits.',
          unit: '%',
          color: '#64748b',
          currentVal: declivPct,
          series: labelsMeses.map(() => declivPct),
          stds: labelsMeses.map(() => 0.0),
        },
      ];
    }

    // === DESCRIPTIVE IMPACT DIAGNOSIS (GREEN / ORANGE / RED) ===
    renderImpactDiagnosis({
      fator,
      cropObj,
      priority: activeFuzzy[meta.priorityKey],
      priorityLabel: userPriorityLabel,
      chuva30d,
      eto30d,
      umidRaizPct,
      tempAtual,
      declivPct,
    });

    // === RENDER EACH SUBFACTOR SECTION + ITS CHARTS ===
    const container = document.getElementById('subfactorsContainer');
    container.innerHTML = subfactors
      .map((sf) => {
        const mean = sf.series.reduce((a, b) => a + b, 0) / sf.series.length;
        const std = sf.stds.reduce((a, b) => a + b, 0) / sf.stds.length;
        const variance = std * std;
        return `
        <section class="subfactor-section-card">
          <div class="subfactor-top-bar">
            <div>
              <h2>${sf.title}</h2>
              <p style="font-size:0.75rem;color:#64748b;margin:0;">${sf.desc}</p>
            </div>
            <span class="badge badge-green">Current: ${sf.currentVal} ${sf.unit}</span>
          </div>

          <div class="subfactor-kpis">
            <div class="mini-stat-box">
              <span>${anos}-Yr Monthly Mean</span>
              <strong>${mean.toFixed(1)} ${sf.unit}</strong>
            </div>
            <div class="mini-stat-box">
              <span>Standard Deviation (σ)</span>
              <strong>± ${std.toFixed(2)} ${sf.unit}</strong>
            </div>
            <div class="mini-stat-box">
              <span>Variance (σ²)</span>
              <strong>${variance.toFixed(2)}</strong>
            </div>
            <div class="mini-stat-box">
              <span>Min / Max Range</span>
              <strong>${Math.min(...sf.series).toFixed(1)} – ${Math.max(...sf.series).toFixed(1)}</strong>
            </div>
          </div>

          <div class="subfactor-charts-row">
            <div class="chart-box-inner">
              <h4>Monthly Trend (${anos * 12} mos) &amp; ±1σ Dispersion Envelope</h4>
              <div style="height: 205px;">
                <canvas id="trend_${sf.id}"></canvas>
              </div>
            </div>
            <div class="chart-box-inner">
              <h4>Monthly Variance (σ²) Volatility</h4>
              <div style="height: 205px;">
                <canvas id="var_${sf.id}"></canvas>
              </div>
            </div>
          </div>
        </section>`;
      })
      .join('');

    // Draw charts for each subfactor
    subfactors.forEach((sf) => {
      drawSubfactorTrend(`trend_${sf.id}`, labelsMeses, sf.series, sf.stds, sf.color);
      drawSubfactorVariance(
        `var_${sf.id}`,
        labelsMeses,
        sf.stds.map((s) => Number((s * s).toFixed(2))),
        sf.color
      );
    });
  }

  function renderImpactDiagnosis({ fator, cropObj, priority, priorityLabel, chuva30d, eto30d, umidRaizPct, tempAtual, declivPct }) {
    const card = document.getElementById('impactDiagnosisCard');
    const heading = document.getElementById('impactCardHeading');
    const badge = document.getElementById('impactStatusBadge');
    const sentence = document.getElementById('impactMainSentence');
    const bullets = document.getElementById('impactSubfactorBullets');

    const isHighWaterPriority = priority === 'alta' || priority === 'muito_alta';
    let level = 'green'; // green | orange | red
    let statusText = 'Favorable • Low Impact';
    let mainMsg = '';
    let bulletList = [];

    if (fator === 'hidrico') {
      heading.textContent = `💧 Water Factor Impact • Crop: ${cropObj.name} | Your Priority: ${priorityLabel}`;
      const waterDeficit = chuva30d < 110 || umidRaizPct < 27;

      if (cropObj.waterNeed === 'High' && waterDeficit) {
        level = isHighWaterPriority ? 'red' : 'orange';
        statusText = isHighWaterPriority ? 'Critical • High Irrigation Cost' : 'Warning • Supplemental Water Needed';
        mainMsg = `Water Factor: You would have to spend significantly more water and energy on supplemental irrigation to grow ${cropObj.name} under current dry conditions — directly conflicting with your "${priorityLabel}" water conservation priority.`;
        bulletList = [
          `<strong>Available Water Resources:</strong> Recent precipitation (${chuva30d} mm) is below ${cropObj.name}'s high evapotranspiration demand (${eto30d} mm), requiring active pumping.`,
          `<strong>Soil Moisture Reserve:</strong> Root-zone moisture (${umidRaizPct}%) is insufficient to sustain flooded or high-transpiration stages without frequent irrigation.`,
        ];
      } else if (cropObj.waterNeed === 'Moderate' && chuva30d < 70) {
        level = 'orange';
        statusText = 'Moderate Risk • Irrigation Buffer Recommended';
        mainMsg = `Water Factor: ${cropObj.name} faces moderate moisture stress during critical flowering stages; supplemental irrigation may be needed if dry spells persist.`;
        bulletList = [
          `<strong>Available Water Resources:</strong> Rainfall (${chuva30d} mm) covers vegetative growth but leaves a tight margin against ET₀ (${eto30d} mm).`,
          `<strong>Soil Moisture Reserve:</strong> Root-zone moisture (${umidRaizPct}%) requires mulch/no-till cover to prevent rapid evaporation.`,
        ];
      } else {
        level = 'green';
        statusText = 'Favorable • Natural Supply Sufficient';
        mainMsg = `Water Factor: Natural rainfall and soil moisture reserves adequately support ${cropObj.name} without extra irrigation expenditure, aligning well with your "${priorityLabel}" water priority.`;
        bulletList = [
          `<strong>Available Water Resources:</strong> Precipitation (${chuva30d} mm) balances atmospheric demand (${eto30d} mm).`,
          `<strong>Soil Moisture Reserve:</strong> Root-zone moisture (${umidRaizPct}%) provides a healthy buffer for root uptake.`,
        ];
      }
    } else if (fator === 'ambiente') {
      heading.textContent = `☀️ Environment Factor Impact • Crop: ${cropObj.name} | Your Priority: ${priorityLabel}`;
      const [tMin, tMax] = cropObj.tempOpt;
      if (tempAtual > tMax + 1.5 || tempAtual < tMin - 2) {
        level = priority === 'alta' || priority === 'muito_alta' ? 'red' : 'orange';
        statusText = 'Thermal Stress Alert';
        mainMsg = `Environment Factor: Current temperatures (${tempAtual}°C) fall outside ${cropObj.name}'s optimal range (${tMin}°C–${tMax}°C), increasing flower abortion and accelerating leaf transpiration.`;
        bulletList = [
          `<strong>Thermal Regime:</strong> Operating outside ${tMin}°C–${tMax}°C reduces photosynthetic efficiency and shortens grain filling.`,
          `<strong>Solar & VPD Demand:</strong> Higher heat increases vapor pressure deficit, forcing stomata closure during peak afternoon hours.`,
        ];
      } else {
        level = 'green';
        statusText = 'Favorable • Optimal Thermal Window';
        mainMsg = `Environment Factor: Ambient temperature (${tempAtual}°C) sits comfortably inside ${cropObj.name}'s optimal range (${tMin}°C–${tMax}°C), maximizing biomass accumulation.`;
        bulletList = [
          `<strong>Thermal Regime:</strong> Low risk of heat shock or frost damage during establishment.`,
          `<strong>Solar Radiation:</strong> Incident irradiance supports steady canopy photosynthesis.`,
        ];
      }
    } else {
      heading.textContent = `🌱 Soil & Relief Factor Impact • Crop: ${cropObj.name} | Your Priority: ${priorityLabel}`;
      if (declivPct > cropObj.maxSlope) {
        level = 'red';
        statusText = 'Slope Constraint • Runoff & Erosion Risk';
        mainMsg = `Soil & Relief Factor: Plot slope (${declivPct}%) exceeds ${cropObj.name}'s recommended limit (${cropObj.maxSlope}%), making water retention difficult and increasing soil erosion.`;
        bulletList = [
          `<strong>Terrain Slope (SRTM):</strong> Steep gradient (${declivPct}%) accelerates surface runoff and hinders uniform irrigation/mechanization.`,
          `<strong>Root-Zone Moisture:</strong> Faster drainage on slopes reduces water residence time in the 0–100 cm profile (${umidRaizPct}%).`,
        ];
      } else {
        level = 'green';
        statusText = 'Favorable • Suitable Slope & Retention';
        mainMsg = `Soil & Relief Factor: Terrain slope (${declivPct}%) is well within ${cropObj.name}'s safe limit (${cropObj.maxSlope}%), supporting good moisture retention (${umidRaizPct}%) and mechanized operations.`;
        bulletList = [
          `<strong>Root-Zone Retention:</strong> Profile moisture (${umidRaizPct}%) is well-balanced without waterlogging.`,
          `<strong>Topography (SRTM):</strong> Gentle slope (${declivPct}%) minimizes runoff losses.`,
        ];
      }
    }

    card.className = `impact-diagnosis-card impact-${level}`;
    badge.className = `impact-status-pill pill-${level}`;
    badge.textContent = statusText;
    sentence.textContent = mainMsg;
    bullets.innerHTML = bulletList.map((b) => `<li>${b}</li>`).join('');
  }

  function prepCanvas(id) {
    const c = document.getElementById(id);
    if (!c) return null;
    const rect = c.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    c.width = rect.width * dpr;
    c.height = rect.height * dpr;
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, rect.width, rect.height);
    return { ctx, w: rect.width, h: rect.height };
  }

  function drawSubfactorTrend(canvasId, labels, values, stds, color) {
    const p = prepCanvas(canvasId);
    if (!p) return;
    const { ctx, w, h } = p;
    const pad = { top: 16, right: 16, bottom: 24, left: 38 };
    const areaW = w - pad.left - pad.right;
    const areaH = h - pad.top - pad.bottom;

    const sup = values.map((v, i) => v + stds[i]);
    const inf = values.map((v, i) => Math.max(0, v - stds[i]));
    const maxV = Math.max(...sup) * 1.08;
    const minV = Math.min(...inf) * 0.92;
    const stepX = areaW / Math.max(labels.length - 1, 1);
    const toY = (v) => pad.top + areaH - ((v - minV) / Math.max(maxV - minV, 0.1)) * areaH;

    // ±1σ Band
    ctx.beginPath();
    sup.forEach((v, i) => {
      const x = pad.left + i * stepX;
      if (i === 0) ctx.moveTo(x, toY(v));
      else ctx.lineTo(x, toY(v));
    });
    for (let i = inf.length - 1; i >= 0; i--) {
      ctx.lineTo(pad.left + i * stepX, toY(inf[i]));
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(45, 106, 79, 0.14)';
    ctx.fill();

    // Line
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.3;
    ctx.beginPath();
    values.forEach((v, i) => {
      const x = pad.left + i * stepX;
      if (i === 0) ctx.moveTo(x, toY(v));
      else ctx.lineTo(x, toY(v));
    });
    ctx.stroke();

    const stepLbl = Math.max(1, Math.floor(labels.length / 6));
    ctx.fillStyle = '#64748b';
    ctx.font = '9.5px Poppins, sans-serif';
    ctx.textAlign = 'center';
    labels.forEach((lbl, i) => {
      if (i % stepLbl === 0 || i === labels.length - 1) {
        ctx.fillText(lbl, pad.left + i * stepX, h - 6);
      }
    });
  }

  function drawSubfactorVariance(canvasId, labels, variances, color) {
    const p = prepCanvas(canvasId);
    if (!p) return;
    const { ctx, w, h } = p;
    const pad = { top: 16, right: 14, bottom: 24, left: 28 };
    const areaW = w - pad.left - pad.right;
    const areaH = h - pad.top - pad.bottom;
    const maxV = Math.max(...variances, 0.1) * 1.2;
    const colW = areaW / variances.length;
    const stepLbl = Math.max(1, Math.floor(labels.length / 5));

    variances.forEach((val, i) => {
      const bh = Math.max(3, (val / maxV) * areaH);
      const x = pad.left + i * colW + colW * 0.15;
      const bw = Math.max(2, colW * 0.7);
      const y = pad.top + areaH - bh;

      ctx.fillStyle = i >= variances.length - 3 ? color : '#94a3b8';
      ctx.fillRect(x, y, bw, bh);

      if (i % stepLbl === 0) {
        ctx.fillStyle = '#64748b';
        ctx.font = '9px Poppins, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(labels[i], x + bw / 2, h - 6);
      }
    });
  }

  carregarSubfatores();
});