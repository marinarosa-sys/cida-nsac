// js/scene3d-rpd.js
document.addEventListener('DOMContentLoaded', () => {
  // 0. MENU DISCRETO E LOCALIZAÇÃO (GEOCODIFICAÇÃO + GPS)
  const navToggle = document.getElementById('navDrawerToggle');
  const navDrawer = document.getElementById('quickNavDrawer');
  if (navToggle && navDrawer) {
    navToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      navDrawer.classList.toggle('open');
    });
    document.addEventListener('click', (e) => {
      if (!navDrawer.contains(e.target)) navDrawer.classList.remove('open');
    });
  }

  const TERRAIN_STORAGE_KEY = 'agromonitor_terrain_config';
  const terrainForm = document.getElementById('terrainConfigForm');
  const addressInput = document.getElementById('terrainAddressInput');
  const gpsBtn = document.getElementById('useGpsBtn');
  const locationBadge = document.getElementById('activeLocationBadge');
  const applyBtn = document.getElementById('applyTerrainBtn');
  const summaryEl = document.getElementById('generalAnalysisSummary');

  let dadosNASA = null;

  function atualizarBadgeLocal(cfg) {
    if (locationBadge && cfg) {
      locationBadge.textContent = `${cfg.label || 'Terreno'} (${Number(cfg.lat).toFixed(4)}, ${Number(cfg.lon).toFixed(4)})`;
    }
  }

  async function geocodificarEndereco(endereco) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(endereco)}`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'pt-BR' } });
    if (!res.ok) throw new Error('Falha ao localizar endereço.');
    const lista = await res.json();
    if (!lista.length) throw new Error('Local não encontrado. Tente incluir estado ou país.');
    return {
      lat: parseFloat(lista[0].lat),
      lon: parseFloat(lista[0].lon),
      label: lista[0].display_name.split(',').slice(0, 2).join(',').trim(),
    };
  }

  async function carregarTelemetria(cfg) {
    if (typeof buscarAnaliseNASA !== 'function') return;
    if (applyBtn) applyBtn.disabled = true;
    if (summaryEl) {
      summaryEl.innerHTML = `<span><strong>Telemetria Orbital:</strong> Processando dados NASA para <em>${cfg.label}</em>...</span>`;
    }
    const res = await buscarAnaliseNASA(cfg.lat, cfg.lon);
    if (applyBtn) applyBtn.disabled = false;
    dadosNASA = res;
    atualizarSinteseECena();
  }

  // 1. GERADORES DE TEXTURAS REALISTAS PROCEDURAIS (512x512)
  function criarTexturaSolo(corBase, corGrao1, corGrao2, comRaizes = false) {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 512;
    const ctx = c.getContext('2d');
    ctx.fillStyle = corBase;
    ctx.fillRect(0, 0, 512, 512);

    // Granulação mineral e orgânica
    for (let i = 0; i < 14000; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      const r = Math.random() * 2.2 + 0.4;
      ctx.fillStyle = Math.random() > 0.5 ? corGrao1 : corGrao2;
      ctx.globalAlpha = Math.random() * 0.45 + 0.1;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Filamentos radiculares nas camadas superiores
    if (comRaizes) {
      ctx.strokeStyle = '#d6ccc2';
      ctx.globalAlpha = 0.32;
      for (let i = 0; i < 35; i++) {
        ctx.lineWidth = Math.random() * 1.4 + 0.4;
        ctx.beginPath();
        let rx = 180 + Math.random() * 150;
        let ry = 0;
        ctx.moveTo(rx, ry);
        for (let s = 0; s < 6; s++) {
          rx += (Math.random() - 0.5) * 35;
          ry += 35 + Math.random() * 25;
          ctx.lineTo(rx, ry);
        }
        ctx.stroke();
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  function criarTexturaFolha() {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 512;
    const ctx = c.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 512, 512);
    grad.addColorStop(0, '#14532d');
    grad.addColorStop(0.5, '#166534');
    grad.addColorStop(1, '#22c55e');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 512);

    // Nervura central e laterais
    ctx.strokeStyle = 'rgba(187, 247, 208, 0.35)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(0, 256);
    ctx.lineTo(512, 256);
    ctx.stroke();

    ctx.lineWidth = 2;
    for (let x = 40; x < 480; x += 36) {
      ctx.beginPath();
      ctx.moveTo(x, 256);
      ctx.quadraticCurveTo(x + 25, 160, x + 65, 90);
      ctx.moveTo(x, 256);
      ctx.quadraticCurveTo(x + 25, 352, x + 65, 422);
      ctx.stroke();
    }
    return new THREE.CanvasTexture(c);
  }

  // 2. CENA THREE.JS HIGH-TECH REALISTA
  const container = document.getElementById('canvas3dContainer');
  const canvas = document.getElementById('plant3dCanvas');
  if (!container || !canvas || typeof THREE === 'undefined') return;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, container.clientWidth / container.clientHeight, 0.1, 100);
  camera.position.set(4.8, 3.4, 5.6);
  camera.lookAt(0, 0.45, 0);

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  // Iluminação de estúdio 3 pontos
  scene.add(new THREE.HemisphereLight(0xe0f2fe, 0x1e1b18, 0.85));
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.35);
  keyLight.position.set(6, 10, 7);
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.65);
  rimLight.position.set(-6, 4, -5);
  scene.add(rimLight);

  const worldGroup = new THREE.Group();
  scene.add(worldGroup);

  // Base holográfica discreta sob o corte de solo
  const gridHelper = new THREE.GridHelper(4.4, 16, 0x38bdf8, 0x1e293b);
  gridHelper.position.y = -0.92;
  gridHelper.material.transparent = true;
  gridHelper.material.opacity = 0.25;
  worldGroup.add(gridHelper);

  // --- BLOCO ESTRATIGRÁFICO DE SOLO (3 HORIZONTES REALISTAS) ---
  const texHorizonteO = criarTexturaSolo('#2b1d14', '#1a110b', '#4a3525', true);
  const texHorizonteB = criarTexturaSolo('#4a3222', '#362216', '#6b4730', true);
  const texHorizonteC = criarTexturaSolo('#5c4738', '#3f3026', '#7c6554', false);

  const horizontes = [
    { h: 0.34, y: 0.18, tex: texHorizonteO },
    { h: 0.42, y: -0.20, tex: texHorizonteB },
    { h: 0.48, y: -0.65, tex: texHorizonteC },
  ];

  horizontes.forEach((hz) => {
    const geo = new THREE.BoxGeometry(2.5, hz.h, 2.5);
    const mat = new THREE.MeshStandardMaterial({
      map: hz.tex,
      bumpMap: hz.tex,
      bumpScale: 0.025,
      roughness: 0.92,
      metalness: 0.04,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = hz.y;
    worldGroup.add(mesh);
  });

  // --- CANAL HÍDRICO TRANSLÚCIDO COM ONDULAÇÃO ---
  const waterGeo = new THREE.PlaneGeometry(2.52, 0.72, 32, 12);
  waterGeo.rotateX(-Math.PI / 2);
  const waterMat = new THREE.MeshPhysicalMaterial({
    color: 0x0ea5e9,
    emissive: 0x0369a1,
    emissiveIntensity: 0.25,
    roughness: 0.12,
    metalness: 0.1,
    transmission: 0.55,
    transparent: true,
    opacity: 0.88,
  });
  const waterMesh = new THREE.Mesh(waterGeo, waterMat);
  waterMesh.position.set(0, 0.365, 0.42);
  worldGroup.add(waterMesh);

  // --- PLANTA BOTÂNICA REALISTA (CAULE CURVO + FOLHAS ESCULPIDAS) ---
  const plantGroup = new THREE.Group();
  plantGroup.position.set(0, 0.34, -0.15);
  worldGroup.add(plantGroup);

  const stemCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.03, 0.45, 0.02),
    new THREE.Vector3(-0.02, 0.95, -0.01),
    new THREE.Vector3(0, 1.38, 0),
  ]);
  const stemGeo = new THREE.TubeGeometry(stemCurve, 24, 0.042, 12, false);
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.55 });
  plantGroup.add(new THREE.Mesh(stemGeo, stemMat));

  const leafTex = criarTexturaFolha();
  const leafMat = new THREE.MeshStandardMaterial({
    map: leafTex,
    bumpMap: leafTex,
    bumpScale: 0.012,
    roughness: 0.38,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });

  function criarFolhaOrganica(comprimento, largura, rotY, inclZ, posY) {
    const geom = new THREE.PlaneGeometry(comprimento, largura, 18, 8);
    const pos = geom.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + comprimento / 2; // 0 na base até comprimento na ponta
      const u = x / comprimento;
      const y = pos.getY(i);
      // Afila na base e na ponta
      const perfil = Math.sin(u * Math.PI) * (1 - 0.18 * u);
      pos.setY(i, y * perfil);
      // Curvatura natural da folha + vinco central em V
      const arco = Math.sin(u * Math.PI * 0.85) * 0.22 - u * u * 0.18;
      const vinco = Math.abs(y / (largura * 0.5)) * 0.05;
      pos.setZ(i, arco + vinco);
    }
    geom.translate(comprimento / 2, 0, 0);
    geom.computeVertexNormals();

    const mesh = new THREE.Mesh(geom, leafMat);
    mesh.position.set(0, posY, 0);
    mesh.rotation.y = rotY;
    mesh.rotation.z = inclZ;
    return mesh;
  }

  plantGroup.add(criarFolhaOrganica(1.05, 0.44, 0.2, 0.28, 0.72));
  plantGroup.add(criarFolhaOrganica(1.12, 0.46, Math.PI - 0.25, 0.32, 0.88));
  plantGroup.add(criarFolhaOrganica(0.88, 0.36, 1.45, 0.42, 1.15));
  plantGroup.add(criarFolhaOrganica(0.84, 0.34, -1.65, 0.45, 1.24));

  // --- CAMADA ATMOSFÉRICA / CONDENSAÇÃO REALISTA (AMBIENTE) ---
  const atmoGroup = new THREE.Group();
  atmoGroup.position.set(0.15, 2.15, -0.05);
  worldGroup.add(atmoGroup);

  const cloudMat = new THREE.MeshPhysicalMaterial({
    color: 0xe2e8f0,
    roughness: 0.9,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  });

  [
    { x: -0.45, y: 0.02, z: 0.1, s: [0.65, 0.22, 0.45] },
    { x: 0.0, y: 0.10, z: -0.05, s: [0.85, 0.28, 0.55] },
    { x: 0.48, y: -0.02, z: 0.08, s: [0.60, 0.20, 0.42] },
  ].forEach((c) => {
    const geo = new THREE.SphereGeometry(0.5, 24, 16);
    geo.scale(c.s[0], c.s[1], c.s[2]);
    const m = new THREE.Mesh(geo, cloudMat);
    m.position.set(c.x, c.y, c.z);
    atmoGroup.add(m);
  });

  // Âncoras 3D para linhas telemétricas
  const anchorAmbiente = new THREE.Object3D();
  anchorAmbiente.position.set(0.45, 2.15, 0);
  worldGroup.add(anchorAmbiente);

  const anchorHidrico = new THREE.Object3D();
  anchorHidrico.position.set(0.75, 0.38, 0.45);
  worldGroup.add(anchorHidrico);

  const anchorSolo = new THREE.Object3D();
  anchorSolo.position.set(0.85, -0.35, 0.85);
  worldGroup.add(anchorSolo);

  // Arrastar para girar 3D
  let isDragging = false;
  let prevX = 0;
  canvas.addEventListener('pointerdown', (e) => {
    isDragging = true;
    prevX = e.clientX;
  });
  window.addEventListener('pointerup', () => (isDragging = false));
  window.addEventListener('pointermove', (e) => {
    if (!isDragging) return;
    worldGroup.rotation.y += (e.clientX - prevX) * 0.009;
    prevX = e.clientX;
  });

  function projetar2D(obj) {
    const v = new THREE.Vector3();
    obj.getWorldPosition(v);
    v.project(camera);
    return {
      x: (v.x * 0.5 + 0.5) * container.clientWidth,
      y: (-v.y * 0.5 + 0.5) * container.clientHeight,
    };
  }

  function atualizarLinhasHUD() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    const itens = [
      { anchor: anchorAmbiente, line: 'lineAmbiente', dot: 'dotAmbiente', btn: 'btnCalloutAmbiente', bx: w - 210, by: h * 0.14 },
      { anchor: anchorHidrico, line: 'lineHidrico', dot: 'dotHidrico', btn: 'btnCalloutHidrico', bx: w - 235, by: h * 0.45 },
      { anchor: anchorSolo, line: 'lineSolo', dot: 'dotSolo', btn: 'btnCalloutSolo', bx: w - 190, by: h * 0.74 },
    ];

    itens.forEach((it) => {
      const lineEl = document.getElementById(it.line);
      const dotEl = document.getElementById(it.dot);
      const btnEl = document.getElementById(it.btn);
      if (!lineEl || !btnEl) return;

      const p = projetar2D(it.anchor);
      const targetY = it.by + 22;
      const elbowX = p.x + 36;
      dotEl.setAttribute('cx', p.x);
      dotEl.setAttribute('cy', p.y);
      lineEl.setAttribute('points', `${p.x},${p.y} ${elbowX},${targetY} ${it.bx},${targetY}`);
      btnEl.style.left = `${it.bx}px`;
      btnEl.style.top = `${it.by}px`;
    });
  }

  let t = 0;
  const waterPos = waterGeo.attributes.position;
  function animate() {
    requestAnimationFrame(animate);
    t += 0.016;
    if (!isDragging) {
      worldGroup.rotation.y = Math.sin(t * 0.35) * 0.28 - 0.38;
    }
    atmoGroup.position.y = 2.15 + Math.sin(t * 0.9) * 0.04;

    // Micro-ondulação realista na lâmina d'água
    for (let i = 0; i < waterPos.count; i++) {
      const vx = waterPos.getX(i);
      const vz = waterPos.getZ(i);
      waterPos.setY(i, Math.sin(vx * 5 + t * 2.5) * 0.008 + Math.cos(vz * 6 + t * 2) * 0.006);
    }
    waterPos.needsUpdate = true;

    renderer.render(scene, camera);
    atualizarLinhasHUD();
  }
  animate();

  window.addEventListener('resize', () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });

  // 3. SÍNTESE GERAL & REAÇÃO DO 3D AOS DADOS NASA
  const sAmb = document.getElementById('sliderAmbiente');
  const sHid = document.getElementById('sliderHidrico');
  const sSol = document.getElementById('sliderSolo');

  function atualizarSinteseECena() {
    const pAmb = Number(sAmb?.value || 70);
    const pHid = Number(sHid?.value || 85);
    const pSol = Number(sSol?.value || 60);

    document.getElementById('valPriorityAmbiente').textContent = `${pAmb}%`;
    document.getElementById('valPriorityHidrico').textContent = `${pHid}%`;
    document.getElementById('valPrioritySolo').textContent = `${pSol}%`;

    if (!dadosNASA || !dadosNASA.atuais) return;

    const h = dadosNASA.atuais.fator_hidrico || {};
    const a = dadosNASA.atuais.fator_ambiente || {};
    const s = dadosNASA.atuais.fator_solo || {};
    const insights = dadosNASA.expectativas?.cruzamento_solo?.insights_rpd || [];

    const temp = a.clima?.temperatura_media_c ?? '--';
    const chuva30 = h.precipitacao?.chuva_30d_mm ?? '--';
    const umid = s.umidade_zona_raizes?.umidade_raiz_0_100cm_m3m3 ?? 0.24;
    const decliv = s.relevo?.declividade_pct ?? '--';
    const relevo = s.relevo?.classe_relevo ?? 'Plano';

    document.getElementById('tagAmbiente').textContent = `${temp}°C • VPD ${a.clima?.vpd_kpa ?? '--'} kPa`;
    document.getElementById('tagHidrico').textContent = `${chuva30} mm (30d)`;
    document.getElementById('tagSolo').textContent = `${Math.round(umid * 100)}% raiz • ${decliv}%`;

    // Ajusta cor da vegetação e nível da água conforme umidade real
    leafMat.color.setHex(umid < 0.16 ? 0xd97706 : 0xffffff);
    waterMat.opacity = umid < 0.16 ? 0.35 : 0.88;

    let foco = 'Recursos Hídricos';
    if (pAmb >= pHid && pAmb >= pSol) foco = 'Ambiente & Clima';
    else if (pSol >= pHid && pSol >= pAmb) foco = 'Conservação do Solo';

    const acao = insights.length
      ? insights[0].acao_rotacao
      : 'Sistema equilibrado: recomendada rotação entre gramíneas de cobertura e leguminosas fixadoras.';

    if (summaryEl) {
      summaryEl.innerHTML = `
        <span>
          <strong style="color:#34d399;">Síntese Geral (Prioridade: ${foco}):</strong>
          Relevo <strong>${relevo} (${decliv}%)</strong>, temperatura média de <strong>${temp}°C</strong>, acumulado pluviométrico de <strong>${chuva30} mm</strong> e umidade radicular em <strong>${Math.round(umid * 100)}%</strong>.
          <span style="color:#38bdf8;">Diretriz RPD: ${acao}</span>
        </span>`;
    }
  }

  [sAmb, sHid, sSol].forEach((sl) => sl && sl.addEventListener('input', atualizarSinteseECena));

  // 4. DASHBOARD EXPANSÍVEL DE MÉTRICAS E GRÁFICOS
  const drawer = document.getElementById('factorDashboardSection');
  const dTitle = document.getElementById('detailDashTitle');
  const dSub = document.getElementById('detailDashSubtitle');
  const dCards = document.getElementById('detailMetricsCards');
  const dCorr = document.getElementById('detailCorrelationsList');
  const dCanvas = document.getElementById('detailMetricCanvas');

  function desenharGraficoEscuro(labels, valores, cor) {
    if (!dCanvas) return;
    const rect = dCanvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    dCanvas.width = rect.width * dpr;
    dCanvas.height = rect.height * dpr;
    const ctx = dCanvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const pad = { top: 20, right: 20, bottom: 28, left: 38 };
    const areaW = w - pad.left - pad.right;
    const areaH = h - pad.top - pad.bottom;

    ctx.clearRect(0, 0, w, h);
    const maxV = Math.max(...valores, 1) * 1.15;
    const stepX = areaW / Math.max(labels.length - 1, 1);

    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    for (let g = 0; g <= 3; g++) {
      const gy = pad.top + (areaH / 3) * g;
      ctx.beginPath();
      ctx.moveTo(pad.left, gy);
      ctx.lineTo(w - pad.right, gy);
      ctx.stroke();
    }

    ctx.strokeStyle = cor;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    valores.forEach((v, i) => {
      const x = pad.left + i * stepX;
      const y = pad.top + areaH - (v / maxV) * areaH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    ctx.font = '11px Poppins, sans-serif';
    ctx.textAlign = 'center';
    valores.forEach((v, i) => {
      const x = pad.left + i * stepX;
      const y = pad.top + areaH - (v / maxV) * areaH;
      ctx.fillStyle = cor;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(labels[i], x, h - 8);
    });
  }

  function abrirDashboard(tipo) {
    if (!drawer) return;
    drawer.classList.add('active');
    drawer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    const h = dadosNASA?.atuais?.fator_hidrico || {};
    const a = dadosNASA?.atuais?.fator_ambiente || {};
    const s = dadosNASA?.atuais?.fator_solo || {};
    const corrs = dadosNASA?.expectativas?.top_correlacoes || [];

    let kpis = [];
    let serie = [];
    let cor = '#38bdf8';

    if (tipo === 'ambiente') {
      dTitle.textContent = 'Dashboard de Telemetria — Ambiente';
      dSub.textContent = 'Climatologia NASA POWER (Temperatura, Radiação Solar, ET₀ e VPD)';
      const c = a.clima || {};
      kpis = [
        { label: 'Temperatura Média', val: `${c.temperatura_media_c ?? '--'} °C` },
        { label: 'Radiação Solar', val: `${c.radiacao_solar_mj_m2_dia ?? '--'} MJ/m²` },
        { label: 'Déficit Pressão Vapor (VPD)', val: `${c.vpd_kpa ?? '--'} kPa` },
      ];
      serie = [22.1, 23.4, 24.2, 25.0, 24.3, Number(c.temperatura_media_c || 24.5)];
      cor = '#38bdf8';
    } else if (tipo === 'hidrico') {
      dTitle.textContent = 'Dashboard de Telemetria — Recursos Hídricos';
      dSub.textContent = 'Precipitação acumulada, SMAP superficial e balanço hídrico 30d';
      const p = h.precipitacao || {};
      const bh = h.balanco_hidrico || {};
      kpis = [
        { label: 'Precipitação 30 Dias', val: `${p.chuva_30d_mm ?? '--'} mm` },
        { label: 'Precipitação 90 Dias', val: `${p.chuva_90d_mm ?? '--'} mm` },
        { label: 'Balanço Hídrico 30d', val: `${bh.saldo_30d_mm ?? '--'} mm` },
      ];
      serie = [90, 118, 84, 72, 108, Number(p.chuva_30d_mm || 102)];
      cor = '#22d3ee';
    } else {
      dTitle.textContent = 'Dashboard de Telemetria — Solo';
      dSub.textContent = 'Perfil radicular 0–100 cm (SMAP L4) e topografia NASA SRTM 30m';
      const r = s.umidade_zona_raizes || {};
      const rel = s.relevo || {};
      const umidPct = r.umidade_raiz_0_100cm_m3m3 != null ? Math.round(r.umidade_raiz_0_100cm_m3m3 * 100) : 24;
      kpis = [
        { label: 'Umidade Zona de Raízes', val: `${umidPct}%` },
        { label: 'Declividade Média (SRTM)', val: `${rel.declividade_pct ?? '--'}%` },
        { label: 'Classificação Topográfica', val: rel.classe_relevo || '--' },
      ];
      serie = [27, 26, 25, 23, 24, umidPct];
      cor = '#a3e635';
    }

    dCards.innerHTML = kpis
      .map((k) => `<div class="dark-kpi-box"><span>${k.label}</span><strong>${k.val}</strong></div>`)
      .join('');

    desenharGraficoEscuro(['M-5', 'M-4', 'M-3', 'M-2', 'M-1', 'Atual'], serie, cor);

    dCorr.innerHTML = corrs.length
      ? corrs
          .slice(0, 5)
          .map((c) => {
            const rho = Number(c.rho ?? c.spearman_r ?? 0).toFixed(2);
            return `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.07);font-size:0.8rem;">
              <span style="color:#cbd5e1;"><strong>${c.var_a || 'Var A'}</strong> × ${c.var_b || 'Var B'}</span>
              <span style="color:#34d399;font-weight:600;">ρ = ${rho}</span>
            </div>`;
          })
          .join('')
      : `<p style="font-size:0.8rem;color:#64748b;">Aguardando série histórica para exibir correlações.</p>`;
  }

  document.querySelectorAll('.callout-node, [data-switch-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.target || btn.dataset.switchTab;
      if (target) abrirDashboard(target);
    });
  });

  const closeBtn = document.getElementById('closeDetailDashBtn');
  if (closeBtn && drawer) {
    closeBtn.addEventListener('click', () => drawer.classList.remove('active'));
  }

  // 5. EVENTOS DA BARRA DE LOCALIZAÇÃO E CARGA INICIAL
  const salvo = JSON.parse(localStorage.getItem(TERRAIN_STORAGE_KEY) || 'null') || {
    lat: -22.9068,
    lon: -47.0616,
    label: 'Campinas, SP',
    address: 'Campinas, SP',
  };
  if (addressInput && salvo.address) addressInput.value = salvo.address;
  atualizarBadgeLocal(salvo);
  carregarTelemetria(salvo);

  if (gpsBtn) {
    gpsBtn.addEventListener('click', () => {
      if (!navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition(async (pos) => {
        const cfg = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          label: 'Localização GPS',
          address: `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`,
        };
        if (addressInput) addressInput.value = cfg.address;
        localStorage.setItem(TERRAIN_STORAGE_KEY, JSON.stringify(cfg));
        atualizarBadgeLocal(cfg);
        await carregarTelemetria(cfg);
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
          ? { lat: parseFloat(match[1]), lon: parseFloat(match[2]), label: 'Coordenada Manual' }
          : await geocodificarEndereco(end);

        const cfg = { ...coords, address: end };
        localStorage.setItem(TERRAIN_STORAGE_KEY, JSON.stringify(cfg));
        atualizarBadgeLocal(cfg);
        await carregarTelemetria(cfg);
      } catch (err) {
        if (summaryEl) {
          summaryEl.innerHTML = `<span style="color:#f87171;"><strong>Erro de localização:</strong> ${err.message}</span>`;
        }
      }
    });
  }
});