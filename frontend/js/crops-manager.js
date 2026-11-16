// js/crops-manager.js
document.addEventListener('DOMContentLoaded', () => {
  const STORAGE_KEY = 'agromonitor_crops';

  const PRESETS_PADRAO = [
    'Rice (Arroz)',
    'Beans (Feijão)',
    'Corn (Milho)',
    'Soybean (Soja)',
  ];

  // Elementos da página
  const listContainer = document.getElementById('cropsListContainer');
  const counterBadge = document.getElementById('cropsCounterBadge');
  const searchInput = document.getElementById('cropSearchInput');
  const typeFilter = document.getElementById('cropTypeFilter');
  const statusFilter = document.getElementById('cropStatusFilter');

  // Elementos do Modal e Formulário
  const modalBackdrop = document.getElementById('cropModalBackdrop');
  const modalTitle = document.getElementById('cropModalTitle');
  const openModalBtn = document.getElementById('openNewCropModalBtn');
  const closeModalBtn = document.getElementById('closeCropModalBtn');
  const cancelBtn = document.getElementById('cancelCropBtn');
  const cropForm = document.getElementById('cropForm');

  const idField = document.getElementById('cropIdField');
  const presetSelect = document.getElementById('cropPresetSelect');
  const customWrapper = document.getElementById('customCropWrapper');
  const customInput = document.getElementById('customCropInput');
  const plantingDateInput = document.getElementById('plantingDateInput');
  const durationInput = document.getElementById('harvestDurationInput');
  const unitSelect = document.getElementById('harvestUnitSelect');
  const statusSelect = document.getElementById('cropStatusSelect');
  const areaInput = document.getElementById('cropAreaInput');
  const notesInput = document.getElementById('cropNotesInput');
  const errorMsg = document.getElementById('cropFormError');

  // Safras iniciais caso o localStorage ainda esteja vazio
  const SAFRAS_INICIAIS = [
    {
      id: 'safra-1',
      name: 'Soybean (Soja)',
      isCustom: false,
      plantingDate: '2026-10-15',
      duration: 120,
      unit: 'days',
      status: 'Em Crescimento',
      area: 180.0,
      notes: 'Plantio direto sobre palhada de braquiária; monitoramento hídrico SMAP.',
    },
    {
      id: 'safra-2',
      name: 'Corn (Milho)',
      isCustom: false,
      plantingDate: '2026-08-10',
      duration: 16,
      unit: 'weeks',
      status: 'Colheita Próxima',
      area: 145.0,
      notes: 'Híbrido de ciclo precoce; atenção ao alerta de potássio (K) no talhão sul.',
    },
    {
      id: 'safra-3',
      name: 'Beans (Feijão)',
      isCustom: false,
      plantingDate: '2026-12-01',
      duration: 90,
      unit: 'days',
      status: 'Planejada',
      area: 60.0,
      notes: 'Rotação de cultura para fixação biológica de nitrogênio.',
    },
    {
      id: 'safra-4',
      name: 'Potato (Batata)',
      isCustom: true,
      plantingDate: '2026-05-20',
      duration: 105,
      unit: 'days',
      status: 'Concluída',
      area: 35.0,
      notes: 'Cultivo de outono/inverno com irrigação controlada; baixa erosão.',
    },
  ];

  function carregarSafras() {
    const salvo = localStorage.getItem(STORAGE_KEY);
    if (!salvo) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(SAFRAS_INICIAIS));
      return [...SAFRAS_INICIAIS];
    }
    try {
      return JSON.parse(salvo);
    } catch {
      return [...SAFRAS_INICIAIS];
    }
  }

  function salvarSafras(lista) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lista));
  }

  function calcularDataColheita(dataStr, duracao, unidade) {
    if (!dataStr || !duracao) return '--';
    const [ano, mes, dia] = dataStr.split('-').map(Number);
    const dt = new Date(ano, mes - 1, dia);
    const dias = unidade === 'weeks' ? duracao * 7 : duracao;
    dt.setDate(dt.getDate() + dias);
    return dt.toLocaleDateString('pt-BR');
  }

  function formatarDataBR(dataStr) {
    if (!dataStr) return '--';
    const [ano, mes, dia] = dataStr.split('-');
    return `${dia}/${mes}/${ano}`;
  }

  function classeBadgeStatus(status) {
    if (status === 'Em Crescimento' || status === 'Concluída') return 'badge-green';
    if (status === 'Colheita Próxima') return 'badge-orange';
    return 'badge-info';
  }

  function renderizarSafras() {
    if (!listContainer) return;
    const todas = carregarSafras();
    const termo = (searchInput?.value || '').trim().toLowerCase();
    const filtroTipo = typeFilter?.value || 'all';
    const filtroStatus = statusFilter?.value || 'all';

    const filtradas = todas.filter((s) => {
      const bateTexto =
        !termo ||
        s.name.toLowerCase().includes(termo) ||
        (s.notes || '').toLowerCase().includes(termo);

      const bateTipo =
        filtroTipo === 'all' ||
        (filtroTipo === 'custom' && s.isCustom) ||
        s.name === filtroTipo;

      const bateStatus = filtroStatus === 'all' || s.status === filtroStatus;

      return bateTexto && bateTipo && bateStatus;
    });

    if (counterBadge) {
      counterBadge.textContent = `${filtradas.length} ${
        filtradas.length === 1 ? 'safra exibida' : 'safras exibidas'
      }`;
    }

    if (!filtradas.length) {
      listContainer.innerHTML = `
        <div class="card-surface" style="grid-column:1/-1;text-align:center;padding:32px;">
          <p style="color:var(--text-secondary);">Nenhuma safra encontrada com os filtros atuais.</p>
        </div>`;
      return;
    }

    listContainer.innerHTML = filtradas
      .map((s) => {
        const colheitaEst = calcularDataColheita(s.plantingDate, Number(s.duration), s.unit);
        const unidadeTexto = s.unit === 'weeks' ? 'sem.' : 'dias';
        return `
          <article class="card-surface" style="display:flex;flex-direction:column;justify-content:space-between;gap:12px;">
            <div>
              <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px;">
                <strong style="font-size:1rem;">${s.name}</strong>
                <span class="badge ${classeBadgeStatus(s.status)}">${s.status}</span>
              </div>
              <p style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:10px;">
                Área: <strong>${Number(s.area).toFixed(1)} ha</strong> • Ciclo: <strong>${s.duration} ${unidadeTexto}</strong>
              </p>
              <div style="font-size:0.78rem;background:var(--bg-body);padding:10px;border-radius:9px;display:flex;justify-content:space-between;">
                <span>Plantio: <strong>${formatarDataBR(s.plantingDate)}</strong></span>
                <span>Colheita Est.: <strong>${colheitaEst}</strong></span>
              </div>
              ${
                s.notes
                  ? `<p style="font-size:0.78rem;color:var(--text-secondary);margin-top:10px;">${s.notes}</p>`
                  : ''
              }
            </div>

            <div style="display:flex;justify-content:flex-end;gap:8px;border-top:1px solid var(--border-color);padding-top:10px;">
              <button type="button" class="btn-ghost" data-edit-id="${s.id}" style="padding:6px 12px;font-size:0.78rem;">Editar</button>
              <button type="button" class="btn-ghost" data-delete-id="${s.id}" style="padding:6px 12px;font-size:0.78rem;color:var(--red);">Excluir</button>
            </div>
          </article>`;
      })
      .join('');

    // Eventos dos botões Editar e Excluir
    listContainer.querySelectorAll('[data-edit-id]').forEach((btn) => {
      btn.addEventListener('click', () => abrirModalEdicao(btn.dataset.editId));
    });

    listContainer.querySelectorAll('[data-delete-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!confirm('Deseja realmente excluir esta safra?')) return;
        const atualizada = carregarSafras().filter((item) => item.id !== btn.dataset.deleteId);
        salvarSafras(atualizada);
        renderizarSafras();
      });
    });
  }

  function atualizarVisibilidadeCustom() {
    if (!presetSelect || !customWrapper) return;
    const ehCustom = presetSelect.value === '__custom__';
    customWrapper.style.display = ehCustom ? 'flex' : 'none';
    if (customInput) customInput.required = ehCustom;
  }

  function abrirModalNova() {
    if (!modalBackdrop || !cropForm) return;
    cropForm.reset();
    if (idField) idField.value = '';
    if (modalTitle) modalTitle.textContent = 'Nova Safra';
    if (errorMsg) errorMsg.style.display = 'none';
    atualizarVisibilidadeCustom();
    modalBackdrop.classList.add('open');
  }

  function abrirModalEdicao(id) {
    const safra = carregarSafras().find((s) => s.id === id);
    if (!safra || !modalBackdrop) return;

    if (idField) idField.value = safra.id;
    if (modalTitle) modalTitle.textContent = 'Editar Safra';
    if (errorMsg) errorMsg.style.display = 'none';

    if (PRESETS_PADRAO.includes(safra.name)) {
      presetSelect.value = safra.name;
      customInput.value = '';
    } else {
      presetSelect.value = '__custom__';
      customInput.value = safra.name;
    }
    atualizarVisibilidadeCustom();

    plantingDateInput.value = safra.plantingDate;
    durationInput.value = safra.duration;
    unitSelect.value = safra.unit;
    statusSelect.value = safra.status;
    areaInput.value = safra.area;
    notesInput.value = safra.notes || '';

    modalBackdrop.classList.add('open');
  }

  function fecharModal() {
    if (modalBackdrop) modalBackdrop.classList.remove('open');
  }

  // Listeners do Modal e Formulário
  if (openModalBtn) openModalBtn.addEventListener('click', abrirModalNova);
  if (closeModalBtn) closeModalBtn.addEventListener('click', fecharModal);
  if (cancelBtn) cancelBtn.addEventListener('click', fecharModal);
  if (presetSelect) presetSelect.addEventListener('change', atualizarVisibilidadeCustom);

  if (modalBackdrop) {
    modalBackdrop.addEventListener('click', (e) => {
      if (e.target === modalBackdrop) fecharModal();
    });
  }

  if (cropForm) {
    cropForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const ehCustom = presetSelect.value === '__custom__';
      const nomeFinal = ehCustom ? customInput.value.trim() : presetSelect.value;
      const plantingDate = plantingDateInput.value;
      const duration = parseInt(durationInput.value, 10);
      const area = parseFloat(areaInput.value);

      if (!nomeFinal || !plantingDate || Number.isNaN(duration) || duration <= 0 || Number.isNaN(area) || area <= 0) {
        if (errorMsg) errorMsg.style.display = 'block';
        return;
      }

      if (errorMsg) errorMsg.style.display = 'none';

      const lista = carregarSafras();
      const registro = {
        id: idField.value || `safra-${Date.now()}`,
        name: nomeFinal,
        isCustom: !PRESETS_PADRAO.includes(nomeFinal),
        plantingDate,
        duration,
        unit: unitSelect.value,
        status: statusSelect.value,
        area,
        notes: notesInput.value.trim(),
      };

      const idx = lista.findIndex((item) => item.id === registro.id);
      if (idx >= 0) lista[idx] = registro;
      else lista.unshift(registro);

      salvarSafras(lista);
      fecharModal();
      renderizarSafras();
    });
  }

  // Listeners dos Filtros
  if (searchInput) searchInput.addEventListener('input', renderizarSafras);
  if (typeFilter) typeFilter.addEventListener('change', renderizarSafras);
  if (statusFilter) statusFilter.addEventListener('change', renderizarSafras);

  renderizarSafras();
});