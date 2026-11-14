(function (root) {
  "use strict";

  const DB_NAME = "seraphina_models_db";
  const DB_VERSION = 1;
  const STORE_NAME = "models";
  const CUSTOM_KEY = "custom_vrm";

  function openDb() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB unavailable"));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
    });
  }

  async function saveCustomModel({ name, buffer, size }) {
    const db = await openDb();
    try {
      const copyBuf = buffer instanceof ArrayBuffer ? buffer.slice(0) : new Uint8Array(buffer).buffer;
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const rec = {
          id: CUSTOM_KEY,
          name: String(name || "custom.vrm"),
          size: Number(size || copyBuf.byteLength),
          updatedAt: Date.now(),
          buffer: copyBuf
        };
        store.put(rec);
        tx.oncomplete = () => resolve({ name: rec.name, size: rec.size, updatedAt: rec.updatedAt });
        tx.onerror = () => reject(tx.error || new Error("IndexedDB write failed"));
      });
    } finally {
      db.close();
    }
  }

  async function loadCustomModel() {
    let db;
    try {
      db = await openDb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const req = tx.objectStore(STORE_NAME).get(CUSTOM_KEY);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error || new Error("IndexedDB read failed"));
      });
    } catch {
      return null;
    } finally {
      if (db) db.close();
    }
  }

  async function clearCustomModel() {
    let db;
    try {
      db = await openDb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).delete(CUSTOM_KEY);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error || new Error("IndexedDB delete failed"));
      });
    } catch {
      return false;
    } finally {
      if (db) db.close();
    }
  }

  root.WAIFU_MODEL_STORE = {
    CUSTOM_KEY,
    saveCustomModel,
    loadCustomModel,
    clearCustomModel
  };
})(typeof globalThis !== "undefined" ? globalThis : window);

