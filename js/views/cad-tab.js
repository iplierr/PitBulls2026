// CAD tab: upload STL/GLB, orientation/units, geometry analysis, part roles, apply measurements.
import { db, uid, touch } from '../store.js';
import { FIELD } from '../fields.js';
import { analyzeCad, cadMeasurements } from '../cad-analysis.js';
import { putCadFile, getCadFile } from '../idb.js';
import { archiveCurrent, historyHTML, onHistoryClick, removeModelDialog } from './cad-history.js';
import { esc, fmt, sig, badge, toast } from '../ui.js';

const ROLES = [['', '—'], ['wing', 'Main wing'], ['htail', 'Horizontal tail'], ['vtail', 'Vertical tail (fin)'], ['body', 'Fuselage / frame'], ['other', 'Other']];
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

let P = null; // { panel, ctx }

export function render(panel, ctx) {
  P = { panel, ctx };
  const cad = ctx.d.cad;
  panel.innerHTML = `
    <div class="upload-layout">
      <div class="panel upload-side">
        <h2>1. Choose a file</h2>
        <label id="dropzone" class="dropzone" tabindex="0">
          <input type="file" id="file-input" accept=".stl,.glb" hidden>
          <strong>${cad ? 'Replace model: drop' : 'Drop'} an STL or GLB file here</strong>
          <span>or click to browse</span>
        </label>
        <p id="file-status" class="status">${cad ? `Current model: <strong>${esc(cad.fileName)}</strong>` : ''}</p>
        ${cad ? `<div class="fix-box">
          <strong>Uploaded the wrong file?</strong> Drop the right one above — the current model is kept in Model history.
          <div class="row-actions" style="margin-top:6px"><button class="btn small danger" id="remove-model" type="button">Remove model…</button></div>
        </div>` : (ctx.d.cadHistory?.length ? '<p class="hint">Earlier models are listed in <strong>Model history</strong> below.</p>' : '')}

        <h2>2. Check units &amp; orientation</h2>
        <div class="form-row">
          <label for="unit-select">File units</label>
          <select id="unit-select">
            <option value="0.001">Millimetres (mm)</option>
            <option value="0.01">Centimetres (cm)</option>
            <option value="1">Metres (m)</option>
            <option value="0.0254">Inches (in)</option>
            <option value="0.3048">Feet (ft)</option>
          </select>
        </div>
        <div class="form-row">
          <label for="up-select">Up direction in file</label>
          <select id="up-select"><option value="y">Y is up</option><option value="z">Z is up</option></select>
        </div>
        <div class="row-actions">
          <button id="swap-axes" class="btn ghost small" type="button">Swap wingspan ↔ length</button>
          <button id="flip-nose" class="btn ghost small" type="button">Flip nose direction</button>
        </div>
        <p class="hint">STL files have no units — pick what your CAD tool exported. Grid squares are <strong>1 m</strong>.
          The <span class="nose-tag">red cone</span> marks the nose; flip it if it is at the tail. Wingspan is assumed to be the wider horizontal direction.</p>

        <h2>3. Measured size</h2>
        <table class="dims"><tbody>
          <tr><th>Wingspan (overall width)</th><td id="dim-span">–</td></tr>
          <tr><th>Length</th><td id="dim-length">–</td></tr>
          <tr><th>Height</th><td id="dim-height">–</td></tr>
        </tbody></table>
      </div>
      <div class="panel viewer-panel">
        <div class="viewer-host" id="cad-viewer"><div class="viewer-empty" id="cad-empty">${cad ? 'Loading saved model…' : 'No model loaded yet'}</div></div>
        <p class="hint">Drag to rotate · right-drag to pan · scroll to zoom</p>
      </div>
    </div>
    <div id="cad-analysis"></div>
    <div id="cad-history-host"></div>`;

  const viewer = ctx.app.viewer;
  viewer.mount(panel.querySelector('#cad-viewer'));
  viewer.hideAll();

  const unit = panel.querySelector('#unit-select'), up = panel.querySelector('#up-select');
  if (cad) { unit.value = cad.units; up.value = cad.up; }

  const input = panel.querySelector('#file-input');
  const dz = panel.querySelector('#dropzone');
  input.addEventListener('change', () => handleFile(input.files[0]));
  dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', (e) => handleFile(e.dataTransfer.files[0]));

  const changeTransform = (fn) => { const c = P.ctx.d.cad; if (!c) return; fn(c); retransform(true); };
  unit.addEventListener('change', () => changeTransform((c) => { c.units = unit.value; }));
  up.addEventListener('change', () => changeTransform((c) => { c.up = up.value; }));
  panel.querySelector('#swap-axes').addEventListener('click', () => changeTransform((c) => { c.swapped = !c.swapped; }));
  panel.querySelector('#flip-nose').addEventListener('click', () => changeTransform((c) => { c.noseFlip = !c.noseFlip; }));

  panel.querySelector('#cad-analysis').addEventListener('change', onAnalysisChange);
  panel.querySelector('#cad-analysis').addEventListener('click', onAnalysisClick);
  panel.querySelector('#cad-history-host').addEventListener('click', (e) => onHistoryClick(e, P.ctx));
  panel.querySelector('#remove-model')?.addEventListener('click', () => removeModelDialog(P.ctx));

  if (cad) restoreSaved();
  else renderAnalysis();
}

export function leave() {
  P = null;
}

export function update() {
  if (P) renderAnalysis();
}

function setStatus(html, kind = '') {
  const el = P.panel.querySelector('#file-status');
  el.innerHTML = html;
  el.className = `status ${kind}`;
}

async function restoreSaved() {
  const { d, app } = P.ctx;
  const viewer = app.viewer;
  if (viewer.hasCad && viewer.loadedKey === d.cad.cadKey) {
    retransform(false);
    return;
  }
  const file = d.cad.cadKey ? await getCadFile(d.cad.cadKey) : null;
  if (!P || P.ctx.d !== d) return;
  if (!file) {
    P.panel.querySelector('#cad-empty').textContent = 'The CAD file is not stored in this browser (for example after importing a backup). Measurements below are still saved — re-upload the file to view it.';
    renderAnalysis();
    return;
  }
  try {
    await viewer.loadFile(file);
    viewer.loadedKey = d.cad.cadKey;
    retransform(false);
  } catch (err) {
    setStatus(`Could not reload the saved model: ${esc(err.message)}`, 'error');
    renderAnalysis();
  }
}

async function handleFile(file) {
  if (!file) return;
  const { d, app } = P.ctx;
  setStatus(`Loading ${esc(file.name)}…`);
  try {
    const ext = file.name.split('.').pop().toLowerCase();
    const { triangles } = await app.viewer.loadFile(file);
    const key = uid();
    const stored = await putCadFile(key, file);
    app.viewer.loadedKey = key;
    const unitSel = P.panel.querySelector('#unit-select');
    if (ext === 'glb') unitSel.value = '1'; // glTF is defined in metres
    const hadModel = !!d.cad;
    archiveCurrent(d, 'replaced by ' + file.name);
    d.cad = { fileName: file.name, fileSize: file.size, cadKey: stored ? key : null, units: unitSel.value,
      up: P.panel.querySelector('#up-select').value, swapped: false, noseFlip: false, roles: {}, analysis: null };
    const big = triangles > 500000 ? ' Large model: rotating may be slow on older laptops (try 3D quality: Low).' : '';
    setStatus(`Loaded <strong>${esc(file.name)}</strong> (${triangles.toLocaleString()} triangles).${big}${stored ? '' : ' (Could not store the file in the browser — you will need to re-upload it after a refresh.)'}${hadModel ? ' The previous model is in Model history below.' : ''}`, 'ok');
    retransform(true);
  } catch (err) {
    console.error(err);
    setStatus(`Could not load this file: ${esc(err.message || err)}`, 'error');
  }
}

// Applies units/orientation to the 3D model; optionally re-runs the geometry analysis.
function retransform(reanalyze) {
  const { d, app } = P.ctx;
  const c = d.cad;
  const viewer = app.viewer;
  if (!viewer.hasCad) return renderAnalysis();
  viewer.showCad(true);
  P.panel.querySelector('#cad-empty').hidden = true;
  const size = viewer.setCadTransform(parseFloat(c.units), c.up, c.swapped, c.noseFlip);
  showNose(size);
  P.panel.querySelector('#dim-span').textContent = `${fmt(size.x, 2)} m`;
  P.panel.querySelector('#dim-length').textContent = `${fmt(size.z, 2)} m`;
  P.panel.querySelector('#dim-height').textContent = `${fmt(size.y, 2)} m`;
  if (!reanalyze && c.analysis) return renderAnalysis();
  P.panel.querySelector('#cad-analysis').innerHTML = '<div class="panel section"><p>Analysing geometry… (large models can take a few seconds)</p></div>';
  setTimeout(() => {
    if (!P || P.ctx.d !== d) return;
    const t0 = performance.now();
    c.analysis = analyzeCad(viewer.inner);
    c.analysis.ms = Math.round(performance.now() - t0);
    if (!Object.keys(c.roles || {}).length && isNum(c.analysis.wingGuess)) {
      c.roles = { [c.analysis.wingGuess]: 'wing' };
      c.wingAutoGuessed = true;
    }
    touch(d);
    P.ctx.changed(null);
  }, 30);
}

// Small red cone at the nose so users can check the orientation.
function showNose(size) {
  P.ctx.app.viewer.setMarkers([{ kind: 'nose', x: 0, y: size.y / 2, m: 0 }]);
}

function onAnalysisChange(e) {
  const d = P.ctx.d;
  if (e.target.matches('select[data-role]')) {
    const i = e.target.dataset.role;
    d.cad.roles = { ...(d.cad.roles || {}) };
    // Only one part per role for wing/tails
    if (['wing', 'htail', 'vtail'].includes(e.target.value)) {
      for (const k of Object.keys(d.cad.roles)) if (d.cad.roles[k] === e.target.value) delete d.cad.roles[k];
    }
    if (e.target.value) d.cad.roles[i] = e.target.value; else delete d.cad.roles[i];
    d.cad.wingAutoGuessed = false;
    P.ctx.changed(null);
  }
}

function onAnalysisClick(e) {
  const d = P.ctx.d;
  if (e.target.id === 'apply-meas') {
    const list = cadMeasurements(d.cad.analysis, d.cad.roles);
    const chosen = [...P.panel.querySelectorAll('input[data-meas]:checked')].map((x) => x.dataset.meas);
    for (const m of list) {
      if (!chosen.includes(m.id)) continue;
      const f = FIELD[m.id];
      const v = Math.min(Math.max(+m.value.toPrecision(4), f.min), f.max);
      d.values[m.id] = v;
      d.source[m.id] = 'measured';
      d.measured[m.id] = v;
    }
    toast(`Applied ${chosen.length} measurement(s) to Design ${d.label}.`);
    P.ctx.changed(null);
  }
  if (e.target.id === 'parts-to-mass') {
    const an = d.cad.analysis;
    let added = 0;
    for (const p of an.parts) {
      const role = d.cad.roles?.[p.i];
      const name = role ? ROLES.find((r) => r[0] === role)[1] : p.name;
      if (d.components.some((c) => c.cadPart === p.i)) continue;
      d.components.push({ id: uid(), name, category: role === 'wing' ? 'Main wing' : role === 'htail' || role === 'vtail' ? 'Tail' : role === 'body' ? 'Frame' : 'Other',
        mass: null, qty: 1, massSource: 'measured', material: '', dims: `${fmt(p.size.x, 2)} × ${fmt(p.size.z, 2)} × ${fmt(p.size.y, 2)} m`,
        x: +((p.fromNose[0] + p.fromNose[1]) / 2).toFixed(3), y: +((p.height[0] + p.height[1]) / 2).toFixed(3),
        notes: 'Position = centre of the CAD part\'s bounding box (measured). Mass still needed.', cadPart: p.i, cadVolume: p.volume ?? null });
      added++;
    }
    toast(added ? `Added ${added} part(s) to the Mass & balance list. Enter their masses there.` : 'All parts are already in the list.');
    P.ctx.changed(null);
  }
}

// Flugtag craft normally have the main wing ahead of the tail. If the assigned parts say otherwise, the nose is probably flipped.
function orientationWarning(an, roles) {
  const part = (role) => an.parts.find((p) => roles[p.i] === role);
  const mid = (p) => (p.fromNose[0] + p.fromNose[1]) / 2;
  const wing = part('wing'), tail = part('htail') || part('vtail');
  if (wing && tail && mid(tail) < mid(wing)) return 'the tail is measured as being in front of the main wing.';
  if (wing && !tail && mid(wing) > 0.6 * an.size.z) return 'the main wing is in the rear part of the model.';
  return '';
}

function renderAnalysis() {
  const host = P.panel.querySelector('#cad-analysis');
  const d = P.ctx.d;
  P.panel.querySelector('#cad-history-host').innerHTML = historyHTML(d);
  const an = d.cad?.analysis;
  if (!an) { host.innerHTML = ''; return; }
  const roles = d.cad.roles || {};
  const m = (label, value, how, src = 'measured') => `<tr><th>${label}</th><td class="num">${value}</td><td>${badge(src)}</td><td class="small muted">${how}</td></tr>`;
  const na = (label, why) => `<tr><th>${label}</th><td class="muted">Not available from CAD</td><td>${badge('missing')}</td><td class="small muted">${why}</td></tr>`;
  const c = an.centroid;
  const meas = cadMeasurements(an, roles);
  const orientWarn = orientationWarning(an, roles);

  host.innerHTML = `
    <div class="panel section">
      <h2>Geometry analysis</h2>
      ${orientWarn ? `<div class="verdict warn"><strong>Check the nose direction:</strong> ${orientWarn} If the red cone is at the tail, click <strong>Flip nose direction</strong> — every "from nose" position depends on it.</div>` : ''}
      <p class="hint">From <strong>${esc(d.cad.fileName)}</strong> · ${an.triangles.toLocaleString()} triangles · orientation: ${d.cad.up.toUpperCase()} up${d.cad.swapped ? ', span/length swapped' : ''}${d.cad.noseFlip ? ', nose flipped' : ''}${an.ms ? ` · analysed in ${an.ms} ms` : ''}</p>
      <div class="table-wrap"><table class="meas-table"><tbody>
        ${m('Overall width', `${fmt(an.size.x, 3)} m`, 'Bounding box, side to side.')}
        ${m('Overall length', `${fmt(an.size.z, 3)} m`, 'Bounding box, nose to tail.')}
        ${m('Overall height', `${fmt(an.size.y, 3)} m`, 'Bounding box, bottom to top.')}
        ${m('Surface area (all surfaces)', `${sig(an.surfaceArea, 4)} m²`, 'Sum of all triangle areas. Useful for estimating covering material.')}
        ${an.volume !== null ? m('Enclosed volume', `${sig(an.volume, 4)} m³`, 'Geometric volume of closed shapes. This is NOT mass: real parts are hollow or made of different materials.')
          : na('Enclosed volume', an.closed === false ? 'The mesh has gaps or open edges, so the enclosed volume cannot be trusted.' : 'Skipped for very large models.')}
        ${c ? m(c.kind === 'volume' ? 'Geometric centre (volume centroid)' : 'Geometric centre (surface centroid)', `${fmt(c.fromNose, 2)} m from nose, ${fmt(c.height, 2)} m up, ${fmt(c.lateral, 2)} m off-centre`,
          'Centre of the SHAPE — not the centre of mass. Materials, hollow parts and the pilot change the real centre of mass (see Mass & balance).') : ''}
        ${m('Top-view area of whole craft', `${sig(an.topArea.value, 3)} ± ${sig(an.topArea.pm, 2)} m²`, 'Silhouette seen from above (includes body and tail, so it is larger than the wing area).')}
        ${m('Side-view area of whole craft', `${sig(an.sideArea.value, 3)} ± ${sig(an.sideArea.pm, 2)} m²`, 'Silhouette seen from the side (relevant for crosswind).')}
        ${m('Separate parts found', an.partCount ?? '–', esc(an.partsNote || 'Disconnected bodies in the file.'))}
        ${na('Mass / centre of mass', 'STL and GLB files contain no material or mass data. Enter masses in Mass & balance.')}
        ${na('Lift / drag coefficients', 'Cannot be derived from shape alone in this tool. Enter them, or use explicitly-labelled assumptions.')}
      </tbody></table></div>
    </div>

    ${an.parts.length > 1 ? `
    <div class="panel section">
      <h2>Parts — tell the app which part is which</h2>
      <p class="hint">Assign roles so the app can measure the wing and tail individually. ${d.cad.wingAutoGuessed ? '<strong>The main wing was auto-guessed (the widest part) — please check it.</strong>' : ''}</p>
      <div class="table-wrap"><table class="list-table"><thead><tr>
        <th>Part</th><th>Role</th><th>Width × length × height (m)</th><th>From nose (m)</th><th>Top-view area</th><th>Side-view area</th><th>Closed?</th>
      </tr></thead><tbody>
        ${an.parts.map((p) => `<tr>
          <td>${esc(p.name)} <small class="muted">${p.triangles.toLocaleString()} tris</small></td>
          <td><select data-role="${p.i}">${ROLES.map(([v, l]) => `<option value="${v}" ${roles[p.i] === v ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
          <td class="num">${fmt(p.size.x, 2)} × ${fmt(p.size.z, 2)} × ${fmt(p.size.y, 2)}</td>
          <td class="num">${fmt(p.fromNose[0], 2)} – ${fmt(p.fromNose[1], 2)}</td>
          <td class="num">${sig(p.topArea.value, 3)} m²</td>
          <td class="num">${sig(p.sideArea.value, 3)} m²</td>
          <td>${p.closed ? 'yes' : '<span class="muted">no</span>'}</td>
        </tr>`).join('')}
      </tbody></table></div>
      <button class="btn small" id="parts-to-mass" type="button">Copy parts to the Mass &amp; balance list (positions measured, masses still needed)</button>
    </div>` : `<div class="panel section"><h2>Parts</h2><p class="hint">${esc(an.partsNote || 'Only one part found.')} Wing area, chord and tail sizes are therefore <strong>not available from CAD</strong> — enter them on the Inputs and Mass &amp; balance tabs.</p></div>`}

    <div class="panel section">
      <h2>Use measurements in the design</h2>
      <p class="hint">Tick the values to copy into Design ${esc(d.label)}. They will be labelled <strong>Measured</strong>. Anything not listed here is not available from this CAD file.</p>
      <div class="table-wrap"><table class="list-table"><thead><tr><th></th><th>Value</th><th>Measured</th><th>Currently in design</th><th>How it was measured</th></tr></thead><tbody>
        ${meas.map((x) => {
          const cur = d.values[x.id];
          return `<tr><td><input type="checkbox" data-meas="${x.id}" ${x.id === 'width' || x.id === 'length' || x.id === 'height' || x.id === 'span' || roles && Object.keys(roles).length ? 'checked' : ''}></td>
            <td>${esc(FIELD[x.id].label)}</td><td class="num">${sig(x.value, 4)} ${esc(FIELD[x.id].unit)}</td>
            <td class="num">${isNum(cur) ? `${sig(cur, 4)} ${badge(d.source[x.id])}` : '<span class="muted">not provided</span>'}</td>
            <td class="small muted">${esc(x.how)}</td></tr>`;
        }).join('')}
      </tbody></table></div>
      <button class="btn primary" id="apply-meas" type="button">Apply selected measurements</button>
    </div>`;
}
