/**
 * LUMEN: AI PHOTOGRAPHY STUDIO
 * Controlador Principal: Linguagem Natural, Direção Iterativa, Foto de Inspiração,
 * Prova de Estúdio (3 Luzes), Laboratório Darkroom em Tempo Real e Pôster Editorial Fine Art.
 * Segurança XSS: Todas as inserções dinâmicas usam exclusivamente textContent.
 */

(function () {
  'use strict';

  const state = {
    isGenerating: false,
    contactSheetMode: false,
    referenceImageBase64: null,
    referenceMimeType: 'image/jpeg',
    currentImageBlobUrl: null,
    activeRawBlobUrl: null,
    contactBlobUrls: [],
    drawerBlobUrls: [],
    currentProduction: null,
    toastTimer: null,
    darkroom: {
      exposure: 0,
      contrast: 0,
      warmth: 0,
      vignette: 0,
      grain: 0,
      bw: false,
    },
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

    refFileInput: document.getElementById('reference-file-input'),
    refDropzone: document.getElementById('reference-dropzone'),
    refEmptyPrompt: document.getElementById('reference-empty-prompt'),
    refPreviewContainer: document.getElementById('reference-preview-container'),
    refPreviewImg: document.getElementById('reference-preview-img'),
    removeRefBtn: document.getElementById('remove-reference-btn'),

    contactSheetToggle: document.getElementById('contact-sheet-toggle'),

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
    contactSheetStrip: document.getElementById('contact-sheet-strip'),
    refinementInput: document.getElementById('refinement-input'),
    applyRefinementBtn: document.getElementById('apply-refinement-btn'),

    resultMetadataBar: document.getElementById('result-metadata-bar'),
    downloadBtn: document.getElementById('download-image-btn'),
    downloadEditorialBtn: document.getElementById('download-editorial-btn'),
    newProductionBtn: document.getElementById('new-production-btn'),

    darkroomPanel: document.getElementById('darkroom-panel'),
    accBtnDarkroom: document.getElementById('accordion-btn-darkroom'),
    accPanelDarkroom: document.getElementById('accordion-panel-darkroom'),
    resetDarkroomBtn: document.getElementById('reset-darkroom-btn'),
    drExposure: document.getElementById('dr-exposure'),
    drExposureVal: document.getElementById('dr-exposure-val'),
    drContrast: document.getElementById('dr-contrast'),
    drContrastVal: document.getElementById('dr-contrast-val'),
    drWarmth: document.getElementById('dr-warmth'),
    drWarmthVal: document.getElementById('dr-warmth-val'),
    drVignette: document.getElementById('dr-vignette'),
    drVignetteVal: document.getElementById('dr-vignette-val'),
    drGrain: document.getElementById('dr-grain'),
    drGrainVal: document.getElementById('dr-grain-val'),

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
    qaSuggestionBox: document.getElementById('qa-suggestion-box'),
    qaSuggestionText: document.getElementById('qa-suggestion-text'),
    applyQaSuggestionBtn: document.getElementById('apply-qa-suggestion-btn'),

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
      if (!response.ok) throw new Error('Status HTTP não-OK');
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
   * 1 & 2. Helpers de Linguagem Natural, Foto de Inspiração e Modo Prova de Estúdio
   */
  function setupNaturalLanguageHelpers() {
    document.querySelectorAll('[data-phrase]').forEach((chip) => {
      chip.addEventListener('click', () => {
        if (state.isGenerating) return;
        const phrase = chip.getAttribute('data-phrase') || '';
        if (!phrase) return;

        const current = els.briefInput.value.trim();
        if (!current) {
          els.briefInput.value = phrase.charAt(0).toUpperCase() + phrase.slice(1);
        } else if (!current.toLowerCase().includes(phrase.toLowerCase())) {
          const cleanEnd = current.replace(/[.,;]+$/, '');
          els.briefInput.value = `${cleanEnd}, ${phrase}.`;
        }
        clearBriefValidationError();
        els.briefInput.focus();
      });
    });

    document.querySelectorAll('[data-example]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (state.isGenerating) return;
        els.briefInput.value = btn.getAttribute('data-example') || '';
        clearBriefValidationError();
        els.briefInput.focus();
      });
    });

    // Toggle Modo Prova de Estúdio (3 Estudos de Luz)
    els.contactSheetToggle.addEventListener('click', () => {
      if (state.isGenerating) return;
      state.contactSheetMode = !state.contactSheetMode;
      els.contactSheetToggle.setAttribute(
        'aria-pressed',
        state.contactSheetMode ? 'true' : 'false'
      );
    });

    // Upload / Drag & Drop / Paste de Foto de Inspiração
    els.refDropzone.addEventListener('click', (e) => {
      if (e.target.closest('#remove-reference-btn')) return;
      els.refFileInput.click();
    });

    els.refDropzone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        els.refFileInput.click();
      }
    });

    els.refFileInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) loadReferenceFile(file);
    });

    els.refDropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      els.refDropzone.classList.add('is-dragover');
    });

    els.refDropzone.addEventListener('dragleave', () => {
      els.refDropzone.classList.remove('is-dragover');
    });

    els.refDropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      els.refDropzone.classList.remove('is-dragover');
      const file = e.dataTransfer?.files?.[0];
      if (file && file.type.startsWith('image/')) {
        loadReferenceFile(file);
      }
    });

    // Colar imagem do Clipboard (Ctrl+V)
    document.addEventListener('paste', (e) => {
      if (state.isGenerating) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            loadReferenceFile(file);
            showToast('Foto de inspiração colada.');
            break;
          }
        }
      }
    });

    els.removeRefBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      clearReferenceImage();
    });
  }

  function loadReferenceFile(file) {
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = String(event.target?.result || '');
      const parts = dataUrl.split(',');
      if (parts.length === 2) {
        state.referenceImageBase64 = parts[1];
        state.referenceMimeType = file.type || 'image/jpeg';
        els.refPreviewImg.src = dataUrl;
        els.refEmptyPrompt.classList.add('hidden');
        els.refPreviewContainer.classList.remove('hidden');
      }
    };
    reader.readAsDataURL(file);
  }

  function clearReferenceImage() {
    state.referenceImageBase64 = null;
    els.refFileInput.value = '';
    els.refPreviewImg.removeAttribute('src');
    els.refPreviewContainer.classList.add('hidden');
    els.refEmptyPrompt.classList.remove('hidden');
  }

  /**
   * Gerenciamento de URLs de Blob
   */
  function revokeCurrentImageUrl() {
    if (state.currentImageBlobUrl) {
      URL.revokeObjectURL(state.currentImageBlobUrl);
      state.currentImageBlobUrl = null;
    }
    if (state.activeRawBlobUrl) {
      URL.revokeObjectURL(state.activeRawBlobUrl);
      state.activeRawBlobUrl = null;
    }
    state.contactBlobUrls.forEach((u) => URL.revokeObjectURL(u));
    state.contactBlobUrls = [];
  }

  function revokeDrawerUrls() {
    state.drawerBlobUrls.forEach((url) => URL.revokeObjectURL(url));
    state.drawerBlobUrls = [];
  }

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

  function setWorkspaceView(viewName) {
    els.stateEmpty.classList.toggle('hidden', viewName !== 'empty');
    els.stateGenerating.classList.toggle('hidden', viewName !== 'generating');
    els.stateSuccess.classList.toggle('hidden', viewName !== 'success');
    els.darkroomPanel.classList.toggle('hidden', viewName !== 'success');
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
    els.applyRefinementBtn.disabled = isSubmitting;
    els.refinementInput.disabled = isSubmitting;
    els.submitBtnLabel.textContent = isSubmitting ? 'Produzindo…' : 'Disparar produção';

    document.querySelectorAll('[data-phrase], [data-example], [data-quick-refine]').forEach((btn) => {
      btn.disabled = isSubmitting;
    });
  }

  /**
   * 4. LABORATÓRIO DARKROOM EM TEMPO REAL (Canvas 2D Processing)
   */
  function resetDarkroomControls() {
    state.darkroom = {
      exposure: 0,
      contrast: 0,
      warmth: 0,
      vignette: 0,
      grain: 0,
      bw: false,
    };
    els.drExposure.value = '0';
    els.drExposureVal.textContent = '0';
    els.drContrast.value = '0';
    els.drContrastVal.textContent = '0';
    els.drWarmth.value = '0';
    els.drWarmthVal.textContent = '0';
    els.drVignette.value = '0';
    els.drVignetteVal.textContent = '0';
    els.drGrain.value = '0';
    els.drGrainVal.textContent = '0';
  }

  async function applyDarkroomToCurrentImage() {
    if (!state.activeRawBlobUrl) return;
    const d = state.darkroom;
    const isUnchanged =
      d.exposure === 0 &&
      d.contrast === 0 &&
      d.warmth === 0 &&
      d.vignette === 0 &&
      d.grain === 0 &&
      !d.bw;

    if (isUnchanged) {
      els.resultImage.src = state.activeRawBlobUrl;
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = state.activeRawBlobUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext('2d');

    // Filtro base de exposição e contraste
    const brightness = 100 + d.exposure;
    const contrast = 100 + d.contrast;
    const grayscale = d.bw ? 100 : 0;
    ctx.filter = `brightness(${brightness}%) contrast(${contrast}%) grayscale(${grayscale}%)`;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    ctx.filter = 'none';

    // Manipulação pixel a pixel para Temperatura (Quente/Fria) e Grão 35mm
    if (d.warmth !== 0 || d.grain > 0) {
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imgData.data;
      const warmShift = d.warmth * 0.9;
      const grainAmp = d.grain * 0.65;

      for (let i = 0; i < data.length; i += 4) {
        let r = data[i];
        let g = data[i + 1];
        let b = data[i + 2];

        if (warmShift !== 0 && !d.bw) {
          r = Math.min(255, Math.max(0, r + warmShift));
          g = Math.min(255, Math.max(0, g + warmShift * 0.25));
          b = Math.min(255, Math.max(0, b - warmShift));
        }

        if (grainAmp > 0) {
          const noise = (Math.random() - 0.5) * grainAmp;
          r = Math.min(255, Math.max(0, r + noise));
          g = Math.min(255, Math.max(0, g + noise));
          b = Math.min(255, Math.max(0, b + noise));
        }

        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
      }
      ctx.putImageData(imgData, 0, 0);
    }

    // Vinheta óptica suave
    if (d.vignette > 0) {
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const maxRadius = Math.sqrt(cx * cx + cy * cy);
      const grad = ctx.createRadialGradient(cx, cy, maxRadius * 0.35, cx, cy, maxRadius);
      grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
      grad.addColorStop(1, `rgba(10, 11, 10, ${(d.vignette / 100) * 0.85})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        if (state.currentImageBlobUrl && state.currentImageBlobUrl !== state.activeRawBlobUrl) {
          URL.revokeObjectURL(state.currentImageBlobUrl);
        }
        state.currentImageBlobUrl = URL.createObjectURL(blob);
        els.resultImage.src = state.currentImageBlobUrl;
      },
      'image/jpeg',
      0.95
    );
  }

  function setupDarkroomEvents() {
    const sliders = [
      { input: els.drExposure, label: els.drExposureVal, key: 'exposure' },
      { input: els.drContrast, label: els.drContrastVal, key: 'contrast' },
      { input: els.drWarmth, label: els.drWarmthVal, key: 'warmth' },
      { input: els.drVignette, label: els.drVignetteVal, key: 'vignette' },
      { input: els.drGrain, label: els.drGrainVal, key: 'grain' },
    ];

    sliders.forEach(({ input, label, key }) => {
      input.addEventListener('input', () => {
        const val = Number(input.value);
        state.darkroom[key] = val;
        label.textContent = String(val);
        applyDarkroomToCurrentImage();
      });
    });

    document.querySelectorAll('[data-darkroom-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const preset = btn.getAttribute('data-darkroom-preset');
        resetDarkroomControls();
        if (preset === 'bw') {
          state.darkroom.bw = true;
          state.darkroom.contrast = 14;
          state.darkroom.grain = 22;
          state.darkroom.vignette = 24;
        } else if (preset === 'warm') {
          state.darkroom.warmth = 22;
          state.darkroom.exposure = 4;
          state.darkroom.grain = 14;
        } else if (preset === 'cinema') {
          state.darkroom.contrast = 18;
          state.darkroom.vignette = 32;
          state.darkroom.warmth = -8;
        }
        els.drExposure.value = String(state.darkroom.exposure);
        els.drExposureVal.textContent = String(state.darkroom.exposure);
        els.drContrast.value = String(state.darkroom.contrast);
        els.drContrastVal.textContent = String(state.darkroom.contrast);
        els.drWarmth.value = String(state.darkroom.warmth);
        els.drWarmthVal.textContent = String(state.darkroom.warmth);
        els.drVignette.value = String(state.darkroom.vignette);
        els.drVignetteVal.textContent = String(state.darkroom.vignette);
        els.drGrain.value = String(state.darkroom.grain);
        els.drGrainVal.textContent = String(state.darkroom.grain);
        applyDarkroomToCurrentImage();
      });
    });

    els.resetDarkroomBtn.addEventListener('click', () => {
      resetDarkroomControls();
      applyDarkroomToCurrentImage();
    });
  }

  /**
   * Renderiza uma produção concluída (com suporte a Prova de Estúdio e Sugestão de Curadoria)
   */
  function renderProductionResult(record) {
    revokeCurrentImageUrl();
    resetDarkroomControls();

    const imageBlob =
      record.imageBlob instanceof Blob
        ? record.imageBlob
        : window.lumenDB.base64ToBlob(record.image_base64, record.mime_type || 'image/jpeg');

    const rawUrl = URL.createObjectURL(imageBlob);
    state.activeRawBlobUrl = rawUrl;
    state.currentImageBlobUrl = rawUrl;
    state.currentProduction = {
      ...record,
      imageBlob,
      timestamp: record.timestamp || Date.now(),
    };

    els.resultImage.src = rawUrl;
    const p = record.params || {};
    els.resultMetadataBar.textContent = `${p.lens || '35mm'} · ${p.aperture || 'f/1.4'} · ${p.film || 'Kodak Portra 400'} · ${p.aspect_ratio || '4:5'}`;
    els.downloadBtn.disabled = false;
    els.downloadEditorialBtn.disabled = false;
    els.refinementInput.value = '';

    // 3. Renderizar Tira de Prova de Estúdio (Contact Sheet) se houver variações
    els.contactSheetStrip.textContent = '';
    const variations = Array.isArray(record.contact_sheet) ? record.contact_sheet : [];
    if (variations.length > 1) {
      els.contactSheetStrip.classList.remove('hidden');
      variations.forEach((v, idx) => {
        const vBlob =
          v.imageBlob instanceof Blob
            ? v.imageBlob
            : window.lumenDB.base64ToBlob(v.image_base64, 'image/jpeg');
        const vUrl = URL.createObjectURL(vBlob);
        state.contactBlobUrls.push(vUrl);

        const cardBtn = document.createElement('button');
        cardBtn.type = 'button';
        cardBtn.className = `lumen-contact-card ${idx === 0 ? 'is-active' : ''}`;

        const thumb = document.createElement('img');
        thumb.src = vUrl;
        thumb.alt = v.label || `Estudo ${idx + 1}`;
        thumb.className = 'w-full h-20 object-cover rounded-sm';

        const lbl = document.createElement('span');
        lbl.className = 'text-[11px] font-medium text-ivory truncate w-full';
        lbl.textContent = v.label || `Estudo ${idx + 1}`;

        cardBtn.appendChild(thumb);
        cardBtn.appendChild(lbl);

        cardBtn.addEventListener('click', () => {
          els.contactSheetStrip.querySelectorAll('.lumen-contact-card').forEach((c) => {
            c.classList.remove('is-active');
          });
          cardBtn.classList.add('is-active');
          state.activeRawBlobUrl = vUrl;
          state.currentImageBlobUrl = vUrl;
          els.directionPromptText.textContent = v.prompt || record.direction?.final_prompt || '';
          applyDarkroomToCurrentImage();
        });

        els.contactSheetStrip.appendChild(cardBtn);
      });
    } else {
      els.contactSheetStrip.classList.add('hidden');
    }

    // Direção Fotográfica
    els.directionOpticsText.textContent = record.direction?.camera_optics || '';
    els.directionPromptText.textContent = record.direction?.final_prompt || '';

    // Auditoria Visual Resiliente + Sugestão Ativa
    if (record.qa_available && record.qa && typeof record.qa.score === 'number') {
      els.qaScorePill.textContent = `${record.qa.score.toFixed(1)} / 10`;
      els.qaLightingText.textContent = record.qa.lighting || '';
      els.qaLensText.textContent = record.qa.lens_coherence || '';
      els.qaNotesText.textContent = record.qa.notes || '';

      const suggestion = record.qa.improvement_suggestion || '';
      if (suggestion) {
        els.qaSuggestionText.textContent = suggestion;
        els.qaSuggestionBox.classList.remove('hidden');
      } else {
        els.qaSuggestionBox.classList.add('hidden');
      }

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
   * Disparo da Produção (Nova ou Refinamento Iterativo sobre a foto atual)
   */
  async function executeGenerationRequest(refinementInstruction = null) {
    if (state.isGenerating) return;

    const briefText = els.briefInput.value.trim() || state.currentProduction?.params?.brief || '';
    if (!briefText) {
      showBriefValidationError('Conte como você imagina a cena antes de disparar a produção.');
      return;
    }

    clearBriefValidationError();
    hideWorkspaceError();
    setSubmittingState(true);
    updateStepProgress(
      'direction',
      refinementInstruction
        ? 'Ajustando direção fotográfica da cena'
        : 'Preparando direção fotográfica'
    );
    setWorkspaceView('generating');

    const payload = {
      brief: briefText,
      contact_sheet: state.contactSheetMode,
    };

    if (refinementInstruction && state.currentProduction) {
      payload.previous_prompt = state.currentProduction.direction?.final_prompt || '';
      payload.refinement_instruction = refinementInstruction;
    }

    if (state.referenceImageBase64) {
      payload.reference_image_base64 = state.referenceImageBase64;
      payload.reference_mime_type = state.referenceMimeType;
    }

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

  function handleProductionSubmit(event) {
    if (event) event.preventDefault();
    executeGenerationRequest(null);
  }

  /**
   * 5. Exportação Editorial Fine Art (Pôster de Galeria com Moldura e Metadados)
   */
  async function handleDownloadEditorialPoster() {
    const activeUrl = els.resultImage.src || state.currentImageBlobUrl;
    if (!activeUrl || !state.currentProduction) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = activeUrl;
    });

    const w = img.naturalWidth || 1024;
    const h = img.naturalHeight || 1280;
    const borderSide = Math.round(Math.max(w, h) * 0.075);
    const borderTop = borderSide;
    const borderBottom = Math.round(borderSide * 2.15);

    const canvas = document.createElement('canvas');
    canvas.width = w + borderSide * 2;
    canvas.height = h + borderTop + borderBottom;
    const ctx = canvas.getContext('2d');

    // Moldura Fine Art em Marfim Editorial (#F3F1EA)
    ctx.fillStyle = '#F3F1EA';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Linha de filete interna sutil
    ctx.strokeStyle = '#D9D7CE';
    ctx.lineWidth = 1;
    ctx.strokeRect(borderSide - 4, borderTop - 4, w + 8, h + 8);

    // Fotografia central
    ctx.drawImage(img, borderSide, borderTop, w, h);

    // Tipografia Editorial no rodapé da moldura
    const p = state.currentProduction.params || {};
    const footerY = borderTop + h + Math.round(borderBottom * 0.46);

    ctx.fillStyle = '#171A12';
    ctx.font = `700 ${Math.round(borderSide * 0.28)}px Inter, sans-serif`;
    ctx.fillText('L U M E N', borderSide, footerY);

    ctx.fillStyle = '#6E7068';
    ctx.font = `500 ${Math.round(borderSide * 0.16)}px Inter, sans-serif`;
    ctx.fillText('AI PHOTOGRAPHY STUDIO · FINE ART EDITION', borderSide, footerY + Math.round(borderSide * 0.28));

    // Metadados ópticos alinhados à direita
    const metaStr = `${p.lens || '35mm'}  ·  ${p.aperture || 'f/1.4'}  ·  ${p.film || 'Kodak Portra 400'}`;
    ctx.textAlign = 'right';
    ctx.fillStyle = '#292D25';
    ctx.font = `500 ${Math.round(borderSide * 0.19)}px "JetBrains Mono", monospace`;
    ctx.fillText(metaStr, canvas.width - borderSide, footerY + Math.round(borderSide * 0.08));

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const ts = state.currentProduction.timestamp || Date.now();
        const link = document.createElement('a');
        link.href = url;
        link.download = `lumen-fine-art-${ts}.jpg`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 3000);
        showToast('Pôster Fine Art exportado.');
      },
      'image/jpeg',
      0.96
    );
  }

  /**
   * Download padronizado: lumen-studio-[timestamp].jpg
   */
  function handleDownloadImage() {
    const activeUrl = els.resultImage.src || state.currentImageBlobUrl;
    if (!activeUrl || !state.currentProduction) return;
    const ts = state.currentProduction.timestamp || Date.now();
    const link = document.createElement('a');
    link.href = activeUrl;
    link.download = `lumen-studio-${ts}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function handleNewProduction() {
    if (state.isGenerating) return;
    revokeCurrentImageUrl();
    state.currentProduction = null;
    els.resultImage.removeAttribute('src');
    els.downloadBtn.disabled = true;
    els.downloadEditorialBtn.disabled = true;
    hideWorkspaceError();
    setWorkspaceView('empty');
    els.briefInput.focus();
  }

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

  function setupAccordions() {
    const toggles = [
      { btn: els.accBtnDarkroom, panel: els.accPanelDarkroom },
      { btn: els.accBtnDirection, panel: els.accPanelDirection },
      { btn: els.accBtnQa, panel: els.accPanelQa },
    ];

    toggles.forEach(({ btn, panel }) => {
      if (!btn || !panel) return;
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
   * Eventos Globais, Refinamento Iterativo e Sugestão da Curadoria
   */
  function bindEvents() {
    els.form.addEventListener('submit', handleProductionSubmit);

    els.briefInput.addEventListener('input', () => {
      if (els.briefInput.value.trim()) {
        clearBriefValidationError();
      }
    });

    els.briefInput.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleProductionSubmit(e);
      }
    });

    // 1. Direção Iterativa ("Conversar com a foto atual")
    els.applyRefinementBtn.addEventListener('click', () => {
      const instruction = els.refinementInput.value.trim();
      if (!instruction) {
        els.refinementInput.focus();
        return;
      }
      executeGenerationRequest(instruction);
    });

    els.refinementInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const instruction = els.refinementInput.value.trim();
        if (instruction) executeGenerationRequest(instruction);
      }
    });

    document.querySelectorAll('[data-quick-refine]').forEach((chip) => {
      chip.addEventListener('click', () => {
        const refineText = chip.getAttribute('data-quick-refine') || '';
        if (refineText) {
          els.refinementInput.value = refineText;
          executeGenerationRequest(refineText);
        }
      });
    });

    // 6. Aplicar sugestão da curadoria com 1 clique
    els.applyQaSuggestionBtn.addEventListener('click', () => {
      const suggestion = els.qaSuggestionText.textContent || '';
      if (suggestion) {
        els.refinementInput.value = suggestion;
        executeGenerationRequest(suggestion);
      }
    });

    els.closeErrorBtn.addEventListener('click', hideWorkspaceError);
    els.downloadBtn.addEventListener('click', handleDownloadImage);
    els.downloadEditorialBtn.addEventListener('click', handleDownloadEditorialPoster);
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

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !els.historyDrawer.classList.contains('hidden')) {
        closeHistoryDrawer();
      }
    });
  }

  async function init() {
    initIcons();
    setupNaturalLanguageHelpers();
    setupDarkroomEvents();
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
