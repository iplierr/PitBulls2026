// What-if tab: sweep one input over a range, compare a single change, and one-at-a-time sensitivity.
import { analyze } from '../physics.js';
import { lineChart } from '../charts.js';
import { whatIfVariables, outputsOf, OUTPUTS, sensitivity } from '../explain.js';
import { simulationSource } from '../calcs.js';
import { esc, fmt, sig, badge } from '../ui.js';
import { missingBlockHTML, bindMissingBlock } from './design.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
let state = { varId: 'mass' };

export function render(panel, ctx) {
  const { ev } = ctx;
  if (!ev.analysis) {
    panel.innerHTML = `<div class="panel section"><h2>What if?</h2><p>The what-if tool changes one input at a time and re-runs the simulation, so it needs a working simulation first.</p>${missingBlockHTML(ev)}</div>`;
    bindMissingBlock(panel);
    return;
  }
  const vars = whatIfVariables(ev);
  if (!vars.some((v) => v.id === state.varId)) state.varId = vars[0].id;
  panel.innerHTML = `
    <div class="panel section">
      <h2>What if we change one thing?</h2>
      <p class="hint">Pick an input and a range. The simulation is re-run for each value while everything else stays the same.
        This shows engineering differences only — it does not say which design is "best".</p>
      <div class="whatif-controls">
        <label>Change <select id="wi-var">${vars.map((v) => `<option value="${v.id}" ${v.id === state.varId ? 'selected' : ''}>${esc(v.label)}${v.unit ? ` (${esc(v.unit)})` : ''}</option>`).join('')}</select></label>
        <label>from <input id="wi-from" type="number" step="any" class="short"></label>
        <label>to <input id="wi-to" type="number" step="any" class="short"></label>
        <label>steps <input id="wi-steps" type="number" min="3" max="41" value="11" class="tiny-in"></label>
        <span class="muted small" id="wi-current"></span>
      </div>
      <p class="hint" id="wi-note"></p>
      <div id="wi-sentences"></div>
      <div class="chart-grid five">${OUTPUTS.map((o) => `<div><h3>${o.label} (${o.unit})</h3><canvas class="chart" id="wi-${o.id}"></canvas></div>`).join('')}</div>
      <details class="explain"><summary>Table of values</summary><div class="table-wrap" id="wi-table"></div></details>
    </div>

    <div class="panel section">
      <h2>Compare one change</h2>
      <div class="whatif-controls">
        <label>New value for <strong id="one-label"></strong> <input id="one-val" type="number" step="any" class="short"></label>
      </div>
      <div id="one-out"></div>
    </div>

    <div class="panel section">
      <h2>Which inputs matter most (in this model)?</h2>
      <p class="hint">Each input is nudged up and down (±10%, or a fixed step for angles and wind) and the change in estimated distance is shown.
        Inputs at the top deserve the most careful measurement.</p>
      <div id="sens"></div>
    </div>`;

  const sel = panel.querySelector('#wi-var');
  sel.addEventListener('change', () => { state.varId = sel.value; setDefaults(panel, ctx); runSweep(panel, ctx); runOne(panel, ctx); });
  ['#wi-from', '#wi-to', '#wi-steps'].forEach((s) => panel.querySelector(s).addEventListener('input', () => runSweep(panel, ctx)));
  panel.querySelector('#one-val').addEventListener('input', () => runOne(panel, ctx));
  setDefaults(panel, ctx);
  update(panel, ctx);
}

export function update(panel, ctx) {
  if (!ctx.ev.analysis || !panel.querySelector('#wi-var')) return render(panel, ctx);
  runSweep(panel, ctx);
  runOne(panel, ctx);
  renderSensitivity(panel, ctx);
}

const currentVar = (ctx) => whatIfVariables(ctx.ev).find((v) => v.id === state.varId);

function setDefaults(panel, ctx) {
  const v = currentVar(ctx);
  const x0 = v.get(ctx.ev.params);
  let lo, hi;
  if (v.additive) { lo = x0 - 3 * v.additive; hi = x0 + 3 * v.additive; }
  else { lo = x0 * 0.7; hi = x0 * 1.3; }
  if (['mass', 'span', 'wingArea', 'deckHeight', 'cd0', 'knownCD', 'clMax'].includes(v.id)) lo = Math.max(lo, x0 * 0.1);
  if (v.id === 'launchSpeed') lo = Math.max(0, lo);
  panel.querySelector('#wi-from').value = +lo.toPrecision(3);
  panel.querySelector('#wi-to').value = +hi.toPrecision(3);
  panel.querySelector('#one-val').value = +(v.additive ? x0 + v.additive : x0 * 1.1).toPrecision(3);
}

function runSweep(panel, ctx) {
  const v = currentVar(ctx);
  const p0 = ctx.ev.params;
  const x0 = v.get(p0);
  const from = parseFloat(panel.querySelector('#wi-from').value);
  const to = parseFloat(panel.querySelector('#wi-to').value);
  const n = Math.min(41, Math.max(3, parseInt(panel.querySelector('#wi-steps').value, 10) || 11));
  panel.querySelector('#wi-current').textContent = `Current value: ${sig(x0, 4)} ${v.unit}`;
  panel.querySelector('#wi-note').textContent = v.note || '';
  if (!isNum(from) || !isNum(to) || from === to) {
    panel.querySelector('#wi-sentences').innerHTML = '<p class="muted">Enter a valid range.</p>';
    return;
  }
  const rows = [];
  for (let i = 0; i < n; i++) {
    const x = from + (to - from) * (i / (n - 1));
    const p = v.apply(p0, x);
    if (!(p.mass > 0 && p.wingArea > 0 && p.span > 0 && p.deckHeight > 0 && p.airDensity > 0)) continue;
    rows.push({ x, ...outputsOf(analyze(p)) });
  }
  const base = outputsOf(ctx.ev.analysis);
  for (const o of OUTPUTS) {
    lineChart(panel.querySelector(`#wi-${o.id}`), {
      xLabel: `${v.label} (${v.unit || '–'})`, yLabel: o.unit, yZero: false,
      series: [
        { color: '#0b5cd6', points: rows.map((r) => [r.x, r[o.id]]), dots: true, dotSize: 2.5 },
        { name: 'current design', color: '#d61f1f', points: [[x0, base[o.id]]], dotsOnly: true, dotSize: 5 },
      ],
      emptyText: 'Not available',
    });
  }
  const first = rows[0], last = rows[rows.length - 1];
  const src = simulationSource(ctx.ev.r);
  const sentence = (o) => `Changing ${v.label.toLowerCase()} from ${sig(first.x, 3)} to ${sig(last.x, 3)} ${v.unit} changed estimated ${o.label.toLowerCase()} from
    <strong>${sig(first[o.id], 3)}</strong> to <strong>${sig(last[o.id], 3)} ${o.unit}</strong>.`;
  const stallRows = rows.filter((r) => r.stalled);
  panel.querySelector('#wi-sentences').innerHTML = `
    <ul class="plain-list">${OUTPUTS.filter((o) => isNum(first[o.id]) && isNum(last[o.id])).map((o) => `<li>${sentence(o)}</li>`).join('')}</ul>
    ${stallRows.length ? `<p class="verdict warn">The wing is stalled for ${stallRows.length} of these values (${sig(stallRows[0].x, 3)}${stallRows.length > 1 ? ` … ${sig(stallRows[stallRows.length - 1].x, 3)}` : ''} ${v.unit}). Results there are very uncertain.</p>` : ''}
    <p class="hint">All values ${badge(src)} — from the simplified model.</p>`;
  panel.querySelector('#wi-table').innerHTML = `<table class="list-table"><thead><tr><th>${esc(v.label)} (${esc(v.unit)})</th>${OUTPUTS.map((o) => `<th>${o.label} (${o.unit})</th>`).join('')}<th>Stalled?</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td class="num">${sig(r.x, 4)}</td>${OUTPUTS.map((o) => `<td class="num">${sig(r[o.id], 4)}</td>`).join('')}<td>${r.stalled ? 'yes' : ''}</td></tr>`).join('')}</tbody></table>`;
}

function runOne(panel, ctx) {
  const v = currentVar(ctx);
  panel.querySelector('#one-label').textContent = `${v.label.toLowerCase()} (${v.unit || '–'})`;
  const x = parseFloat(panel.querySelector('#one-val').value);
  const out = panel.querySelector('#one-out');
  const x0 = v.get(ctx.ev.params);
  if (!isNum(x)) { out.innerHTML = ''; return; }
  const p = v.apply(ctx.ev.params, x);
  if (!(p.mass > 0 && p.wingArea > 0 && p.span > 0 && p.deckHeight > 0)) { out.innerHTML = '<p class="muted">That value is not physically possible.</p>'; return; }
  const a = outputsOf(ctx.ev.analysis), b = outputsOf(analyze(p));
  out.innerHTML = `<table class="list-table"><thead><tr><th></th><th>Current (${sig(x0, 4)} ${esc(v.unit)})</th><th>Changed (${sig(x, 4)} ${esc(v.unit)})</th><th>Difference</th></tr></thead><tbody>
    ${OUTPUTS.map((o) => {
      const dlt = b[o.id] - a[o.id];
      return `<tr><td>${o.label}</td><td class="num">${sig(a[o.id], 4)} ${o.unit}</td><td class="num">${sig(b[o.id], 4)} ${o.unit}</td>
        <td class="num">${isNum(dlt) ? `${dlt >= 0 ? '+' : ''}${sig(dlt, 3)} ${o.unit} (${a[o.id] ? `${dlt >= 0 ? '+' : ''}${fmt(dlt / a[o.id] * 100, 1)}%` : '–'})` : '–'}</td></tr>`;
    }).join('')}</tbody></table>
    ${b.stalled && !a.stalled ? '<p class="verdict warn">With this change the wing stalls.</p>' : ''}`;
}

function renderSensitivity(panel, ctx) {
  const sens = sensitivity(ctx.ev);
  const max = Math.max(0.01, ...sens.map((s) => Math.max(Math.abs(s.dLo), Math.abs(s.dHi))));
  panel.querySelector('#sens').innerHTML = `<div class="sens">${sens.map((s) => `
    <div class="sens-row">
      <span class="sens-label">${esc(s.label)} <small class="muted">${esc(s.stepText)}</small></span>
      <span class="sens-track">
        <span class="sens-bar ${s.dLo < 0 ? 'neg' : 'pos'}" style="${barStyle(s.dLo, max)}" title="lower value: ${fmt(s.dLo, 2)} m"></span>
        <span class="sens-bar ${s.dHi < 0 ? 'neg' : 'pos'}" style="${barStyle(s.dHi, max)}" title="higher value: ${fmt(s.dHi, 2)} m"></span>
        <span class="sens-mid"></span>
      </span>
      <span class="sens-val">lower: ${s.dLo >= 0 ? '+' : ''}${fmt(s.dLo, 2)} m · higher: ${s.dHi >= 0 ? '+' : ''}${fmt(s.dHi, 2)} m</span>
    </div>`).join('')}</div>
    <p class="hint">Bars show the change in estimated distance. Green = further, red = shorter. ${badge(simulationSource(ctx.ev.r))}</p>`;
}

function barStyle(d, max) {
  const w = Math.abs(d) / max * 50;
  return d >= 0 ? `left:50%;width:${w}%` : `left:${50 - w}%;width:${w}%`;
}
