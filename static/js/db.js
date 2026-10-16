/**
 * LUMEN: AI PHOTOGRAPHY STUDIO
 * Persistência Local Resiliente via IndexedDB com suporte a Blobs e Prova de Estúdio
 */

const DB_NAME = 'LumenStudioDB';
const DB_VERSION = 1;
const STORE_NAME = 'productions';

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
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, {
            keyPath: 'id',
            autoIncrement: true,
          });
          store.createIndex('timestamp', 'timestamp', { unique: false });
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

  /**
   * Converte string Base64 em Blob binário para armazenamento otimizado
   */
  base64ToBlob(base64Data, mimeType = 'image/jpeg') {
    const byteCharacters = atob(base64Data);
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

  async saveProduction(productionData) {
    const db = await this.open();
    const imageBlob =
      productionData.imageBlob instanceof Blob
        ? productionData.imageBlob
        : this.base64ToBlob(productionData.image_base64, productionData.mime_type || 'image/jpeg');

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

    const record = {
      timestamp: Date.now(),
      imageBlob,
      mime_type: productionData.mime_type || 'image/jpeg',
      contact_sheet: contactSheet,
      params: {
        brief: String(productionData.params?.brief || ''),
        lens: String(productionData.params?.lens || '35mm'),
        aperture: String(productionData.params?.aperture || 'f/1.4'),
        film: String(productionData.params?.film || 'Kodak Portra 400'),
        aspect_ratio: String(productionData.params?.aspect_ratio || '4:5'),
      },
      direction: {
        camera_optics: String(productionData.direction?.camera_optics || ''),
        final_prompt: String(productionData.direction?.final_prompt || ''),
      },
      qa: {
        score:
          typeof productionData.qa?.score === 'number'
            ? productionData.qa.score
            : null,
        lighting: String(productionData.qa?.lighting || 'Auditoria indisponível'),
        lens_coherence: String(productionData.qa?.lens_coherence || 'Auditoria indisponível'),
        notes: String(productionData.qa?.notes || 'Auditoria indisponível'),
        improvement_suggestion: String(productionData.qa?.improvement_suggestion || ''),
        auto_corrected: Boolean(productionData.qa?.auto_corrected),
      },
      qa_available: Boolean(productionData.qa_available),
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.add(record);

      request.onsuccess = (event) => {
        resolve({ ...record, id: event.target.result });
      };

      request.onerror = (event) => {
        reject(event.target.error || new Error('Falha ao gravar produção no histórico.'));
      };
    });
  }

  async getAllProductions() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = (event) => {
        const items = event.target.result || [];
        items.sort((a, b) => b.timestamp - a.timestamp);
        resolve(items);
      };

      request.onerror = (event) => {
        reject(event.target.error || new Error('Falha ao carregar histórico.'));
      };
    });
  }

  async deleteProduction(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(Number(id));

      request.onsuccess = () => resolve(true);
      request.onerror = (event) =>
        reject(event.target.error || new Error('Falha ao remover item do histórico.'));
    });
  }

  async clearAll() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => resolve(true);
      request.onerror = (event) =>
        reject(event.target.error || new Error('Falha ao limpar o histórico.'));
    });
  }
}

window.lumenDB = new LumenDatabase();
