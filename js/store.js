// All persistent data: designs (with versions), physical tests, notebook entries, settings.
// Stored in localStorage as one JSON document. CAD files themselves go in IndexedDB (see idb.js).
import { FIELD } from './fields.js';

const KEY = 'flugtag-lab-v2';
const OLD_KEY = 'flugtag-lab-v1';

export const db = {
  designs: [],
  tests: [],
  notes: [],
  trash: [],
  currentId: null,
  settings: { quality: 'normal', level: 'basic' },
};

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const today = () => new Date().toISOString().slice(0, 10);

let saveError = null;
export const lastSaveError = () => saveError;

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
    saveError = null;
  } catch (e) {
    saveError = e;
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('flugtag-saved'));
}

export function load() {
  let data = null;
  try { data = JSON.parse(localStorage.getItem(KEY)); } catch { /* corrupt */ }
  if (data && Array.isArray(data.designs)) {
    Object.assign(db, data);
    db.settings = { quality: 'normal', level: 'basic', ...(data.settings || {}) };
  } else {
    migrateV1();
  }
  db.designs.forEach(normalizeDesign);
  if (!getDesign(db.currentId)) db.currentId = db.designs[0]?.id ?? null;
}

// The first version stored one design with defaults. Keep it only if the user changed something.
function migrateV1() {
  let old = null;
  try { old = JSON.parse(localStorage.getItem(OLD_KEY)); } catch { return; }
  if (!old?.values) return;
  const userTouched = Object.values(old.source || {}).some((s) => s === 'entered' || s === 'measured');
  if (!userTouched) return;
  const d = createDesign({ name: 'Imported from first version' });
  for (const [id, v] of Object.entries(old.values)) {
    const src = old.source?.[id] || 'entered';
    if (id === 'headwind') {
      d.values.windSpeed = Math.abs(v);
      d.values.windDir = v >= 0 ? 0 : 180;
      d.source.windSpeed = d.source.windDir = src;
    } else if (FIELD[id]) {
      d.values[id] = v;
      d.source[id] = src;
    }
  }
  d.measured = { ...(old.measured || {}) };
  save();
}

function normalizeDesign(d) {
  d.values ??= {};
  d.source ??= {};
  d.measured ??= {};
  d.components ??= [];
  d.cad ??= null;
  d.cadHistory ??= [];
  d.description ??= '';
}

// ---------------------------------------------------------------------------
// Designs & versions. Labels look like "1", "1.1", "1.2", "2".
// ---------------------------------------------------------------------------
const major = (label) => parseInt(String(label).split('.')[0], 10) || 0;

export function nextMajorLabel() {
  return String(Math.max(0, ...db.designs.map((d) => major(d.label))) + 1);
}

export function nextMinorLabel(label) {
  const m = major(label);
  const minors = db.designs
    .filter((d) => major(d.label) === m && String(d.label).includes('.'))
    .map((d) => parseInt(String(d.label).split('.')[1], 10) || 0);
  return `${m}.${Math.max(0, ...minors) + 1}`;
}

export function designTitle(d) {
  if (!d) return 'No design';
  return `Design ${d.label}${d.name ? ` — ${d.name}` : ''}`;
}

export function createDesign({ name = '', label = nextMajorLabel(), from = null } = {}) {
  const now = new Date().toISOString();
  const d = from
    ? JSON.parse(JSON.stringify(from))
    : { values: {}, source: {}, measured: {}, components: [], cad: null, description: '' };
  Object.assign(d, { id: uid(), label, name, parentId: from ? from.id : null, created: now, updated: now });
  normalizeDesign(d);
  db.designs.push(d);
  db.currentId = d.id;
  save();
  return d;
}

export const newVersion = (src) => createDesign({ from: src, name: src.name, label: nextMinorLabel(src.label) });
export const duplicateAsNew = (src) => createDesign({ from: src, name: `${src.name || 'Copy'} (copy)`, label: nextMajorLabel() });

export function getDesign(id) {
  return db.designs.find((d) => d.id === id) || null;
}

export function current() {
  return getDesign(db.currentId);
}

export function touch(d) {
  d.updated = new Date().toISOString();
  save();
}

export function deleteDesign(id) {
  const d = getDesign(id);
  if (d) toTrash('design', d);
  db.designs = db.designs.filter((x) => x.id !== id);
  if (db.currentId === id) db.currentId = db.designs[0]?.id ?? null;
  save();
}

// ---------------------------------------------------------------------------
// Recently deleted: designs, tests and notes go here first and can be restored.
// Items older than 30 days (or beyond 40 items) are removed for good.
// ---------------------------------------------------------------------------
const TRASH_DAYS = 30;
const TRASH_MAX = 40;
const LISTS = { design: 'designs', test: 'tests', note: 'notes' };

export function toTrash(kind, item) {
  db.trash ??= [];
  db.trash.unshift({ id: uid(), kind, item: JSON.parse(JSON.stringify(item)), deletedAt: new Date().toISOString() });
  const cutoff = Date.now() - TRASH_DAYS * 86400000;
  db.trash = db.trash.filter((t) => Date.parse(t.deletedAt) > cutoff).slice(0, TRASH_MAX);
}

// Removes a test or note (to the bin) and saves.
export function deleteItem(kind, id) {
  const list = LISTS[kind];
  const item = db[list].find((x) => x.id === id);
  if (!item) return;
  toTrash(kind, item);
  db[list] = db[list].filter((x) => x.id !== id);
  save();
}

export function restoreFromTrash(trashId) {
  const t = (db.trash || []).find((x) => x.id === trashId);
  if (!t) return null;
  const list = db[LISTS[t.kind]];
  const item = t.item;
  if (list.some((x) => x.id === item.id)) item.id = uid(); // never overwrite a live item
  if (t.kind === 'design') {
    normalizeDesign(item);
    if (db.designs.some((x) => String(x.label) === String(item.label))) item.label = nextMajorLabel();
  }
  list.push(item);
  db.trash = db.trash.filter((x) => x.id !== trashId);
  save();
  return { kind: t.kind, item };
}

export function purgeTrash(trashId) {
  db.trash = (db.trash || []).filter((x) => trashId && x.id !== trashId);
  save();
}

// Every stored CAD file still referenced by a design (current model or model history) or the bin.
export function cadKeysInUse() {
  const keys = new Set();
  const add = (d) => {
    if (d?.cad?.cadKey) keys.add(d.cad.cadKey);
    for (const h of d?.cadHistory || []) if (h.cadKey) keys.add(h.cadKey);
  };
  db.designs.forEach(add);
  (db.trash || []).filter((t) => t.kind === 'design').forEach((t) => add(t.item));
  return keys;
}

export function sortedDesigns() {
  return [...db.designs].sort((a, b) => {
    const [am, an = 0] = String(a.label).split('.').map(Number);
    const [bm, bn = 0] = String(b.label).split('.').map(Number);
    return am - bm || an - bn;
  });
}

// ---------------------------------------------------------------------------
// Backup / sharing between teammates
// ---------------------------------------------------------------------------
export function exportJSON() {
  return JSON.stringify({ app: 'flugtag-lab', format: 2, exported: new Date().toISOString(), ...db }, null, 2);
}

// Merges designs/tests/notes from a backup file. Items with the same id are replaced.
export function importJSON(text) {
  const data = JSON.parse(text);
  if (data.app !== 'flugtag-lab' || !Array.isArray(data.designs)) throw new Error('This is not a Flugtag Lab backup file.');
  const merge = (list, incoming) => {
    for (const item of incoming || []) {
      if (!item || typeof item.id !== 'string') continue;
      const i = list.findIndex((x) => x.id === item.id);
      if (i >= 0) list[i] = item; else list.push(item);
    }
  };
  // A new design whose version number is already used here gets the next free number
  for (const d of data.designs) {
    if (!d || db.designs.some((x) => x.id === d.id)) continue;
    if (db.designs.some((x) => String(x.label) === String(d.label))) d.label = nextMajorLabel();
  }
  merge(db.designs, data.designs);
  merge(db.tests, data.tests);
  merge(db.notes, data.notes);
  db.designs.forEach(normalizeDesign);
  if (!getDesign(db.currentId)) db.currentId = db.designs[0]?.id ?? null;
  save();
  return { designs: data.designs.length, tests: (data.tests || []).length, notes: (data.notes || []).length };
}
