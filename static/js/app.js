/**
 * LUMEN: AI PHOTOGRAPHY STUDIO
 * Controlador Principal com PALCO DE LUZ ESPACIAL 360° (Radar Interativo 60fps +
 * Esfera 3D Sombreada em Tempo Real + Reiluminação Direcional na Foto Pronta).
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
    // Estado do Palco de Luz Espacial 360°
    lightingRig: {
      key_light: {
        enabled: true,
        angle_deg: 315, // 45° pela esquerda (Rembrandt)
        distance_pct: 65,
        color_label: 'Sol Dourado',
        color_hex: '#FFD166',
        intensity: 88,
      },
      rim_light: {
        enabled: true,
        angle_deg: 135, // Contraluz traseira direita
        distance_pct: 78,
        color_label: 'Frio Noturno',
        color_hex: '#74B9FF',
        intensity: 62,
      },
      spatial_summary:
        'Luz principal Sol Dourado a 45° pela esquerda (Rembrandt) + Contraluz Frio Noturno traseira à direita',
      draggingNode: null, // 'key' | 'rim' | null
      liveRelightPreviewActive: false,
    },
    darkroom: {
      exposure: 0,
      contrast: 0,
      warmth: 0,
      vignette: 0,
      grain: 0,
      bw: false,
    },
  };

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

    lightStageCanvas: document.getElementById('light-stage-canvas'),
    spatialReadout: document.getElementById('spatial-light-readout'),
    toggleRimBtn: document.getElementById('toggle-rim-light-btn'),
    relightCurrentBtn: document.getElementById('relight-current-photo-btn'),

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
   * ============================================================================
   * PALCO DE LUZ ESPACIAL 360° (RADAR INTERATIVO + ESFERA 3D EM TEMPO REAL)
   * ============================================================================
   * Convenção de ângulo no radar:
   * 0° = Frente (embaixo, onde está a câmera)
   * 90° = Direita
   * 180° = Trás / Contraluz (no topo)
   * 270° = Esquerda
   */
  function polarToCanvas(angleDeg, distancePct, cx, cy, maxR) {
    // 0° fica na parte inferior (Math.PI / 2 no círculo trigonométrico padrão),
    // 90° à direita (0 rad), 180° no topo (-Math.PI/2), 270° à esquerda (Math.PI)
    const rad = ((90 - angleDeg) * Math.PI) / 180;
    const r = (distancePct / 100) * maxR;
    return {
      x: cx + r * Math.cos(rad),
      y: cy + r * Math.sin(rad),
    };
  }

  function canvasToPolar(x, y, cx, cy, maxR) {
    const dx = x - cx;
    const dy = y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const distancePct = Math.min(96, Math.max(22, Math.round((dist / maxR) * 100)));

    const stdDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    // Converter de padrão (0=Dir, 90=Baixo, -90=Topo) para nosso radar (0=Baixo/Frente, 90=Dir, 180=Topo/Trás, 270=Esq)
    let angleDeg = Math.round((90 - stdDeg + 360) % 360);
    return { angleDeg, distancePct };
  }

  function describeAnglePt(angleDeg, distancePct) {
    const a = ((angleDeg % 360) + 360) % 360;
    let dir = 'frontal';
    if (a <= 22 || a >= 338) dir = 'frontal (0°)';
    else if (a <= 68) dir = 'a 45° pela direita';
    else if (a <= 112) dir = 'lateral 90° pela direita (Split)';
    else if (a <= 158) dir = 'diagonal traseira direita';
    else if (a <= 202) dir = 'contraluz 180° por trás';
    else if (a <= 248) dir = 'diagonal traseira esquerda';
    else if (a <= 292) dir = 'lateral 90° pela esquerda (Split)';
    else dir = 'a 45° pela esquerda (Rembrandt)';

    const elev =
      distancePct < 40 ? 'alta/zenital' : distancePct < 74 ? 'altura média' : 'baixa/rasante';
    return `${dir}, ${elev}`;
  }

  function updateSpatialSummary() {
    const k = state.lightingRig.key_light;
    const r = state.lightingRig.rim_light;
    const keyDesc = `Luz principal (${k.color_label}) ${describeAnglePt(k.angle_deg, k.distance_pct)}`;
    const rimDesc = r.enabled
      ? ` + Contraluz ${describeAnglePt(r.angle_deg, r.distance_pct)}`
      : ' (sem 2ª luz)';

    const summary = keyDesc + rimDesc;
    state.lightingRig.spatial_summary = summary;
    els.spatialReadout.textContent = summary;
  }

  function hexToRgb(hex) {
    const clean = hex.replace('#', '');
    const num = parseInt(clean, 16);
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255,
    };
  }

  function drawLightStageRadar() {
    const canvas = els.lightStageCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const maxR = w * 0.41;

    ctx.clearRect(0, 0, w, h);

    // Fundo circular do palco
    const bgGrad = ctx.createRadialGradient(cx, cy, 10, cx, cy, maxR * 1.15);
    bgGrad.addColorStop(0, '#1C1F1A');
    bgGrad.addColorStop(1, '#121311');
    ctx.fillStyle = bgGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, maxR * 1.12, 0, Math.PI * 2);
    ctx.fill();

    // Anéis de elevação (Zenital, 45°, Horizonte)
    ctx.strokeStyle = '#2B2E27';
    ctx.lineWidth = 1.2;
    [0.38, 0.7, 1.0].forEach((ratio) => {
      ctx.beginPath();
      ctx.arc(cx, cy, maxR * ratio, 0, Math.PI * 2);
      ctx.stroke();
    });

    // Eixos cruzados
    ctx.beginPath();
    ctx.moveTo(cx - maxR, cy);
    ctx.lineTo(cx + maxR, cy);
    ctx.moveTo(cx, cy - maxR);
    ctx.lineTo(cx, cy + maxR);
    ctx.stroke();

    // Rótulos cardeais do estúdio
    ctx.fillStyle = '#85877F';
    ctx.font = '600 16px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('CONTRALUZ 180°', cx, cy - maxR - 12);
    ctx.fillText('CÂMERA 0°', cx, cy + maxR + 24);
    ctx.fillText('ESQ', cx - maxR - 20, cy + 5);
    ctx.fillText('DIR', cx + maxR + 20, cy + 5);

    const k = state.lightingRig.key_light;
    const r = state.lightingRig.rim_light;
    const keyPos = polarToCanvas(k.angle_deg, k.distance_pct, cx, cy, maxR);
    const rimPos = polarToCanvas(r.angle_deg, r.distance_pct, cx, cy, maxR);

    // Cone luminoso da Contraluz (2ª Luz)
    if (r.enabled) {
      const rimRgb = hexToRgb(r.color_hex || '#74B9FF');
      const rimCone = ctx.createRadialGradient(rimPos.x, rimPos.y, 4, cx, cy, maxR * 0.85);
      rimCone.addColorStop(0, `rgba(${rimRgb.r}, ${rimRgb.g}, ${rimRgb.b}, 0.35)`);
      rimCone.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = rimCone;
      ctx.beginPath();
      ctx.arc(cx, cy, maxR, 0, Math.PI * 2);
      ctx.fill();
    }

    // Cone luminoso da Luz Principal (Sol / Key Light)
    const keyRgb = hexToRgb(k.color_hex || '#FFD166');
    const keyCone = ctx.createRadialGradient(keyPos.x, keyPos.y, 6, cx, cy, maxR * 0.95);
    keyCone.addColorStop(0, `rgba(${keyRgb.r}, ${keyRgb.g}, ${keyRgb.b}, 0.48)`);
    keyCone.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = keyCone;
    ctx.beginPath();
    ctx.arc(cx, cy, maxR, 0, Math.PI * 2);
    ctx.fill();

    // Sombra projetada pelo sujeito na direção oposta à Luz Principal
    const shadowDx = cx - keyPos.x;
    const shadowDy = cy - keyPos.y;
    const shadowLen = Math.sqrt(shadowDx * shadowDx + shadowDy * shadowDy) || 1;
    const sNormX = shadowDx / shadowLen;
    const sNormY = shadowDy / shadowLen;
    const sphereR = 46;

    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.beginPath();
    ctx.ellipse(
      cx + sNormX * 34,
      cy + sNormY * 34,
      sphereR * 0.92,
      sphereR * 0.68,
      Math.atan2(sNormY, sNormX),
      0,
      Math.PI * 2
    );
    ctx.fill();
    ctx.restore();

    // ESFERA 3D CENTRAL (Sujeito sombreado em tempo real pela Luz Principal + Contraluz)
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, sphereR, 0, Math.PI * 2);
    ctx.clip();

    // Base escura da esfera (lado da sombra)
    ctx.fillStyle = '#181A16';
    ctx.fillRect(cx - sphereR, cy - sphereR, sphereR * 2, sphereR * 2);

    // Iluminação difusa + especular da Luz Principal na esfera
    const lightOffsetX = ((keyPos.x - cx) / maxR) * (sphereR * 0.78);
    const lightOffsetY = ((keyPos.y - cy) / maxR) * (sphereR * 0.78);
    const sphereGrad = ctx.createRadialGradient(
      cx + lightOffsetX,
      cy + lightOffsetY,
      sphereR * 0.08,
      cx,
      cy,
      sphereR * 1.25
    );
    sphereGrad.addColorStop(0, '#FFFDF7');
    sphereGrad.addColorStop(0.28, k.color_hex || '#FFD166');
    sphereGrad.addColorStop(0.72, '#2B2E26');
    sphereGrad.addColorStop(1, '#101110');
    ctx.fillStyle = sphereGrad;
    ctx.fillRect(cx - sphereR, cy - sphereR, sphereR * 2, sphereR * 2);

    // Brilho de recorte da Contraluz (Rim Light) na borda da esfera
    if (r.enabled) {
      const rimOffsetX = ((rimPos.x - cx) / maxR) * (sphereR * 0.95);
      const rimOffsetY = ((rimPos.y - cy) / maxR) * (sphereR * 0.95);
      const rimRgb = hexToRgb(r.color_hex || '#74B9FF');
      const rimSphereGrad = ctx.createRadialGradient(
        cx + rimOffsetX,
        cy + rimOffsetY,
        sphereR * 0.05,
        cx + rimOffsetX * 0.4,
        cy + rimOffsetY * 0.4,
        sphereR * 0.95
      );
      rimSphereGrad.addColorStop(0, `rgba(${rimRgb.r}, ${rimRgb.g}, ${rimRgb.b}, 0.85)`);
      rimSphereGrad.addColorStop(0.55, `rgba(${rimRgb.r}, ${rimRgb.g}, ${rimRgb.b}, 0.15)`);
      rimSphereGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = rimSphereGrad;
      ctx.fillRect(cx - sphereR, cy - sphereR, sphereR * 2, sphereR * 2);
    }

    ctx.restore();

    // Contorno sutil da esfera central
    ctx.strokeStyle = '#45493F';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, sphereR, 0, Math.PI * 2);
    ctx.stroke();

    // Linha tracejada e Handle da Contraluz (2ª Luz)
    if (r.enabled) {
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = r.color_hex || '#74B9FF';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(rimPos.x, rimPos.y);
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = r.color_hex || '#74B9FF';
      ctx.strokeStyle = '#101110';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(rimPos.x, rimPos.y, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#101110';
      ctx.font = '700 13px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('2', rimPos.x, rimPos.y + 4.5);
    }

    // Linha contínua e Handle da Luz Principal (1ª Luz - Key Light)
    ctx.strokeStyle = k.color_hex || '#FFD166';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(keyPos.x, keyPos.y);
    ctx.stroke();

    ctx.fillStyle = k.color_hex || '#FFD166';
    ctx.strokeStyle = '#D8FF63';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(keyPos.x, keyPos.y, 17, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#171A12';
    ctx.font = '700 14px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('SOL', keyPos.x, keyPos.y + 5);
  }

  function setupLightStageRadarEvents() {
    const canvas = els.lightStageCanvas;
    if (!canvas) return;

    function getCanvasMousePos(evt) {
      const rect = canvas.getBoundingClientRect();
      const clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
      const clientY = evt.touches ? evt.touches[0].clientY : evt.clientY;
      return {
        x: ((clientX - rect.left) / rect.width) * canvas.width,
        y: ((clientY - rect.top) / rect.height) * canvas.height,
      };
    }

    function onPointerDown(evt) {
      if (state.isGenerating) return;
      const pos = getCanvasMousePos(evt);
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const maxR = canvas.width * 0.41;

      const k = state.lightingRig.key_light;
      const r = state.lightingRig.rim_light;
      const keyPos = polarToCanvas(k.angle_deg, k.distance_pct, cx, cy, maxR);
      const rimPos = polarToCanvas(r.angle_deg, r.distance_pct, cx, cy, maxR);

      const distKey = Math.hypot(pos.x - keyPos.x, pos.y - keyPos.y);
      const distRim = r.enabled ? Math.hypot(pos.x - rimPos.x, pos.y - rimPos.y) : 9999;

      if (distRim < 28 && distRim < distKey) {
        state.lightingRig.draggingNode = 'rim';
      } else {
        state.lightingRig.draggingNode = 'key';
        const polar = canvasToPolar(pos.x, pos.y, cx, cy, maxR);
        k.angle_deg = polar.angleDeg;
        k.distance_pct = polar.distancePct;
      }

      updateSpatialSummary();
      drawLightStageRadar();
      onLightingRigChangedByUser();
    }

    function onPointerMove(evt) {
      if (!state.lightingRig.draggingNode || state.isGenerating) return;
      evt.preventDefault();
      const pos = getCanvasMousePos(evt);
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const maxR = canvas.width * 0.41;
      const polar = canvasToPolar(pos.x, pos.y, cx, cy, maxR);

      if (state.lightingRig.draggingNode === 'key') {
        state.lightingRig.key_light.angle_deg = polar.angleDeg;
        state.lightingRig.key_light.distance_pct = polar.distancePct;
      } else if (state.lightingRig.draggingNode === 'rim') {
        state.lightingRig.rim_light.angle_deg = polar.angleDeg;
        state.lightingRig.rim_light.distance_pct = polar.distancePct;
      }

      updateSpatialSummary();
      drawLightStageRadar();
      onLightingRigChangedByUser();
    }

    function onPointerUp() {
      state.lightingRig.draggingNode = null;
    }

    canvas.addEventListener('mousedown', onPointerDown);
    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp);

    canvas.addEventListener('touchstart', onPointerDown, { passive: false });
    window.addEventListener('touchmove', onPointerMove, { passive: false });
    window.addEventListener('touchend', onPointerUp);

    // Swatches de cor da Luz Principal
    document.querySelectorAll('[data-light-color]').forEach((swatch) => {
      swatch.addEventListener('click', () => {
        if (state.isGenerating) return;
        document.querySelectorAll('[data-light-color]').forEach((s) => {
          s.classList.remove('is-selected');
        });
        swatch.classList.add('is-selected');
        state.lightingRig.key_light.color_label =
          swatch.getAttribute('data-light-color') || 'Sol Dourado';
        state.lightingRig.key_light.color_hex =
          swatch.getAttribute('data-light-hex') || '#FFD166';
        updateSpatialSummary();
        drawLightStageRadar();
        onLightingRigChangedByUser();
      });
    });

    // Botão ON/OFF da 2ª Luz (Contraluz)
    els.toggleRimBtn.addEventListener('click', () => {
      if (state.isGenerating) return;
      const next = !state.lightingRig.rim_light.enabled;
      state.lightingRig.rim_light.enabled = next;
      els.toggleRimBtn.setAttribute('aria-pressed', next ? 'true' : 'false');
      els.toggleRimBtn.textContent = `2ª Luz (Contraluz): ${next ? 'ON' : 'OFF'}`;
      updateSpatialSummary();
      drawLightStageRadar();
      onLightingRigChangedByUser();
    });

    // Presets Espaciais Clássicos
    document.querySelectorAll('[data-stage-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (state.isGenerating) return;
        const preset = btn.getAttribute('data-stage-preset');
        const k = state.lightingRig.key_light;
        const r = state.lightingRig.rim_light;

        if (preset === 'rembrandt') {
          k.angle_deg = 315;
          k.distance_pct = 64;
          r.enabled = true;
          r.angle_deg = 135;
          r.distance_pct = 78;
        } else if (preset === 'split') {
          k.angle_deg = 270;
          k.distance_pct = 82;
          r.enabled = false;
        } else if (preset === 'silhouette') {
          k.angle_deg = 180;
          k.distance_pct = 85;
          r.enabled = true;
          r.angle_deg = 0;
          r.distance_pct = 60;
        } else if (preset === 'cinema') {
          k.angle_deg = 305;
          k.distance_pct = 68;
          k.color_label = 'Tungstênio Âmbar';
          k.color_hex = '#FF9F43';
          r.enabled = true;
          r.angle_deg = 125;
          r.distance_pct = 75;
          r.color_label = 'Frio Noturno';
          r.color_hex = '#74B9FF';
        }

        els.toggleRimBtn.setAttribute('aria-pressed', r.enabled ? 'true' : 'false');
        els.toggleRimBtn.textContent = `2ª Luz (Contraluz): ${r.enabled ? 'ON' : 'OFF'}`;
        updateSpatialSummary();
        drawLightStageRadar();
        onLightingRigChangedByUser();
      });
    });

    // Botão Reiluminar Foto Atual com o novo ângulo 360°
    els.relightCurrentBtn.addEventListener('click', () => {
      if (!state.currentProduction || state.isGenerating) return;
      executeGenerationRequest(
        `Reiluminar a mesma cena mudando fisicamente a posição da luz para: ${state.lightingRig.spatial_summary}`,
        true
      );
    });

    updateSpatialSummary();
    drawLightStageRadar();
  }

  /**
   * Quando já existe uma foto aberta no palco e o usuário arrasta a luz no Radar 360°:
   * 1) Exibe o botão "Reiluminar foto atual com este novo ângulo 360°"
   * 2) Aplica um preview direcional 2.5D instantâneo na foto mostrando de onde a nova luz vem!
   */
  function onLightingRigChangedByUser() {
    if (!state.currentProduction || !state.activeRawBlobUrl) return;
    els.relightCurrentBtn.classList.remove('hidden');
    state.lightingRig.liveRelightPreviewActive = true;
    applyDarkroomToCurrentImage();
  }

  /**
   * Helpers de Linguagem Natural, Foto de Referência e Modo Prova de Estúdio
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

    els.contactSheetToggle.addEventListener('click', () => {
      if (state.isGenerating) return;
      state.contactSheetMode = !state.contactSheetMode;
      els.contactSheetToggle.setAttribute(
        'aria-pressed',
        state.contactSheetMode ? 'true' : 'false'
      );
    });

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

    document.addEventListener('paste', (e) => {
      if (state.isGenerating) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            loadReferenceFile(file);
            showToast('Foto de referência colada.');
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
    if (viewName !== 'success') {
      els.relightCurrentBtn.classList.add('hidden');
    }
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
    els.relightCurrentBtn.disabled = isSubmitting;
    els.submitBtnLabel.textContent = isSubmitting ? 'Produzindo…' : 'Disparar produção';

    document.querySelectorAll('[data-phrase], [data-example], [data-quick-refine], [data-stage-preset]').forEach(
      (btn) => {
        btn.disabled = isSubmitting;
      }
    );
  }

  /**
   * LABORATÓRIO DARKROOM + PREVIEW DIRECIONAL 2.5D DO PALCO DE LUZ 360°
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
    const isDarkroomUnchanged =
      d.exposure === 0 &&
      d.contrast === 0 &&
      d.warmth === 0 &&
      d.vignette === 0 &&
      d.grain === 0 &&
      !d.bw;

    if (isDarkroomUnchanged && !state.lightingRig.liveRelightPreviewActive) {
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

    const brightness = 100 + d.exposure;
    const contrast = 100 + d.contrast;
    const grayscale = d.bw ? 100 : 0;
    ctx.filter = `brightness(${brightness}%) contrast(${contrast}%) grayscale(${grayscale}%)`;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    ctx.filter = 'none';

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

    // Preview direcional 2.5D ao arrastar os refletores do Radar 360° sobre uma foto aberta
    if (state.lightingRig.liveRelightPreviewActive) {
      const k = state.lightingRig.key_light;
      const rad = ((90 - k.angle_deg) * Math.PI) / 180;
      const lx = canvas.width * (0.5 + 0.48 * Math.cos(rad));
      const ly = canvas.height * (0.5 - 0.42 * Math.sin(rad));
      const maxDim = Math.max(canvas.width, canvas.height);

      const rgb = hexToRgb(k.color_hex || '#FFD166');
      ctx.save();
      ctx.globalCompositeOperation = 'soft-light';
      const relightGrad = ctx.createRadialGradient(lx, ly, maxDim * 0.05, canvas.width / 2, canvas.height / 2, maxDim * 0.95);
      relightGrad.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.62)`);
      relightGrad.addColorStop(0.55, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.14)`);
      relightGrad.addColorStop(1, 'rgba(0, 0, 0, 0.52)');
      ctx.fillStyle = relightGrad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    }

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
      state.lightingRig.liveRelightPreviewActive = false;
      applyDarkroomToCurrentImage();
    });
  }

  function renderProductionResult(record) {
    revokeCurrentImageUrl();
    resetDarkroomControls();
    state.lightingRig.liveRelightPreviewActive = false;
    els.relightCurrentBtn.classList.add('hidden');

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

    els.directionOpticsText.textContent = record.direction?.camera_optics || '';
    els.directionPromptText.textContent = record.direction?.final_prompt || '';

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
   * Disparo da Produção com as Coordenadas do Palco de Luz Espacial 360°
   */
  async function executeGenerationRequest(refinementInstruction = null, relightMode = false) {
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
      relightMode
        ? 'Recalculando geometria de luz 360° na cena'
        : refinementInstruction
          ? 'Ajustando direção fotográfica da cena'
          : 'Mapeando Palco de Luz 360° e direção óptica'
    );
    setWorkspaceView('generating');

    const payload = {
      brief: briefText,
      contact_sheet: state.contactSheetMode,
      lighting_rig: {
        key_light: {
          enabled: true,
          angle_deg: state.lightingRig.key_light.angle_deg,
          distance_pct: state.lightingRig.key_light.distance_pct,
          color_label: state.lightingRig.key_light.color_label,
          intensity: state.lightingRig.key_light.intensity,
        },
        rim_light: {
          enabled: state.lightingRig.rim_light.enabled,
          angle_deg: state.lightingRig.rim_light.angle_deg,
          distance_pct: state.lightingRig.rim_light.distance_pct,
          color_label: state.lightingRig.rim_light.color_label,
          intensity: state.lightingRig.rim_light.intensity,
        },
        spatial_summary: state.lightingRig.spatial_summary,
        relight_mode: Boolean(relightMode),
      },
    };

    if ((refinementInstruction || relightMode) && state.currentProduction) {
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
    executeGenerationRequest(null, false);
  }

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

    ctx.fillStyle = '#F3F1EA';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = '#D9D7CE';
    ctx.lineWidth = 1;
    ctx.strokeRect(borderSide - 4, borderTop - 4, w + 8, h + 8);

    ctx.drawImage(img, borderSide, borderTop, w, h);

    const p = state.currentProduction.params || {};
    const footerY = borderTop + h + Math.round(borderBottom * 0.46);

    ctx.fillStyle = '#171A12';
    ctx.font = `700 ${Math.round(borderSide * 0.28)}px Inter, sans-serif`;
    ctx.fillText('L U M E N', borderSide, footerY);

    ctx.fillStyle = '#6E7068';
    ctx.font = `500 ${Math.round(borderSide * 0.16)}px Inter, sans-serif`;
    ctx.fillText(
      `360° SPATIAL LIGHT STUDIO · ${state.lightingRig.key_light.angle_deg}° KEY`,
      borderSide,
      footerY + Math.round(borderSide * 0.28)
    );

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
    state.lightingRig.liveRelightPreviewActive = false;
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

    els.applyRefinementBtn.addEventListener('click', () => {
      const instruction = els.refinementInput.value.trim();
      if (!instruction) {
        els.refinementInput.focus();
        return;
      }
      executeGenerationRequest(instruction, false);
    });

    els.refinementInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const instruction = els.refinementInput.value.trim();
        if (instruction) executeGenerationRequest(instruction, false);
      }
    });

    document.querySelectorAll('[data-quick-refine]').forEach((chip) => {
      chip.addEventListener('click', () => {
        const refineText = chip.getAttribute('data-quick-refine') || '';
        if (refineText) {
          els.refinementInput.value = refineText;
          executeGenerationRequest(refineText, false);
        }
      });
    });

    els.applyQaSuggestionBtn.addEventListener('click', () => {
      const suggestion = els.qaSuggestionText.textContent || '';
      if (suggestion) {
        els.refinementInput.value = suggestion;
        executeGenerationRequest(suggestion, false);
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
    setupLightStageRadarEvents();
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
