// Design workspace: header, tabs, Overview and Design numbers steps. Other tabs live in their own modules.
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
import { airfoilPanelHTML, bindAirfoilPanel } from './airfoil-panel.js';
import { ruleChecks, partsRuleWarnings, rulesetOf } from '../rules.js';

const overviewTab = { render: renderOverview, update: renderOverview };
const inputsTab = { render: renderInputs, update: updateInputs };

// Plain-language tab names. Steps 1–4 are the normal order; "More tools" are optional extras.
const TABS = [
  ['overview', 'Summary', overviewTab, { home: true, desc: 'Your results, the Miami rules check, and what to do next.' }],
  ['inputs', 'Design numbers', inputsTab, { step: 1, desc: 'Step 1 — type in the craft\'s size, weight and launch conditions. You can type feet and pounds (e.g. "28 ft", "400 lb").' }],
  ['cad', '3D model', cadTab, { step: 2, desc: 'Step 2 (optional) — upload your CAD file (STL or GLB) to measure the craft automatically.' }],
  ['mass', 'Parts & balance', massTab, { step: 3, desc: 'Step 3 — list the parts, their weights and positions to find the balance point (centre of mass).' }],
  ['simulate', 'Fly it', simTab, { step: 4, desc: 'Step 4 — watch the estimated flight, with graphs and a plain-English explanation.' }],
  ['whatif', 'What if?', whatifTab, { more: true, desc: 'Change one thing (weight, wingspan, launch speed…) and see how the flight changes.' }],
  ['calcs', 'The math', calcTab.calcs, { more: true, desc: 'Every equation, its inputs and where each number came from.' }],
  ['structure', 'Strength', calcTab.structure, { more: true, desc: 'Rough check of whether the wing spar is strong enough, and water-impact loads.' }],
];
const TAB = Object.fromEntries(TABS.map(([id, label, mod, meta]) => [id, { id, label, mod, ...meta }]));

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
        <button class="btn small" id="btn-version" title="Save a copy as the next version (e.g. 1 → 1.1) before changing things, so you can compare">Save as new version</button>
        <a class="btn small" href="#/report/${d.id}" title="Printable report, PDF and spreadsheet exports">Report</a>
        <details class="menu">
          <summary class="btn small">More ▾</summary>
          <div class="menu-list">
            <button type="button" id="btn-dup">Duplicate as a new design</button>
            <button type="button" id="btn-restart">Start over… <small>(clear this design)</small></button>
            <button type="button" id="btn-delete" class="danger">Delete design</button>
          </div>
        </details>
      </div>
    </div>
    ${d.example ? '<div class="verdict warn example-banner"><strong>Example design.</strong> These numbers are made up so you can see how the app works. Don\'t use its results for your craft — start your own design from the Dashboard.</div>' : ''}
    <nav class="tabs steps" role="tablist" aria-label="Design steps">
      ${TABS.filter(([, , , m]) => m.home).map(([id, label]) => `<a href="#/design/${d.id}/${id}" data-tab="${id}" role="tab" class="tab-home">⌂ ${label}</a>`).join('')}
      <span class="tab-sep">Steps</span>
      ${TABS.filter(([, , , m]) => m.step).map(([id, label, , m]) => `<a href="#/design/${d.id}/${id}" data-tab="${id}" role="tab"><span class="step-num">${m.step}</span>${label}<span class="step-st" data-st="${id}"></span></a>`).join('')}
      <span class="tab-sep">More tools</span>
      ${TABS.filter(([, , , m]) => m.more).map(([id, label]) => `<a href="#/design/${d.id}/${id}" data-tab="${id}" role="tab" class="tab-more">${label}</a>`).join('')}
    </nav>
    <div class="tab-desc-row">
      <p class="tab-desc" id="tab-desc"></p>
      <details class="legend-help">
        <summary>What do the coloured labels mean?</summary>
        <ul>
          <li>${badge('measured')} measured from your CAD model (or a part you weighed)</li>
          <li>${badge('entered')} typed in by your team</li>
          <li>${badge('calculated')} worked out from other numbers with an equation</li>
          <li>${badge('estimated')} a guess or typical value — or worked out from one. Replace with real data when you can.</li>
          <li>${badge('missing')} not filled in yet. The app never fills in blanks behind your back.</li>
        </ul>
      </details>
    </div>
    <div class="tab-panel"></div>`;
  // Close the More menu after choosing an item
  const menu = S.el.querySelector('details.menu');
  menu.querySelector('.menu-list').addEventListener('click', () => menu.removeAttribute('open'));
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
  // Step status marks: ✓ done, ! needs something, ○ optional
  const st = {
    inputs: S.ev.missing.length ? ['todo', '!', `${S.ev.missing.length} thing(s) still needed`] : ['done', '✓', 'Enough to run the simulation'],
    cad: S.d.cad ? ['done', '✓', 'CAD model loaded'] : ['opt', '○', 'Optional'],
    mass: Number.isFinite(S.com.x) ? ['done', '✓', 'Balance point calculated'] : ['todo', '!', 'Parts or positions still needed'],
    simulate: S.ev.analysis ? ['done', '✓', 'Simulation ready'] : ['todo', '–', 'Needs step 1 first'],
  };
  S.el.querySelectorAll('[data-st]').forEach((el) => {
    const [cls, icon, title] = st[el.dataset.st];
    el.className = `step-st st-${cls}`;
    el.textContent = icon;
    el.title = title;
    el.closest('a').title = title;
  });
  const desc = S.el.querySelector('#tab-desc');
  if (desc && S.tab) desc.textContent = TAB[S.tab].desc;
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
          <button class="linkbtn" data-goto-field="${m.fieldIds[0]}">Enter it →</button>${m.id === 'deckHeight' && S && rulesetOf(S.d)?.deck ? ` <button class="btn tiny" data-deck-official="1">Use the official ${rulesetOf(S.d).deck.ft} ft</button>` : ''}</li>`).join('')}
      </ul>
      ${assumable.length ? `
        <div class="assume-all">
          <button class="btn small" data-assume-all="${assumable.join(',')}">Use typical values for: ${assumable.map((id) => esc(FIELD[id].label)).join(', ')}</button>
          <p class="hint">These will be marked <strong>Estimated</strong>, and every result that uses them will be marked Estimated too. Replace them with real data when you can.</p>
        </div>` : ''}
    </div>`;
}

export function bindMissingBlock(root) {
  root.addEventListener('click', (e) => {
    const g = e.target.closest('[data-goto-field]');
    if (g) { ctx.gotoField(g.dataset.gotoField); return; }
    if (e.target.closest('[data-deck-official]')) {
      const deck = rulesetOf(S.d).deck;
      S.d.values.deckHeight = +deck.m.toFixed(4);
      S.d.source.deckHeight = 'entered';
      S.d.sourceNote = { ...(S.d.sourceNote || {}), deckHeight: deck.note };
      toast(`Deck height set to the official ${deck.ft} ft.`);
      ctx.changed(null);
      return;
    }
    const a = e.target.closest('[data-assume-all]');
    if (a) {
      applyAssumptions(S.d, a.dataset.assumeAll.split(','));
      toast('Typical values filled in and marked Estimated.');
      ctx.changed(null);
    }
  });
}

// ---------------------------------------------------------------------------
// Overview tab
// ---------------------------------------------------------------------------
const STATUS_ICON = { ok: '✓', est: '≈', missing: '⚠', optional: '○' };
const STATUS_TEXT = { ok: 'available', est: 'uses estimates', missing: 'missing', optional: 'optional' };

// The single most useful thing to do next, in plain words.
function nextStep(d, ev, com, tests) {
  const partWarn = partsRuleWarnings(d).find((w) => w.level === 'bad');
  if (partWarn) {
    return { title: partWarn.title, text: partWarn.detail, btn: '<button class="btn primary" data-scroll="rules-panel">See the rules check ↓</button>' };
  }
  if (ev.missing.length) {
    const m = ev.missing[0];
    const assumable = assumableMissing(ev.missing);
    const onlyAssumable = ev.missing.every((x) => x.fieldIds.some((id) => assumable.includes(id)));
    if (onlyAssumable) {
      return { title: 'Almost there — a few aerodynamics or weather numbers are missing',
        text: 'If you don\'t know them yet, use the typical values (they will be clearly marked Estimated). Then you\'ll see the flight.',
        btn: `<button class="btn primary" data-assume-all="${assumable.join(',')}">Use typical values and show the flight</button>` };
    }
    return { title: `Fill in: ${m.label.toLowerCase()}${ev.missing.length > 1 ? ` (and ${ev.missing.length - 1} more)` : ''}`,
      text: m.why, btn: `<button class="btn primary" data-goto-field="${m.fieldIds[0]}">Enter it →</button>` };
  }
  const over = ruleChecks(d, ev, com).filter((c) => c.status === 'over');
  if (over.length) {
    return { title: `Your design breaks a Miami rule: ${over.map((c) => c.label.toLowerCase()).join(', ')}`,
      text: over[0].fixes[0] || 'See the rules check below for what to change.', btn: '<button class="btn primary" data-scroll="rules-panel">See the rules check ↓</button>' };
  }
  if (!Number.isFinite(com.x)) {
    return { title: 'Find your balance point', text: 'List the parts with their weights and positions so the app can find the centre of mass — an unbalanced craft is a common reason flights end early.',
      btn: '<button class="btn primary" data-go-tab="mass">Go to Parts &amp; balance →</button>' };
  }
  if (!tests.length) {
    return { title: 'Watch the flight, then test for real', text: 'See the estimated flight, then record a real practice test so you can compare it with the simulation.',
      btn: '<button class="btn primary" data-go-tab="simulate">Fly it →</button> <a class="btn" href="#/tests">Record a test</a>' };
  }
  return { title: 'Try an improvement', text: 'Use "What if?" to see which change helps the flight most, then save it as a new version so you can compare.',
    btn: '<button class="btn primary" data-go-tab="whatif">What if? →</button>' };
}

function renderOverview(panel) {
  const { d, ev, com } = S;
  const tests = db.tests.filter((t) => t.designId === d.id);
  const comp = completeness(d, ev.r, ev, com, tests);
  const checks = sanityChecks(d, ev.r, ev.analysis);
  const a = ev.analysis;
  const firstBind = !panel.dataset.bound;

  const next = nextStep(d, ev, com, tests);
  panel.innerHTML = `
    <div class="next-step">
      <div class="next-label">Your next step</div>
      <div class="next-title">${esc(next.title)}</div>
      <p>${esc(next.text)}</p>
      <div class="row-actions">${next.btn}</div>
    </div>
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
            <p class="hint">A simplified model — an estimate, not a prediction. See the Fly it step for the flight path, graphs and an explanation.</p>
            <button class="btn primary small" data-go-tab="simulate">Watch the flight →</button>`
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
      const sc = e.target.closest('[data-scroll]');
      if (sc) document.getElementById(sc.dataset.scroll)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
}

// ---------------------------------------------------------------------------
// Design numbers step
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
      ${airfoilPanelHTML(S.d)}
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
  bindAirfoilPanel(panel.querySelector('.airfoil-panel'), ctx);
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
