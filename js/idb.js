// Stores uploaded CAD files in the browser (IndexedDB) so models survive a page refresh.
// Everything is best-effort: if storage fails, the app still works (measurements are kept in localStorage).
const DB_NAME = 'flugtag-lab-cad';
const STORE = 'files';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const idb = await open();
  return new Promise((resolve, reject) => {
    const t = idb.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => { idb.close(); resolve(req?.result); };
    t.onerror = () => { idb.close(); reject(t.error); };
  });
}

export async function putCadFile(key, file) {
  try {
    await tx('readwrite', (s) => s.put({ name: file.name, blob: file }, key));
    return true;
  } catch { return false; }
}

export async function getCadFile(key) {
  try {
    const rec = await tx('readonly', (s) => s.get(key));
    return rec ? new File([rec.blob], rec.name) : null;
  } catch { return null; }
}

export async function allCadKeys() {
  try { return (await tx('readonly', (s) => s.getAllKeys())) || []; } catch { return []; }
}

// Deletes stored CAD files that nothing refers to any more (keysInUse: Set of keys to keep).
export async function cleanupCadFiles(keysInUse) {
  const keys = await allCadKeys();
  for (const k of keys) if (!keysInUse.has(k)) await deleteCadFile(k);
}

export async function deleteCadFile(key) {
  try { await tx('readwrite', (s) => s.delete(key)); } catch { /* ignore */ }
}
