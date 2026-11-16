// js/trends-charts.js
document.addEventListener('DOMContentLoaded', () => {
  const canvas1 = document.getElementById('productivityRainCanvas');
  const canvas2 = document.getElementById('npkBarCanvas');
  const tooltip1 = document.getElementById('tooltipChart1');
  const tooltip2 = document.getElementById('tooltipChart2');
  const filterBtns = document.querySelectorAll('#periodFilterGroup button');

  const SERIES = {
    daily: {
      labels: ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'],
      produtividade: [82, 83, 84, 83, 85, 86, 87],
      chuva: [12, 5, 0, 18, 24, 8, 4],
      ciclos: ['T1', 'T2', 'T3', 'T4', 'T5'],
      n: [42, 48, 45, 39, 51],
      p: [28, 32, 30, 26, 35],
      k: [36, 40, 38, 19, 42], // T4 abaixo do limiar (25)
    },
    weekly: {
      labels: ['Sem 1', 'Sem 2', 'Sem 3', 'Sem 4', 'Sem 5', 'Sem 6'],
      produtividade: [78, 80, 82, 81, 85, 88],
      chuva: [45, 62, 30, 18, 74, 52],
      ciclos: ['C1', 'C2', 'C3', 'C4', 'C5'],
      n: [45, 50, 47, 41, 53],
      p: [30, 34, 31, 27, 36],
      k: [38, 42, 39, 18, 44], // C4 abaixo do limiar (25)
    },
    monthly: {
      labels: ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun'],
      produtividade: [74, 77, 81, 84, 86, 89],
      chuva: [210, 185, 160, 95, 65, 48],
      ciclos: ['Safra 22', 'Safra 23', 'Safra 24', 'Safra 25', 'Proj. 26'],
      n: [44, 49, 46, 40, 52],
      p: [29, 33, 30, 26, 35],
      k: [37, 41, 38, 20, 43],
    },
  };

  let periodoAtual = 'weekly';
  let pontosGrafico1 = [];
  let barrasGrafico2 = [];

  function ajustarCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    return { ctx, w: rect.width, h: rect.height };
  }

  function corTexto() {
    return document.body.classList.contains('dark-mode') ? '#94a3b8' : '#657786';
  }

  function corGrade() {
    return document.body.classList.contains('dark-mode') ? '#2d333b' : '#e1e8ed';
  }

  // GRÁFICO 1: Produtividade (Linha Verde) vs Chuva (Linha Laranja)
  function desenharGrafico1(dados) {
    if (!canvas1) return;
    const { ctx, w, h } = ajustarCanvas(canvas1);
    const pad = { top: 20, right: 24, bottom: 32, left: 38 };
    const areaW = w - pad.left - pad.right;
    const areaH = h - pad.top - pad.bottom;

    ctx.clearRect(0, 0, w, h);
    pontosGrafico1 = [];

    // Grade horizontal
    ctx.strokeStyle = corGrade();
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + (areaH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(w - pad.right, y);
      ctx.stroke();
    }

    const maxProd = Math.max(...dados.produtividade) * 1.1;
    const maxChuva = Math.max(...dados.chuva, 10) * 1.15;
    const passoX = areaW / Math.max(dados.labels.length - 1, 1);

    // Eixo X
    ctx.fillStyle = corTexto();
    ctx.font = '11px Poppins, sans-serif';
    ctx.textAlign = 'center';
    dados.labels.forEach((lbl, idx) => {
      const x = pad.left + idx * passoX;
      ctx.fillText(lbl, x, h - 10);
    });

    function tracarLinha(valores, maxVal, cor) {
      ctx.strokeStyle = cor;
      ctx.lineWidth = 3;
      ctx.beginPath();
      valores.forEach((v, idx) => {
        const x = pad.left + idx * passoX;
        const y = pad.top + areaH - (v / maxVal) * areaH;
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      valores.forEach((v, idx) => {
        const x = pad.left + idx * passoX;
        const y = pad.top + areaH - (v / maxVal) * areaH;
        ctx.fillStyle = cor;
        ctx.beginPath();
        ctx.arc(x, y, 4.5, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    tracarLinha(dados.produtividade, maxProd, '#2d6a4f');
    tracarLinha(dados.chuva, maxChuva, '#ff9f1c');

    dados.labels.forEach((lbl, idx) => {
      const x = pad.left + idx * passoX;
      const yProd = pad.top + areaH - (dados.produtividade[idx] / maxProd) * areaH;
      pontosGrafico1.push({
        x,
        y: yProd,
        label: lbl,
        prod: dados.produtividade[idx],
        chuva: dados.chuva[idx],
      });
    });
  }

  // GRÁFICO 2: Barras Agrupadas NPK com Limiar de Alerta
  function desenharGrafico2(dados) {
    if (!canvas2) return;
    const { ctx, w, h } = ajustarCanvas(canvas2);
    const pad = { top: 20, right: 20, bottom: 32, left: 36 };
    const areaW = w - pad.left - pad.right;
    const areaH = h - pad.top - pad.bottom;

    ctx.clearRect(0, 0, w, h);
    barrasGrafico2 = [];

    const maxVal = 65;
    const limiarK = 25;

    // Grade
    ctx.strokeStyle = corGrade();
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + (areaH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(w - pad.right, y);
      ctx.stroke();
    }

    // Linha tracejada do limiar mínimo (25 mg/dm³)
    const yLimiar = pad.top + areaH - (limiarK / maxVal) * areaH;
    ctx.save();
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = '#e63946';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(pad.left, yLimiar);
    ctx.lineTo(w - pad.right, yLimiar);
    ctx.stroke();
    ctx.restore();

    const grupoW = areaW / dados.ciclos.length;
    const barW = Math.min(16, (grupoW - 18) / 3);

    ctx.font = '11px Poppins, sans-serif';
    ctx.textAlign = 'center';

    dados.ciclos.forEach((ciclo, idx) => {
      const centroX = pad.left + grupoW * idx + grupoW / 2;
      ctx.fillStyle = corTexto();
      ctx.fillText(ciclo, centroX, h - 10);

      const itens = [
        { nome: 'Nitrogênio (N)', val: dados.n[idx], cor: '#2d6a4f' },
        { nome: 'Fósforo (P)', val: dados.p[idx], cor: '#3a86ff' },
        {
          nome: 'Potássio (K)',
          val: dados.k[idx],
          cor: dados.k[idx] < limiarK ? '#e63946' : '#ff9f1c',
        },
      ];

      itens.forEach((item, bIdx) => {
        const bx = centroX - (barW * 1.5 + 3) + bIdx * (barW + 3);
        const bh = (item.val / maxVal) * areaH;
        const by = pad.top + areaH - bh;

        ctx.fillStyle = item.cor;
        ctx.fillRect(bx, by, barW, bh);

        barrasGrafico2.push({
          x: bx,
          y: by,
          w: barW,
          h: bh,
          ciclo,
          nutriente: item.nome,
          val: item.val,
        });
      });
    });
  }

  function renderizarTudo() {
    const dados = SERIES[periodoAtual];
    desenharGrafico1(dados);
    desenharGrafico2(dados);
  }

  // Tooltips interativos
  if (canvas1 && tooltip1) {
    canvas1.addEventListener('mousemove', (e) => {
      const rect = canvas1.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const alvo = pontosGrafico1.find((p) => Math.abs(p.x - mx) < 22);
      if (alvo) {
        tooltip1.style.display = 'block';
        tooltip1.style.left = `${Math.min(alvo.x + 10, rect.width - 150)}px`;
        tooltip1.style.top = `${Math.max(alvo.y - 36, 8)}px`;
        tooltip1.innerHTML = `<strong>${alvo.label}</strong><br/>Rend.: ${alvo.prod} sc/ha<br/>Chuva: ${alvo.chuva} mm`;
      } else {
        tooltip1.style.display = 'none';
      }
    });
    canvas1.addEventListener('mouseleave', () => (tooltip1.style.display = 'none'));
  }

  if (canvas2 && tooltip2) {
    canvas2.addEventListener('mousemove', (e) => {
      const rect = canvas2.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const alvo = barrasGrafico2.find(
        (b) => mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h
      );
      if (alvo) {
        tooltip2.style.display = 'block';
        tooltip2.style.left = `${Math.min(alvo.x, rect.width - 160)}px`;
        tooltip2.style.top = `${Math.max(alvo.y - 38, 8)}px`;
        tooltip2.innerHTML = `<strong>${alvo.ciclo} — ${alvo.nutriente}</strong><br/>${alvo.val} mg/dm³`;
      } else {
        tooltip2.style.display = 'none';
      }
    });
    canvas2.addEventListener('mouseleave', () => (tooltip2.style.display = 'none'));
  }

  // Filtro de período (Diário / Semanal / Mensal)
  filterBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      filterBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      periodoAtual = btn.dataset.period || 'weekly';
      renderizarTudo();
    });
  });

  // Integração com dados reais da API NASA RPD (atualiza série mensal de chuva e badges)
  if (typeof buscarAnaliseNASA === 'function') {
    buscarAnaliseNASA(-22.9068, -47.0616).then((res) => {
      if (!res || !res.atuais) return;
      const chuva30d = res.atuais.fator_hidrico?.precipitacao?.chuva_30d_mm;
      if (chuva30d != null) {
        SERIES.monthly.chuva[SERIES.monthly.chuva.length - 1] = Math.round(chuva30d);
      }
      const alerta = res.expectativas?.alerta_hidrico;
      const badgeProj = document.querySelector('.trends-grid .chart-card:first-child .badge');
      if (badgeProj && alerta) {
        badgeProj.textContent = `RPD: ${alerta.status_alerta}`;
      }
      renderizarTudo();
    });
  }

  window.addEventListener('resize', renderizarTudo);
  renderizarTudo();
});