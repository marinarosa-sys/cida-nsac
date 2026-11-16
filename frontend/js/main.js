// js/main.js
document.addEventListener('DOMContentLoaded', () => {
  // 1. DARK MODE PERSISTENTE
  const darkToggle = document.getElementById('darkModeToggleBtn');
  if (localStorage.getItem('agromonitor_dark_mode') === '1') {
    document.body.classList.add('dark-mode');
    if (darkToggle) darkToggle.classList.add('active');
  }
  if (darkToggle) {
    darkToggle.addEventListener('click', () => {
      const ativo = document.body.classList.toggle('dark-mode');
      darkToggle.classList.toggle('active', ativo);
      localStorage.setItem('agromonitor_dark_mode', ativo ? '1' : '0');
    });
  }

  // 2. PERFIL ATIVO
  const perfilSalvo = JSON.parse(localStorage.getItem('agromonitor_active_user') || 'null');
  if (perfilSalvo) {
    document.querySelectorAll('.user-name').forEach((el) => (el.textContent = perfilSalvo.name));
    document.querySelectorAll('.user-role').forEach((el) => (el.textContent = perfilSalvo.role));
    document.querySelectorAll('.user-avatar').forEach((el) => (el.textContent = perfilSalvo.initials));

    const inputNome = document.getElementById('profileName');
    const inputCargo = document.getElementById('profileRole');
    if (inputNome) inputNome.value = perfilSalvo.name;
    if (inputCargo) inputCargo.value = perfilSalvo.role;
  }

  const saveProfileBtn = document.getElementById('saveProfileBtn');
  if (saveProfileBtn) {
    saveProfileBtn.addEventListener('click', () => {
      const name = document.getElementById('profileName')?.value.trim() || 'Anne Souza';
      const role = document.getElementById('profileRole')?.value.trim() || 'Engenharia';
      const initials = name
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map((p) => p[0].toUpperCase())
        .join('');

      const novoPerfil = { name, role, initials: initials || 'AS' };
      localStorage.setItem('agromonitor_active_user', JSON.stringify(novoPerfil));

      document.querySelectorAll('.user-name').forEach((el) => (el.textContent = novoPerfil.name));
      document.querySelectorAll('.user-role').forEach((el) => (el.textContent = novoPerfil.role));
      document.querySelectorAll('.user-avatar').forEach((el) => (el.textContent = novoPerfil.initials));

      const msg = document.getElementById('profileSavedMsg');
      if (msg) {
        msg.style.display = 'inline-block';
        setTimeout(() => (msg.style.display = 'none'), 2500);
      }
    });
  }

  // 3. DROPDOWN DE NOTIFICAÇÕES
  const notifBtn = document.getElementById('notifToggleBtn');
  const notifDropdown = document.getElementById('notifDropdown');
  if (notifBtn && notifDropdown) {
    notifBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      notifDropdown.classList.toggle('open');
    });
    document.addEventListener('click', (e) => {
      if (!notifDropdown.contains(e.target)) notifDropdown.classList.remove('open');
    });
  }

  // 4. SELETOR DE IDIOMA
  const langBtn = document.getElementById('langToggleBtn');
  const langLabel = document.getElementById('currentLangLabel');
  if (langBtn && langLabel) {
    langLabel.textContent = localStorage.getItem('agromonitor_lang') || 'PT';
    langBtn.addEventListener('click', () => {
      const proximo = langLabel.textContent === 'PT' ? 'EN' : 'PT';
      langLabel.textContent = proximo;
      localStorage.setItem('agromonitor_lang', proximo);
    });
  }

  // 5. ABAS DE CONFIGURAÇÕES
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.settings-panel');
  if (tabBtns.length) {
    tabBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        tabBtns.forEach((b) => b.classList.remove('active'));
        tabPanels.forEach((p) => p.classList.remove('active'));
        btn.classList.add('active');
        const painel = document.getElementById(`panel-${btn.dataset.tab}`);
        if (painel) painel.classList.add('active');
      });
    });
  }

  // 6. RESUMO DE SAFRAS RECENTES
  const recentContainer = document.getElementById('dashboardRecentCrops');
  if (recentContainer) {
    const safras = JSON.parse(localStorage.getItem('agromonitor_crops') || '[]');
    const lista = safras.length
      ? safras.slice(0, 3)
      : [
          { name: 'Soybean (Soja)', area: 180, status: 'Em Crescimento' },
          { name: 'Corn (Milho)', area: 145, status: 'Colheita Próxima' },
          { name: 'Beans (Feijão)', area: 95, status: 'Planejada' },
        ];

    recentContainer.innerHTML = lista
      .map(
        (s) => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border-color);font-size:0.82rem;">
          <div>
            <strong>${s.name}</strong>
            <div style="color:var(--text-secondary);font-size:0.74rem;">${s.area} ha</div>
          </div>
          <span class="badge badge-green">${s.status}</span>
        </div>`
      )
      .join('');
  }

  // 7. INTEGRAÇÃO COMPLETA DO DASHBOARD RPD (FATORES + CORRELAÇÕES + INSIGHTS + MODAL)
  const terrainForm = document.getElementById('terrainConfigForm');
  const addressInput = document.getElementById('terrainAddressInput');
  const gpsBtn = document.getElementById('useGpsBtn');
  const prioritySelect = document.getElementById('rpdPrioritySelect');
  const locationBadge = document.getElementById('activeLocationBadge');
  const feedbackMsg = document.getElementById('terrainFeedbackMsg');
  const applyBtn = document.getElementById('applyTerrainBtn');

  const detailModal = document.getElementById('factorDetailModal');
  const closeDetailBtn = document.getElementById('closeFactorModalBtn');
  const detailTitle = document.getElementById('factorModalTitle');
  const detailSubtitle = document.getElementById('factorModalSubtitle');
  const detailBody = document.getElementById('factorModalBody');

  const TERRAIN_STORAGE_KEY = 'agromonitor_terrain_config';
  let ultimoResultadoNASA = null;

  function mostrarFeedback(texto, isErro = false) {
    if (!feedbackMsg) return;
    feedbackMsg.style.display = 'block';
    feedbackMsg.style.color = isErro ? 'var(--red)' : 'var(--green)';
    feedbackMsg.textContent = texto;
  }

  function atualizarBadgeLocal(cfg) {
    if (!locationBadge || !cfg) return;
    locationBadge.textContent = `${cfg.label || 'Terreno'} (${Number(cfg.lat).toFixed(4)}, ${Number(cfg.lon).toFixed(4)})`;
  }

  function fmt(val, sufixo = '', casas = 1) {
    if (val === null || val === undefined || Number.isNaN(Number(val))) return '--';
    return `${Number(val).toFixed(casas)}${sufixo}`;
  }

  function aplicarBadgeStatus(el, ok, textoOk = 'OK', textoAlerta = 'Atenção') {
    if (!el) return;
    el.className = ok ? 'badge badge-green' : 'badge badge-orange';
    el.textContent = ok ? textoOk : textoAlerta;
  }

  // Renderiza os 3 quadrados (Hídrico, Ambiente, Solo), correlações e insights
  function renderizarDashboardRPD(dados, prioridade = 'agua') {
    if (!dados || !dados.atuais) return;
    ultimoResultadoNASA = dados;

    const hidrico = dados.atuais.fator_hidrico || {};
    const ambiente = dados.atuais.fator_ambiente || {};
    const solo = dados.atuais.fator_solo || {};
    const exp = dados.expectativas || {};

    const precip = hidrico.precipitacao || {};
    const smapSup = hidrico.umidade_smap || hidrico.umidade_solo || {};
    const balanco = hidrico.balanco_hidrico || {};
    const clima = ambiente.clima || {};
    const raiz = solo.umidade_zona_raizes || {};
    const relevo = solo.relevo || {};
    const tempSolo = solo.temperatura_solo || {};

    // --- BLOCO 1: FATORES HÍDRICOS ---
    const umidSup = smapSup.umidade_m3m3 ?? smapSup.atual_m3m3;
    const chuva30 = precip.chuva_30d_mm;
    const saldo30 = balanco.saldo_30d_mm;
    const hidricoOk = (umidSup == null || umidSup >= 0.16) && (saldo30 == null || saldo30 >= -40);

    document.getElementById('hidricoMainVal').textContent =
      umidSup != null ? `${Math.round(umidSup * 100)}%` : fmt(chuva30, ' mm', 0);
    document.getElementById('hidricoSummaryText').textContent =
      `Chuva 30d: ${fmt(chuva30, ' mm', 0)} • Saldo hídrico: ${fmt(saldo30, ' mm', 0)}`;
    aplicarBadgeStatus(
      document.getElementById('hidricoStatusBadge'),
      hidricoOk,
      'OK • Hidratado',
      'Atenção • Déficit'
    );

    // --- BLOCO 2: FATORES DO AMBIENTE ---
    const tempMed = clima.temperatura_media_c;
    const vpd = clima.vpd_kpa;
    const et0 = clima.et0_30d_mm;
    const ambienteOk = (tempMed == null || (tempMed >= 14 && tempMed <= 33)) && (vpd == null || vpd <= 1.8);

    document.getElementById('ambienteMainVal').textContent = fmt(tempMed, '°C', 1);
    document.getElementById('ambienteSummaryText').textContent =
      `ET₀ 30d: ${fmt(et0, ' mm', 0)} • VPD: ${fmt(vpd, ' kPa', 2)}`;
    aplicarBadgeStatus(
      document.getElementById('ambienteStatusBadge'),
      ambienteOk,
      'OK • Clima Estável',
      'Atenção • Estresse'
    );

    // --- BLOCO 3: FATORES DO SOLO ---
    const umidRaiz = raiz.umidade_raiz_0_100cm_m3m3;
    const decliv = relevo.declividade_pct;
    const classeRelevo = relevo.classe_relevo || 'Plano';
    const soloOk = (decliv == null || decliv <= 8.0) && (umidRaiz == null || umidRaiz >= 0.18);

    document.getElementById('soloMainVal').textContent =
      umidRaiz != null ? `${Math.round(umidRaiz * 100)}%` : fmt(decliv, '% decl.', 1);
    document.getElementById('soloSummaryText').textContent =
      `Relevo: ${classeRelevo} (${fmt(decliv, '%', 1)}) • Raiz 0–100cm`;
    aplicarBadgeStatus(
      document.getElementById('soloStatusBadge'),
      soloOk,
      'OK • Solo Estável',
      'Atenção • Manejo'
    );

    // --- KPIs LATERAIS ---
    document.getElementById('asideWaterBalanceVal').textContent = fmt(saldo30, ' mm', 1);
    document.getElementById('dashSoilMoistureVal').textContent =
      umidRaiz != null ? `${Math.round(umidRaiz * 100)}%` : '--%';
    document.getElementById('dashSolarRadVal').textContent = fmt(clima.radiacao_solar_mj_m2_dia, ' MJ/m²', 1);

    // --- GRÁFICO DE CORRELAÇÕES EMPÍRICAS (SPEARMAN) ---
    const corrContainer = document.getElementById('rpdCorrelationsContainer');
    const corrBadge = document.getElementById('corrCountBadge');
    const correlacoes = exp.top_correlacoes || [];

    if (corrBadge) corrBadge.textContent = `${correlacoes.length} pares`;
    if (corrContainer) {
      if (!correlacoes.length) {
        corrContainer.innerHTML = `<p style="font-size:0.8rem;color:var(--text-secondary);">Sem correlações significativas calculadas para este ponto.</p>`;
      } else {
        corrContainer.innerHTML = correlacoes
          .slice(0, 6)
          .map((c) => {
            const rho = Number(c.rho ?? c.spearman_r ?? 0);
            const pct = Math.min(Math.round(Math.abs(rho) * 100), 100);
            const cor = rho >= 0 ? 'var(--green)' : 'var(--orange)';
            const varA = c.var_a || c.variavel_1 || 'Var A';
            const varB = c.var_b || c.variavel_2 || 'Var B';
            const cat = c.categoria || '';
            return `
              <div class="corr-bar-row">
                <div class="corr-bar-header">
                  <span><strong>${varA}</strong> × <strong>${varB}</strong> <small style="color:var(--text-secondary);">(${cat})</small></span>
                  <strong style="color:${cor};">ρ = ${rho.toFixed(2)}</strong>
                </div>
                <div class="corr-bar-track">
                  <div class="corr-bar-fill" style="width:${pct}%;background:${cor};"></div>
                </div>
              </div>`;
          })
          .join('');
      }
    }

    // --- INSIGHTS RPD ADAPTADOS À PRIORIDADE ---
    const insightsContainer = document.getElementById('rpdInsightsContainer');
    const insightsBrutos = (exp.cruzamento_solo || {}).insights_rpd || [];
    const dicaPrioridade = {
      agua: 'Prioridade Água: dê preferência a culturas de ciclo curto e cobertura morta para reduzir evaporação.',
      lucro: 'Prioridade Lucro: priorize culturas de maior valor agregado nas janelas de saldo hídrico positivo.',
      solo: 'Prioridade Solo: intercale leguminosas fixadoras de N e gramíneas de raiz profunda.',
      produtividade: 'Prioridade Produtividade: aproveite picos de radiação solar com adubação nitrogenada ajustada à umidade.',
    };

    if (insightsContainer) {
      const listaHtml = insightsBrutos.length
        ? insightsBrutos
            .map((item) => {
              const sev = (item.severidade || '').toLowerCase();
              const cls = sev.includes('alta') ? 'alta' : sev.includes('méd') || sev.includes('med') ? 'media' : '';
              return `
                <div class="insight-box ${cls}">
                  <strong>${item.eixo} (${item.severidade})</strong>
                  <p style="margin:3px 0;">${item.diagnostico}</p>
                  <span style="color:var(--green);font-weight:600;">→ ${item.acao_rotacao}</span>
                </div>`;
            })
            .join('')
        : `<div class="insight-box">
            <strong>Condição Equilibrada</strong>
            <p style="margin:3px 0;">Nenhum conflito severo entre relevo, umidade de raiz e demanda atmosférica.</p>
          </div>`;

      insightsContainer.innerHTML =
        listaHtml +
        `<div class="insight-box" style="border-left-color:var(--blue);">
          <strong>Foco Selecionado</strong>
          <p style="margin-top:2px;">${dicaPrioridade[prioridade] || dicaPrioridade.agua}</p>
        </div>`;
    }
  }

  // Abre modal detalhado ao clicar nos blocos Hídrico, Ambiente ou Solo
  function abrirDetalhesFator(tipo) {
    if (!ultimoResultadoNASA || !detailModal) return;
    const { fator_hidrico: h = {}, fator_ambiente: a = {}, fator_solo: s = {} } = ultimoResultadoNASA.atuais || {};

    let titulo = '';
    let subtitulo = '';
    let metricas = [];

    if (tipo === 'hidrico') {
      titulo = 'Fatores Hídricos — Detalhamento NASA';
      subtitulo = 'Satélites SMAP, NASA POWER e GLDAS';
      const p = h.precipitacao || {};
      const sm = h.umidade_smap || h.umidade_solo || {};
      const bh = h.balanco_hidrico || {};
      metricas = [
        { label: 'Umidade Superficial (SMAP)', val: sm.umidade_m3m3 != null ? `${(sm.umidade_m3m3 * 100).toFixed(1)}% (${sm.umidade_m3m3} m³/m³)` : '--' },
        { label: 'Precipitação Acumulada (30d)', val: fmt(p.chuva_30d_mm, ' mm', 1) },
        { label: 'Precipitação Acumulada (90d)', val: fmt(p.chuva_90d_mm, ' mm', 1) },
        { label: 'Balanço Hídrico (30d)', val: fmt(bh.saldo_30d_mm, ' mm', 1) },
        { label: 'Dias Secos Consecutivos', val: fmt(p.dias_secos_consecutivos, ' dias', 0) },
        { label: 'Status Hídrico', val: sm.classificacao || bh.status || 'Monitorado' },
      ];
    } else if (tipo === 'ambiente') {
      titulo = 'Fatores do Ambiente — Detalhamento NASA';
      subtitulo = 'Climatologia Agroclimática NASA POWER';
      const c = a.clima || {};
      metricas = [
        { label: 'Temperatura Média', val: fmt(c.temperatura_media_c, ' °C', 1) },
        { label: 'Temperatura Máxima Média', val: fmt(c.temperatura_max_c, ' °C', 1) },
        { label: 'Temperatura Mínima Média', val: fmt(c.temperatura_min_c, ' °C', 1) },
        { label: 'Evapotranspiração (ET₀ 30d)', val: fmt(c.et0_30d_mm, ' mm', 1) },
        { label: 'Radiação Solar Média', val: fmt(c.radiacao_solar_mj_m2_dia, ' MJ/m²/dia', 1) },
        { label: 'Déficit de Pressão de Vapor (VPD)', val: fmt(c.vpd_kpa, ' kPa', 2) },
      ];
    } else if (tipo === 'solo') {
      titulo = 'Fatores do Solo — Detalhamento NASA';
      subtitulo = 'Perfil Radicular SMAP L4, Relevo SRTM 30m e GLDAS';
      const r = s.umidade_zona_raizes || {};
      const rel = s.relevo || {};
      const ts = s.temperatura_solo || {};
      metricas = [
        { label: 'Umidade Zona de Raízes (0–100 cm)', val: r.umidade_raiz_0_100cm_m3m3 != null ? `${(r.umidade_raiz_0_100cm_m3m3 * 100).toFixed(1)}%` : '--' },
        { label: 'Reserva Hídrica Estimada', val: fmt(r.lamina_agua_mm, ' mm', 1) },
        { label: 'Declividade Média (SRTM)', val: fmt(rel.declividade_pct, '%', 1) },
        { label: 'Classificação do Relevo', val: rel.classe_relevo || '--' },
        { label: 'Elevação (Altitude)', val: fmt(rel.elevacao_m, ' m', 0) },
        { label: 'Temperatura do Solo (0–10 cm)', val: fmt(ts.temp_solo_c, ' °C', 1) },
      ];
    }

    detailTitle.textContent = titulo;
    detailSubtitle.textContent = subtitulo;
    detailBody.innerHTML = `
      <div class="metric-detail-grid">
        ${metricas
          .map(
            (m) => `
          <div class="metric-detail-item">
            <span>${m.label}</span>
            <strong>${m.val}</strong>
          </div>`
          )
          .join('')}
      </div>`;
    detailModal.classList.add('open');
  }

  document.querySelectorAll('.rpd-factor-card').forEach((card) => {
    card.addEventListener('click', () => abrirDetalhesFator(card.dataset.factor));
  });
  if (closeDetailBtn && detailModal) {
    closeDetailBtn.addEventListener('click', () => detailModal.classList.remove('open'));
    detailModal.addEventListener('click', (e) => {
      if (e.target === detailModal) detailModal.classList.remove('open');
    });
  }

  // Geocodificação Nominatim
  async function geocodificarEndereco(endereco) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(endereco)}`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'pt-BR' } });
    if (!res.ok) throw new Error('Falha ao consultar serviço de endereços.');
    const lista = await res.json();
    if (!lista.length) throw new Error('Endereço não encontrado. Tente incluir cidade e estado.');
    return {
      lat: parseFloat(lista[0].lat),
      lon: parseFloat(lista[0].lon),
      label: lista[0].display_name.split(',').slice(0, 2).join(',').trim(),
    };
  }

  async function sincronizarDashboardComNASA(cfg) {
    if (typeof buscarAnaliseNASA !== 'function') return;
    mostrarFeedback('Consultando satélites NASA (SMAP, GLDAS, POWER, SRTM)...');
    if (applyBtn) applyBtn.disabled = true;

    const dados = await buscarAnaliseNASA(cfg.lat, cfg.lon);
    if (applyBtn) applyBtn.disabled = false;

    if (!dados || !dados.atuais) {
      mostrarFeedback('Não foi possível obter dados da API. Verifique se o uvicorn está rodando.', true);
      return;
    }

    renderizarDashboardRPD(dados, cfg.priority);
    mostrarFeedback(`✓ Dados NASA atualizados para ${cfg.label}. Clique nos blocos acima para ver todas as métricas.`);
  }

  if (terrainForm) {
    const salvo = JSON.parse(localStorage.getItem(TERRAIN_STORAGE_KEY) || 'null') || {
      lat: -22.9068,
      lon: -47.0616,
      label: 'Campinas, SP',
      address: 'Campinas, SP',
      priority: 'agua',
    };

    if (addressInput && salvo.address) addressInput.value = salvo.address;
    if (prioritySelect && salvo.priority) prioritySelect.value = salvo.priority;
    atualizarBadgeLocal(salvo);

    // Carrega automaticamente ao abrir o dashboard
    sincronizarDashboardComNASA(salvo);

    if (gpsBtn) {
      gpsBtn.addEventListener('click', () => {
        if (!navigator.geolocation) {
          mostrarFeedback('Seu navegador não suporta geolocalização.', true);
          return;
        }
        mostrarFeedback('Obtendo coordenadas GPS do dispositivo...');
        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            const cfg = {
              lat: pos.coords.latitude,
              lon: pos.coords.longitude,
              label: 'Localização Atual (GPS)',
              address: `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`,
              priority: prioritySelect?.value || 'agua',
            };
            if (addressInput) addressInput.value = cfg.address;
            localStorage.setItem(TERRAIN_STORAGE_KEY, JSON.stringify(cfg));
            atualizarBadgeLocal(cfg);
            await sincronizarDashboardComNASA(cfg);
          },
          () => mostrarFeedback('Permissão de localização negada. Digite o endereço manualmente.', true),
          { enableHighAccuracy: true, timeout: 10000 }
        );
      });
    }

    terrainForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const endereco = (addressInput?.value || '').trim();
      const priority = prioritySelect?.value || 'agua';
      const anterior = JSON.parse(localStorage.getItem(TERRAIN_STORAGE_KEY) || 'null');

      try {
        let coords;
        const coordMatch = endereco.match(/^([-\d.]+)\s*,\s*([-\d.]+)$/);
        if (coordMatch) {
          coords = { lat: parseFloat(coordMatch[1]), lon: parseFloat(coordMatch[2]), label: 'Coordenada Manual' };
        } else if (endereco) {
          mostrarFeedback('Convertendo endereço em latitude e longitude...');
          coords = await geocodificarEndereco(endereco);
        } else if (anterior) {
          coords = { lat: anterior.lat, lon: anterior.lon, label: anterior.label };
        } else {
          coords = { lat: -22.9068, lon: -47.0616, label: 'Campinas, SP' };
        }

        const cfg = { ...coords, address: endereco || anterior?.address || '', priority };
        localStorage.setItem(TERRAIN_STORAGE_KEY, JSON.stringify(cfg));
        atualizarBadgeLocal(cfg);
        await sincronizarDashboardComNASA(cfg);
      } catch (err) {
        mostrarFeedback(err.message, true);
      }
    });
  }
});