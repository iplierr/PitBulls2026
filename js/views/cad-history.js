// CAD model history: every replaced or removed model is kept (up to 10 per design) so the team can
// switch back after uploading the wrong file, compare an updated model with the previous one, or delete old ones.
import { cadKeysInUse } from '../store.js';
import { cleanupCadFiles } from '../idb.js';
import * as history from '../history.js';
import { esc, fmt, sig, toast } from '../ui.js';

const MAX_HISTORY = 10;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const stamp = () => new Date().toISOString();

// Move the current model into history (used when replacing or removing it).
export function archiveCurrent(d, why) {
  if (!d.cad) return;
  d.cadHistory = [{ ...d.cad, archivedAt: stamp(), archivedWhy: why }, ...(d.cadHistory || [])].slice(0, MAX_HISTORY);
}

export function cleanupFiles() {
  cleanupCadFiles(new Set([...cadKeysInUse(), ...history.referencedCadKeys()]));
}

const partForRole = (cad, role) => cad?.analysis?.parts?.find((p) => cad.roles?.[p.i] === role);

// "What changed since the previous model?" + list of older models.
export function historyHTML(d) {
  const list = d.cadHistory || [];
  if (!list.length) return '';
  const prev = list.find((h) => h.analysis);
  const cur = d.cad;
  let compare = '';
  if (cur?.analysis && prev) {
    const a = cur.analysis, b = prev.analysis;
    const wa = partForRole(cur, 'wing'), wb = partForRole(prev, 'wing');
    const rows = [
      ['Overall width', b.size.x, a.size.x, 'm'],
      ['Overall length', b.size.z, a.size.z, 'm'],
      ['Overall height', b.size.y, a.size.y, 'm'],
      ['Surface area', b.surfaceArea, a.surfaceArea, 'm²'],
      ['Enclosed volume', b.volume, a.volume, 'm³'],
      ['Top-view area (whole craft)', b.topArea?.value, a.topArea?.value, 'm²'],
      ['Separate parts', b.partCount, a.partCount, ''],
      ['Main wing top-view area', wb?.topArea?.value, wa?.topArea?.value, 'm²'],
    ].filter(([, x, y]) => isNum(x) || isNum(y));
    compare = `
      <h3>What changed since the previous model (${esc(prev.fileName)})</h3>
      <table class="list-table"><thead><tr><th></th><th>Previous</th><th>Current</th><th>Change</th></tr></thead><tbody>
        ${rows.map(([label, x, y, u]) => {
          const dl = isNum(x) && isNum(y) ? y - x : NaN;
          return `<tr><td>${label}</td><td class="num">${isNum(x) ? `${sig(x, 4)} ${u}` : '<span class="muted">not available</span>'}</td>
            <td class="num">${isNum(y) ? `${sig(y, 4)} ${u}` : '<span class="muted">not available</span>'}</td>
            <td class="num">${isNum(dl) ? `${dl >= 0 ? '+' : ''}${sig(dl, 3)} ${u}${x ? ` (${dl >= 0 ? '+' : ''}${fmt(dl / Math.abs(x) * 100, 1)}%)` : ''}` : '–'}</td></tr>`;
        }).join('')}
      </tbody></table>
      <p class="hint">A smaller volume usually means material was removed (for example pocketing). The design's inputs are <strong>not</strong> changed automatically — use
        "Apply selected measurements" above to copy the new model's measurements into the design.</p>`;
  }
  return `
    <div class="panel section" id="cad-history">
      <h2>Model history</h2>
      <p class="hint">Older models are kept here (up to ${MAX_HISTORY}). Switch back if the wrong file was uploaded, or delete ones you no longer need.</p>
      ${compare}
      <table class="list-table"><thead><tr><th>File</th><th>Put aside</th><th>Size (W × L × H)</th><th></th></tr></thead><tbody>
        ${list.map((h, i) => `<tr>
          <td>${esc(h.fileName)} ${h.cadKey ? '' : '<small class="muted">(file not stored)</small>'}</td>
          <td class="small muted">${esc((h.archivedAt || '').slice(0, 16).replace('T', ' '))} ${h.archivedWhy ? `· ${esc(h.archivedWhy)}` : ''}</td>
          <td class="num">${h.analysis ? `${fmt(h.analysis.size.x, 2)} × ${fmt(h.analysis.size.z, 2)} × ${fmt(h.analysis.size.y, 2)} m` : '–'}</td>
          <td class="row-actions"><button class="btn tiny" data-hist-use="${i}">Use this model</button><button class="btn tiny danger" data-hist-del="${i}">Delete</button></td>
        </tr>`).join('')}
      </tbody></table>
    </div>`;
}

// Handles clicks inside the history panel. Returns true if it handled the click.
export function onHistoryClick(e, ctx) {
  const d = ctx.d;
  const use = e.target.closest('[data-hist-use]');
  const del = e.target.closest('[data-hist-del]');
  if (use) {
    const i = Number(use.dataset.histUse);
    const chosen = d.cadHistory[i];
    d.cadHistory.splice(i, 1);
    archiveCurrent(d, 'switched to an older model');
    d.cad = { ...chosen };
    delete d.cad.archivedAt;
    delete d.cad.archivedWhy;
    toast(`Now using ${chosen.fileName}. The design's inputs were not changed — re-apply measurements if needed.`);
    ctx.changed(null);
    ctx.rerender();
    return true;
  }
  if (del) {
    const i = Number(del.dataset.histDel);
    const h = d.cadHistory[i];
    if (!confirm(`Delete ${h.fileName} from the model history?\n(Undo can still bring it back while this page stays open.)`)) return true;
    d.cadHistory.splice(i, 1);
    ctx.changed(null);
    cleanupFiles();
    toast('Old model deleted.');
    return true;
  }
  return false;
}

// "Remove model" dialog for a wrong upload.
export function removeModelDialog(ctx) {
  const d = ctx.d;
  if (!d.cad) return;
  const measuredIds = Object.keys(d.measured || {}).filter((id) => d.source[id] === 'measured');
  const cadParts = d.components.filter((c) => c.cadPart !== undefined && c.cadPart !== null);
  let dlg = document.getElementById('remove-model-dialog');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'remove-model-dialog';
    dlg.className = 'converter';
    document.body.appendChild(dlg);
  }
  dlg.innerHTML = `
    <form method="dialog">
      <h2>Remove ${esc(d.cad.fileName)}?</h2>
      <p class="hint">The model moves to <strong>Model history</strong>, so you can switch back to it later. Undo (top of the page) also works.</p>
      <label class="check-row"><input type="checkbox" name="meas" ${measuredIds.length ? 'checked' : 'disabled'}> Also clear the ${measuredIds.length} value(s) it put into the design (fields marked Measured)</label>
      <label class="check-row"><input type="checkbox" name="parts" ${cadParts.length ? '' : 'disabled'}> Also remove the ${cadParts.length} part(s) copied from it into Mass &amp; balance</label>
      <div class="row-actions" style="margin-top:12px">
        <button class="btn primary" value="ok">Remove model</button>
        <button class="btn" value="cancel">Cancel</button>
      </div>
    </form>`;
  dlg.onclose = () => {
    if (dlg.returnValue !== 'ok') return;
    const f = dlg.querySelector('form');
    archiveCurrent(d, 'removed');
    d.cad = null;
    if (f.meas.checked) {
      for (const id of measuredIds) { delete d.values[id]; delete d.source[id]; }
      d.measured = {};
    }
    if (f.parts.checked) d.components = d.components.filter((c) => !cadParts.includes(c));
    ctx.app.viewer.loadedKey = null;
    toast('Model removed (kept in Model history).');
    ctx.changed(null);
    ctx.rerender();
  };
  dlg.returnValue = '';
  dlg.showModal();
}
