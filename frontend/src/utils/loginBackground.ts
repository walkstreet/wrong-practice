const PREF_KEY = "login-bg";
const LEGACY_CUSTOM_KEY = "login-bg-custom";
const DB_NAME = "righton-login";
const STORE_NAME = "kv";
const CUSTOM_IDB_KEY = "login-bg-custom";

export type LoginBgKey = "forest1" | "forest2" | "custom";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("无法打开本地背景库"));
  });
}

async function idbGet(key: string): Promise<string | null> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve(typeof req.result === "string" ? req.result : null);
      req.onerror = () => reject(req.error ?? new Error("读取本地背景失败"));
    });
  } finally {
    db.close();
  }
}

async function idbSet(key: string, value: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("写入本地背景失败"));
    });
  } finally {
    db.close();
  }
}

export function getSavedBgPreference(): string | null {
  try {
    return localStorage.getItem(PREF_KEY);
  } catch {
    return null;
  }
}

export function setSavedBgPreference(key: LoginBgKey): void {
  localStorage.setItem(PREF_KEY, key);
}

function compressImageFile(file: File, maxEdge = 1920, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("当前浏览器无法处理图片"));
        return;
      }
      ctx.drawImage(image, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("无法读取这张图片"));
    };
    image.src = objectUrl;
  });
}

function saveToLocalStorage(dataUrl: string): boolean {
  try {
    localStorage.setItem(LEGACY_CUSTOM_KEY, dataUrl);
    return true;
  } catch {
    try {
      localStorage.removeItem(LEGACY_CUSTOM_KEY);
    } catch {
      /* ignore */
    }
    return false;
  }
}

export async function loadCustomBackground(): Promise<string | null> {
  try {
    const fromIdb = await idbGet(CUSTOM_IDB_KEY);
    if (fromIdb) return fromIdb;
  } catch {
    /* IndexedDB 不可用时回退到 localStorage */
  }
  try {
    const legacy = localStorage.getItem(LEGACY_CUSTOM_KEY);
    if (!legacy) return null;
    try {
      await idbSet(CUSTOM_IDB_KEY, legacy);
    } catch {
      /* 迁移失败也不影响继续用旧数据 */
    }
    return legacy;
  } catch {
    return null;
  }
}

export async function saveCustomBackground(file: File): Promise<string> {
  const candidates = [
    { maxEdge: 1920, quality: 0.8 },
    { maxEdge: 1440, quality: 0.72 },
    { maxEdge: 1280, quality: 0.62 },
  ];

  let lastError: Error | null = null;
  for (const option of candidates) {
    try {
      const dataUrl = await compressImageFile(file, option.maxEdge, option.quality);
      try {
        await idbSet(CUSTOM_IDB_KEY, dataUrl);
        setSavedBgPreference("custom");
        saveToLocalStorage(dataUrl);
        return dataUrl;
      } catch (error) {
        if (saveToLocalStorage(dataUrl)) {
          setSavedBgPreference("custom");
          return dataUrl;
        }
        lastError = error instanceof Error ? error : new Error("本地空间不足");
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("图片处理失败");
    }
  }

  throw lastError ?? new Error("自定义背景保存失败，请换一张更小的图片");
}
