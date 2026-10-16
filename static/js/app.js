/**
 * LUMEN: AI PHOTOGRAPHY STUDIO
 * Controlador Principal de Interface em Linguagem Natural, Streaming NDJSON e Histórico
 * Segurança XSS: Todas as inserções de conteúdo dinâmico utilizam exclusivamente textContent.
 */

(function () {
  'use strict';

  const state = {
    isGenerating: false,
    currentImageBlobUrl: null,
    currentProduction: null,
    drawerBlobUrls: [],
    toastTimer: null,
  };

  // Referências DOM
  const els = {
    statusDot: document.getElementById('system-status-dot'),
    statusText: document.getElementById('system-status-text'),
    openHistoryBtn: document.getElementById('open-history-btn'),
    closeHistoryBtn: document.getElementById('close-history-btn'),
    historyCountBadge: document.getElementById('history-count-badge'),
    historyDrawer: document.getElementById('history-drawer'),
    historyBackdrop: document.getElementById('history-drawer-backdrop'),
    historyList: document.getElementById('history-list'),
    clearHistoryBtn: document.getElementById('clear-history-btn'),
    clearConfirmBox: document.getElementById('clear-confirm-box'),
    confirmClearYes: document.getElementById('confirm-clear-yes'),
    confirmClearNo: document.getElementById('confirm-clear-no'),

    form: document.getElementById('production-form'),
    briefInput: document.getElementById('brief-input'),
    briefAlert: document.getElementById('brief-validation-alert'),
    briefAlertText: document.getElementById('brief-validation-text'),
    submitBtn: document.getElementById('submit-production-btn'),
    submitBtnLabel: document.getElementById('submit-btn-label'),

    errorBanner: document.getElementById('workspace-error-banner'),
    errorText: document.getElementById('workspace-error-text'),
    closeErrorBtn: document.getElementById('close-error-btn'),

    stateEmpty: document.getElementById('state-empty'),
    stateGenerating: document.getElementById('state-generating'),
    stateSuccess: document.getElementById('state-success'),

    generatingHeading: document.getElementById('generating-live-heading'),
    stepDirection: document.getElementById('step-item-direction'),
    stepImaging: document.getElementById('step-item-imaging'),
    stepQa: document.getElementById('step-item-qa'),

    resultImage: document.getElementById('result-image'),
    resultMetadataBar: document.getElementById('result-metadata-bar'),
    downloadBtn: document.getElementById('download-image-btn'),
    newProductionBtn: document.getElementById('new-production-btn'),

    technicalPanels: document.getElementById('technical-panels'),
    accBtnDirection: document.getElementById('accordion-btn-direction'),
    accPanelDirection: document.getElementById('accordion-panel-direction'),
    directionOpticsText: document.getElementById('direction-optics-text'),
    directionPromptText: document.getElementById('direction-prompt-text'),
    copyPromptBtn: document.getElementById('copy-prompt-btn'),

    accBtnQa: document.getElementById('accordion-btn-qa'),
    accPanelQa: document.getElementById('accordion-panel-qa'),
    qaScorePill: document.getElementById('qa-score-pill'),
    qaContentAvailable: document.getElementById('qa-content-available'),
    qaContentUnavailable: document.getElementById('qa-content-unavailable'),
    qaLightingText: document.getElementById('qa-lighting-text'),
    qaLensText: document.getElementById('qa-lens-text'),
    qaNotesText: document.getElementById('qa-notes-text'),

    toast: document.getElementById('lumen-toast'),
    toastText: document.getElementById('lumen-toast-text'),
  };

  function initIcons() {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
  }

  /**
   * Checagem real de saúde do backend (GET /health)
   */
  async function checkSystemHealth() {
    try {
      const response = await fetch('/health', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Status HTTP não-OK');
      }
      const data = await response.json();
      if (data.status === 'ok' && data.api_key_configured) {
        els.statusDot.style.backgroundColor = 'var(--color-success)';
        els.statusText.textContent = 'Estúdio online';
      } else if (data.status === 'ok' && !data.api_key_configured) {
        els.statusDot.style.backgroundColor = 'var(--color-warning)';
        els.statusText.textContent = 'API Key pendente';
      } else {
        els.statusDot.style.backgroundColor = 'var(--color-danger)';
        els.statusText.textContent = 'Sistema offline';
      }
    } catch (_err) {
      els.statusDot.style.backgroundColor = 'var(--color-danger)';
      els.statusText.textContent = 'Sistema offline';
    }
  }

  /**
   * Suporte a pílulas de linguagem natural e exemplos prontos
   */
  function setupNaturalLanguageHelpers() {
    const phraseChips = document.querySelectorAll('[data-phrase]');
    phraseChips.forEach((chip) => {
      chip.addEventListener('click', () => {
        if (state.isGenerating) return;
        const phrase = chip.getAttribute('data-phrase') || '';
        if (!phrase) return;

        const current = els.briefInput.value.trim();
        if (!current) {
          els.briefInput.value =
            phrase.charAt(0).toUpperCase() + phrase.slice(1);
        } else if (!current.toLowerCase().includes(phrase.toLowerCase())) {
          const cleanEnd = current.replace(/[.,;]+$/, '');
          els.briefInput.value = `${cleanEnd}, ${phrase}.`;
        }
        clearBriefValidationError();
        els.briefInput.focus();
      });
    });

    const exampleButtons = document.querySelectorAll('[data-example]');
    exampleButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        if (state.isGenerating) return;
        const exampleText = btn.getAttribute('data-example') || '';
        els.briefInput.value = exampleText;
        clearBriefValidationError();
        els.briefInput.focus();
      });
    });
  }

  /**
   * Gerenciamento seguro de URLs de Blob para evitar vazamento de memória
   */
  function revokeCurrentImageUrl() {
    if (state.currentImageBlobUrl) {
      URL.revokeObjectURL(state.currentImageBlobUrl);
      state.currentImageBlobUrl = null;
    }
  }

  function revokeDrawerUrls() {
    state.drawerBlobUrls.forEach((url) => URL.revokeObjectURL(url));
    state.drawerBlobUrls = [];
  }

  /**
   * Exibição de erros e alertas inline
   */
  function showBriefValidationError(message) {
    els.briefAlertText.textContent = message;
    els.briefAlert.classList.remove('hidden');
    els.briefInput.classList.add('has-error');
    els.briefInput.focus();
  }

  function clearBriefValidationError() {
    els.briefAlert.classList.add('hidden');
    els.briefInput.classList.remove('has-error');
  }

  function showWorkspaceError(message) {
    els.errorText.textContent = message;
    els.errorBanner.classList.remove('hidden');
  }

  function hideWorkspaceError() {
    els.errorBanner.classList.add('hidden');
    els.errorText.textContent = '';
  }

  /**
   * Transição de estados visuais do Workspace
   */
  function setWorkspaceView(viewName) {
    els.stateEmpty.classList.toggle('hidden', viewName !== 'empty');
    els.stateGenerating.classList.toggle('hidden', viewName !== 'generating');
    els.stateSuccess.classList.toggle('hidden', viewName !== 'success');
    els.technicalPanels.classList.toggle('hidden', viewName !== 'success');
  }

  function updateStepProgress(activeStep, liveMessage) {
    if (liveMessage) {
      els.generatingHeading.textContent = liveMessage;
    }

    const order = ['direction', 'imaging', 'qa'];
    const activeIndex = order.indexOf(activeStep);

    const stepMap = {
      direction: els.stepDirection,
      imaging: els.stepImaging,
      qa: els.stepQa,
    };

    order.forEach((stepKey, idx) => {
      const el = stepMap[stepKey];
      if (!el) return;
      el.classList.remove('is-active', 'is-done');
      if (idx < activeIndex) {
        el.classList.add('is-done');
      } else if (idx === activeIndex) {
        el.classList.add('is-active');
      }
    });
  }

  function setSubmittingState(isSubmitting) {
    state.isGenerating = isSubmitting;
    els.submitBtn.disabled = isSubmitting;
    els.briefInput.disabled = isSubmitting;
    els.submitBtnLabel.textContent = isSubmitting ? 'Produzindo…' : 'Disparar produção';

    document.querySelectorAll('[data-phrase], [data-example]').forEach((btn) => {
      btn.disabled = isSubmitting;
    });
  }

  /**
   * Renderiza uma produção concluída (nova ou restaurada do histórico) no Workspace
   */
  function renderProductionResult(record) {
    revokeCurrentImageUrl();

    const imageBlob =
      record.imageBlob instanceof Blob
        ? record.imageBlob
        : window.lumenDB.base64ToBlob(record.image_base64, record.mime_type || 'image/jpeg');

    const objectUrl = URL.createObjectURL(imageBlob);
    state.currentImageBlobUrl = objectUrl;
    state.currentProduction = {
      ...record,
      imageBlob,
      timestamp: record.timestamp || Date.now(),
    };

    els.resultImage.src = objectUrl;
    const p = record.params || {};
    const lens = p.lens || '35mm';
    const aperture = p.aperture || 'f/1.4';
    const film = p.film || 'Kodak Portra 400';
    const ratio = p.aspect_ratio || '4:5';
    els.resultMetadataBar.textContent = `${lens} · ${aperture} · ${film} · ${ratio}`;
    els.downloadBtn.disabled = false;

    // Direção Fotográfica
    els.directionOpticsText.textContent = record.direction?.camera_optics || '';
    els.directionPromptText.textContent = record.direction?.final_prompt || '';

    // Auditoria Visual Resiliente
    if (record.qa_available && record.qa && typeof record.qa.score === 'number') {
      els.qaScorePill.textContent = `${record.qa.score.toFixed(1)} / 10`;
      els.qaLightingText.textContent = record.qa.lighting || '';
      els.qaLensText.textContent = record.qa.lens_coherence || '';
      els.qaNotesText.textContent = record.qa.notes || '';
      els.qaContentAvailable.classList.remove('hidden');
      els.qaContentUnavailable.classList.add('hidden');
    } else {
      els.qaScorePill.textContent = 'Auditoria indisponível';
      els.qaContentAvailable.classList.add('hidden');
      els.qaContentUnavailable.classList.remove('hidden');
    }

    setWorkspaceView('success');
  }

  /**
   * Disparo da Produção com leitura de Streaming NDJSON em tempo real
   */
  async function handleProductionSubmit(event) {
    if (event) event.preventDefault();
    if (state.isGenerating) return;

    const briefText = els.briefInput.value.trim();
    if (!briefText) {
      showBriefValidationError('Conte como você imagina a cena antes de disparar a produção.');
      return;
    }

    clearBriefValidationError();
    hideWorkspaceError();
    setSubmittingState(true);
    updateStepProgress('direction', 'Preparando direção fotográfica');
    setWorkspaceView('generating');

    const payload = {
      brief: briefText,
    };

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok || !response.body) {
        let errorDetail = 'Falha ao iniciar comunicação com o estúdio.';
        try {
          const errJson = await response.json();
          if (errJson.detail) errorDetail = String(errJson.detail);
        } catch (_e) {
          // Ignorar erro de parse
        }
        throw new Error(errorDetail);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let completedData = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line) continue;

          const eventObj = JSON.parse(line);
          if (eventObj.event === 'step') {
            updateStepProgress(eventObj.step, eventObj.message);
          } else if (eventObj.event === 'error') {
            throw new Error(eventObj.message || 'Erro durante a produção fotográfica.');
          } else if (eventObj.event === 'complete' && eventObj.data) {
            completedData = eventObj.data;
          }
        }
      }

      if (buffer.trim()) {
        const lastEvent = JSON.parse(buffer.trim());
        if (lastEvent.event === 'error') {
          throw new Error(lastEvent.message || 'Erro durante a produção fotográfica.');
        } else if (lastEvent.event === 'complete' && lastEvent.data) {
          completedData = lastEvent.data;
        }
      }

      if (!completedData) {
        throw new Error('A transmissão foi encerrada antes de concluir a fotografia.');
      }

      const savedRecord = await window.lumenDB.saveProduction(completedData);
      renderProductionResult(savedRecord);
      await refreshHistoryBadge();
    } catch (err) {
      showWorkspaceError(err.message || 'Ocorreu um erro inesperado ao processar a produção.');
      if (state.currentProduction) {
        setWorkspaceView('success');
      } else {
        setWorkspaceView('empty');
      }
    } finally {
      setSubmittingState(false);
    }
  }

  /**
   * Download padronizado: lumen-studio-[timestamp].jpg
   */
  function handleDownloadImage() {
    if (!state.currentImageBlobUrl || !state.currentProduction) return;
    const ts = state.currentProduction.timestamp || Date.now();
    const link = document.createElement('a');
    link.href = state.currentImageBlobUrl;
    link.download = `lumen-studio-${ts}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  /**
   * Nova produção: reseta workspace para o estado inicial de forma limpa
   */
  function handleNewProduction() {
    if (state.isGenerating) return;
    revokeCurrentImageUrl();
    state.currentProduction = null;
    els.resultImage.removeAttribute('src');
    els.downloadBtn.disabled = true;
    hideWorkspaceError();
    setWorkspaceView('empty');
    els.briefInput.focus();
  }

  /**
   * Copiar prompt técnico com Toast exato "Prompt copiado."
   */
  async function handleCopyPrompt() {
    const promptText = els.directionPromptText.textContent || '';
    if (!promptText) return;

    try {
      await navigator.clipboard.writeText(promptText);
      showToast('Prompt copiado.');
    } catch (_err) {
      const tempArea = document.createElement('textarea');
      tempArea.value = promptText;
      tempArea.style.position = 'fixed';
      tempArea.style.opacity = '0';
      document.body.appendChild(tempArea);
      tempArea.select();
      document.execCommand('copy');
      document.body.removeChild(tempArea);
      showToast('Prompt copiado.');
    }
  }

  function showToast(message) {
    if (state.toastTimer) clearTimeout(state.toastTimer);
    els.toastText.textContent = message;
    els.toast.classList.remove('hidden');
    state.toastTimer = setTimeout(() => {
      els.toast.classList.add('hidden');
    }, 2600);
  }

  /**
   * Accordions Acessíveis
   */
  function setupAccordions() {
    const toggles = [
      { btn: els.accBtnDirection, panel: els.accPanelDirection },
      { btn: els.accBtnQa, panel: els.accPanelQa },
    ];

    toggles.forEach(({ btn, panel }) => {
      btn.addEventListener('click', () => {
        const isExpanded = btn.getAttribute('aria-expanded') === 'true';
        const nextState = !isExpanded;
        btn.setAttribute('aria-expanded', nextState ? 'true' : 'false');
        panel.classList.toggle('hidden', !nextState);
      });
    });
  }

  /**
   * Histórico Local (IndexedDB) e Drawer Lateral
   */
  async function refreshHistoryBadge() {
    try {
      const items = await window.lumenDB.getAllProductions();
      els.historyCountBadge.textContent = String(items.length);
      return items;
    } catch (_err) {
      els.historyCountBadge.textContent = '0';
      return [];
    }
  }

  async function openHistoryDrawer() {
    els.historyBackdrop.classList.remove('hidden');
    els.historyDrawer.classList.remove('hidden');
    els.openHistoryBtn.setAttribute('aria-expanded', 'true');
    els.clearConfirmBox.classList.add('hidden');
    await renderHistoryDrawerItems();
    els.closeHistoryBtn.focus();
  }

  function closeHistoryDrawer() {
    els.historyBackdrop.classList.add('hidden');
    els.historyDrawer.classList.add('hidden');
    els.openHistoryBtn.setAttribute('aria-expanded', 'false');
    els.clearConfirmBox.classList.add('hidden');
    revokeDrawerUrls();
  }

  async function renderHistoryDrawerItems() {
    revokeDrawerUrls();
    els.historyList.textContent = '';

    const items = await refreshHistoryBadge();

    if (items.length === 0) {
      const emptyBox = document.createElement('div');
      emptyBox.className = 'py-12 text-center text-xs text-text-muted';
      emptyBox.textContent = 'Nenhuma produção salva neste navegador.';
      els.historyList.appendChild(emptyBox);
      return;
    }

    items.forEach((item) => {
      const card = document.createElement('article');
      card.className =
        'p-3 rounded-lg bg-surface border border-border hover:border-border-strong transition flex gap-3 items-start';

      const thumbUrl = URL.createObjectURL(item.imageBlob);
      state.drawerBlobUrls.push(thumbUrl);

      const thumbImg = document.createElement('img');
      thumbImg.src = thumbUrl;
      thumbImg.alt = 'Miniatura da produção salva';
      thumbImg.className = 'w-16 h-16 rounded object-cover bg-bg border border-border shrink-0 cursor-pointer';
      thumbImg.addEventListener('click', () => restoreProductionFromHistory(item));

      const bodyDiv = document.createElement('div');
      bodyDiv.className = 'flex-1 min-w-0 flex flex-col gap-1';

      const briefBtn = document.createElement('button');
      briefBtn.type = 'button';
      briefBtn.className = 'text-left text-xs font-medium text-ivory truncate hover:text-accent bg-transparent border-0 p-0 cursor-pointer';
      briefBtn.textContent = item.params?.brief || 'Produção sem título';
      briefBtn.addEventListener('click', () => restoreProductionFromHistory(item));

      const metaSpan = document.createElement('span');
      metaSpan.className = 'font-mono-tech text-[11px] text-text-muted';
      metaSpan.textContent = `${item.params?.lens || '35mm'} · ${item.params?.aperture || 'f/1.4'} · ${item.params?.aspect_ratio || '4:5'}`;

      const footerRow = document.createElement('div');
      footerRow.className = 'flex items-center justify-between gap-2 mt-1';

      const dateSpan = document.createElement('span');
      dateSpan.className = 'text-[11px] text-text-muted';
      dateSpan.textContent = new Date(item.timestamp).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });

      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'flex items-center gap-2';

      const restoreBtn = document.createElement('button');
      restoreBtn.type = 'button';
      restoreBtn.className = 'text-[11px] font-medium text-text-secondary hover:text-ivory bg-transparent border-0 p-0 cursor-pointer';
      restoreBtn.textContent = 'Restaurar';
      restoreBtn.addEventListener('click', () => restoreProductionFromHistory(item));

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'text-[11px] text-text-muted hover:text-danger bg-transparent border-0 p-0 cursor-pointer';
      deleteBtn.setAttribute('aria-label', 'Excluir produção do histórico');
      deleteBtn.textContent = 'Excluir';
      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await window.lumenDB.deleteProduction(item.id);
        await renderHistoryDrawerItems();
      });

      actionsDiv.appendChild(restoreBtn);
      actionsDiv.appendChild(deleteBtn);
      footerRow.appendChild(dateSpan);
      footerRow.appendChild(actionsDiv);

      bodyDiv.appendChild(briefBtn);
      bodyDiv.appendChild(metaSpan);
      bodyDiv.appendChild(footerRow);

      card.appendChild(thumbImg);
      card.appendChild(bodyDiv);

      els.historyList.appendChild(card);
    });
  }

  function restoreProductionFromHistory(item) {
    if (state.isGenerating) return;
    if (item.params) {
      els.briefInput.value = item.params.brief || '';
    }
    clearBriefValidationError();
    hideWorkspaceError();
    renderProductionResult(item);
    closeHistoryDrawer();
  }

  /**
   * Registro de Eventos Globais e Atalhos de Teclado
   */
  function bindEvents() {
    els.form.addEventListener('submit', handleProductionSubmit);

    els.briefInput.addEventListener('input', () => {
      if (els.briefInput.value.trim()) {
        clearBriefValidationError();
      }
    });

    // Atalho Ctrl+Enter ou Cmd+Enter para submeter
    els.briefInput.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleProductionSubmit(e);
      }
    });

    els.closeErrorBtn.addEventListener('click', hideWorkspaceError);
    els.downloadBtn.addEventListener('click', handleDownloadImage);
    els.newProductionBtn.addEventListener('click', handleNewProduction);
    els.copyPromptBtn.addEventListener('click', handleCopyPrompt);

    els.openHistoryBtn.addEventListener('click', openHistoryDrawer);
    els.closeHistoryBtn.addEventListener('click', closeHistoryDrawer);
    els.historyBackdrop.addEventListener('click', closeHistoryDrawer);

    els.clearHistoryBtn.addEventListener('click', () => {
      els.clearConfirmBox.classList.toggle('hidden');
    });

    els.confirmClearNo.addEventListener('click', () => {
      els.clearConfirmBox.classList.add('hidden');
    });

    els.confirmClearYes.addEventListener('click', async () => {
      await window.lumenDB.clearAll();
      els.clearConfirmBox.classList.add('hidden');
      await renderHistoryDrawerItems();
    });

    // Fechar Drawer com tecla Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !els.historyDrawer.classList.contains('hidden')) {
        closeHistoryDrawer();
      }
    });
  }

  /**
   * Inicialização
   */
  async function init() {
    initIcons();
    setupNaturalLanguageHelpers();
    setupAccordions();
    bindEvents();
    await checkSystemHealth();
    setInterval(checkSystemHealth, 4 * 60 * 1000);
    await refreshHistoryBadge();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
