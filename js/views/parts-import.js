// "Import parts from CSV" dialog for Parts & balance. Reads mass ledgers such as
// itemID,part,mass_lb,x_ft,y_ft,z_ft and converts units and reference points to the app's
// "kg, metres from the nose, metres above the lowest point".
import { uid } from '../store.js';
import { esc, toast } from '../ui.js';

const LEN = { m: 1, mm: 0.001, cm: 0.01, in: 0.0254, ft: 0.3048 };
const MASS = { kg: 1, g: 0.001, lb: 0.45359237, lbs: 0.45359237, oz: 0.028349523 };

export function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  const t = String(text).replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',' || ch === ';' || ch === '\t') { row.push(f.trim()); f = ''; }
    else if (ch === '\n') { row.push(f.trim()); rows.push(row); row = []; f = ''; }
    else if (ch !== '\r') f += ch;
  }
  if (f.length || row.length) { row.push(f.trim()); rows.push(row); }
  return rows.filter((r) => r.some((c) => c !== ''));
}

// Finds which column holds what, and the unit written in the header (e.g. "mass_lb", "x (ft)").
export function detectColumns(header) {
  const h = header.map((c) => c.toLowerCase().trim());
  const unitOf = (c, table) => { const m = c.match(/[_\s(\[]([a-z]+)\)?\]?$/); return m && table[m[1]] ? m[1] : null; };
  const find = (re) => h.findIndex((c) => re.test(c));
  const col = {
    id: find(/^(item ?id|part ?id|id)$/),
    name: find(/^(part|name|component|description|label|item)( name)?$/),
    mass: find(/^(mass|weight|estimated[ _]mass)/),
    qty: find(/^(qty|quantity|count)$/),
    x: find(/^x([ _(\[].*)?$/),
    z: find(/^z([ _(\[].*)?$/),
    height: find(/^(height|y_?height)/),
    material: find(/^material/),
    notes: find(/^(notes?|comment|spec)/),
  };
  if (col.name < 0) col.name = find(/part|name|desc/);
  return {
    col,
    massUnit: col.mass >= 0 ? unitOf(h[col.mass], MASS) : null,
    lenUnit: col.x >= 0 ? unitOf(h[col.x], LEN) : null,
  };
}

export function openPartsImport(ctx, onDone) {
  let dlg = document.getElementById('parts-import');
  if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'parts-import'; dlg.className = 'converter wide-dialog'; document.body.appendChild(dlg); }
  dlg.innerHTML = `
    <form method="dialog" id="pi-form">
      <div class="panel-head"><h2>Import parts from a CSV file</h2><button class="btn ghost small" value="cancel">Close</button></div>
      <p class="hint">Use a spreadsheet saved as CSV with a header row — for example a mass ledger with columns like <code>part, mass_lb, x_ft, z_ft</code>.
        Units written in the column names (lb, kg, ft, in, m) are detected automatically.</p>
      <div class="row-actions"><label class="btn small">Choose CSV file… <input type="file" id="pi-file" accept=".csv,.txt" hidden></label><span id="pi-fname" class="muted small"></span></div>
      <div id="pi-setup"></div>
      <div class="row-actions" style="margin-top:12px">
        <button class="btn primary" value="ok" id="pi-ok" disabled>Import</button>
        <button class="btn" value="cancel">Cancel</button>
      </div>
    </form>`;
  let rows = null, det = null;
  const $ = (s) => dlg.querySelector(s);
  $('#pi-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    $('#pi-fname').textContent = file.name;
    rows = parseCSV(await file.text());
    if (rows.length < 2) { $('#pi-setup').innerHTML = '<p class="error-msg">No data rows found.</p>'; return; }
    det = detectColumns(rows[0]);
    if (det.col.mass < 0) { $('#pi-setup').innerHTML = '<p class="error-msg">Could not find a mass/weight column in the header.</p>'; return; }
    const sel = (id, table, val) => `<select id="${id}">${Object.keys(table).map((k) => `<option ${k === val ? 'selected' : ''}>${k}</option>`).join('')}</select>`;
    $('#pi-setup').innerHTML = `
      <p class="small">Found <strong>${rows.length - 1}</strong> rows. Columns: mass → <code>${esc(rows[0][det.col.mass])}</code>${det.col.x >= 0 ? `, position → <code>${esc(rows[0][det.col.x])}</code>` : ', no position column'}${det.col.z >= 0 ? `, vertical → <code>${esc(rows[0][det.col.z])}</code>` : ''}.</p>
      <div class="form-grid">
        <label>Mass unit ${sel('pi-mu', MASS, det.massUnit || 'kg')}</label>
        <label>Length unit ${sel('pi-lu', LEN, det.lenUnit || 'm')}</label>
        <label>Masses are <select id="pi-src"><option value="estimated">Design estimates / guesses</option><option value="entered">From spec / calculation</option><option value="measured">Weighed</option></select></label>
        <label>Import mode <select id="pi-mode"><option value="add">Add to the current list</option><option value="replace">Replace the current list</option></select></label>
      </div>
      <fieldset class="field-group"><legend>Where are positions measured from?</legend>
        <label class="check-row"><input type="radio" name="pi-datum" value="nose" checked> From the nose (front-most point) — same as this app</label>
        <label class="check-row"><input type="radio" name="pi-datum" value="ref"> From another reference point that is <input id="pi-off" class="short" placeholder="e.g. 2.103"> (same length unit) <em>behind</em> the nose</label>
        <p class="hint">Example: a ledger measured from the wing's leading edge at the centreline. If you have the CAD model, the nose offset is how far the front-most point is ahead of that reference.</p>
      </fieldset>
      ${det.col.z >= 0 ? `<fieldset class="field-group"><legend>Vertical positions (z, up = positive)</legend>
        <label class="check-row"><input type="radio" name="pi-v" value="ref" checked> Measured from the same reference; the lowest point of the craft is <input id="pi-low" class="short" placeholder="e.g. 3.703"> below it</label>
        <label class="check-row"><input type="radio" name="pi-v" value="bottom"> Already "height above the lowest point"</label>
        <label class="check-row"><input type="radio" name="pi-v" value="skip"> Don't import heights</label>
      </fieldset>` : ''}
      <p class="hint">Rows without a mass are imported with no mass (they won't count until you fill one in).</p>`;
    $('#pi-ok').disabled = false;
  });
  dlg.onclose = () => {
    if (dlg.returnValue !== 'ok' || !rows || !det) return;
    const mu = MASS[$('#pi-mu').value], lu = LEN[$('#pi-lu').value];
    const src = $('#pi-src').value;
    const datum = dlg.querySelector('input[name=pi-datum]:checked').value;
    const off = datum === 'ref' ? parseFloat($('#pi-off').value) : 0;
    if (datum === 'ref' && !Number.isFinite(off)) { toast('Enter how far the reference point is behind the nose — nothing was imported.', 'error'); return; }
    const vMode = dlg.querySelector('input[name=pi-v]:checked')?.value || 'skip';
    const low = vMode === 'ref' ? parseFloat($('#pi-low').value) : 0;
    if (vMode === 'ref' && !Number.isFinite(low)) { toast('Enter how far the lowest point is below the reference — nothing was imported.', 'error'); return; }
    const num = (row, i) => { if (i < 0) return NaN; const v = parseFloat(String(row[i]).replace(/,/g, '')); return Number.isFinite(v) ? v : NaN; };
    const c = det.col;
    const parts = rows.slice(1).map((row) => {
      const m = num(row, c.mass), x = num(row, c.x), z = num(row, c.z), h = num(row, c.height);
      const name = [c.id >= 0 ? row[c.id] : '', c.name >= 0 ? row[c.name] : ''].filter(Boolean).join(' ').trim() || 'Imported part';
      let y = null;
      if (vMode === 'ref' && Number.isFinite(z)) y = +((z + low) * lu).toFixed(4);
      else if (vMode === 'bottom' && Number.isFinite(Number.isFinite(h) ? h : z)) y = +((Number.isFinite(h) ? h : z) * lu).toFixed(4);
      return {
        id: uid(), name: name.slice(0, 60), category: guessCategory(name), mass: Number.isFinite(m) ? +(m * mu).toFixed(4) : null,
        qty: Number.isFinite(num(row, c.qty)) ? num(row, c.qty) : 1, massSource: src,
        material: c.material >= 0 ? String(row[c.material]).slice(0, 60) : '', dims: '',
        x: Number.isFinite(x) ? +((x + off) * lu).toFixed(4) : null, y,
        notes: (`Imported from ${$('#pi-fname').textContent}${datum === 'ref' ? ` (position converted: reference point is ${off} ${$('#pi-lu').value} behind the nose)` : ''}. ` + (c.notes >= 0 ? row[c.notes] : '')).slice(0, 200),
      };
    });
    if ($('#pi-mode').value === 'replace') ctx.d.components = parts;
    else ctx.d.components.push(...parts);
    toast(`Imported ${parts.length} parts.`);
    onDone();
  };
  dlg.returnValue = '';
  dlg.showModal();
}

function guessCategory(name) {
  const n = name.toLowerCase();
  if (/spar|rib|wing|skin|covering|leading|trailing|longeron/.test(n)) return 'Main wing';
  if (/tail|rudder|elevator|fin|tip/.test(n)) return 'Tail';
  if (/wheel|axle|skid|landing|gear/.test(n)) return 'Landing structure';
  if (/bolt|nut|pin|washer|fastener|terminal|turnbuckle|hardware|adhesive|sealant/.test(n)) return 'Fasteners & joints';
  if (/decor|label|paint|vinyl/.test(n)) return 'Decorations';
  if (/frame|rail|tube|strut|cabane|yoke|saddle|gusset|stay|brace|cradle/.test(n)) return 'Frame';
  return 'Other';
}
