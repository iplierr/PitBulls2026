// Parts & balance tab: parts list, totals, mass distribution, centre of mass, preliminary pitch-stability check.
import { uid } from '../store.js';
import { componentMass, partMassSource, pocketRemoval, pocketVolume, withoutPocketing, hasPocketing, evaluate, centerOfMass } from '../model.js';
import { FIELD } from '../fields.js';
import { openPartsImport } from './parts-import.js';
import { stabilityCalcs } from '../calcs.js';
import { esc, fmt, sig, badge, calcCardHTML, groupsHTML, refreshFields, bindFields } from '../ui.js';

const CATEGORIES = ['Frame', 'Main wing', 'Tail', 'Landing structure', 'Decorations', 'Electronics', 'Fasteners & joints', 'Other'];
const MASS_SRC = [['measured', 'Weighed'], ['entered', 'From spec / calculation'], ['calculated', 'CAD volume × density'], ['estimated', 'Guess']];
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function render(panel, ctx) {
  panel.innerHTML = `
    <div class="panel section">
      <div class="panel-head">
        <h2>Parts &amp; masses</h2>
        <div class="row-actions">
          <button class="btn small" id="add-part" type="button">+ Add part</button>
          <button class="btn small" id="add-typical" type="button" title="Adds empty rows with typical Flugtag part names — no masses are filled in">+ Add typical part list</button>
          <button class="btn small" id="import-parts" type="button" title="Import a mass ledger / parts list saved as CSV">⇪ Import from CSV…</button>
        </div>
      </div>
      <p class="hint">List every part with its mass. Positions are measured <strong>from the nose</strong> (backwards) and <strong>from the lowest point</strong> (upwards), in metres.
        Mark whether each mass was weighed, taken from a spec, or guessed — guesses make the totals <em>Estimated</em>. The pilot is entered on the Design numbers step (mass) and below (position).</p>
      <div class="table-wrap"><table class="parts-table" id="parts-table"></table></div>
    </div>
    <div class="panel section">
      <h2>Lightweighting (pocketing) &amp; mass from CAD volume</h2>
      <p class="hint"><strong>Pocketing</strong> means cutting cavities or holes into a part to remove material that isn't carrying much load, making it lighter. There are two ways to include it:</p>
      <ol class="hint">
        <li><strong>From CAD:</strong> model the pockets in CAD, upload the model, copy its parts here (3D model step), enter each part's material density, and click
          <em>Use as part mass</em>. A pocketed model has less volume, so it automatically weighs less. Save the un-pocketed and pocketed models as two design versions to compare them.</li>
        <li><strong>By hand:</strong> enter the part's mass <em>before</em> pocketing in the table above, then add its pockets below (how many × size × depth).
          The removed material is subtracted. If you weighed the part <em>after</em> pocketing, don't add pockets — they would be subtracted twice.</li>
      </ol>
      <p class="hint">Density is never assumed: take it from the material datasheet, or weigh a sample and divide by its volume.</p>
      <div id="lw-rows"></div>
      <div id="lw-summary"></div>
    </div>
    <div id="mass-summary"></div>
    <div class="panel section">
      <h2>Balance &amp; tail inputs</h2>
      <form id="stab-form" novalidate>${groupsHTML('stability')}</form>
    </div>
    <div id="stability"></div>`;

  renderTable(panel, ctx);
  renderLW(panel, ctx);
  bindLW(panel, ctx);
  const table = panel.querySelector('#parts-table');
  table.addEventListener('input', (e) => {
    const row = e.target.closest('tr[data-id]');
    const key = e.target.dataset.k;
    if (!row || !key) return;
    const c = ctx.d.components.find((x) => x.id === row.dataset.id);
    if (['mass', 'qty', 'x', 'y'].includes(key)) {
      const v = e.target.value === '' ? null : parseFloat(e.target.value);
      const bad = v !== null && (!Number.isFinite(v) || v < 0 || (key === 'qty' && v < 1));
      e.target.classList.toggle('bad', bad);
      if (bad) return;
      c[key] = v;
    } else {
      c[key] = e.target.value;
    }
    ctx.changed(null);
  });
  table.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (!del) return;
    const c = ctx.d.components.find((x) => x.id === del.dataset.del);
    if (!confirm(`Remove "${c.name || 'this part'}"?`)) return;
    ctx.d.components = ctx.d.components.filter((x) => x !== c);
    renderTable(panel, ctx);
    renderLW(panel, ctx);
    ctx.changed(null);
  });
  const add = (name, category) => ctx.d.components.push({ id: uid(), name, category, mass: null, qty: 1, massSource: 'entered', material: '', dims: '', x: null, y: null, notes: '' });
  panel.querySelector('#add-part').addEventListener('click', () => {
    add('', 'Other');
    renderTable(panel, ctx);
    renderLW(panel, ctx);
    ctx.changed(null);
    panel.querySelector('#parts-table tbody tr:last-child input')?.focus();
  });
  panel.querySelector('#import-parts').addEventListener('click', () => openPartsImport(ctx, () => {
    renderTable(panel, ctx);
    renderLW(panel, ctx);
    ctx.changed(null);
  }));
  panel.querySelector('#add-typical').addEventListener('click', () => {
    for (const [n, c] of [['Frame', 'Frame'], ['Main wing', 'Main wing'], ['Tail', 'Tail'], ['Landing structure', 'Landing structure'], ['Decorations', 'Decorations'], ['Electronics', 'Electronics'], ['Other', 'Other']]) {
      if (!ctx.d.components.some((x) => x.name === n)) add(n, c);
    }
    renderTable(panel, ctx);
    renderLW(panel, ctx);
    ctx.changed(null);
  });

  const form = panel.querySelector('#stab-form');
  bindFields(form, () => ctx.d, (id) => ctx.changed(id));
  panel.querySelector('#stability').addEventListener('click', (e) => {
    const g = e.target.closest('[data-goto-field]');
    if (g) ctx.gotoField(g.dataset.gotoField);
  });
  update(panel, ctx, null);
}


// ---------------------------------------------------------------------------
// Lightweighting section (pocketing, mass from CAD volume × density)
// ---------------------------------------------------------------------------
function cadVolumeOf(d, c) {
  if (isNum(c.cadVolume)) return c.cadVolume;
  const p = isNum(c.cadPart) ? d.cad?.analysis?.parts?.find((x) => x.i === c.cadPart) : null;
  return p && isNum(p.volume) ? p.volume : null;
}

function renderLW(panel, ctx) {
  const d = ctx.d;
  const box = panel.querySelector('#lw-rows');
  if (!d.components.length) { box.innerHTML = '<p class="muted">Add parts above first.</p>'; return; }
  box.innerHTML = d.components.map((c) => {
    const vol = cadVolumeOf(d, c);
    return `
    <details class="lw-row" data-id="${c.id}" ${(c.pockets || []).length || isNum(c.density) || isNum(c.removedMass) || vol !== null ? 'open' : ''}>
      <summary class="lw-head"><strong class="lw-name">${esc(c.name || 'Unnamed part')}</strong> <span class="lw-result small"></span></summary>
      <div class="lw-grid">
        <label>Material density <span class="unit">(kg/m³)</span><input data-lk="density" type="number" min="1" max="25000" step="any" value="${c.density ?? ''}" placeholder="from datasheet"></label>
        <div class="lw-cad">${vol !== null
          ? `CAD volume: <strong>${sig(vol, 4)} m³</strong> ${badge('measured')}<br><span class="lw-cadmass"></span>`
          : '<span class="muted small">No CAD volume for this part (copy parts from the 3D model step; the part must be a closed shape).</span>'}</div>
        <label>Or mass removed <span class="unit">(kg)</span><input data-lk="removedMass" type="number" min="0" step="any" value="${c.removedMass ?? ''}" placeholder="e.g. weighed offcuts"></label>
      </div>
      ${(c.pockets || []).length ? `<table class="pocket-table">
        <thead><tr><th>Pocket shape</th><th>How many</th><th>Length or Ø (mm)</th><th>Width (mm)</th><th>Depth (mm)</th><th>Volume removed</th><th></th></tr></thead>
        <tbody>${c.pockets.map((p, i) => `
          <tr data-pi="${i}">
            <td><select data-pk="shape"><option value="rect" ${p.shape !== 'round' ? 'selected' : ''}>Rectangular</option><option value="round" ${p.shape === 'round' ? 'selected' : ''}>Round hole</option></select></td>
            <td><input data-pk="count" type="number" min="1" step="1" value="${p.count ?? 1}" class="tiny-in"></td>
            <td><input data-pk="a" type="number" min="0" step="any" value="${p.a ?? ''}" class="short"></td>
            <td><input data-pk="b" type="number" min="0" step="any" value="${p.b ?? ''}" class="short" ${p.shape === 'round' ? 'disabled placeholder="—"' : ''}></td>
            <td><input data-pk="depth" type="number" min="0" step="any" value="${p.depth ?? ''}" class="short" placeholder="mm"></td>
            <td class="num pv"></td>
            <td><button type="button" class="reset" data-del-pocket="${i}" title="Remove pocket" aria-label="Remove pocket">✕</button></td>
          </tr>`).join('')}</tbody>
      </table>` : ''}
      <button type="button" class="btn tiny" data-add-pocket>+ Add pocket</button>
      <small class="muted">For a through-hole, depth = the part's thickness.</small>
    </details>`;
  }).join('');
  updateLW(panel, ctx);
}

function bindLW(panel, ctx) {
  const box = panel.querySelector('#lw-rows');
  const comp = (el) => ctx.d.components.find((x) => x.id === el.closest('.lw-row')?.dataset.id);
  box.addEventListener('input', (e) => {
    const c = comp(e.target);
    if (!c || e.target.dataset.pk === 'shape') return;
    const num = e.target.value === '' ? null : parseFloat(e.target.value);
    const bad = num !== null && (!Number.isFinite(num) || num < 0);
    e.target.classList.toggle('bad', bad);
    if (bad) return;
    if (e.target.dataset.lk) c[e.target.dataset.lk] = num;
    if (e.target.dataset.pk) c.pockets[Number(e.target.closest('tr').dataset.pi)][e.target.dataset.pk] = num;
    ctx.changed(null);
  });
  box.addEventListener('change', (e) => {
    if (e.target.dataset.pk !== 'shape') return;
    comp(e.target).pockets[Number(e.target.closest('tr').dataset.pi)].shape = e.target.value;
    renderLW(panel, ctx);
    ctx.changed(null);
  });
  box.addEventListener('click', (e) => {
    const c = comp(e.target);
    if (!c) return;
    if (e.target.matches('[data-add-pocket]')) {
      (c.pockets ??= []).push({ shape: 'rect', count: 1, a: null, b: null, depth: null });
      renderLW(panel, ctx);
      ctx.changed(null);
    } else if (e.target.closest('[data-del-pocket]')) {
      c.pockets.splice(Number(e.target.closest('[data-del-pocket]').dataset.delPocket), 1);
      renderLW(panel, ctx);
      ctx.changed(null);
    } else if (e.target.matches('[data-use-cad]')) {
      c.mass = +(cadVolumeOf(ctx.d, c) * c.density).toFixed(3);
      c.massSource = 'calculated';
      c.massFromCad = true;
      renderTable(panel, ctx);
      ctx.changed(null);
    }
  });
}

function updateLW(panel, ctx) {
  const d = ctx.d;
  for (const row of panel.querySelectorAll('.lw-row')) {
    const c = d.components.find((x) => x.id === row.dataset.id);
    if (!c) continue;
    row.querySelector('.lw-name').textContent = c.name || 'Unnamed part';
    (c.pockets || []).forEach((p, i) => {
      const v = pocketVolume(p);
      const cell = row.querySelector(`tr[data-pi="${i}"] .pv`);
      if (cell) cell.innerHTML = isNum(v) ? `${sig(v * 1e6, 3)} cm³` : '<span class="muted">needs sizes</span>';
    });
    const cm = row.querySelector('.lw-cadmass');
    const vol = cadVolumeOf(d, c);
    if (cm) cm.innerHTML = isNum(c.density)
      ? `Volume × density = <strong>${sig(vol * c.density, 4)} kg</strong> ${badge('calculated')} <button type="button" class="btn tiny" data-use-cad>Use as part mass</button>
         <br><small class="muted">Only valid for a solid part of one material (not hollow, foam-cored or covered).</small>`
      : '<span class="muted small">Enter the density to calculate mass from this volume.</span>';
    const rem = pocketRemoval(c);
    const res = row.querySelector('.lw-result');
    if (rem.none) res.innerHTML = '<span class="muted">no pocketing</span>';
    else if (rem.ok === false) res.innerHTML = `<span class="error-msg">Pockets not subtracted: ${esc(rem.reason)}.</span>`;
    else res.innerHTML = `removes <strong>${sig(rem.mass, 3)} kg</strong> per item ${badge('calculated')} → ${isNum(c.mass) ? `${sig(Math.max(0, c.mass - rem.mass), 4)} kg each (was ${c.mass} kg)` : 'enter the part mass (before pocketing) above'}`;
  }

  // With vs without pocketing
  const out = panel.querySelector('#lw-summary');
  if (!hasPocketing(d)) { out.innerHTML = ''; return; }
  const plain = withoutPocketing(d);
  const ev0 = evaluate(plain), ev1 = ctx.ev;
  const com0 = centerOfMass(plain, ev0.r), com1 = ctx.com;
  const removed = d.components.reduce((a, c) => { const r = pocketRemoval(c); return a + (r.ok ? r.mass * (isNum(c.qty) ? c.qty : 1) : 0); }, 0);
  const typed = isNum(d.values.craftMass);
  const row = (label, a, b, unit, dg = 2) => `<tr><td>${label}</td><td class="num">${isNum(a) ? sig(a, 4) + ' ' + unit : '–'}</td><td class="num">${isNum(b) ? sig(b, 4) + ' ' + unit : '–'}</td>
    <td class="num">${isNum(a) && isNum(b) ? `${b - a >= 0 ? '+' : ''}${(b - a).toFixed(dg)} ${unit}` : '–'}</td></tr>`;
  out.innerHTML = `
    <h3>Effect of pocketing</h3>
    ${typed ? '<div class="verdict warn">Craft mass is typed directly on the Design numbers step, so the simulation <strong>ignores the parts list and pocketing</strong>. Clear that field to use the parts total.</div>' : ''}
    <table class="list-table"><thead><tr><th></th><th>Without pocketing</th><th>With pocketing</th><th>Change</th></tr></thead><tbody>
      ${row('Material removed', 0, removed, 'kg')}
      ${row('Total mass (craft + pilot)', ev0.r.v.totalMass, ev1.r.v.totalMass, 'kg')}
      ${row('Centre of mass from nose', com0.x, com1.x, 'm', 3)}
      ${row('Estimated distance', ev0.analysis?.flight.distance, ev1.analysis?.flight.distance, 'm')}
      ${row('Estimated flight time', ev0.analysis?.flight.time, ev1.analysis?.flight.time, 's', 3)}
      ${row('Stall speed', ev0.analysis?.stallSpeed, ev1.analysis?.stallSpeed, 'm/s')}
    </tbody></table>
    <p class="hint">Removed material is assumed to come from the part's listed position, so the centre of mass shifts only because of the mass change.
      <strong>Pockets weaken parts.</strong> Pocketing isn't modelled in the Strength tab, and holes near highly stressed edges, joints or bolt holes can start cracks.
      Keep material where the loads go (flanges, around fasteners) and remove it from lightly loaded webs.</p>`;
}

function renderTable(panel, ctx) {
  const rows = ctx.d.components.map((c) => `
    <tr data-id="${c.id}">
      <td><input data-k="name" value="${esc(c.name)}" placeholder="Part name" maxlength="60"></td>
      <td><select data-k="category">${CATEGORIES.map((k) => `<option ${c.category === k ? 'selected' : ''}>${k}</option>`).join('')}</select></td>
      <td><input data-k="mass" type="number" step="0.1" min="0" value="${c.mass ?? ''}" placeholder="kg" class="short"></td>
      <td><input data-k="qty" type="number" step="1" min="1" value="${c.qty ?? 1}" class="tiny-in"></td>
      <td><select data-k="massSource">${MASS_SRC.map(([v, l]) => `<option value="${v}" ${c.massSource === v ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
      <td><input data-k="material" value="${esc(c.material)}" placeholder="e.g. plywood" maxlength="60"></td>
      <td><input data-k="dims" value="${esc(c.dims)}" placeholder="e.g. 2 × 0.3 m" maxlength="60"></td>
      <td><input data-k="x" type="number" step="0.05" min="0" value="${c.x ?? ''}" placeholder="m" class="short"></td>
      <td><input data-k="y" type="number" step="0.05" min="0" value="${c.y ?? ''}" placeholder="m" class="short"></td>
      <td><input data-k="notes" value="${esc(c.notes)}" maxlength="200"></td>
      <td><button type="button" class="reset" data-del="${c.id}" title="Remove part" aria-label="Remove part">✕</button></td>
    </tr>`).join('');
  panel.querySelector('#parts-table').innerHTML = `
    <thead><tr><th>Name</th><th>Category</th><th>Mass each (kg)</th><th>Qty</th><th>Mass is</th><th>Material</th><th>Dimensions</th>
      <th title="Distance from the nose">From nose (m)</th><th title="Height above the lowest point">Height (m)</th><th>Notes</th><th></th></tr></thead>
    <tbody>${rows || '<tr><td colspan="11" class="muted">No parts yet. Add parts, or copy them from the 3D model step.</td></tr>'}</tbody>`;
}

export function update(panel, ctx, skipId) {
  const { d, ev, com } = ctx;
  const r = ev.r;
  updateLW(panel, ctx);
  refreshFields(panel.querySelector('#stab-form'), d, r, { level: 'advanced', skipId });

  // ---- totals and distribution
  const parts = d.components.filter((c) => isNum(componentMass(c)));
  const sum = parts.reduce((a, c) => a + componentMass(c), 0);
  const partsSrc = parts.some((c) => c.massSource === 'estimated') ? 'estimated' : 'calculated';
  const byCat = {};
  for (const c of parts) byCat[c.category || 'Other'] = (byCat[c.category || 'Other'] || 0) + componentMass(c);
  const withPilot = [...Object.entries(byCat)];
  if (isNum(r.v.pilotMass)) withPilot.push(['Pilot', r.v.pilotMass]);
  const total = withPilot.reduce((a, [, m]) => a + m, 0);
  const top = [...parts].sort((a, b) => componentMass(b) - componentMass(a)).slice(0, 5);

  panel.querySelector('#mass-summary').innerHTML = `
    <div class="two-col">
      <div class="panel section">
        <h2>Totals</h2>
        <table class="meas-table"><tbody>
          <tr><th>Sum of parts</th><td class="num">${parts.length ? `${fmt(sum, 1)} kg` : '–'}</td><td>${parts.length ? badge(partsSrc) : badge('missing')}</td></tr>
          <tr><th>Craft mass used by the simulation</th><td class="num">${isNum(r.v.craftMass) ? `${fmt(r.v.craftMass, 1)} kg` : '–'}</td><td>${badge(r.src.craftMass || 'missing')}</td></tr>
          <tr><th>Pilot</th><td class="num">${isNum(r.v.pilotMass) ? `${fmt(r.v.pilotMass, 1)} kg` : '–'}</td><td>${badge(r.src.pilotMass || 'missing')}</td></tr>
          <tr><th>Total (craft + pilot)</th><td class="num">${isNum(r.v.totalMass) ? `<strong>${fmt(r.v.totalMass, 1)} kg</strong>` : '–'}</td><td>${badge(r.src.totalMass || 'missing')}</td></tr>
        </tbody></table>
        ${isNum(d.values.craftMass) && parts.length ? '<p class="hint">Craft mass is typed directly on the Design numbers step, so the parts total is <strong>not</strong> used by the simulation. Clear it there to use the parts total.</p>' : ''}
        ${d.components.some((c) => !isNum(componentMass(c))) ? `<p class="hint">${d.components.filter((c) => !isNum(componentMass(c))).length} part(s) have no mass yet and are not counted.</p>` : ''}
        ${top.length ? `<h3>Heaviest parts</h3><ol class="plain-list numbered">${top.map((c) => `<li>${esc(c.name || 'Unnamed')} — ${fmt(componentMass(c), 1)} kg (${fmt(componentMass(c) / sum * 100, 0)}% of parts) ${badge(partMassSource(c))}</li>`).join('')}</ol>` : ''}
      </div>
      <div class="panel section">
        <h2>Mass distribution</h2>
        ${total > 0 ? `<div class="bars">${withPilot.sort((a, b) => b[1] - a[1]).map(([k, m]) => `
          <div class="bar-row"><span class="bar-label">${esc(k)}</span><span class="bar-track"><span class="bar-fill ${k === 'Pilot' ? 'pilot' : ''}" style="width:${(m / total * 100).toFixed(1)}%"></span></span>
          <span class="bar-val">${fmt(m, 1)} kg · ${fmt(m / total * 100, 0)}%</span></div>`).join('')}</div>`
        : '<p class="muted">Enter part masses to see where the weight comes from.</p>'}
      </div>
    </div>
    <div class="panel section">
      <h2>Centre of mass</h2>
      ${comHTML(ctx)}
      <div class="diagram-wrap">${sideDiagram(ctx)}</div>
      <details class="explain"><summary>Why does the centre of mass matter?</summary>
        <p>The centre of mass (CoM) is the balance point of the whole craft including the pilot. Lift acts roughly a quarter of the way back along the wing.
        If the CoM is too far back relative to the wing and tail, a small nose-up disturbance tends to grow — the craft pitches up, slows and stalls, which is one of the
        most common Flugtag outcomes. If it is too far forward, the tail may not be able to hold the nose up, and the craft dives.
        Knowing the CoM is <strong>necessary</strong> for a stable design but <strong>not enough</strong> to prove one: tail size, wing shape, flexibility and the pilot moving all matter.</p>
      </details>
    </div>`;

  // ---- stability
  const cards = stabilityCalcs(r, com);
  const sm = cards.find((c) => c.id === 'sm');
  let verdict;
  if (!isNum(sm.result)) {
    const need = new Set(cards.filter((c) => c.missingIds).flatMap((c) => c.missingIds));
    if (!isNum(com.x)) need.add('centre of mass');
    verdict = `<div class="verdict warn"><strong>Insufficient information for a stability estimate.</strong>
      Still needed: ${[...need].map((x) => esc(FIELD[x]?.label || x)).join(', ') || 'see the cards below'}.</div>`;
  } else if (sm.result > 0) {
    verdict = `<div class="verdict good">In this simplified model the centre of mass is <strong>${fmt(sm.result, 0)}% of chord ahead</strong> of the estimated neutral point,
      which indicates a nose-down restoring tendency in pitch. <strong>This is a preliminary check, not proof that the craft is stable.</strong> ${sm.src === 'estimated' ? 'It also uses estimated inputs.' : ''}</div>`;
  } else {
    verdict = `<div class="verdict bad">In this simplified model the centre of mass is <strong>${fmt(-sm.result, 0)}% of chord behind</strong> the estimated neutral point.
      That predicts the craft would tend to keep pitching away after a disturbance (pitch-unstable). Options to investigate: move mass forward, enlarge the tail, or move the tail further back — then re-check.</div>`;
  }
  panel.querySelector('#stability').innerHTML = `
    <div class="panel section">
      <h2>Preliminary pitch-stability check <span class="badge prelim">Preliminary estimate</span></h2>
      ${verdict}
      <div class="calc-grid">${cards.map((c) => calcCardHTML(c)).join('')}</div>
      <p class="hint">This tool is for preliminary engineering analysis only — not certification or flight-safety approval.</p>
    </div>`;
}

function comHTML({ com, ev }) {
  if (!com.items.length) return '<p class="muted">Add parts with masses (and the pilot mass on the Design numbers step) to calculate the centre of mass.</p>';
  const problems = [];
  if (com.missingX.length) problems.push(`positions (from nose) are missing for: <strong>${com.missingX.map(esc).join(', ')}</strong>${com.missingX.includes('Pilot') ? ' — enter the pilot position below' : ''}`);
  if (com.noMass.length) problems.push(`these parts have no mass and are ignored: ${com.noMass.map(esc).join(', ')}`);
  const src = com.guessed ? 'estimated' : 'calculated';
  const eq = '<div class="eq">x_cm = Σ(mᵢ × xᵢ) ÷ Σmᵢ</div>';
  if (!isNum(com.x)) return `<div class="verdict warn">Cannot calculate the centre of mass: ${problems.join('; ')}.</div>${eq}`;
  return `
    <div class="metrics">
      <div class="metric"><div class="label">From nose</div><div class="value">${fmt(com.x, 2)} <small>m</small></div>${badge(src)}</div>
      <div class="metric"><div class="label">Height above lowest point</div><div class="value">${isNum(com.y) ? `${fmt(com.y, 2)} <small>m</small>` : '<small class="muted">needs heights</small>'}</div>${isNum(com.y) ? badge(src) : badge('missing')}</div>
    </div>
    ${eq}
    <p class="hint">Uses ${com.items.length} items totalling ${fmt(com.mass, 1)} kg (parts + pilot). ${problems.length ? 'Note: ' + problems.join('; ') + '.' : ''}
      ${com.partsIncomplete ? '<strong>Warning:</strong> the parts do not add up to the craft mass typed on the Design numbers step, so some mass is missing from this calculation.' : ''}
      ${isNum(ev.r.v.wingLEx) && isNum(ev.r.v.macLength ?? ev.r.v.chord) ? `The CoM is at <strong>${fmt((com.x - ev.r.v.wingLEx) / (ev.r.v.macLength ?? ev.r.v.chord) * 100, 1)}%</strong> of the ${isNum(ev.r.v.macLength) ? 'mean aerodynamic chord (MAC)' : 'wing chord'} from its leading edge.` : ''}</p>`;
}

// Simple side-view diagram (SVG): wing, tail, parts, pilot, centre of mass.
function sideDiagram({ com, ev }) {
  const v = ev.r.v;
  const xs = com.items.filter((i) => isNum(i.x)).map((i) => i.x);
  const L = Math.max(isNum(v.length) ? v.length : 0, ...xs, isNum(v.tailLEx) ? v.tailLEx + 0.5 : 0, 1);
  const H = Math.max(isNum(v.height) ? v.height : 0, ...com.items.filter((i) => isNum(i.y)).map((i) => i.y), 1);
  const W = 820, Hpx = 190, pad = 30;
  const sx = (W - 2 * pad) / L;
  const sy = Math.min(sx, (Hpx - 50) / H);
  const X = (x) => pad + x * sx, Y = (y) => Hpx - 22 - y * sy;
  const maxM = Math.max(1, ...com.items.map((i) => i.m));
  let g = `<line x1="${X(0)}" y1="${Y(0)}" x2="${X(L)}" y2="${Y(0)}" stroke="#9aa5b5" stroke-width="2"/>`;
  for (let x = 0; x <= L + 1e-9; x += L > 6 ? 1 : 0.5) g += `<line x1="${X(x)}" y1="${Y(0)}" x2="${X(x)}" y2="${Y(0) + 5}" stroke="#9aa5b5"/><text x="${X(x)}" y="${Y(0) + 17}" class="svg-tick">${+x.toFixed(1)} m</text>`;
  g += `<text x="${X(0)}" y="14" class="svg-label">nose</text>`;
  const wingY = isNum(v.height) ? v.height * 0.85 : H * 0.8;
  if (isNum(v.wingLEx) && isNum(v.chord)) {
    g += `<rect x="${X(v.wingLEx)}" y="${Y(wingY) - 4}" width="${v.chord * sx}" height="8" fill="#e8792b" opacity="0.8"><title>Main wing</title></rect>`;
    g += `<line x1="${X(v.wingLEx + 0.25 * v.chord)}" y1="${Y(wingY) - 12}" x2="${X(v.wingLEx + 0.25 * v.chord)}" y2="${Y(wingY) + 12}" stroke="#7a3a0c" stroke-width="2"/><text x="${X(v.wingLEx + 0.25 * v.chord)}" y="${Y(wingY) - 15}" class="svg-tick">wing ¼ chord</text>`;
  }
  if (isNum(v.tailLEx) && isNum(v.tailArea) && isNum(v.tailSpan)) {
    g += `<rect x="${X(v.tailLEx)}" y="${Y(H * 0.35) - 3}" width="${(v.tailArea / v.tailSpan) * sx}" height="6" fill="#e8792b" opacity="0.8"><title>Horizontal tail</title></rect>`;
  }
  for (const i of com.items) {
    if (!isNum(i.x)) continue;
    const rr = 3 + 9 * Math.sqrt(i.m / maxM);
    g += `<circle cx="${X(i.x)}" cy="${Y(isNum(i.y) ? i.y : H * 0.4)}" r="${rr}" fill="${i.pilot ? '#6a4fc7' : '#17803d'}" opacity="0.75"><title>${esc(i.name)}: ${fmt(i.m, 1)} kg at ${fmt(i.x, 2)} m</title></circle>`;
  }
  if (isNum(com.x)) {
    const cy = Y(isNum(com.y) ? com.y : H * 0.4);
    g += `<g class="svg-com"><circle cx="${X(com.x)}" cy="${cy}" r="9" fill="#fff" stroke="#d61f1f" stroke-width="3"/>
      <line x1="${X(com.x) - 9}" y1="${cy}" x2="${X(com.x) + 9}" y2="${cy}" stroke="#d61f1f" stroke-width="2"/><line x1="${X(com.x)}" y1="${cy - 9}" x2="${X(com.x)}" y2="${cy + 9}" stroke="#d61f1f" stroke-width="2"/>
      <text x="${X(com.x)}" y="${cy + 24}" class="svg-label" fill="#d61f1f">CoM ${fmt(com.x, 2)} m</text></g>`;
  }
  return `<svg viewBox="0 0 ${W} ${Hpx}" class="side-diagram" role="img" aria-label="Side view with centre of mass">${g}</svg>
    <p class="hint">Side view (not to exact shape). <span class="dot green"></span> parts (size ∝ mass) · <span class="dot purple"></span> pilot · <span class="dot red"></span> centre of mass · orange = wing and tail.</p>`;
}
