// Design workspace: header, tabs, Overview and Inputs tabs. Other tabs live in their own modules.
import { db, getDesign, touch, newVersion, duplicateAsNew, designTitle, deleteDesign } from '../store.js';
import * as history from '../history.js';
import { FIELD, GROUPS, LEVELS, LEVEL_LABEL } from '../fields.js';
import { evaluate, centerOfMass, sanityChecks, completeness, assumableMissing, applyAssumptions } from '../model.js';
import { esc, fmt, badge, toast, groupsHTML, refreshFields, bindFields, focusField } from '../ui.js';
import { simulationSource } from '../calcs.js';
import * as cadTab from './cad-tab.js';
import * as massTab from './mass-tab.js';
import * as simTab from './sim-tab.js';
import * as whatifTab from './whatif-tab.js';
import * as calcTab from './calc-tab.js';
import { nasaPanelHTML, bindNasaPanel, refreshNasaPanel } from './nasa-panel.js';
import { rulesPanelHTML, bindRulesPanel } from './rules-panel.js';

const overviewTab = { render: renderOverview, update: renderOverview };
const inputsTab = { render: renderInputs, update: updateInputs };

const TABS = [
  ['overview', 'Overview', overviewTab],
  ['inputs', 'Inputs', inputsTab],
  ['cad', 'CAD model', cadTab],
  ['mass', 'Mass & balance', massTab],
  ['simulate', 'Simulate', simTab],
  ['whatif', 'What if?', whatifTab],
  ['calcs', 'Calculations', calcTab.calcs],
  ['structure', 'Structure', calcTab.structure],
];
const TAB = Object.fromEntries(TABS.map(([id, label, mod]) => [id, { id, label, mod }]));

let S = null; // { el, app, d, tab, ev, com, pendingFocus }

function compute() {
  S.ev = evaluate(S.d);
  S.com = centerOfMass(S.d, S.ev.r);
}

const ctx = {
  get d() { return S.d; },
  get ev() { return S.ev; },
  get com() { return S.com; },
  get app() { return S.app; },
  // Called after any change to the design
  changed(fieldId = null) {
    touch(S.d);
    history.record(S.d);
    compute();
    updateHeader();
    const panel = S.el.querySelector('.tab-panel');
    TAB[S.tab].mod.update?.(panel, ctx, fieldId);
  },
  // Re-draws the current tab from scratch (after undo/redo/start over)
  rerender() {
    compute();
    S.el.querySelector('#design-name').value = S.d.name || '';
    updateHeader();
    show(S.el, S.app, { id: S.d.id, tab: S.tab });
  },
  gotoField(id) {
    const tab = { inputs: 'inputs', stability: 'mass', structure: 'structure' }[GROUPS.find((g) => g.id === FIELD[id]?.group)?.tab] || 'inputs';
    S.pendingFocus = id;
    if (S.tab === tab) doFocus();
    else S.app.go(`#/design/${S.d.id}/${tab}`);
  },
  goTab(tab) { S.app.go(`#/design/${S.d.id}/${tab}`); },
};

function doFocus() {
  const id = S.pendingFocus;
  S.pendingFocus = null;
  if (id) setTimeout(() => focusField(S.el, id), 50);
}

export function leave() {
  if (S) TAB[S.tab]?.mod.leave?.(S.el.querySelector('.tab-panel'), ctx);
}

// Leaving a tab within the design view
function leaveTab() {
  if (S?.tab) TAB[S.tab]?.mod.leave?.(S.el.querySelector('.tab-panel'), ctx);
}

export function show(el, app, { id, tab }) {
  const d = getDesign(id);
  history.track(d);
  tab = TAB[tab] ? tab : 'overview';
  if (!S || S.d !== d || S.el !== el) {
    S = { el, app, d, tab, pendingFocus: S?.d === d ? S.pendingFocus : null };
    compute();
    renderShell();
  } else {
    compute();
  }
  leaveTab();
  S.tab = tab;
  el.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  updateHeader();
  // Fresh panel per tab so listeners from the previous tab are dropped
  const panel = document.createElement('div');
  panel.className = 'tab-panel';
  panel.dataset.tab = tab;
  el.querySelector('.tab-panel').replaceWith(panel);
  TAB[tab].mod.render(panel, ctx);
  doFocus();
}

function renderShell() {
  const d = S.d;
  S.el.innerHTML = `
    <div class="design-head">
      <div class="design-title">
        <span class="label-chip">Design ${esc(d.label)}</span>
        <input class="design-name" id="design-name" placeholder="Name this design (e.g. Bat Wing)" maxlength="60" value="${esc(d.name)}">
        <button class="btn small" id="btn-undo" title="Undo the last change (Ctrl+Z)">↶ Undo</button>
        <button class="btn small" id="btn-redo" title="Redo (Ctrl+Y)">↷ Redo</button>
      </div>
      <div class="design-status" id="design-status"></div>
      <div class="row-actions">
        <button class="btn small" id="btn-version" title="Copy as the next version, e.g. 1 → 1.1">New version</button>
        <button class="btn small" id="btn-dup">Duplicate</button>
        <a class="btn small" href="#/report/${d.id}">Report / export</a>
        <button class="btn small" id="btn-restart" title="Clear this design and start again (can be undone)">Start over…</button>
        <button class="btn small danger" id="btn-delete" title="Move this design to Recently deleted">Delete</button>
      </div>
    </div>
    <div class="legend-inline">
      ${badge('measured')} from CAD geometry ${badge('entered')} typed by you ${badge('calculated')} worked out from other values
      ${badge('estimated')} assumption or uses one ${badge('missing')}
    </div>
    <nav class="tabs" role="tablist">
      ${TABS.map(([id, label]) => `<a href="#/design/${d.id}/${id}" data-tab="${id}" role="tab">${label}</a>`).join('')}
    </nav>
    <div class="tab-panel"></div>`;
  S.el.querySelector('#design-name').addEventListener('input', (e) => {
    S.d.name = e.target.value;
    touch(S.d);
    history.record(S.d);
    updateHeader();
    S.app.refreshNav();
  });
  S.el.querySelector('#btn-undo').addEventListener('click', doUndo);
  S.el.querySelector('#btn-redo').addEventListener('click', doRedo);
  S.el.querySelector('#btn-restart').addEventListener('click', startOver);
  S.el.querySelector('#btn-delete').addEventListener('click', () => {
    const tests = db.tests.filter((t) => t.designId === S.d.id).length;
    if (!confirm(`Delete ${designTitle(S.d)}?

It moves to "Recently deleted" on the Dashboard, where you can restore it for 30 days.${tests ? `
Its ${tests} physical test(s) are kept.` : ''}`)) return;
    const title = designTitle(S.d);
    deleteDesign(S.d.id);
    S = null;
    toast(`${title} moved to Recently deleted (Dashboard).`);
    location.hash = '#/dashboard';
  });
  S.el.querySelector('#btn-version').addEventListener('click', () => {
    const n = newVersion(S.d);
    toast(`Created Design ${n.label} — you are now editing it.`);
    S.app.go(`#/design/${n.id}/${S.tab}`);
  });
  S.el.querySelector('#btn-dup').addEventListener('click', () => {
    const n = duplicateAsNew(S.d);
    toast(`Created Design ${n.label} — you are now editing it.`);
    S.app.go(`#/design/${n.id}/${S.tab}`);
  });
}

function doUndo() {
  if (!S || !history.undo(S.d)) return;
  touch(S.d);
  toast('Undone.');
  S.app.refreshNav();
  ctx.rerender();
}

function doRedo() {
  if (!S || !history.redo(S.d)) return;
  touch(S.d);
  toast('Redone.');
  S.app.refreshNav();
  ctx.rerender();
}

// Ctrl+Z / Ctrl+Y on the design screen (but not while typing in a box — the browser's own undo handles that)
document.addEventListener('keydown', (e) => {
  if (!S || !S.el.classList.contains('active') || !(e.ctrlKey || e.metaKey)) return;
  if (e.target.closest('input, textarea, select, [contenteditable]')) return;
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); doUndo(); }
  else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); doRedo(); }
});

function startOver() {
  let dlg = document.getElementById('restart-dialog');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'restart-dialog';
    dlg.className = 'converter';
    document.body.appendChild(dlg);
  }
  const d = S.d;
  dlg.innerHTML = `
    <form method="dialog">
      <h2>Start over with Design ${esc(d.label)}?</h2>
      <p class="hint">Choose what to clear. The name, version number and physical tests are kept. You can press <strong>Undo</strong> afterwards if you change your mind.</p>
      <label class="check-row"><input type="checkbox" name="inputs" checked> Clear all inputs (sizes, masses, launch, wind &amp; air, aerodynamics, balance, structure)</label>
      <label class="check-row"><input type="checkbox" name="parts" checked> Clear the parts list and pocketing (${d.components.length} part(s))</label>
      <label class="check-row"><input type="checkbox" name="cad" ${d.cad ? '' : 'disabled'}> Remove the CAD model ${d.cad ? `(${esc(d.cad.fileName)} — kept in model history)` : '(none loaded)'}</label>
      <label class="check-row"><input type="checkbox" name="weather" ${d.weather ? '' : 'disabled'}> Clear the NASA weather download</label>
      <div class="row-actions" style="margin-top:12px">
        <button class="btn primary" value="ok">Start over</button>
        <button class="btn" value="cancel">Cancel</button>
      </div>
    </form>`;
  dlg.onclose = () => {
    if (dlg.returnValue !== 'ok') return;
    const f = dlg.querySelector('form');
    if (f.inputs.checked) { d.values = {}; d.source = {}; d.measured = {}; d.sourceNote = {}; }
    if (f.parts.checked) d.components = [];
    if (f.cad.checked && d.cad) { d.cadHistory = [{ ...d.cad, removedAt: new Date().toISOString() }, ...(d.cadHistory || [])].slice(0, 10); d.cad = null; }
    if (f.weather.checked) delete d.weather;
    touch(d);
    history.record(d);
    toast('Started over. Press Undo to get everything back.');
    ctx.rerender();
  };
  dlg.returnValue = '';
  dlg.showModal();
}

function updateHeader() {
  const u = S.el.querySelector('#btn-undo'), r = S.el.querySelector('#btn-redo');
  if (u) { u.disabled = !history.canUndo(S.d); r.disabled = !history.canRedo(S.d); }
  const a = S.ev.analysis;
  S.el.querySelector('#design-status').innerHTML = a
    ? `Estimate: <strong>${fmt(a.flight.distance)} m</strong> · ${fmt(a.flight.time, 2)} s ${badge(simulationSource(S.ev.r))}`
    : `<span class="muted">Simulation needs ${S.ev.missing.length} more input${S.ev.missing.length > 1 ? 's' : ''}</span>`;
}

// ---------------------------------------------------------------------------
// Shared: "simulation can't run" block with explicit assumption button
// ---------------------------------------------------------------------------
export function missingBlockHTML(ev) {
  const assumable = assumableMissing(ev.missing);
  return `
    <div class="verdict warn">
      <strong>The simulation cannot run yet.</strong>
      <ul class="missing-list">
        ${ev.missing.map((m) => `<li>Cannot calculate the flight because <strong>${esc(m.label.toLowerCase())}</strong> is missing — ${esc(m.why)}
          <button class="linkbtn" data-goto-field="${m.fieldIds[0]}">Enter it →</button></li>`).join('')}
      </ul>
      ${assumable.length ? `
        <div class="assume-all">
          <button class="btn small" data-assume-all="${assumable.join(',')}">Use typical assumptions for: ${assumable.map((id) => esc(FIELD[id].label)).join(', ')}</button>
          <p class="hint">These will be marked <strong>Estimated</strong>, and every result that uses them will be marked Estimated too. Replace them with real data when you can.</p>
        </div>` : ''}
    </div>`;
}

export function bindMissingBlock(root) {
  root.addEventListener('click', (e) => {
    const g = e.target.closest('[data-goto-field]');
    if (g) { ctx.gotoField(g.dataset.gotoField); return; }
    const a = e.target.closest('[data-assume-all]');
    if (a) {
      applyAssumptions(S.d, a.dataset.assumeAll.split(','));
      toast('Assumptions applied and marked Estimated.');
      ctx.changed(null);
    }
  });
}

// ---------------------------------------------------------------------------
// Overview tab
// ---------------------------------------------------------------------------
const STATUS_ICON = { ok: '✓', est: '≈', missing: '⚠', optional: '○' };
const STATUS_TEXT = { ok: 'available', est: 'uses estimates', missing: 'missing', optional: 'optional' };

function renderOverview(panel) {
  const { d, ev, com } = S;
  const tests = db.tests.filter((t) => t.designId === d.id);
  const comp = completeness(d, ev.r, ev, com, tests);
  const checks = sanityChecks(d, ev.r, ev.analysis);
  const a = ev.analysis;
  const firstBind = !panel.dataset.bound;

  panel.innerHTML = `
    <div class="two-col wide-left">
      <div>
        <div class="panel section">
          <h2>Flight estimate</h2>
          ${a ? `
            <div class="metrics four">
              <div class="metric"><div class="label">Distance</div><div class="value">${fmt(a.flight.distance)} <small>m</small></div></div>
              <div class="metric"><div class="label">Flight time</div><div class="value">${fmt(a.flight.time, 2)} <small>s</small></div></div>
              <div class="metric"><div class="label">Max height (above water)</div><div class="value">${fmt(a.flight.maxHeight)} <small>m</small></div></div>
              <div class="metric"><div class="label">Impact speed</div><div class="value">${fmt(a.flight.impactSpeed)} <small>m/s</small></div></div>
            </div>
            <p class="hint">A simplified model — an estimate, not a prediction. See the Simulate tab for the flight path, graphs and an explanation.</p>
            <button class="btn primary small" data-go-tab="simulate">Open simulation →</button>`
          : missingBlockHTML(ev)}
        </div>

        ${rulesPanelHTML(d, ev, com)}

        <div class="panel section">
          <h2>Problem checks</h2>
          ${checks.length ? `<ul class="check-list">${checks.map((c) => `
            <li class="check ${c.level}"><span class="check-icon">${c.level === 'error' ? '✕' : c.level === 'warn' ? '!' : 'i'}</span>
              <span>${esc(c.text)} ${c.fieldId ? `<button class="linkbtn" data-goto-field="${c.fieldId}">Check it →</button>` : ''}</span></li>`).join('')}</ul>`
          : '<p class="muted">No obvious problems found in the information entered so far. (This only catches simple mistakes.)</p>'}
        </div>

        <div class="panel section">
          <h2>Description &amp; goals</h2>
          <textarea id="design-desc" rows="3" placeholder="What is special about this version? What are you trying to find out?">${esc(d.description)}</textarea>
          <p class="hint">Physical tests of this design: <strong>${tests.length}</strong>. <a href="#/tests">Record or view tests →</a></p>
        </div>
      </div>

      <div class="panel section">
        <h2>What information do we have?</h2>
        <p class="hint">Not a score — just a list of what is known and what is still needed.</p>
        <ul class="checklist">
          ${comp.items.map((i) => `
            <li class="cl-${i.status}">
              <span class="cl-icon" title="${STATUS_TEXT[i.status]}">${STATUS_ICON[i.status]}</span>
              <span class="cl-label">${esc(i.label)} <small class="muted">${esc(i.detail || STATUS_TEXT[i.status])}</small></span>
              ${i.go === 'tests' ? '<a class="linkbtn" href="#/tests">Go →</a>' : `<button class="linkbtn" ${i.field ? `data-goto-field="${i.field}"` : `data-go-tab="${i.go}"`}>Go →</button>`}
            </li>`).join('')}
        </ul>
        <p class="hint">✓ available · ≈ available but uses estimates · ⚠ missing · ○ optional</p>
        <h3>Analyses available</h3>
        <ul class="plain-list">
          ${comp.analyses.map((x) => `<li>${x.ok ? '✓' : '✕'} ${esc(x.label)} ${x.ok ? '' : `<small class="muted">— ${esc(x.why)}</small>`}</li>`).join('')}
        </ul>
      </div>
    </div>`;

  panel.querySelector('#design-desc').addEventListener('input', (e) => { S.d.description = e.target.value; touch(S.d); history.record(S.d); updateHeader(); });
  if (firstBind) {
    panel.dataset.bound = '1';
    bindMissingBlock(panel);
    bindRulesPanel(panel, ctx, () => {});
    panel.addEventListener('click', (e) => {
      const t = e.target.closest('[data-go-tab]');
      if (t) ctx.goTab(t.dataset.goTab);
    });
  }
}

// ---------------------------------------------------------------------------
// Inputs tab
// ---------------------------------------------------------------------------
function renderInputs(panel) {
  const level = db.settings.level || 'basic';
  panel.innerHTML = `
    <div class="inputs-layout">
      <div>
      ${nasaPanelHTML(S.d)}
      <div class="panel section">
        <div class="panel-head">
          <h2>Design inputs</h2>
          <div class="level-switch" role="radiogroup" aria-label="How much detail to show">
            ${LEVELS.map((l) => `<label><input type="radio" name="level" value="${l}" ${l === level ? 'checked' : ''}> ${LEVEL_LABEL[l]}</label>`).join('')}
          </div>
        </div>
        <p class="hint">Start with <strong>Basic</strong>. Blank fields are "Not provided" — the app never fills them in silently.
          Grey values are calculated from other inputs; type over them to enter your own. ↺ clears a value (or restores the CAD measurement).
          Need feet or pounds? Use <strong>⇄ Units</strong> at the top.</p>
        <form id="input-form" novalidate>${groupsHTML('inputs')}</form>
      </div>
      </div>
      <aside class="panel section sticky-side" id="inputs-side"></aside>
    </div>`;
  const form = panel.querySelector('#input-form');
  bindFields(form, () => S.d, (id) => ctx.changed(id));
  panel.querySelectorAll('input[name="level"]').forEach((r) => r.addEventListener('change', () => {
    db.settings.level = r.value;
    touch(S.d);
    updateInputs(panel, ctx, null);
  }));
  bindMissingBlock(panel.querySelector('#inputs-side'));
  bindNasaPanel(panel.querySelector('.nasa-panel'), ctx);
  updateInputs(panel, ctx, null);
}

function updateInputs(panel, _ctx, skipId) {
  const form = panel.querySelector('#input-form');
  if (!form) return;
  const requiredIds = S.ev.missing.flatMap((m) => m.fieldIds.slice(0, 1));
  refreshFields(form, S.d, S.ev.r, { level: db.settings.level || 'basic', requiredIds, skipId });
  refreshNasaPanel(panel.querySelector('.nasa-panel'), ctx);
  const a = S.ev.analysis;
  const checks = sanityChecks(S.d, S.ev.r, a).filter((c) => c.level !== 'info');
  panel.querySelector('#inputs-side').innerHTML = `
    <h2>Live estimate</h2>
    ${a ? `
      <div class="metrics">
        <div class="metric"><div class="label">Distance</div><div class="value">${fmt(a.flight.distance)} <small>m</small></div></div>
        <div class="metric"><div class="label">Flight time</div><div class="value">${fmt(a.flight.time, 2)} <small>s</small></div></div>
        <div class="metric"><div class="label">Max height</div><div class="value">${fmt(a.flight.maxHeight)} <small>m</small></div></div>
        <div class="metric"><div class="label">Stall speed</div><div class="value">${fmt(a.stallSpeed)} <small>m/s</small></div></div>
      </div>
      <p class="hint">Updates as you type. ${Object.values(S.ev.r.src).includes('estimated') ? 'Uses some <strong>Estimated</strong> inputs.' : ''}</p>
      <a class="btn primary small" href="#/design/${S.d.id}/simulate">See the flight →</a>`
    : missingBlockHTML(S.ev)}
    ${checks.length ? `<h3>Checks</h3><ul class="check-list compact">${checks.map((c) => `<li class="check ${c.level}"><span class="check-icon">${c.level === 'error' ? '✕' : '!'}</span><span>${esc(c.text)}</span></li>`).join('')}</ul>` : ''}`;
}
