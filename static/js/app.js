/**
 * LUMEN Studio 6.0 — Controlador Principal
 * - Palco de Luz Espacial 360° (3 Fontes: Key, Rim, Fill + Softness + Razão Key:Fill + Teclado)
 * - 10 Presets Clássicos & 9 Ações de Direção Rápida com Undo
 * - Comparador Antes/Depois (Split Slider 0-100% + Lado a Lado + Zoom/Pan + Fundo Quadriculado)
 * - Histograma Óptico & Detecção de Clipping
 * - Análise de Referência (/api/analyze-reference)
 * - Social Format Pack (/api/generate-pack)
 * - Receitas Versionadas (Schema v1 com Import/Export JSON)
 * - Projetos & Versões Imutáveis (IndexedDB v2 com Blobs nativos)
 * - Segurança XSS Estrita: Todas as inserções usam textContent ou criação segura de nós.
 */

(function () {
  'use strict';

  const state = {
    activeView: 'studio', // 'studio' | 'projects' | 'recipes' | 'pack' | 'history'
    activeControlTab: 'tab-light',
    theme: localStorage.getItem('lumen_theme') || 'dark',
    isGenerating: false,
    currentJobId: null,
    currentProduction: null,
    activeVersion: null,
    previousVersion: null,
    activeProject: 'proj_default',
    contactSheetMode: false,
    canvasMode: 'normal', // 'normal' | 'split' | 'side_by_side'
    splitPercent: 50,
    zoomScale: 1.0,
    checkerboardActive: false,
    histogramVisible: false,
    undoStack: [],

    // Rig Espacial 360° (3 Fontes)
    activeLightSource: 'key', // 'key' | 'rim' | 'fill'
    lightingRig: {
      key_light: {
        enabled: true,
        angle_deg: 315,
        distance_pct: 65,
        color_label: 'Sol Dourado',
        color_hex: '#FFD166',
        intensity: 85,
        softness: 55,
      },
      rim_light: {
        enabled: true,
        angle_deg: 135,
        distance_pct: 78,
        color_label: 'Frio Noturno',
        color_hex: '#74B9FF',
        intensity: 60,
        softness: 40,
      },
      fill_light: {
        enabled: true,
        angle_deg: 45,
        distance_pct: 55,
        color_label: 'Luz do Dia',
        color_hex: '#F4F6F8',
        intensity: 28,
        softness: 85,
      },
      spatial_summary: 'Luz principal a 315° pela esquerda (Rembrandt)',
      relight_mode: false,
      schema_version: 1,
    },

    // Parâmetros Ópticos
    camera: {
      lens: '35mm',
      aperture: 'f/2.8',
      film: 'Kodak Portra 400',
      aspect_ratio: '4:5',
      depth_of_field: 'balanced',
      framing_intent: 'preserve',
    },

    // Sujeito e Consistência
    referenceImageBase64: null,
    referenceMimeType: 'image/jpeg',
    preserveCategories: [],
    consistencyLocks: [],

    // Darkroom
    darkroom: {
      exposure: 0,
      contrast: 0,
      warmth: 0,
      vignette: 0,
      grain: 0,
      bw: false,
    },

    // URLs de Blobs para revogação limpa
    activeBlobUrls: [],
  };

  function createSafeBlobUrl(blob) {
    const url = URL.createObjectURL(blob);
    state.activeBlobUrls.push(url);
    if (state.activeBlobUrls.length > 40) {
      const old = state.activeBlobUrls.shift();
      URL.revokeObjectURL(old);
    }
    return url;
  }

  function initIcons() {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
  }

  function applyTheme(themeName) {
    state.theme = themeName;
    localStorage.setItem('lumen_theme', themeName);
    if (themeName === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    const themeIcon = document.getElementById('theme-toggle-icon');
    if (themeIcon) {
      themeIcon.setAttribute('data-lucide', themeName === 'light' ? 'moon' : 'sun');
      initIcons();
    }
  }

  function showToast(message) {
    const toast = document.getElementById('lumen-toast');
    const toastText = document.getElementById('lumen-toast-text');
    if (!toast || !toastText) return;
    toastText.textContent = message;
    toast.classList.remove('hidden');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.classList.add('hidden');
    }, 3800);
  }

  // ===========================================================================
  // PALCO DE LUZ ESPACIAL 360° (CANVAS 60FPS COM ESFERA 3D E SOMBRA VETORIAL)
  // ===========================================================================

  const canvas = document.getElementById('light-stage-canvas');
  const ctx = canvas ? canvas.getContext('2d') : null;
  const offscreenSphere = document.createElement('canvas');
  offscreenSphere.width = 80;
  offscreenSphere.height = 80;
  const offCtx = offscreenSphere.getContext('2d');

  function getLightVector3D(light) {
    if (!light || !light.enabled || light.intensity <= 0) {
      return { x: 0, y: 0, z: 0, intensity: 0 };
    }
    const angleRad = (light.angle_deg * Math.PI) / 180;
    const elevRad = ((90 - (light.distance_pct * 0.7)) * Math.PI) / 180;
    const cosE = Math.cos(elevRad);
    return {
      x: Math.sin(angleRad) * cosE,
      y: -Math.cos(angleRad) * cosE,
      z: Math.sin(elevRad),
      intensity: (light.intensity / 100) * 0.95,
      colorHex: light.color_hex || '#FFD166',
    };
  }

  function hexToRgb(hex) {
    let clean = (hex || '#FFFFFF').replace('#', '');
    if (clean.length === 3) {
      clean = clean.split('').map((c) => c + c).join('');
    }
    const num = parseInt(clean, 16);
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255,
    };
  }

  function render3DSphereOffscreen() {
    if (!offCtx) return;
    const size = 80;
    const radius = size / 2 - 2;
    const cx = size / 2;
    const cy = size / 2;
    const imgData = offCtx.createImageData(size, size);
    const data = imgData.data;

    const keyV = getLightVector3D(state.lightingRig.key_light);
    const rimV = getLightVector3D(state.lightingRig.rim_light);
    const fillV = getLightVector3D(state.lightingRig.fill_light);

    const keyRgb = hexToRgb(keyV.colorHex);
    const rimRgb = hexToRgb(rimV.colorHex);
    const fillRgb = hexToRgb(fillV.colorHex);

    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const dx = (px - cx) / radius;
        const dy = (py - cy) / radius;
        const distSq = dx * dx + dy * dy;
        const idx = (py * size + px) * 4;

        if (distSq > 1.0) {
          data[idx + 3] = 0;
          continue;
        }

        const dz = Math.sqrt(Math.max(0, 1.0 - distSq));
        const nx = dx;
        const ny = dy;
        const nz = dz;

        // Ambiente base
        let r = 24;
        let g = 24;
        let b = 28;

        // Key Light (Lambertian Diffuse + Blinn-Phong Specular)
        if (keyV.intensity > 0) {
          const dotK = Math.max(0, nx * keyV.x + ny * keyV.y + nz * keyV.z);
          const diffK = dotK * keyV.intensity;
          const hx = keyV.x;
          const hy = keyV.y;
          const hz = keyV.z + 1.0;
          const hLen = Math.hypot(hx, hy, hz) || 1;
          const specDot = Math.max(0, (nx * hx + ny * hy + nz * hz) / hLen);
          const specK = Math.pow(specDot, 28) * (keyV.intensity * 0.9);

          r += keyRgb.r * diffK + 255 * specK;
          g += keyRgb.g * diffK + 255 * specK;
          b += keyRgb.b * diffK + 255 * specK;
        }

        // Fill Light (Luz suave difusa)
        if (fillV.intensity > 0) {
          const dotF = Math.max(0, nx * fillV.x + ny * fillV.y + nz * fillV.z);
          const diffF = dotF * fillV.intensity * 0.7;
          r += fillRgb.r * diffF;
          g += fillRgb.g * diffF;
          b += fillRgb.b * diffF;
        }

        // Rim Light (Fresnel de borda traseira)
        if (rimV.intensity > 0) {
          const fresnel = Math.pow(1.0 - nz, 2.8);
          const dotR = Math.max(0, nx * rimV.x + ny * rimV.y + nz * rimV.z);
          const rimFactor = (fresnel * 0.8 + dotR * 0.4) * rimV.intensity;
          r += rimRgb.r * rimFactor;
          g += rimRgb.g * rimFactor;
          b += rimRgb.b * rimFactor;
        }

        data[idx] = Math.min(255, Math.round(r));
        data[idx + 1] = Math.min(255, Math.round(g));
        data[idx + 2] = Math.min(255, Math.round(b));
        data[idx + 3] = 255;
      }
    }
    offCtx.putImageData(imgData, 0, 0);
  }

  function renderLightStage() {
    if (!ctx || !canvas) return;
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const radarRadius = w / 2 - 24;

    ctx.clearRect(0, 0, w, h);

    // Círculos concêntricos e eixos do radar
    ctx.strokeStyle = 'rgba(160, 156, 148, 0.18)';
    ctx.lineWidth = 1.2;

    [0.35, 0.65, 1.0].forEach((ratio) => {
      ctx.beginPath();
      ctx.arc(cx, cy, radarRadius * ratio, 0, Math.PI * 2);
      ctx.stroke();
    });

    // Eixos cardeais
    ctx.beginPath();
    ctx.moveTo(cx, cy - radarRadius);
    ctx.lineTo(cx, cy + radarRadius);
    ctx.moveTo(cx - radarRadius, cy);
    ctx.lineTo(cx + radarRadius, cy);
    ctx.stroke();

    // Rótulos cardeais
    ctx.fillStyle = 'rgba(160, 156, 148, 0.6)';
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('0° FRENTE', cx, cy + radarRadius + 14);
    ctx.fillText('180° TRÁS', cx, cy - radarRadius - 14);
    ctx.fillText('270° ESQ', cx - radarRadius - 14, cy);
    ctx.fillText('90° DIR', cx + radarRadius + 14, cy);

    // Sombra projetada no piso pela Luz Principal
    const key = state.lightingRig.key_light;
    if (key.enabled && key.intensity > 0) {
      const oppAngle = ((key.angle_deg + 180) * Math.PI) / 180;
      const shadowDist = 28 * (key.distance_pct / 100);
      const sx = cx + Math.sin(oppAngle) * shadowDist;
      const sy = cy - Math.cos(oppAngle) * shadowDist;
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(sx, sy, 34, 18, oppAngle, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
      ctx.filter = 'blur(6px)';
      ctx.fill();
      ctx.restore();
    }

    // Desenha esfera central 3D
    render3DSphereOffscreen();
    ctx.drawImage(offscreenSphere, cx - 40, cy - 40, 80, 80);

    // Borda da esfera
    ctx.beginPath();
    ctx.arc(cx, cy, 39, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Desenha os 3 refletores (Key, Rim, Fill)
    const drawLightNode = (light, keyId, defaultHex, label) => {
      if (!light.enabled) return;
      const angleRad = (light.angle_deg * Math.PI) / 180;
      const dist = radarRadius * (light.distance_pct / 100);
      const nx = cx + Math.sin(angleRad) * dist;
      const ny = cy - Math.cos(angleRad) * dist;

      // Raio luminoso até a esfera
      ctx.beginPath();
      ctx.moveTo(nx, ny);
      ctx.lineTo(cx, cy);
      ctx.strokeStyle = `${light.color_hex || defaultHex}44`;
      ctx.lineWidth = Math.max(1, (light.intensity / 100) * 3);
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Marcador do refletor
      const isSelected = state.activeLightSource === keyId;
      ctx.beginPath();
      ctx.arc(nx, ny, isSelected ? 11 : 8, 0, Math.PI * 2);
      ctx.fillStyle = light.color_hex || defaultHex;
      ctx.fill();
      ctx.lineWidth = isSelected ? 3 : 1.5;
      ctx.strokeStyle = isSelected ? '#FFFFFF' : 'rgba(0, 0, 0, 0.8)';
      ctx.stroke();

      // Rótulo técnico
      ctx.font = '10px "Plus Jakarta Sans", sans-serif';
      ctx.fillStyle = isSelected ? '#FFFFFF' : 'rgba(237, 234, 227, 0.75)';
      ctx.fillText(label, nx, ny - (isSelected ? 16 : 13));
    };

    drawLightNode(state.lightingRig.key_light, 'key', '#FFD166', 'Key');
    drawLightNode(state.lightingRig.rim_light, 'rim', '#74B9FF', 'Rim');
    drawLightNode(state.lightingRig.fill_light, 'fill', '#F4F6F8', 'Fill');
  }

  function updateSpatialSummaryAndRatio() {
    const rig = state.lightingRig;
    const key = rig.key_light;
    const rim = rig.rim_light;
    const fill = rig.fill_light;

    let summary = `Luz Principal (${key.color_label}) a ${key.angle_deg}°`;
    if (rim.enabled && rim.intensity > 0) {
      summary += ` + Contraluz (${rim.color_label}) a ${rim.angle_deg}°`;
    }
    if (fill.enabled && fill.intensity > 0) {
      summary += ` + Preenchimento a ${fill.angle_deg}°`;
    }
    rig.spatial_summary = summary;

    const readout = document.getElementById('spatial-light-readout');
    if (readout) readout.textContent = summary;

    const ratioBadge = document.getElementById('key-fill-ratio-badge');
    if (ratioBadge) {
      if (!key.enabled || key.intensity <= 0) {
        ratioBadge.textContent = 'Key OFF';
      } else if (!fill.enabled || fill.intensity <= 0) {
        ratioBadge.textContent = `${key.intensity}:0 (Sem preenchimento)`;
      } else {
        const r = round1((key.intensity + fill.intensity) / fill.intensity);
        ratioBadge.textContent = `${r}:1 (estimativa)`;
      }
    }

    // Atualiza pills da barra de fontes
    const pKey = document.getElementById('pill-key-angle');
    const pRim = document.getElementById('pill-rim-angle');
    const pFill = document.getElementById('pill-fill-angle');
    if (pKey) pKey.textContent = `${key.angle_deg}°`;
    if (pRim) pRim.textContent = `${rim.angle_deg}°`;
    if (pFill) pFill.textContent = `${fill.angle_deg}°`;

    updateDirtyStateIndicator();
  }

  function round1(num) {
    return Math.round(num * 10) / 10;
  }

  function updateDirtyStateIndicator() {
    const indicator = document.getElementById('dirty-rig-indicator');
    const submitLabel = document.getElementById('submit-btn-label');
    if (!indicator || !submitLabel) return;

    if (!state.activeVersion || !state.activeVersion.lighting_rig) {
      indicator.textContent = 'Rig pronto';
      submitLabel.textContent = 'Disparar produção';
      return;
    }

    const curKey = state.lightingRig.key_light;
    const curRim = state.lightingRig.rim_light;
    const curFill = state.lightingRig.fill_light;
    const saved = state.activeVersion.lighting_rig;

    const diff =
      curKey.angle_deg !== saved.key_light?.angle_deg ||
      curKey.intensity !== saved.key_light?.intensity ||
      curKey.softness !== saved.key_light?.softness ||
      curRim.angle_deg !== saved.rim_light?.angle_deg ||
      curRim.enabled !== saved.rim_light?.enabled ||
      curFill.angle_deg !== saved.fill_light?.angle_deg ||
      curFill.intensity !== saved.fill_light?.intensity;

    if (diff) {
      indicator.textContent = 'Luz modificada';
      indicator.classList.add('text-accent');
      submitLabel.textContent = 'Aplicar nova iluminação';
      state.lightingRig.relight_mode = true;
    } else {
      indicator.textContent = 'Luz igual à versão';
      indicator.classList.remove('text-accent');
      submitLabel.textContent = 'Produzir novamente';
      state.lightingRig.relight_mode = false;
    }
  }

  // Interação do Canvas do Radar (Mouse + Toque + Teclado)
  let isDraggingRadar = false;

  function handleRadarPointer(e) {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const x = clientX - rect.left - rect.width / 2;
    const y = clientY - rect.top - rect.height / 2;

    const radius = rect.width / 2 - 12;
    const dist = Math.hypot(x, y);
    const distPct = Math.max(15, Math.min(100, Math.round((dist / radius) * 100)));

    let angleDeg = Math.round((Math.atan2(x, -y) * 180) / Math.PI);
    if (angleDeg < 0) angleDeg += 360;

    const activeSrc = state.lightingRig[`${state.activeLightSource}_light`];
    if (activeSrc) {
      activeSrc.angle_deg = angleDeg % 360;
      activeSrc.distance_pct = distPct;
      updateSpatialSummaryAndRatio();
      renderLightStage();
      applyLiveRelightOverlay();
    }
  }

  if (canvas) {
    canvas.addEventListener('pointerdown', (e) => {
      isDraggingRadar = true;
      canvas.setPointerCapture(e.pointerId);
      handleRadarPointer(e);
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!isDraggingRadar) return;
      handleRadarPointer(e);
    });

    const stopDrag = (e) => {
      if (isDraggingRadar) {
        isDraggingRadar = false;
        try {
          canvas.releasePointerCapture(e.pointerId);
        } catch (_) {}
      }
    };
    canvas.addEventListener('pointerup', stopDrag);
    canvas.addEventListener('pointercancel', stopDrag);

    // Controle do Radar por Teclado
    canvas.addEventListener('keydown', (e) => {
      const activeSrc = state.lightingRig[`${state.activeLightSource}_light`];
      if (!activeSrc) return;
      const step = e.shiftKey ? 15 : 3;

      if (e.key === 'ArrowLeft') {
        activeSrc.angle_deg = (activeSrc.angle_deg - step + 360) % 360;
        e.preventDefault();
      } else if (e.key === 'ArrowRight') {
        activeSrc.angle_deg = (activeSrc.angle_deg + step) % 360;
        e.preventDefault();
      } else if (e.key === 'ArrowUp') {
        activeSrc.distance_pct = Math.max(15, activeSrc.distance_pct - step);
        e.preventDefault();
      } else if (e.key === 'ArrowDown') {
        activeSrc.distance_pct = Math.min(100, activeSrc.distance_pct + step);
        e.preventDefault();
      }
      updateSpatialSummaryAndRatio();
      renderLightStage();
      applyLiveRelightOverlay();
    });
  }

  // ===========================================================================
  // 10 PRESETS CLÁSSICOS & 9 AÇÕES DE DIREÇÃO RÁPIDA COM UNDO
  // ===========================================================================

  const PRESETS_MAP = {
    rembrandt: {
      key: { angle_deg: 315, distance_pct: 65, intensity: 88, softness: 55, color_label: 'Sol Dourado' },
      rim: { enabled: true, angle_deg: 135, distance_pct: 78, intensity: 60, softness: 40, color_label: 'Frio Noturno' },
      fill: { enabled: true, angle_deg: 45, distance_pct: 55, intensity: 28, softness: 85, color_label: 'Luz do Dia' },
    },
    split: {
      key: { angle_deg: 270, distance_pct: 82, intensity: 92, softness: 30, color_label: 'Luz do Dia' },
      rim: { enabled: true, angle_deg: 90, distance_pct: 85, intensity: 45, softness: 35, color_label: 'Frio Noturno' },
      fill: { enabled: false, angle_deg: 0, distance_pct: 50, intensity: 0, softness: 80, color_label: 'Luz do Dia' },
    },
    butterfly: {
      key: { angle_deg: 0, distance_pct: 35, intensity: 90, softness: 65, color_label: 'Luz do Dia' },
      rim: { enabled: true, angle_deg: 180, distance_pct: 75, intensity: 50, softness: 50, color_label: 'Luz do Dia' },
      fill: { enabled: true, angle_deg: 0, distance_pct: 85, intensity: 40, softness: 90, color_label: 'Luz do Dia' },
    },
    loop: {
      key: { angle_deg: 335, distance_pct: 55, intensity: 85, softness: 60, color_label: 'Sol Dourado' },
      rim: { enabled: true, angle_deg: 140, distance_pct: 75, intensity: 55, softness: 45, color_label: 'Frio Noturno' },
      fill: { enabled: true, angle_deg: 35, distance_pct: 60, intensity: 32, softness: 80, color_label: 'Luz do Dia' },
    },
    broad_short: {
      key: { angle_deg: 45, distance_pct: 68, intensity: 86, softness: 50, color_label: 'Sol Dourado' },
      rim: { enabled: true, angle_deg: 225, distance_pct: 80, intensity: 65, softness: 35, color_label: 'Frio Noturno' },
      fill: { enabled: true, angle_deg: 315, distance_pct: 55, intensity: 26, softness: 85, color_label: 'Luz do Dia' },
    },
    rim_light: {
      key: { angle_deg: 0, distance_pct: 70, intensity: 25, softness: 75, color_label: 'Luz do Dia' },
      rim: { enabled: true, angle_deg: 180, distance_pct: 85, intensity: 95, softness: 25, color_label: 'Frio Noturno' },
      fill: { enabled: true, angle_deg: 180, distance_pct: 80, intensity: 20, softness: 85, color_label: 'Luz do Dia' },
    },
    three_point: {
      key: { angle_deg: 315, distance_pct: 60, intensity: 85, softness: 60, color_label: 'Luz do Dia' },
      rim: { enabled: true, angle_deg: 135, distance_pct: 75, intensity: 65, softness: 40, color_label: 'Sol Dourado' },
      fill: { enabled: true, angle_deg: 45, distance_pct: 55, intensity: 35, softness: 85, color_label: 'Luz do Dia' },
    },
    soft_catalog: {
      key: { angle_deg: 345, distance_pct: 50, intensity: 75, softness: 90, color_label: 'Luz do Dia' },
      rim: { enabled: true, angle_deg: 180, distance_pct: 70, intensity: 35, softness: 75, color_label: 'Luz do Dia' },
      fill: { enabled: true, angle_deg: 30, distance_pct: 50, intensity: 50, softness: 95, color_label: 'Luz do Dia' },
    },
    low_key: {
      key: { angle_deg: 280, distance_pct: 85, intensity: 90, softness: 25, color_label: 'Tungstênio Âmbar' },
      rim: { enabled: true, angle_deg: 110, distance_pct: 90, intensity: 70, softness: 20, color_label: 'Frio Noturno' },
      fill: { enabled: false, angle_deg: 0, distance_pct: 50, intensity: 0, softness: 80, color_label: 'Luz do Dia' },
    },
    golden_hour: {
      key: { angle_deg: 255, distance_pct: 92, intensity: 92, softness: 45, color_label: 'Sol Dourado' },
      rim: { enabled: true, angle_deg: 75, distance_pct: 85, intensity: 55, softness: 50, color_label: 'Rosa Crepúsculo' },
      fill: { enabled: true, angle_deg: 0, distance_pct: 65, intensity: 22, softness: 85, color_label: 'Sol Dourado' },
    },
  };

  function applyRigPreset(presetKey) {
    const p = PRESETS_MAP[presetKey];
    if (!p) return;
    pushRigToUndoStack();

    Object.assign(state.lightingRig.key_light, p.key);
    Object.assign(state.lightingRig.rim_light, p.rim);
    if (p.fill) {
      Object.assign(state.lightingRig.fill_light, p.fill);
    }

    syncControlInputsFromRig();
    updateSpatialSummaryAndRatio();
    renderLightStage();
    applyLiveRelightOverlay();
    showToast(`Preset "${presetKey}" aplicado ao radar.`);
  }

  function pushRigToUndoStack() {
    state.undoStack.push(JSON.parse(JSON.stringify(state.lightingRig)));
    if (state.undoStack.length > 20) state.undoStack.shift();
    const undoBtn = document.getElementById('undo-quick-action-btn');
    if (undoBtn) undoBtn.classList.remove('hidden');
  }

  function undoLastRigAction() {
    if (state.undoStack.length === 0) return;
    const prev = state.undoStack.pop();
    state.lightingRig = prev;
    syncControlInputsFromRig();
    updateSpatialSummaryAndRatio();
    renderLightStage();
    applyLiveRelightOverlay();
    showToast('Ação de iluminação desfeita.');
    const undoBtn = document.getElementById('undo-quick-action-btn');
    if (undoBtn && state.undoStack.length === 0) {
      undoBtn.classList.add('hidden');
    }
  }

  function applyQuickAction(actionKey) {
    pushRigToUndoStack();
    const key = state.lightingRig.key_light;
    const rim = state.lightingRig.rim_light;
    const fill = state.lightingRig.fill_light;

    switch (actionKey) {
      case 'dramatic':
        key.intensity = Math.min(100, key.intensity + 12);
        key.softness = Math.max(15, key.softness - 25);
        fill.intensity = Math.max(0, fill.intensity - 15);
        break;
      case 'soft_shadows':
        key.softness = Math.min(100, key.softness + 25);
        fill.enabled = true;
        fill.softness = 90;
        fill.intensity = Math.min(65, fill.intensity + 15);
        break;
      case 'warmer':
        key.color_label = 'Sol Dourado';
        key.color_hex = '#FFD166';
        break;
      case 'cooler':
        key.color_label = 'Frio Noturno';
        key.color_hex = '#74B9FF';
        break;
      case 'bg_sep':
        rim.enabled = true;
        rim.angle_deg = 180;
        rim.distance_pct = 85;
        rim.intensity = Math.min(100, rim.intensity + 20);
        break;
      case 'clean_cat':
        applyRigPreset('soft_catalog');
        return;
      case 'golden':
        applyRigPreset('golden_hour');
        return;
      case 'open_shadows':
        fill.enabled = true;
        fill.intensity = Math.min(80, fill.intensity + 20);
        break;
      case 'tame_highlights':
        key.intensity = Math.max(35, key.intensity - 20);
        key.softness = Math.min(95, key.softness + 15);
        break;
    }

    syncControlInputsFromRig();
    updateSpatialSummaryAndRatio();
    renderLightStage();
    applyLiveRelightOverlay();
  }

  function syncControlInputsFromRig() {
    const cur = state.lightingRig[`${state.activeLightSource}_light`];
    if (!cur) return;

    const nameLabel = document.getElementById('active-source-name-label');
    const toggleBtn = document.getElementById('toggle-active-source-btn');
    const sliderInt = document.getElementById('active-source-intensity-slider');
    const valInt = document.getElementById('active-source-intensity-val');
    const sliderSoft = document.getElementById('active-source-softness-slider');
    const valSoft = document.getElementById('active-source-softness-val');

    const names = {
      key: 'Luz Principal (Key Light)',
      rim: 'Contraluz (Rim Light)',
      fill: 'Preenchimento (Fill Light)',
    };
    if (nameLabel) nameLabel.textContent = names[state.activeLightSource] || 'Fonte';
    if (toggleBtn) {
      toggleBtn.textContent = cur.enabled ? 'ON' : 'OFF';
      toggleBtn.setAttribute('aria-pressed', String(cur.enabled));
    }
    if (sliderInt) sliderInt.value = cur.intensity;
    if (valInt) valInt.textContent = `${cur.intensity}%`;
    if (sliderSoft) sliderSoft.value = cur.softness;
    if (valSoft) valSoft.textContent = `${cur.softness}%`;

    // Atualiza swatches de cor
    const swatches = document.querySelectorAll('#color-swatches-row .lumen-color-swatch');
    swatches.forEach((btn) => {
      if (btn.getAttribute('data-light-color') === cur.color_label) {
        btn.classList.add('is-selected');
      } else {
        btn.classList.remove('is-selected');
      }
    });

    // Atualiza pílulas do seletor
    document.querySelectorAll('.lumen-source-pill').forEach((btn) => {
      const srcId = btn.getAttribute('data-active-source');
      if (srcId === state.activeLightSource) {
        btn.classList.add('is-selected');
        btn.setAttribute('aria-checked', 'true');
      } else {
        btn.classList.remove('is-selected');
        btn.setAttribute('aria-checked', 'false');
      }
    });
  }

  // ===========================================================================
  // REILUMINAÇÃO INTERATIVA 2.5D SOBRE A FOTO REVELADA
  // ===========================================================================

  function applyLiveRelightOverlay() {
    const img = document.getElementById('result-image');
    if (!img || !img.src || state.isGenerating) return;

    const key = state.lightingRig.key_light;
    const oppRad = ((key.angle_deg + 180) * Math.PI) / 180;
    const dx = Math.round(Math.sin(oppRad) * 45);
    const dy = Math.round(-Math.cos(oppRad) * 45);

    // Constrói filtro Darkroom somado ao gradiente da luz
    const dr = state.darkroom;
    const b = 100 + dr.exposure * 0.7;
    const c = 100 + dr.contrast * 0.8;
    const sep = Math.max(0, dr.warmth * 0.75);
    const hue = dr.warmth < 0 ? Math.round(dr.warmth * 1.5) : 0;
    const sat = 100 + dr.warmth * 0.4;
    const bw = dr.bw ? 'grayscale(100%)' : '';

    img.style.filter = `brightness(${b}%) contrast(${c}%) sepia(${sep}%) hue-rotate(${hue}deg) saturate(${sat}%) ${bw}`.trim();
  }

  // ===========================================================================
  // COMPARADOR ANTES / DEPOIS & ZOOM NO CANVAS
  // ===========================================================================

  function setupCanvasToolbar() {
    const modeBtns = document.querySelectorAll('[data-canvas-mode]');
    modeBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        setCanvasMode(btn.getAttribute('data-canvas-mode'));
      });
    });

    const chkBtn = document.getElementById('toggle-checkerboard-btn');
    if (chkBtn) {
      chkBtn.addEventListener('click', () => {
        state.checkerboardActive = !state.checkerboardActive;
        const stage = document.getElementById('canvas-stage');
        if (stage) stage.classList.toggle('is-checkerboard', state.checkerboardActive);
      });
    }

    const zoomFit = document.getElementById('zoom-fit-btn');
    const zoom100 = document.getElementById('zoom-100-btn');
    const zoomIn = document.getElementById('zoom-in-btn');
    const zoomOut = document.getElementById('zoom-out-btn');

    if (zoomFit) zoomFit.addEventListener('click', () => setZoom(1.0));
    if (zoom100) zoom100.addEventListener('click', () => setZoom(1.0));
    if (zoomIn) zoomIn.addEventListener('click', () => setZoom(state.zoomScale + 0.25));
    if (zoomOut) zoomOut.addEventListener('click', () => setZoom(state.zoomScale - 0.25));

    const histBtn = document.getElementById('toggle-histogram-btn');
    if (histBtn) {
      histBtn.addEventListener('click', () => {
        state.histogramVisible = !state.histogramVisible;
        const panel = document.getElementById('histogram-panel');
        if (panel) panel.classList.toggle('hidden', !state.histogramVisible);
      });
    }
  }

  function setZoom(scale) {
    state.zoomScale = Math.max(0.5, Math.min(3.0, scale));
    const targetImgs = document.querySelectorAll('.lumen-photo-img');
    targetImgs.forEach((img) => {
      img.style.transform = `scale(${state.zoomScale})`;
    });
  }

  function setCanvasMode(mode) {
    state.canvasMode = mode;
    document.querySelectorAll('[data-canvas-mode]').forEach((b) => {
      b.classList.toggle('is-active', b.getAttribute('data-canvas-mode') === mode);
    });

    const normalImg = document.getElementById('result-image');
    const splitBox = document.getElementById('split-comparator-box');
    const sbsBox = document.getElementById('side-by-side-box');

    if (!normalImg || !splitBox || !sbsBox) return;

    if (mode === 'split') {
      normalImg.classList.add('hidden');
      sbsBox.classList.add('hidden');
      splitBox.classList.remove('hidden');
      updateSplitView();
    } else if (mode === 'side_by_side') {
      normalImg.classList.add('hidden');
      splitBox.classList.add('hidden');
      sbsBox.classList.remove('hidden');
      updateSideBySideView();
    } else {
      splitBox.classList.add('hidden');
      sbsBox.classList.add('hidden');
      normalImg.classList.remove('hidden');
    }
  }

  function updateSplitView() {
    const beforeImg = document.getElementById('split-before-img');
    const afterImg = document.getElementById('split-after-img');
    const splitWrap = document.getElementById('split-before-wrap');
    const divider = document.getElementById('split-divider-line');

    if (!afterImg) return;
    const curImg = document.getElementById('result-image');
    if (curImg) afterImg.src = curImg.src;

    if (beforeImg && state.previousVersion && state.previousVersion.imageBlob) {
      beforeImg.src = createSafeBlobUrl(state.previousVersion.imageBlob);
    } else if (beforeImg && curImg) {
      beforeImg.src = curImg.src;
    }

    const pct = state.splitPercent;
    if (splitWrap) splitWrap.style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
    if (divider) divider.style.left = `${pct}%`;
  }

  function updateSideBySideView() {
    const sbsBefore = document.getElementById('sbs-before-img');
    const sbsAfter = document.getElementById('sbs-after-img');
    const curImg = document.getElementById('result-image');

    if (sbsAfter && curImg) sbsAfter.src = curImg.src;
    if (sbsBefore && state.previousVersion && state.previousVersion.imageBlob) {
      sbsBefore.src = createSafeBlobUrl(state.previousVersion.imageBlob);
    } else if (sbsBefore && curImg) {
      sbsBefore.src = curImg.src;
    }
  }

  // Interação do Divisor de Split (Mouse + Toque + Teclado)
  const splitDivider = document.getElementById('split-divider-line');
  const splitContainer = document.getElementById('split-comparator-box');
  let isDraggingSplit = false;

  if (splitDivider && splitContainer) {
    function moveSplit(clientX) {
      const rect = splitContainer.getBoundingClientRect();
      if (rect.width <= 0) return;
      const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
      state.splitPercent = Math.round((x / rect.width) * 100);
      updateSplitView();
    }

    splitDivider.addEventListener('pointerdown', (e) => {
      isDraggingSplit = true;
      splitDivider.setPointerCapture(e.pointerId);
    });

    window.addEventListener('pointermove', (e) => {
      if (!isDraggingSplit) return;
      moveSplit(e.clientX);
    });

    window.addEventListener('pointerup', (e) => {
      if (isDraggingSplit) {
        isDraggingSplit = false;
        try {
          splitDivider.releasePointerCapture(e.pointerId);
        } catch (_) {}
      }
    });

    splitDivider.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') {
        state.splitPercent = Math.max(0, state.splitPercent - 5);
        updateSplitView();
        e.preventDefault();
      } else if (e.key === 'ArrowRight') {
        state.splitPercent = Math.min(100, state.splitPercent + 5);
        updateSplitView();
        e.preventDefault();
      }
    });
  }

  // ===========================================================================
  // HISTOGRAMA ÓPTICO 64 BINS NO CANVAS
  // ===========================================================================

  function drawHistogram(histData) {
    const canvasH = document.getElementById('histogram-canvas');
    if (!canvasH || !histData || !histData.bins_64) return;
    const ctxH = canvasH.getContext('2d');
    const w = canvasH.width;
    const h = canvasH.height;

    ctxH.clearRect(0, 0, w, h);

    const lumBins = histData.bins_64.luminance;
    const maxVal = Math.max(...lumBins, 1);
    const barW = w / 64;

    for (let i = 0; i < 64; i++) {
      const bh = (lumBins[i] / maxVal) * (h - 4);
      ctxH.fillStyle = 'rgba(232, 176, 74, 0.75)';
      ctxH.fillRect(i * barW, h - bh, barW - 0.5, bh);
    }

    const hlSpan = document.getElementById('hist-highlight-clip');
    const shSpan = document.getElementById('hist-shadow-crush');
    if (hlSpan) {
      hlSpan.textContent = `Altas luzes: ${histData.highlight_clip_pct}%`;
      hlSpan.classList.toggle('text-warning', Boolean(histData.highlight_warning));
    }
    if (shSpan) {
      shSpan.textContent = `Sombras: ${histData.shadow_crush_pct}%`;
      shSpan.classList.toggle('text-warning', Boolean(histData.shadow_warning));
    }
  }

  // ===========================================================================
  // ANÁLISE DE ILUMINAÇÃO POR REFERÊNCIA (/api/analyze-reference)
  // ===========================================================================

  async function handleAnalyzeReference() {
    if (!state.referenceImageBase64) return;
    const btn = document.getElementById('analyze-ref-lighting-btn');
    const box = document.getElementById('ref-analysis-result-box');
    if (btn) btn.disabled = true;

    try {
      const resp = await fetch('/api/analyze-reference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_base64: state.referenceImageBase64,
          mime_type: state.referenceMimeType || 'image/jpeg',
        }),
      });
      if (!resp.ok) throw new Error('Falha ao analisar referência.');
      const data = await resp.json();

      if (box) {
        box.innerHTML = '';
        box.classList.remove('hidden');

        const title = document.createElement('span');
        title.className = 'font-bold text-accent';
        title.textContent = `Iluminação Estimada (${Math.round(data.confidence * 100)}% confiança):`;
        box.appendChild(title);

        const dP = document.createElement('span');
        dP.textContent = `Direção Principal: ${data.key_direction_estimate}`;
        box.appendChild(dP);

        const sP = document.createElement('span');
        sP.textContent = `Maciez: ${data.relative_softness}`;
        box.appendChild(sP);

        const tP = document.createElement('span');
        tP.textContent = `Temperatura: ${data.apparent_temperature}`;
        box.appendChild(tP);

        const applyBtn = document.createElement('button');
        applyBtn.type = 'button';
        applyBtn.className = 'lumen-btn-primary py-1 px-2 text-[10px] mt-1.5 w-full';
        applyBtn.textContent = 'Aplicar estes parâmetros ao Palco 360°';
        applyBtn.addEventListener('click', () => {
          pushRigToUndoStack();
          state.lightingRig.key_light.angle_deg = data.estimated_angle_deg;
          state.lightingRig.key_light.distance_pct = data.estimated_distance_pct;
          state.lightingRig.key_light.softness = data.estimated_softness_pct;
          state.lightingRig.key_light.color_label = data.estimated_color_label;
          syncControlInputsFromRig();
          updateSpatialSummaryAndRatio();
          renderLightStage();
          applyLiveRelightOverlay();
          showToast('Parâmetros da referência aplicados ao Radar 360°!');
        });
        box.appendChild(applyBtn);

        const cav = document.createElement('span');
        cav.className = 'text-[9px] text-text-muted italic mt-0.5';
        cav.textContent = data.caveats;
        box.appendChild(cav);
      }
    } catch (err) {
      showToast(err.message || 'Erro ao analisar referência.');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ===========================================================================
  // SOCIAL FORMAT PACK (/api/generate-pack)
  // ===========================================================================

  async function handleGenerateSocialPack() {
    if (!state.currentProduction || !state.currentProduction.imageBlob) {
      showToast('Nenhuma imagem ativa no Studio para gerar o pacote.');
      return;
    }

    const grid = document.getElementById('social-pack-results-grid');
    const packBtn = document.getElementById('generate-pack-btn');
    if (!grid || !packBtn) return;

    packBtn.disabled = true;
    grid.innerHTML = '<div class="col-span-full p-8 text-center text-xs text-accent">Processando recortes de alta definição sem distorção…</div>';

    try {
      const b64 = await window.lumenDB.blobToBase64(state.currentProduction.imageBlob);
      const projName = document.getElementById('pack-project-name')?.value || 'lumen-pack';
      const outFmt = document.getElementById('pack-output-format')?.value || 'JPEG';
      const template = document.getElementById('pack-naming-template')?.value || '{project}_{format}_{version}';

      const resp = await fetch('/api/generate-pack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_image_base64: b64,
          project_name: projName,
          version_tag: 'v1',
          naming_template: template,
          output_format: outFmt,
        }),
      });

      if (!resp.ok) throw new Error('Falha ao gerar pacote.');
      const data = await resp.json();

      grid.innerHTML = '';
      (data.items || []).forEach((item) => {
        const card = document.createElement('div');
        card.className = 'p-2.5 rounded-lg bg-surface border border-border flex flex-col gap-2';

        const head = document.createElement('div');
        head.className = 'flex items-center justify-between text-xs font-semibold';
        const ratioSpan = document.createElement('span');
        ratioSpan.className = 'text-accent font-mono';
        ratioSpan.textContent = item.aspect_ratio;
        head.appendChild(ratioSpan);

        const dimSpan = document.createElement('span');
        dimSpan.className = 'text-[10px] text-text-muted font-mono';
        dimSpan.textContent = `${item.width}x${item.height}`;
        head.appendChild(dimSpan);
        card.appendChild(head);

        if (item.image_base64) {
          const img = document.createElement('img');
          img.className = 'w-full h-44 object-cover rounded border border-border';
          img.src = `data:${item.mime_type};base64,${item.image_base64}`;
          img.alt = item.filename;
          card.appendChild(img);

          const dl = document.createElement('a');
          dl.className = 'lumen-btn-secondary text-xs w-full text-center py-1';
          dl.href = img.src;
          dl.download = item.filename;
          dl.textContent = `Baixar ${item.filename}`;
          card.appendChild(dl);
        } else {
          const errBox = document.createElement('div');
          errBox.className = 'p-4 text-xs text-danger text-center';
          errBox.textContent = item.error || 'Falha ao gerar formato.';
          card.appendChild(errBox);
        }
        grid.appendChild(card);
      });
      showToast('Pacote multiformato gerado com sucesso!');
    } catch (err) {
      grid.innerHTML = `<div class="col-span-full p-4 text-xs text-danger text-center">${err.message || 'Erro ao gerar pacote.'}</div>`;
      showToast(err.message || 'Falha ao gerar pacote.');
    } finally {
      packBtn.disabled = false;
    }
  }

  // ===========================================================================
  // RECEITAS DE ILUMINAÇÃO (SCHEMA V1)
  // ===========================================================================

  async function loadRecipesView() {
    const grid = document.getElementById('recipes-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const list = await window.lumenDB.getAllRecipes();
    if (list.length === 0) {
      grid.innerHTML = '<div class="col-span-full p-8 text-center text-xs text-text-muted">Nenhuma receita salva. Ajuste a luz no Studio e salve uma nova receita.</div>';
      return;
    }

    list.forEach((rcp) => {
      const card = document.createElement('div');
      card.className = 'p-3.5 rounded-lg bg-surface border border-border flex flex-col justify-between gap-3';

      const top = document.createElement('div');
      top.className = 'flex flex-col gap-1.5';

      const titleRow = document.createElement('div');
      titleRow.className = 'flex items-center justify-between';
      const name = document.createElement('h3');
      name.className = 'text-sm font-semibold text-ivory m-0';
      name.textContent = rcp.name;
      titleRow.appendChild(name);

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'text-text-muted hover:text-danger p-1';
      delBtn.innerHTML = '<i data-lucide="trash-2" class="w-3.5 h-3.5"></i>';
      delBtn.addEventListener('click', async () => {
        if (confirm(`Excluir a receita "${rcp.name}"?`)) {
          await window.lumenDB.deleteRecipe(rcp.id);
          loadRecipesView();
          showToast('Receita removida.');
        }
      });
      titleRow.appendChild(delBtn);
      top.appendChild(titleRow);

      const desc = document.createElement('p');
      desc.className = 'text-xs text-text-secondary m-0 leading-relaxed';
      desc.textContent = rcp.description || 'Esquema de iluminação 360°';
      top.appendChild(desc);

      const tagsRow = document.createElement('div');
      tagsRow.className = 'flex flex-wrap gap-1 mt-1';
      (rcp.tags || []).forEach((t) => {
        const tag = document.createElement('span');
        tag.className = 'text-[10px] px-1.5 py-0.5 rounded bg-bg text-text-muted font-mono';
        tag.textContent = `#${t}`;
        tagsRow.appendChild(tag);
      });
      top.appendChild(tagsRow);
      card.appendChild(top);

      // Botões de Aplicação e Exportação JSON
      const actions = document.createElement('div');
      actions.className = 'flex items-center gap-1.5 pt-2 border-t border-border';

      const applyLight = document.createElement('button');
      applyLight.type = 'button';
      applyLight.className = 'lumen-btn-primary py-1 px-2 text-xs flex-1';
      applyLight.textContent = 'Aplicar Luz 360°';
      applyLight.addEventListener('click', () => {
        pushRigToUndoStack();
        state.lightingRig.key_light = { ...state.lightingRig.key_light, ...rcp.lighting.key_light };
        state.lightingRig.rim_light = { ...state.lightingRig.rim_light, ...rcp.lighting.rim_light };
        if (rcp.lighting.fill_light) {
          state.lightingRig.fill_light = { ...state.lightingRig.fill_light, ...rcp.lighting.fill_light };
        }
        syncControlInputsFromRig();
        updateSpatialSummaryAndRatio();
        renderLightStage();
        applyLiveRelightOverlay();
        switchView('studio');
        showToast(`Receita "${rcp.name}" aplicada!`);
      });
      actions.appendChild(applyLight);

      const exportBtn = document.createElement('button');
      exportBtn.type = 'button';
      exportBtn.className = 'lumen-btn-secondary py-1 px-2 text-xs';
      exportBtn.title = 'Exportar JSON';
      exportBtn.innerHTML = '<i data-lucide="download" class="w-3.5 h-3.5"></i>';
      exportBtn.addEventListener('click', () => {
        const blob = new Blob([JSON.stringify(rcp, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `lumen_recipe_${rcp.id}.json`;
        a.click();
      });
      actions.appendChild(exportBtn);

      card.appendChild(actions);
      grid.appendChild(card);
    });
    initIcons();
  }

  async function handleSaveCurrentRecipe() {
    const name = prompt('Nome da nova receita de luz:', 'Minha Luz de Estúdio');
    if (!name || !name.trim()) return;
    const desc = prompt('Descrição breve (opcional):', 'Configuração personalizada 360°');

    const newRcp = {
      schema_version: 1,
      name: name.trim(),
      description: desc ? desc.trim() : '',
      tags: ['personalizada', state.camera.lens],
      lighting: {
        key_light: { ...state.lightingRig.key_light },
        rim_light: { ...state.lightingRig.rim_light },
        fill_light: { ...state.lightingRig.fill_light },
      },
      camera: { ...state.camera },
    };

    await window.lumenDB.saveRecipe(newRcp);
    showToast(`Receita "${name}" salva com sucesso!`);
  }

  // ===========================================================================
  // PROJETOS & BIBLIOTECA DE ASSETS
  // ===========================================================================

  async function loadProjectsView() {
    const grid = document.getElementById('projects-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const projects = await window.lumenDB.getAllProjects();
    const allProductions = await window.lumenDB.getAllProductions();

    projects.forEach((proj) => {
      const card = document.createElement('div');
      card.className = 'p-4 rounded-lg bg-surface border border-border flex flex-col justify-between gap-3';

      const prodsInProj = allProductions.filter((p) => p.project_id === proj.id);

      const top = document.createElement('div');
      top.className = 'flex flex-col gap-1';

      const titleRow = document.createElement('div');
      titleRow.className = 'flex items-center justify-between';
      const h3 = document.createElement('h3');
      h3.className = 'text-sm font-semibold text-ivory m-0';
      h3.textContent = proj.name;
      titleRow.appendChild(h3);

      const count = document.createElement('span');
      count.className = 'text-xs font-mono px-2 py-0.5 rounded bg-bg text-text-muted';
      count.textContent = `${prodsInProj.length} versões`;
      titleRow.appendChild(count);
      top.appendChild(titleRow);

      const desc = document.createElement('p');
      desc.className = 'text-xs text-text-secondary m-0 leading-relaxed';
      desc.textContent = proj.description || 'Sessão fotográfica';
      top.appendChild(desc);

      card.appendChild(top);

      const bottom = document.createElement('div');
      bottom.className = 'flex items-center justify-between pt-2 border-t border-border';

      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'lumen-btn-primary py-1 px-3 text-xs w-auto';
      openBtn.textContent = 'Abrir Projeto';
      openBtn.addEventListener('click', () => {
        state.activeProject = proj.id;
        const select = document.getElementById('header-project-select');
        if (select) select.value = proj.id;
        switchView('studio');
        showToast(`Projeto "${proj.name}" ativo.`);
      });
      bottom.appendChild(openBtn);

      card.appendChild(bottom);
      grid.appendChild(card);
    });
  }

  // ===========================================================================
  // HISTÓRICO & GERENCIADOR DE JOBS
  // ===========================================================================

  async function loadHistoryView() {
    const container = document.getElementById('jobs-table-container');
    if (!container) return;
    container.innerHTML = '';

    const productions = await window.lumenDB.getAllProductions();
    if (productions.length === 0) {
      container.innerHTML = '<div class="p-8 text-center text-xs text-text-muted border border-dashed border-border rounded-lg">Nenhum job ou fotografia no histórico.</div>';
      return;
    }

    productions.forEach((prod) => {
      const card = document.createElement('div');
      card.className = 'p-3 rounded-lg bg-surface border border-border flex items-center justify-between gap-3';

      const left = document.createElement('div');
      left.className = 'flex items-center gap-3 min-w-0';

      if (prod.imageBlob) {
        const thumb = document.createElement('img');
        thumb.className = 'w-12 h-12 object-cover rounded border border-border shrink-0';
        thumb.src = createSafeBlobUrl(prod.imageBlob);
        left.appendChild(thumb);
      }

      const info = document.createElement('div');
      info.className = 'flex flex-col min-w-0';
      const name = document.createElement('span');
      name.className = 'text-xs font-semibold text-ivory truncate';
      name.textContent = prod.name || prod.params?.brief || 'Produção de Estúdio';
      info.appendChild(name);

      const meta = document.createElement('span');
      meta.className = 'text-[11px] text-text-muted font-mono';
      const timeStr = new Date(prod.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      meta.textContent = `${timeStr} · ${prod.params?.lens || '35mm'} · ${prod.params?.film || 'Portra 400'} · Nota: ${prod.qa?.score ?? '-'}`;
      info.appendChild(meta);
      left.appendChild(info);
      card.appendChild(left);

      const actions = document.createElement('div');
      actions.className = 'flex items-center gap-2 shrink-0';

      const restoreBtn = document.createElement('button');
      restoreBtn.type = 'button';
      restoreBtn.className = 'lumen-btn-primary py-1 px-2.5 text-xs w-auto';
      restoreBtn.textContent = 'Restaurar no Studio';
      restoreBtn.addEventListener('click', () => {
        restoreProductionToStudio(prod);
        switchView('studio');
      });
      actions.appendChild(restoreBtn);

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'p-1.5 text-text-muted hover:text-danger';
      delBtn.innerHTML = '<i data-lucide="trash-2" class="w-3.5 h-3.5"></i>';
      delBtn.addEventListener('click', async () => {
        await window.lumenDB.deleteProduction(prod.id);
        loadHistoryView();
        showToast('Item removido.');
      });
      actions.appendChild(delBtn);

      card.appendChild(actions);
      container.appendChild(card);
    });
    initIcons();
  }

  function restoreProductionToStudio(prod) {
    state.previousVersion = state.currentProduction;
    state.currentProduction = prod;
    state.activeVersion = prod;

    const img = document.getElementById('result-image');
    if (img && prod.imageBlob) {
      img.src = createSafeBlobUrl(prod.imageBlob);
    }

    if (prod.lighting_rig) {
      state.lightingRig = JSON.parse(JSON.stringify(prod.lighting_rig));
      syncControlInputsFromRig();
      updateSpatialSummaryAndRatio();
      renderLightStage();
    }

    const stateEmpty = document.getElementById('state-empty');
    const stateSuccess = document.getElementById('state-success');
    if (stateEmpty) stateEmpty.classList.add('hidden');
    if (stateSuccess) stateSuccess.classList.remove('hidden');

    const metaBar = document.getElementById('result-metadata-bar');
    if (metaBar) {
      metaBar.textContent = `${prod.params?.lens} · ${prod.params?.aperture} · ${prod.params?.film} · ${prod.params?.aspect_ratio}`;
    }

    const dlBtn = document.getElementById('download-image-btn');
    const dlEd = document.getElementById('download-editorial-btn');
    if (dlBtn) dlBtn.disabled = false;
    if (dlEd) dlEd.disabled = false;

    if (prod.histogram) {
      drawHistogram(prod.histogram);
    }

    updateDirtyStateIndicator();
    showToast('Versão restaurada no Studio com sucesso!');
  }

  // ===========================================================================
  // DISPARO DE PRODUÇÃO (STREAMING NDJSON + IDEMPOTÊNCIA + TELEMETRIA)
  // ===========================================================================

  async function handleProductionSubmit(e) {
    if (e) e.preventDefault();
    if (state.isGenerating) return;

    const briefInput = document.getElementById('brief-input');
    const brief = (briefInput?.value || '').trim();
    if (!brief) {
      const alertBox = document.getElementById('brief-validation-alert');
      if (alertBox) alertBox.classList.remove('hidden');
      if (briefInput) briefInput.focus();
      return;
    }

    state.isGenerating = true;
    const submitBtn = document.getElementById('submit-production-btn');
    if (submitBtn) submitBtn.disabled = true;

    // Alterna visualizadores de estado
    document.getElementById('state-empty')?.classList.add('hidden');
    document.getElementById('state-success')?.classList.add('hidden');
    document.getElementById('state-generating')?.classList.remove('hidden');

    // Chave de idempotência única por submissão
    const idempotencyKey = `idem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const payload = {
      brief,
      lens: state.camera.lens,
      aperture: state.camera.aperture,
      film: state.camera.film,
      aspect_ratio: state.camera.aspect_ratio,
      depth_of_field: state.camera.depth_of_field,
      framing_intent: state.camera.framing_intent,
      lighting_rig: state.lightingRig,
      previous_prompt: state.currentProduction?.direction?.final_prompt || null,
      parent_version_id: state.currentProduction?.version_id || null,
      project_id: state.activeProject,
      reference_image_base64: state.referenceImageBase64,
      reference_mime_type: state.referenceMimeType,
      preserve_categories: state.preserveCategories,
      locks: state.consistencyLocks,
      contact_sheet: state.contactSheetMode,
      idempotency_key: idempotencyKey,
    };

    try {
      const response = await fetch('/api/generate-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Erro no servidor HTTP (${response.status})`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // preserva linha incompleta

        for (const line of lines) {
          if (!line.trim()) continue;
          const evt = JSON.parse(line.trim());

          if (evt.event === 'step') {
            updateLivePipelineStep(evt.step, evt.message, evt.job_id);
          } else if (evt.event === 'complete') {
            await handleProductionComplete(evt.data);
          } else if (evt.event === 'error') {
            throw new Error(evt.message || 'Erro durante a produção.');
          }
        }
      }
    } catch (err) {
      showToast(err.message || 'Falha ao processar produção.');
      document.getElementById('state-generating')?.classList.add('hidden');
      if (state.currentProduction) {
        document.getElementById('state-success')?.classList.remove('hidden');
      } else {
        document.getElementById('state-empty')?.classList.remove('hidden');
      }
    } finally {
      state.isGenerating = false;
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  function updateLivePipelineStep(step, message, jobId) {
    const jobLabel = document.getElementById('live-job-id-label');
    const heading = document.getElementById('generating-live-heading');
    if (jobLabel && jobId) jobLabel.textContent = `Job: ${jobId}`;
    if (heading && message) heading.textContent = message;

    const sDir = document.getElementById('step-item-direction');
    const sImg = document.getElementById('step-item-imaging');
    const sQa = document.getElementById('step-item-qa');

    [sDir, sImg, sQa].forEach((el) => {
      if (el) el.className = 'lumen-step-item';
    });

    if (step === 'direction') {
      sDir?.classList.add('is-active');
    } else if (step === 'imaging') {
      sDir?.classList.add('is-done');
      sImg?.classList.add('is-active');
    } else if (step === 'qa') {
      sDir?.classList.add('is-done');
      sImg?.classList.add('is-done');
      sQa?.classList.add('is-active');
    }
  }

  async function handleProductionComplete(data) {
    document.getElementById('state-generating')?.classList.add('hidden');
    document.getElementById('state-success')?.classList.remove('hidden');

    const imageBlob = window.lumenDB.base64ToBlob(data.image_base64, data.mime_type || 'image/jpeg');
    const imgUrl = createSafeBlobUrl(imageBlob);

    const resultImg = document.getElementById('result-image');
    if (resultImg) resultImg.src = imgUrl;

    const savedRecord = await window.lumenDB.saveProduction({
      ...data,
      imageBlob,
      project_id: state.activeProject,
    });

    state.previousVersion = state.currentProduction;
    state.currentProduction = savedRecord;
    state.activeVersion = savedRecord;

    // Atualiza metadados técnicos
    const metaBar = document.getElementById('result-metadata-bar');
    if (metaBar) {
      metaBar.textContent = `${data.params?.lens} · ${data.params?.aperture} · ${data.params?.film} · ${data.params?.aspect_ratio}`;
    }

    // Painéis de direção e QA
    const techPanels = document.getElementById('technical-panels');
    if (techPanels) techPanels.classList.remove('hidden');

    const dirOptics = document.getElementById('direction-optics-text');
    const dirPrompt = document.getElementById('direction-prompt-text');
    if (dirOptics) dirOptics.textContent = data.direction?.camera_optics || '';
    if (dirPrompt) dirPrompt.textContent = data.direction?.final_prompt || '';

    const qaScore = document.getElementById('qa-score-pill');
    const qaLight = document.getElementById('qa-lighting-text');
    const qaLens = document.getElementById('qa-lens-text');
    const qaTelem = document.getElementById('qa-telemetry-text');
    if (qaScore) qaScore.textContent = `Nota: ${data.qa?.score ?? '-'}/10`;
    if (qaLight) qaLight.textContent = data.qa?.lighting || '';
    if (qaLens) qaLens.textContent = data.qa?.lens_coherence || '';
    if (qaTelem && data.job_telemetry) {
      qaTelem.textContent = `Provedor: ${data.job_telemetry.provider_used} | Tempo: ${data.job_telemetry.elapsed_ms}ms | Fallback: ${data.job_telemetry.fallback_occurred ? 'Sim' : 'Não'}`;
    }

    // Histograma
    if (data.histogram) {
      drawHistogram(data.histogram);
    }

    // Habilita download
    document.getElementById('download-image-btn').disabled = false;
    document.getElementById('download-editorial-btn').disabled = false;

    updateDirtyStateIndicator();
    showToast('Fotografia produzida e masterizada com sucesso!');
  }

  // ===========================================================================
  // CONTROLE DE NAVEGAÇÃO ENTRE AS 5 ÁREAS
  // ===========================================================================

  function switchView(viewName) {
    state.activeView = viewName;
    document.querySelectorAll('.lumen-nav-btn').forEach((b) => {
      b.classList.toggle('is-active', b.getAttribute('data-nav-target') === viewName);
    });

    const views = ['studio', 'projects', 'recipes', 'pack', 'history'];
    views.forEach((v) => {
      const el = document.getElementById(`view-${v}`);
      if (el) el.classList.toggle('hidden', v !== viewName);
    });

    const sidebar = document.getElementById('studio-sidebar');
    const shell = document.getElementById('app-shell');
    if (sidebar && shell) {
      if (viewName === 'studio') {
        sidebar.classList.remove('hidden');
        shell.classList.remove('is-full-view');
      } else {
        sidebar.classList.add('hidden');
        shell.classList.add('is-full-view');
      }
    }

    if (viewName === 'projects') loadProjectsView();
    if (viewName === 'recipes') loadRecipesView();
    if (viewName === 'history') loadHistoryView();
  }

  function setupNavigation() {
    document.querySelectorAll('.lumen-nav-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        switchView(btn.getAttribute('data-nav-target'));
      });
    });

    // Abas do Painel de Controle (Luz | Câmera | Sujeito | Estilo)
    document.querySelectorAll('.lumen-control-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        const target = tab.getAttribute('data-tab-panel');
        state.activeControlTab = target;
        document.querySelectorAll('.lumen-control-tab').forEach((t) => t.classList.remove('is-active'));
        tab.classList.add('is-active');

        ['tab-light', 'tab-camera', 'tab-subject', 'tab-darkroom'].forEach((pId) => {
          const pEl = document.getElementById(pId);
          if (pEl) pEl.classList.toggle('hidden', pId !== target);
        });
      });
    });

    // Tema
    const themeBtn = document.getElementById('theme-toggle-btn');
    if (themeBtn) {
      themeBtn.addEventListener('click', () => {
        applyTheme(state.theme === 'light' ? 'dark' : 'light');
      });
    }

    // Projetos no Header
    const projSelect = document.getElementById('header-project-select');
    if (projSelect) {
      window.lumenDB.getAllProjects().then((projs) => {
        projSelect.innerHTML = '';
        projs.forEach((p) => {
          const opt = document.createElement('option');
          opt.value = p.id;
          opt.textContent = p.name;
          projSelect.appendChild(opt);
        });
        projSelect.value = state.activeProject;
      });
      projSelect.addEventListener('change', () => {
        state.activeProject = projSelect.value;
        showToast('Projeto ativo alterado.');
      });
    }

    // Presets e Direção Rápida
    document.querySelectorAll('[data-stage-preset]').forEach((btn) => {
      btn.addEventListener('click', () => applyRigPreset(btn.getAttribute('data-stage-preset')));
    });

    document.querySelectorAll('[data-quick-action]').forEach((btn) => {
      btn.addEventListener('click', () => applyQuickAction(btn.getAttribute('data-quick-action')));
    });

    const undoBtn = document.getElementById('undo-quick-action-btn');
    if (undoBtn) undoBtn.addEventListener('click', undoLastRigAction);

    // Seletor de Fontes no Radar (Key, Rim, Fill)
    document.querySelectorAll('.lumen-source-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.activeLightSource = btn.getAttribute('data-active-source');
        syncControlInputsFromRig();
        renderLightStage();
      });
    });

    // Sliders de Intensidade e Maciez
    const slInt = document.getElementById('active-source-intensity-slider');
    if (slInt) {
      slInt.addEventListener('input', (e) => {
        const cur = state.lightingRig[`${state.activeLightSource}_light`];
        if (cur) {
          cur.intensity = Number(e.target.value);
          document.getElementById('active-source-intensity-val').textContent = `${cur.intensity}%`;
          updateSpatialSummaryAndRatio();
          renderLightStage();
          applyLiveRelightOverlay();
        }
      });
    }

    const slSoft = document.getElementById('active-source-softness-slider');
    if (slSoft) {
      slSoft.addEventListener('input', (e) => {
        const cur = state.lightingRig[`${state.activeLightSource}_light`];
        if (cur) {
          cur.softness = Number(e.target.value);
          document.getElementById('active-source-softness-val').textContent = `${cur.softness}%`;
          updateSpatialSummaryAndRatio();
          renderLightStage();
        }
      });
    }

    // Toggle Liga/Desliga Fonte
    const toggleSrc = document.getElementById('toggle-active-source-btn');
    if (toggleSrc) {
      toggleSrc.addEventListener('click', () => {
        const cur = state.lightingRig[`${state.activeLightSource}_light`];
        if (cur) {
          cur.enabled = !cur.enabled;
          syncControlInputsFromRig();
          updateSpatialSummaryAndRatio();
          renderLightStage();
          applyLiveRelightOverlay();
        }
      });
    }

    // Swatches de Cor
    document.querySelectorAll('#color-swatches-row .lumen-color-swatch').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cur = state.lightingRig[`${state.activeLightSource}_light`];
        if (cur) {
          cur.color_label = btn.getAttribute('data-light-color');
          syncControlInputsFromRig();
          updateSpatialSummaryAndRatio();
          renderLightStage();
          applyLiveRelightOverlay();
        }
      });
    });

    // Dropzone de Referência
    const refInput = document.getElementById('reference-file-input');
    const refDrop = document.getElementById('reference-dropzone');
    const refEmpty = document.getElementById('reference-empty-prompt');
    const refPrevBox = document.getElementById('reference-preview-container');
    const refPrevImg = document.getElementById('reference-preview-img');
    const refRemove = document.getElementById('remove-reference-btn');
    const refAnalyzeBtn = document.getElementById('analyze-ref-lighting-btn');

    if (refDrop && refInput) {
      refDrop.addEventListener('click', (e) => {
        if (e.target !== refRemove && !refRemove.contains(e.target)) {
          refInput.click();
        }
      });
      refInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) loadReferenceFile(file);
      });
    }

    window.addEventListener('paste', (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) loadReferenceFile(file);
          break;
        }
      }
    });

    function loadReferenceFile(file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const res = ev.target.result;
        state.referenceImageBase64 = res;
        state.referenceMimeType = file.type;
        if (refPrevImg) refPrevImg.src = res;
        refEmpty?.classList.add('hidden');
        refPrevBox?.classList.remove('hidden');
        refAnalyzeBtn?.classList.remove('hidden');
        showToast('Foto de referência carregada!');
      };
      reader.readAsDataURL(file);
    }

    if (refRemove) {
      refRemove.addEventListener('click', () => {
        state.referenceImageBase64 = null;
        refEmpty?.classList.remove('hidden');
        refPrevBox?.classList.add('hidden');
        refAnalyzeBtn?.classList.add('hidden');
        document.getElementById('ref-analysis-result-box')?.classList.add('hidden');
        if (refInput) refInput.value = '';
      });
    }

    if (refAnalyzeBtn) {
      refAnalyzeBtn.addEventListener('click', handleAnalyzeReference);
    }

    // Toggle Contact Sheet
    const csToggle = document.getElementById('contact-sheet-toggle');
    if (csToggle) {
      csToggle.addEventListener('click', () => {
        state.contactSheetMode = !state.contactSheetMode;
        csToggle.setAttribute('aria-pressed', String(state.contactSheetMode));
      });
    }

    // Salvar Receita Atual
    const saveRcpBtn = document.getElementById('save-current-recipe-btn');
    if (saveRcpBtn) saveRcpBtn.addEventListener('click', handleSaveCurrentRecipe);

    // Gerar Social Pack
    const genPackBtn = document.getElementById('generate-pack-btn');
    if (genPackBtn) genPackBtn.addEventListener('click', handleGenerateSocialPack);

    // Importar Receita JSON
    const impFile = document.getElementById('recipe-import-file');
    const impBtn = document.getElementById('import-recipe-btn');
    if (impBtn && impFile) {
      impBtn.addEventListener('click', () => impFile.click());
      impFile.addEventListener('change', async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        try {
          const text = await f.text();
          const parsed = JSON.parse(text);
          await window.lumenDB.saveRecipe(parsed);
          loadRecipesView();
          showToast('Receita importada e validada com sucesso!');
        } catch (err) {
          showToast(err.message || 'Arquivo JSON inválido.');
        }
      });
    }

    // Form Submit
    const form = document.getElementById('production-form');
    if (form) form.addEventListener('submit', handleProductionSubmit);

    // Ctrl+Enter no briefing
    const briefInput = document.getElementById('brief-input');
    if (briefInput) {
      briefInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          handleProductionSubmit();
        }
      });
    }

    // Download Direto
    const dlBtn = document.getElementById('download-image-btn');
    if (dlBtn) {
      dlBtn.addEventListener('click', () => {
        const img = document.getElementById('result-image');
        if (!img || !img.src) return;
        const a = document.createElement('a');
        a.href = img.src;
        a.download = `lumen_production_${Date.now()}.jpg`;
        a.click();
      });
    }

    setupCanvasToolbar();
  }

  // ===========================================================================
  // INICIALIZAÇÃO DO ESTÚDIO
  // ===========================================================================

  window.addEventListener('DOMContentLoaded', async () => {
    applyTheme(state.theme);
    setupNavigation();
    updateSpatialSummaryAndRatio();
    renderLightStage();
    initIcons();

    // Health Check Real
    try {
      const resp = await fetch('/health', { cache: 'no-store' });
      const data = await resp.json();
      const dot = document.getElementById('system-status-dot');
      const text = document.getElementById('system-status-text');
      if (data.status === 'ok') {
        if (dot) dot.style.backgroundColor = 'var(--color-success)';
        if (text) text.textContent = data.api_key_configured ? 'Estúdio online' : 'Chave pendente';
      }
    } catch (_) {
      const dot = document.getElementById('system-status-dot');
      const text = document.getElementById('system-status-text');
      if (dot) dot.style.backgroundColor = 'var(--color-danger)';
      if (text) text.textContent = 'Offline';
    }
  });
})();
