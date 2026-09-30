// Undo / redo for each design (kept in memory while the page is open).
// Every change to a design is recorded; rapid changes (e.g. typing "8.5") are merged into one step.
const H = new Map(); // design id -> { undo: [], redo: [], last, t }
const MAX = 60;
const MERGE_MS = 800;

const snap = (d) => JSON.stringify(d, (k, v) => (k === 'updated' ? undefined : v));

function state(d) {
  if (!H.has(d.id)) H.set(d.id, { undo: [], redo: [], last: snap(d), t: 0 });
  return H.get(d.id);
}

export function track(d) {
  state(d);
}

// Call after the design has changed.
export function record(d) {
  const h = state(d);
  const now = snap(d);
  if (now === h.last) return;
  const t = Date.now();
  if (t - h.t > MERGE_MS || !h.undo.length) {
    h.undo.push(h.last);
    if (h.undo.length > MAX) h.undo.shift();
  }
  h.last = now;
  h.t = t;
  h.redo = [];
}

function restore(d, s) {
  const o = JSON.parse(s);
  const keep = { id: d.id, created: d.created };
  for (const k of Object.keys(d)) delete d[k];
  Object.assign(d, o, keep, { updated: new Date().toISOString() });
}

export function undo(d) {
  const h = state(d);
  if (!h.undo.length) return false;
  h.redo.push(snap(d));
  restore(d, h.undo.pop());
  h.last = snap(d);
  h.t = 0;
  return true;
}

export function redo(d) {
  const h = state(d);
  if (!h.redo.length) return false;
  h.undo.push(snap(d));
  restore(d, h.redo.pop());
  h.last = snap(d);
  h.t = 0;
  return true;
}

export const canUndo = (d) => state(d).undo.length > 0;
export const canRedo = (d) => state(d).redo.length > 0;

// CAD files referenced by undo/redo steps must not be cleaned up while the page is open.
export function referencedCadKeys() {
  const keys = new Set();
  for (const h of H.values()) {
    for (const s of [...h.undo, ...h.redo, h.last]) {
      for (const m of s.matchAll(/"cadKey":"([^"]+)"/g)) keys.add(m[1]);
    }
  }
  return keys;
}
