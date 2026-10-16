/**
 * LUMEN Studio 6.0 — Camada de Persistência IndexedDB Versionada (DB_VERSION = 2)
 * Suporta:
 *  - productions (versões imutáveis com parent_version_id, project_id, favorite, Blob binário)
 *  - projects (projetos criativos e campanhas)
 *  - recipes (receitas de luz 3 fontes com schema_version=1, import/export JSON validado)
 *  - brand_kits (kits de marca, margens seguras e convenções de nomenclatura)
 */

const DB_NAME = 'LumenStudioDB';
const DB_VERSION = 2;
const STORE_PRODUCTIONS = 'productions';
const STORE_PROJECTS = 'projects';
const STORE_RECIPES = 'recipes';
const STORE_BRAND_KITS = 'brand_kits';

const DEFAULT_RECIPES_SEED = [
  {
    id: 'rcp_rembrandt_editorial',
    schema_version: 1,
    name: 'Rembrandt Editorial 45°',
    description: 'Luz principal dourada a 45° pela esquerda com contraluz fria e preenchimento suave.',
    tags: ['retrato', 'editorial', 'rembrandt'],
    lighting: {
      key_light: {
        enabled: true,
        angle_deg: 315,
        distance_pct: 62,
        color_label: 'Sol Dourado',
        color_hex: '#FFD166',
        intensity: 88,
        softness: 55,
      },
      rim_light: {
        enabled: true,
        angle_deg: 135,
        distance_pct: 78,
        color_label: 'Frio Noturno',
        color_hex: '#74B9FF',
        intensity: 60,
        softness: 35,
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
    },
    camera: {
      lens: '85mm',
      aperture: 'f/1.4',
      film: 'Kodak Portra 400',
      aspect_ratio: '4:5',
    },
    createdAt: Date.now() - 3600000 * 12,
    updatedAt: Date.now() - 3600000 * 12,
  },
  {
    id: 'rcp_soft_catalog',
    schema_version: 1,
    name: 'Soft Catalog (E-Commerce)',
    description: 'Luz frontal ampla e difusa com preenchimento equilibrado para produtos sem sombras duras.',
    tags: ['produto', 'catálogo', 'suave'],
    lighting: {
      key_light: {
        enabled: true,
        angle_deg: 340,
        distance_pct: 52,
        color_label: 'Luz do Dia',
        color_hex: '#F4F6F8',
        intensity: 75,
        softness: 88,
      },
      rim_light: {
        enabled: true,
        angle_deg: 180,
        distance_pct: 70,
        color_label: 'Luz do Dia',
        color_hex: '#F4F6F8',
        intensity: 32,
        softness: 75,
      },
      fill_light: {
        enabled: true,
        angle_deg: 30,
        distance_pct: 50,
        color_label: 'Luz do Dia',
        color_hex: '#F4F6F8',
        intensity: 48,
        softness: 92,
      },
    },
    camera: {
      lens: '50mm',
      aperture: 'f/8',
      film: 'Neutro',
      aspect_ratio: '4:5',
    },
    createdAt: Date.now() - 3600000 * 8,
    updatedAt: Date.now() - 3600000 * 8,
  },
  {
    id: 'rcp_stadium_campaign',
    schema_version: 1,
    name: 'Campanha Esportiva (Estádio)',
    description: 'Contraluz potente de refletor de estádio a 180° combinada com ataque lateral dramático.',
    tags: ['esporte', 'campanha', 'estádio'],
    lighting: {
      key_light: {
        enabled: true,
        angle_deg: 300,
        distance_pct: 68,
        color_label: 'Luz do Dia',
        color_hex: '#F4F6F8',
        intensity: 90,
        softness: 38,
      },
      rim_light: {
        enabled: true,
        angle_deg: 180,
        distance_pct: 82,
        color_label: 'Frio Noturno',
        color_hex: '#74B9FF',
        intensity: 85,
        softness: 25,
      },
      fill_light: {
        enabled: true,
        angle_deg: 60,
        distance_pct: 58,
        color_label: 'Sol Dourado',
        color_hex: '#FFD166',
        intensity: 24,
        softness: 75,
      },
    },
    camera: {
      lens: '35mm',
      aperture: 'f/8',
      film: 'Kodak Portra 400',
      aspect_ratio: '4:5',
    },
    createdAt: Date.now() - 3600000 * 4,
    updatedAt: Date.now() - 3600000 * 4,
  },
];

const DEFAULT_BRAND_KIT_SEED = {
  id: 'bk_default_studio',
  name: 'Padrão LUMEN Editorial',
  primary_color: '#E8B04A',
  secondary_color: '#EDEAE3',
  safe_margin_pct: 6,
  target_formats: ['4:5', '9:16', '1:1', '16:9'],
  naming_template: '{project}_{format}_{version}',
  updatedAt: Date.now(),
};

class LumenDatabase {
  constructor() {
    this.dbPromise = null;
  }

  open() {
    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error('IndexedDB não suportado neste navegador.'));
        return;
      }

      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        if (!db.objectStoreNames.contains(STORE_PRODUCTIONS)) {
          const prodStore = db.createObjectStore(STORE_PRODUCTIONS, {
            keyPath: 'id',
            autoIncrement: true,
          });
          prodStore.createIndex('timestamp', 'timestamp', { unique: false });
          prodStore.createIndex('project_id', 'project_id', { unique: false });
          prodStore.createIndex('version_id', 'version_id', { unique: false });
        }

        if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
          const projStore = db.createObjectStore(STORE_PROJECTS, {
            keyPath: 'id',
          });
          projStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        }

        if (!db.objectStoreNames.contains(STORE_RECIPES)) {
          const rcpStore = db.createObjectStore(STORE_RECIPES, {
            keyPath: 'id',
          });
          rcpStore.createIndex('updatedAt', 'updatedAt', { unique: false });
          DEFAULT_RECIPES_SEED.forEach((r) => rcpStore.put(r));
        }

        if (!db.objectStoreNames.contains(STORE_BRAND_KITS)) {
          const bkStore = db.createObjectStore(STORE_BRAND_KITS, {
            keyPath: 'id',
          });
          bkStore.put(DEFAULT_BRAND_KIT_SEED);
        }
      };

      request.onsuccess = (event) => {
        resolve(event.target.result);
      };

      request.onerror = (event) => {
        reject(event.target.error || new Error('Erro ao abrir IndexedDB.'));
      };
    });

    return this.dbPromise;
  }

  base64ToBlob(base64Data, mimeType = 'image/jpeg') {
    const clean = String(base64Data || '').includes(',')
      ? String(base64Data).split(',')[1]
      : String(base64Data || '');
    const byteCharacters = atob(clean);
    const byteArrays = [];
    const sliceSize = 1024;

    for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
      const slice = byteCharacters.slice(offset, offset + sliceSize);
      const byteNumbers = new Array(slice.length);
      for (let i = 0; i < slice.length; i++) {
        byteNumbers[i] = slice.charCodeAt(i);
      }
      byteArrays.push(new Uint8Array(byteNumbers));
    }

    return new Blob(byteArrays, { type: mimeType });
  }

  blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const res = String(reader.result || '');
        resolve(res.includes(',') ? res.split(',')[1] : res);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // ===========================================================================
  // VERSÕES E PRODUÇÕES IMUTÁVEIS
  // ===========================================================================

  async saveProduction(productionData) {
    const db = await this.open();
    const imageBlob =
      productionData.imageBlob instanceof Blob
        ? productionData.imageBlob
        : this.base64ToBlob(
            productionData.image_base64,
            productionData.mime_type || 'image/jpeg'
          );

    const contactSheet = Array.isArray(productionData.contact_sheet)
      ? productionData.contact_sheet.map((v) => ({
          label: String(v.label || ''),
          prompt: String(v.prompt || ''),
          imageBlob:
            v.imageBlob instanceof Blob
              ? v.imageBlob
              : this.base64ToBlob(v.image_base64, 'image/jpeg'),
        }))
      : [];

    const versionId =
      productionData.version_id ||
      `ver_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

    const record = {
      timestamp: Date.now(),
      version_id: versionId,
      parent_version_id: productionData.parent_version_id || null,
      project_id: productionData.project_id || 'proj_default',
      name: String(
        productionData.name ||
          (productionData.is_original_import ? 'Original Importado' : 'Versão de Estúdio')
      ),
      is_original_import: Boolean(productionData.is_original_import),
      favorite: Boolean(productionData.favorite),
      imageBlob,
      mime_type: productionData.mime_type || 'image/jpeg',
      contact_sheet: contactSheet,
      lighting_rig: productionData.lighting_rig || null,
      normalized_rig: productionData.normalized_rig || null,
      histogram: productionData.histogram || null,
      job_telemetry: productionData.job_telemetry || null,
      params: {
        brief: String(productionData.params?.brief || ''),
        lens: String(productionData.params?.lens || '35mm'),
        aperture: String(productionData.params?.aperture || 'f/2.8'),
        film: String(productionData.params?.film || 'Kodak Portra 400'),
        aspect_ratio: String(productionData.params?.aspect_ratio || '4:5'),
        depth_of_field: String(productionData.params?.depth_of_field || 'balanced'),
        framing_intent: String(productionData.params?.framing_intent || 'preserve'),
      },
      direction: {
        camera_optics: String(productionData.direction?.camera_optics || ''),
        final_prompt: String(productionData.direction?.final_prompt || ''),
        key_fill_ratio: String(productionData.direction?.key_fill_ratio || ''),
      },
      qa: {
        score:
          typeof productionData.qa?.score === 'number'
            ? productionData.qa.score
            : null,
        lighting: String(productionData.qa?.lighting || 'Auditoria indisponível'),
        lens_coherence: String(
          productionData.qa?.lens_coherence || 'Auditoria indisponível'
        ),
        notes: String(productionData.qa?.notes || 'Auditoria indisponível'),
        improvement_suggestion: String(
          productionData.qa?.improvement_suggestion || ''
        ),
        auto_corrected: Boolean(productionData.qa?.auto_corrected),
      },
      qa_available: Boolean(productionData.qa_available),
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_PRODUCTIONS], 'readwrite');
      const store = tx.objectStore(STORE_PRODUCTIONS);
      const request = store.add(record);

      request.onsuccess = (event) => {
        resolve({ ...record, id: event.target.result });
      };

      request.onerror = (event) => {
        reject(
          event.target.error || new Error('Falha ao gravar versão no banco local.')
        );
      };
    });
  }

  async updateProductionMeta(id, patch) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_PRODUCTIONS], 'readwrite');
      const store = tx.objectStore(STORE_PRODUCTIONS);
      const getReq = store.get(Number(id));
      getReq.onsuccess = () => {
        const existing = getReq.result;
        if (!existing) {
          reject(new Error('Versão não encontrada.'));
          return;
        }
        const updated = {
          ...existing,
          name: patch.name !== undefined ? String(patch.name) : existing.name,
          favorite:
            patch.favorite !== undefined
              ? Boolean(patch.favorite)
              : existing.favorite,
          project_id:
            patch.project_id !== undefined
              ? String(patch.project_id)
              : existing.project_id,
        };
        const putReq = store.put(updated);
        putReq.onsuccess = () => resolve(updated);
        putReq.onerror = (e) => reject(e.target.error);
      };
      getReq.onerror = (e) => reject(e.target.error);
    });
  }

  async getAllProductions() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_PRODUCTIONS], 'readonly');
      const store = tx.objectStore(STORE_PRODUCTIONS);
      const request = store.getAll();

      request.onsuccess = (event) => {
        const items = event.target.result || [];
        items.sort((a, b) => b.timestamp - a.timestamp);
        resolve(items);
      };

      request.onerror = (event) => {
        reject(event.target.error || new Error('Falha ao carregar versões.'));
      };
    });
  }

  async deleteProduction(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_PRODUCTIONS], 'readwrite');
      const store = tx.objectStore(STORE_PRODUCTIONS);
      const request = store.delete(Number(id));

      request.onsuccess = () => resolve(true);
      request.onerror = (event) =>
        reject(event.target.error || new Error('Falha ao remover versão.'));
    });
  }

  async clearAll() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_PRODUCTIONS], 'readwrite');
      const store = tx.objectStore(STORE_PRODUCTIONS);
      const request = store.clear();

      request.onsuccess = () => resolve(true);
      request.onerror = (event) =>
        reject(event.target.error || new Error('Falha ao limpar versões.'));
    });
  }

  // ===========================================================================
  // PROJETOS CRIATIVOS
  // ===========================================================================

  async getAllProjects() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_PROJECTS], 'readonly');
      const store = tx.objectStore(STORE_PROJECTS);
      const req = store.getAll();
      req.onsuccess = async () => {
        let list = req.result || [];
        if (list.length === 0) {
          const defProj = {
            id: 'proj_default',
            name: 'Sessão Principal de Estúdio',
            description: 'Projeto padrão para capturas, originais importados e estudos de luz 360°.',
            archived: false,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          await this.saveProject(defProj);
          list = [defProj];
        }
        list.sort((a, b) => b.updatedAt - a.updatedAt);
        resolve(list);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async saveProject(project) {
    const db = await this.open();
    const record = {
      id: project.id || `proj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
      name: String(project.name || 'Novo Projeto').trim(),
      description: String(project.description || '').trim(),
      archived: Boolean(project.archived),
      createdAt: project.createdAt || Date.now(),
      updatedAt: Date.now(),
    };
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_PROJECTS], 'readwrite');
      const store = tx.objectStore(STORE_PROJECTS);
      const req = store.put(record);
      req.onsuccess = () => resolve(record);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async deleteProject(projectId) {
    if (projectId === 'proj_default') {
      throw new Error('O projeto padrão principal não pode ser excluído.');
    }
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_PROJECTS], 'readwrite');
      const store = tx.objectStore(STORE_PROJECTS);
      const req = store.delete(String(projectId));
      req.onsuccess = () => resolve(true);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  // ===========================================================================
  // RECEITAS DE ILUMINAÇÃO (SCHEMA VERSION 1 + IMPORT/EXPORT JSON VALIDADO)
  // ===========================================================================

  async getAllRecipes() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_RECIPES], 'readonly');
      const store = tx.objectStore(STORE_RECIPES);
      const req = store.getAll();
      req.onsuccess = () => {
        const items = req.result || [];
        items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        resolve(items);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  validateAndNormalizeRecipePayload(raw) {
    if (!raw || typeof raw !== 'object') {
      throw new Error('JSON de receita inválido.');
    }
    const name = String(raw.name || '').trim();
    if (!name) {
      throw new Error('A receita precisa ter um nome válido.');
    }
    const lighting = raw.lighting || raw.lighting_rig;
    if (!lighting || typeof lighting !== 'object' || !lighting.key_light) {
      throw new Error('A receita não contém especificações válidas de iluminação (key_light ausente).');
    }

    const normLight = (src, fallbackAngle, fallbackColor) => ({
      enabled: src?.enabled !== undefined ? Boolean(src.enabled) : true,
      angle_deg: Math.max(0, Math.min(359, Number(src?.angle_deg ?? fallbackAngle) || 0)),
      distance_pct: Math.max(15, Math.min(100, Number(src?.distance_pct ?? 60) || 60)),
      color_label: String(src?.color_label || fallbackColor),
      color_hex: src?.color_hex ? String(src.color_hex) : '#FFD166',
      intensity: Math.max(0, Math.min(100, Number(src?.intensity ?? 75))),
      softness: Math.max(0, Math.min(100, Number(src?.softness ?? 55))),
    });

    return {
      id: raw.id && String(raw.id).startsWith('rcp_')
        ? String(raw.id)
        : `rcp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      schema_version: Number(raw.schema_version || 1),
      name: name.slice(0, 80),
      description: String(raw.description || '').slice(0, 280),
      tags: Array.isArray(raw.tags)
        ? raw.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 8)
        : [],
      lighting: {
        key_light: normLight(lighting.key_light, 315, 'Sol Dourado'),
        rim_light: normLight(lighting.rim_light, 135, 'Frio Noturno'),
        fill_light: normLight(lighting.fill_light, 45, 'Luz do Dia'),
      },
      camera: raw.camera
        ? {
            lens: String(raw.camera.lens || '35mm'),
            aperture: String(raw.camera.aperture || 'f/2.8'),
            film: String(raw.camera.film || 'Kodak Portra 400'),
            aspect_ratio: String(raw.camera.aspect_ratio || '4:5'),
          }
        : null,
      createdAt: raw.createdAt || Date.now(),
      updatedAt: Date.now(),
    };
  }

  async saveRecipe(recipeData) {
    const validated = this.validateAndNormalizeRecipePayload(recipeData);
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_RECIPES], 'readwrite');
      const store = tx.objectStore(STORE_RECIPES);
      const req = store.put(validated);
      req.onsuccess = () => resolve(validated);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async deleteRecipe(recipeId) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_RECIPES], 'readwrite');
      const store = tx.objectStore(STORE_RECIPES);
      const req = store.delete(String(recipeId));
      req.onsuccess = () => resolve(true);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  // ===========================================================================
  // BRAND KITS
  // ===========================================================================

  async getAllBrandKits() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_BRAND_KITS], 'readonly');
      const store = tx.objectStore(STORE_BRAND_KITS);
      const req = store.getAll();
      req.onsuccess = () => {
        const list = req.result || [];
        resolve(list.length ? list : [DEFAULT_BRAND_KIT_SEED]);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async saveBrandKit(kit) {
    const db = await this.open();
    const record = {
      id: kit.id || `bk_${Date.now().toString(36)}`,
      name: String(kit.name || 'Kit de Marca').trim(),
      primary_color: String(kit.primary_color || '#E8B04A'),
      secondary_color: String(kit.secondary_color || '#EDEAE3'),
      safe_margin_pct: Math.max(0, Math.min(20, Number(kit.safe_margin_pct ?? 6))),
      target_formats: Array.isArray(kit.target_formats)
        ? kit.target_formats
        : ['4:5', '9:16', '1:1', '16:9'],
      naming_template:
        String(kit.naming_template || '{project}_{format}_{version}').trim() ||
        '{project}_{format}_{version}',
      updatedAt: Date.now(),
    };
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_BRAND_KITS], 'readwrite');
      const store = tx.objectStore(STORE_BRAND_KITS);
      const req = store.put(record);
      req.onsuccess = () => resolve(record);
      req.onerror = (e) => reject(e.target.error);
    });
  }
}

window.lumenDB = new LumenDatabase();
