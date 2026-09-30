// Physical tests: record real-world tests, list them, compare each with the simulation under the same conditions.
import { db, uid, save, today, sortedDesigns, designTitle, getDesign, deleteItem } from '../store.js';
import { evaluate } from '../model.js';
import { simulationSource } from '../calcs.js';
import { lineChart } from '../charts.js';
import { esc, fmt, sig, badge, toast, download, toCSV } from '../ui.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const DEG = Math.PI / 180;

const NUM_FIELDS = [
  ['launchSpeed', 'Launch speed', 'm/s'], ['launchAngle', 'Launch angle', '°'], ['windSpeed', 'Wind speed', 'm/s'],
  ['windDir', 'Wind direction (0 = headwind)', '°'], ['distance', 'Distance flown', 'm'], ['time', 'Flight time', 's'],
  ['maxHeight', 'Maximum height (above landing surface)', 'm'], ['impactSpeed', 'Impact speed (if measured)', 'm/s'],
  ['launchHeight', 'Launch height used in test', 'm'],
];
const TEXT_FIELDS = [
  ['behavior', 'Observed behaviour', 'e.g. nose pitched up after 1 s, then stalled'],
  ['problems', 'Problems', 'e.g. left wing tip hit the ramp'],
  ['notes', 'Notes (how things were measured, conditions)', 'e.g. distance by tape measure, time from 60 fps video'],
];
const OVERRIDE_LABEL = { launchSpeed: 'launch speed', launchAngle: 'launch angle', deckHeight: 'launch height', headwind: 'headwind component' };
const OVERRIDE_UNIT = { launchSpeed: 'm/s', launchAngle: '°', deckHeight: 'm', headwind: 'm/s' };
const TYPES = [['full', 'Full-size craft'], ['scale', 'Scale model'], ['component', 'Component / load test'], ['other', 'Other']];

let editingId = null;
let compareId = null;

export function testsCSV() {
  const head = ['Test', 'Date', 'Design', 'Type', ...NUM_FIELDS.map(([, l, u]) => `${l} (${u})`), 'Behaviour', 'Problems', 'Notes',
    'Sim distance (m)', 'Sim time (s)', 'Sim max height (m)', 'Sim impact speed (m/s)', 'Distance diff (%)', 'Time diff (%)', 'Why different (notes)'];
  const rows = sortedTests().map((t) => {
    const s = simFor(t);
    const f = s.analysis?.flight;
    return [t.number, t.date, getDesign(t.designId) ? designTitle(getDesign(t.designId)) : '', t.type, ...NUM_FIELDS.map(([k]) => t[k]),
      t.behavior, t.problems, t.notes, f?.distance, f?.time, f?.maxHeight, f?.impactSpeed, pct(f?.distance, t.distance), pct(f?.time, t.time), t.diffNotes];
  });
  return [head, ...rows];
}

const sortedTests = () => [...db.tests].sort((a, b) => (Number(a.number) || 0) - (Number(b.number) || 0));
const pct = (sim, real) => (isNum(sim) && isNum(real) && real !== 0 ? (sim - real) / real * 100 : NaN);

// Simulation of the tested design using the conditions measured in the test.
export function simFor(t) {
  const d = getDesign(t.designId);
  if (!d) return { error: 'The design for this test no longer exists.' };
  const o = {};
  if (isNum(t.launchSpeed)) o.launchSpeed = t.launchSpeed;
  if (isNum(t.launchAngle)) o.launchAngle = t.launchAngle;
  if (isNum(t.launchHeight)) o.deckHeight = t.launchHeight;
  if (isNum(t.windSpeed)) {
    if (t.windSpeed === 0) o.headwind = 0;
    else if (isNum(t.windDir)) o.headwind = t.windSpeed * Math.cos(t.windDir * DEG);
  }
  const ev = evaluate(d, o);
  return { ...ev, design: d, overrides: o };
}

export function show(el) {
  const designs = sortedDesigns();
  const nextNo = Math.max(0, ...db.tests.map((t) => Number(t.number) || 0)) + 1;
  el.innerHTML = `
    <h1>Physical tests</h1>
    <p class="lead left">Record every real test — full-size runs, scale models, load tests — and compare them with the simulation under the same conditions.
      This is how the team finds out where the model is wrong.</p>
    <details class="panel section" id="test-form-wrap" ${!db.tests.length || editingId ? 'open' : ''}>
      <summary><strong id="form-title">${editingId ? 'Edit test' : '+ Record a new test'}</strong></summary>
      ${designs.length ? `
      <form id="test-form" class="test-form" novalidate>
        <div class="form-grid">
          <label>Test number <input name="number" type="number" min="1" step="1" value="${nextNo}"></label>
          <label>Date <input name="date" type="date" value="${today()}"></label>
          <label>Design version <select name="designId">${designs.map((d) => `<option value="${d.id}" ${d.id === db.currentId ? 'selected' : ''}>${esc(designTitle(d))}</option>`).join('')}</select></label>
          <label>Type <select name="type">${TYPES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
          ${NUM_FIELDS.map(([k, l, u]) => `<label>${l} <span class="unit">(${u})</span><input name="${k}" type="number" step="any" placeholder="not measured"></label>`).join('')}
        </div>
        ${TEXT_FIELDS.map(([k, l, ph]) => `<label class="block">${l}<textarea name="${k}" rows="2" placeholder="${esc(ph)}"></textarea></label>`).join('')}
        <p class="hint">Leave a box empty if it was not measured — it will show as "not measured", never as zero. Launch height: fill in only if it differed from the design's deck height (e.g. a practice ramp).
          Scale-model tests should be linked to a design that describes the <em>scale model</em>, otherwise the comparison is meaningless.</p>
        <div class="row-actions">
          <button class="btn primary" type="submit">${editingId ? 'Save changes' : 'Save test'}</button>
          ${editingId ? '<button class="btn" type="button" id="cancel-edit">Cancel</button>' : ''}
        </div>
      </form>` : '<p class="muted">Create a design first (Dashboard), then record tests for it.</p>'}
    </details>

    <div class="panel section">
      <div class="panel-head"><h2>All tests</h2><button class="btn small" id="tests-csv" type="button">Export CSV</button></div>
      ${db.tests.length ? `<div class="table-wrap"><table class="list-table" id="tests-table">
        <thead><tr><th>#</th><th>Date</th><th>Design</th><th>Type</th><th>Launch</th><th>Wind</th><th>Distance</th><th>Time</th><th>Sim distance</th><th>Behaviour</th><th></th></tr></thead>
        <tbody>${sortedTests().map((t) => {
          const s = simFor(t);
          const d = getDesign(t.designId);
          return `<tr data-id="${t.id}">
            <td>${esc(t.number)}</td><td>${esc(t.date)}</td>
            <td>${d ? `<a href="#/design/${d.id}/overview">${esc(designTitle(d))}</a>` : '<span class="muted">deleted</span>'}</td>
            <td>${esc(TYPES.find((x) => x[0] === t.type)?.[1] || '')}</td>
            <td class="num">${isNum(t.launchSpeed) ? fmt(t.launchSpeed) + ' m/s' : '<span class="muted">—</span>'}</td>
            <td class="num">${isNum(t.windSpeed) ? `${fmt(t.windSpeed)} m/s${isNum(t.windDir) ? ` @ ${t.windDir}°` : ''}` : '<span class="muted">—</span>'}</td>
            <td class="num">${isNum(t.distance) ? fmt(t.distance) + ' m' : '<span class="muted">—</span>'}</td>
            <td class="num">${isNum(t.time) ? fmt(t.time, 2) + ' s' : '<span class="muted">—</span>'}</td>
            <td class="num">${s.analysis ? fmt(s.analysis.flight.distance) + ' m' : '<span class="muted">n/a</span>'}</td>
            <td class="small">${esc((t.behavior || '').slice(0, 60))}${(t.behavior || '').length > 60 ? '…' : ''}</td>
            <td class="row-actions"><button class="btn tiny" data-act="cmp">Sim vs real</button><button class="btn tiny" data-act="edit">Edit</button><button class="btn tiny danger" data-act="del">Delete</button></td>
          </tr>`;
        }).join('')}</tbody></table></div>` : '<p class="muted">No tests yet.</p>'}
    </div>

    <div class="panel section" id="svr"></div>`;

  const form = el.querySelector('#test-form');
  if (form && editingId) fillForm(form, db.tests.find((t) => t.id === editingId));
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const t = editingId ? db.tests.find((x) => x.id === editingId) : { id: uid(), created: new Date().toISOString(), diffNotes: '' };
    t.number = parseInt(fd.get('number'), 10) || nextNo;
    t.date = fd.get('date') || today();
    t.designId = fd.get('designId');
    t.type = fd.get('type');
    for (const [k] of NUM_FIELDS) {
      const v = fd.get(k);
      t[k] = v === '' || v === null ? null : parseFloat(v);
      if (t[k] !== null && !Number.isFinite(t[k])) t[k] = null;
    }
    for (const [k] of TEXT_FIELDS) t[k] = String(fd.get(k) || '').slice(0, 2000);
    if (!editingId) db.tests.push(t);
    compareId = t.id;
    editingId = null;
    save();
    toast('Test saved.');
    show(el);
  });
  el.querySelector('#cancel-edit')?.addEventListener('click', () => { editingId = null; show(el); });
  el.querySelector('#tests-csv').addEventListener('click', () => download(`flugtag-tests-${today()}.csv`, toCSV(testsCSV()), 'text/csv'));
  el.querySelector('#tests-table')?.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const id = b.closest('tr').dataset.id;
    if (b.dataset.act === 'edit') { editingId = id; show(el); el.querySelector('#test-form-wrap').scrollIntoView(); }
    if (b.dataset.act === 'cmp') { compareId = id; renderCompare(el); el.querySelector('#svr').scrollIntoView({ behavior: 'smooth' }); }
    if (b.dataset.act === 'del' && confirm('Delete this test? You can restore it from Dashboard → Recently deleted.')) {
      deleteItem('test', id);
      toast('Test moved to Recently deleted.');
      show(el);
    }
  });
  renderCompare(el);
}

function fillForm(form, t) {
  if (!t) return;
  for (const el of form.elements) {
    if (!el.name) continue;
    const v = t[el.name];
    el.value = v === null || v === undefined ? '' : v;
  }
}

function renderCompare(el) {
  const box = el.querySelector('#svr');
  const tests = sortedTests();
  if (!tests.length) { box.innerHTML = '<h2>Simulation vs reality</h2><p class="muted">Record a test to compare it with the simulation.</p>'; return; }
  if (!tests.some((t) => t.id === compareId)) compareId = tests[tests.length - 1].id;
  const t = tests.find((x) => x.id === compareId);
  const s = simFor(t);
  const f = s.analysis?.flight;
  const rows = [['Distance', 'distance', 'distance', 'm', 1], ['Flight time', 'time', 'time', 's', 2], ['Max height', 'maxHeight', 'maxHeight', 'm', 1], ['Impact speed', 'impactSpeed', 'impactSpeed', 'm/s', 1]];
  const src = s.analysis ? simulationSource(s.r) : 'missing';
  const edited = s.design && t.created && s.design.updated > t.created;

  box.innerHTML = `
    <div class="panel-head"><h2>Simulation vs reality</h2>
      <label>Test <select id="svr-pick">${tests.map((x) => `<option value="${x.id}" ${x.id === compareId ? 'selected' : ''}>Test ${esc(x.number)} · ${esc(x.date)}</option>`).join('')}</select></label>
    </div>
    ${s.error ? `<p class="verdict warn">${esc(s.error)}</p>` : !s.analysis ? `<p class="verdict warn">The simulation cannot run for ${esc(designTitle(s.design))}: missing ${s.missing.map((m) => esc(m.label.toLowerCase())).join(', ')}. <a href="#/design/${s.design.id}/inputs">Complete the design →</a></p>` : `
    <p class="hint">Simulation of <strong>${esc(designTitle(s.design))}</strong> using this test's measured conditions:
      ${Object.keys(s.overrides).length ? Object.entries(s.overrides).map(([k, v]) => `${OVERRIDE_LABEL[k] || esc(k)} = ${sig(v, 3)} ${OVERRIDE_UNIT[k] || ''}`).join(', ') : 'none recorded — the design\'s own launch/wind inputs were used'}.
      ${edited ? '<strong>Note:</strong> this design was edited after the test was recorded; the simulation uses its current inputs.' : ''}</p>
    <div class="table-wrap"><table class="list-table svr-table">
      <thead><tr><th></th><th>Simulation ${badge(src)}</th><th>Real test ${badge('measured')}</th><th>Difference (sim − real)</th><th></th></tr></thead>
      <tbody>${rows.map(([label, sk, tk, u, dg]) => {
        const sv = f[sk], rv = t[tk];
        const p = pct(sv, rv);
        return `<tr><td>${label}</td><td class="num">${fmt(sv, dg)} ${u}</td>
          <td class="num">${isNum(rv) ? `${fmt(rv, dg)} ${u}` : '<span class="muted">not measured</span>'}</td>
          <td class="num">${isNum(rv) ? `${sv - rv >= 0 ? '+' : ''}${fmt(sv - rv, dg)} ${u} (${p >= 0 ? '+' : ''}${fmt(p, 0)}%)` : '–'}</td>
          <td class="bar-cell">${isNum(rv) ? pairBars(sv, rv) : ''}</td></tr>`;
      }).join('')}</tbody></table></div>
    <p class="hint"><span class="dot" style="background:#0b5cd6"></span> simulation <span class="dot green"></span> real test. Positive % = the simulation predicted more than happened. Observed behaviour: ${esc(t.behavior || 'not recorded')}.</p>`}
    <label class="block">Why do we think the simulation and the test differed?
      <textarea id="diff-notes" rows="3" placeholder="e.g. craft pitched up and stalled (model assumes constant angle); push speed measured by eye; wing flexed">${esc(t.diffNotes || '')}</textarea></label>
    <h3>All tests: simulated vs measured distance</h3>
    <canvas class="chart" id="svr-chart"></canvas>
    <p class="hint">Points on the dashed line mean the simulation matched. Points above it mean the model over-predicted. A consistent pattern suggests an input (often drag or launch speed) needs adjusting.</p>`;

  box.querySelector('#svr-pick').addEventListener('change', (e) => { compareId = e.target.value; renderCompare(el); });
  box.querySelector('#diff-notes').addEventListener('input', (e) => { t.diffNotes = e.target.value; save(); });
  const pts = tests.map((x) => { const sx = simFor(x); return [x.distance, sx.analysis?.flight.distance]; }).filter(([a, b]) => isNum(a) && isNum(b));
  const mx = Math.max(1, ...pts.flat());
  lineChart(box.querySelector('#svr-chart'), {
    xLabel: 'measured distance (m)', yLabel: 'simulated (m)',
    series: [{ name: 'tests', color: '#0b5cd6', points: pts, dotsOnly: true, dotSize: 5 }, { name: 'perfect match', color: '#9aa5b5', points: [[0, 0], [mx, mx]], dashed: true }],
    emptyText: 'Record tests with a measured distance (and a working simulation) to see this chart.',
  });
}

function pairBars(sim, real) {
  const m = Math.max(Math.abs(sim), Math.abs(real)) || 1;
  return `<div class="pair"><span class="pbar sim" style="width:${Math.abs(sim) / m * 100}%"></span><span class="pbar real" style="width:${Math.abs(real) / m * 100}%"></span></div>`;
}
