// Compare design versions side by side. No scores or rankings — only the values and their differences.
import { db, save, sortedDesigns, designTitle } from '../store.js';
import { evaluate, centerOfMass } from '../model.js';
import { stabilityCalcs, simulationSource } from '../calcs.js';
import { esc, sig, badge } from '../ui.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

const METRICS = [
  ['Mass', null],
  ['Total mass', 'kg', (c) => [c.r.v.totalMass, c.r.src.totalMass]],
  ['Craft mass (no pilot)', 'kg', (c) => [c.r.v.craftMass, c.r.src.craftMass]],
  ['Pilot mass', 'kg', (c) => [c.r.v.pilotMass, c.r.src.pilotMass]],
  ['Centre of mass from nose', 'm', (c) => [c.com.x, isNum(c.com.x) ? (c.com.guessed ? 'estimated' : 'calculated') : 'missing']],
  ['Geometry', null],
  ['Wingspan', 'm', (c) => [c.r.v.span, c.r.src.span]],
  ['Wing area', 'm²', (c) => [c.r.v.wingArea, c.r.src.wingArea]],
  ['Average chord', 'm', (c) => [c.r.v.chord, c.r.src.chord]],
  ['Aspect ratio', '', (c) => [c.r.v.AR, c.r.src.AR]],
  ['Wing loading', 'N/m²', (c) => [c.r.v.weight / c.r.v.wingArea, isNum(c.r.v.weight / c.r.v.wingArea) ? worst(c, ['weight', 'wingArea']) : 'missing']],
  ['Length', 'm', (c) => [c.r.v.length, c.r.src.length]],
  ['Launch & air', null],
  ['Launch speed', 'm/s', (c) => [c.r.v.launchSpeed, c.r.src.launchSpeed]],
  ['Launch angle', '°', (c) => [c.r.v.launchAngle, c.r.src.launchAngle]],
  ['Deck height', 'm', (c) => [c.r.v.deckHeight, c.r.src.deckHeight]],
  ['Headwind component', 'm/s', (c) => [c.r.v.headwind, c.r.src.headwind]],
  ['Aerodynamics', null],
  ['Lift coefficient used', '', (c) => [c.a?.aero.CL, c.simSrc]],
  ['Drag coefficient used', '', (c) => [c.a?.aero.CD, c.simSrc]],
  ['Glide ratio L/D', '', (c) => [c.a?.LD, c.simSrc]],
  ['Stall speed', 'm/s', (c) => [c.a?.stallSpeed, c.simSrc]],
  ['Static margin', '% chord', (c) => { const s = stabilityCalcs(c.r, c.com).find((x) => x.id === 'sm'); return [s.result, s.src]; }],
  ['Simulation (estimates)', null],
  ['Distance', 'm', (c) => [c.a?.flight.distance, c.simSrc]],
  ['Flight time', 's', (c) => [c.a?.flight.time, c.simSrc]],
  ['Max height', 'm', (c) => [c.a?.flight.maxHeight, c.simSrc]],
  ['Impact speed', 'm/s', (c) => [c.a?.flight.impactSpeed, c.simSrc]],
  ['Peak load factor', 'g', (c) => [c.a?.flight.peakLoadFactor, c.simSrc]],
  ['Physical tests', null],
  ['Tests recorded', '', (c) => [c.tests.length, 'calculated']],
  ['Longest measured distance', 'm', (c) => { const ds = c.tests.map((t) => t.distance).filter(isNum); return [ds.length ? Math.max(...ds) : NaN, ds.length ? 'measured' : 'missing']; }],
];

function worst(c, ids) {
  return ids.some((id) => c.r.src[id] === 'estimated') ? 'estimated' : 'calculated';
}

export function show(el) {
  const designs = sortedDesigns();
  let sel = (db.settings.compare || []).filter((id) => designs.some((d) => d.id === id));
  if (!sel.length) sel = designs.slice(0, 3).map((d) => d.id);

  el.innerHTML = `
    <h1>Compare designs</h1>
    <p class="lead left">Values side by side, with the difference from the first selected design. There is no score and no "winner" — the numbers are for the team to discuss.</p>
    <div class="panel section">
      <h2>Choose designs</h2>
      ${designs.length ? `<div class="pick-list">${designs.map((d) => `<label><input type="checkbox" value="${d.id}" ${sel.includes(d.id) ? 'checked' : ''}> ${esc(designTitle(d))}</label>`).join('')}</div>`
      : '<p class="muted">No designs yet.</p>'}
    </div>
    <div class="panel section" id="cmp-table"></div>`;
  el.querySelectorAll('.pick-list input').forEach((cb) => cb.addEventListener('change', () => {
    db.settings.compare = [...el.querySelectorAll('.pick-list input:checked')].map((x) => x.value);
    save();
    renderTable(el, db.settings.compare);
  }));
  renderTable(el, sel);
}

function renderTable(el, ids) {
  const box = el.querySelector('#cmp-table');
  const cols = ids.map((id) => db.designs.find((d) => d.id === id)).filter(Boolean).map((d) => {
    const ev = evaluate(d);
    return { d, r: ev.r, a: ev.analysis, ev, com: centerOfMass(d, ev.r), tests: db.tests.filter((t) => t.designId === d.id), simSrc: ev.analysis ? simulationSource(ev.r) : 'missing' };
  });
  if (!cols.length) { box.innerHTML = '<p class="muted">Select at least one design.</p>'; return; }
  const ref = cols[0];
  const body = METRICS.map(([label, unit, fn]) => {
    if (!fn) return `<tr class="group-row"><th colspan="${cols.length + 1}">${label}</th></tr>`;
    const vals = cols.map((c) => fn(c));
    const max = Math.max(...vals.map(([v]) => (isNum(v) ? Math.abs(v) : 0)));
    const [rv] = vals[0];
    return `<tr><th>${label}${unit ? ` <span class="unit">(${unit})</span>` : ''}</th>${vals.map(([v, s], i) => {
      if (!isNum(v)) return `<td class="muted small">${cols[i].a || !label.match(/Distance|time|height|Impact|Lift|Drag|Glide|Stall|load/) ? 'not available' : 'simulation needs inputs'}</td>`;
      const diff = i > 0 && isNum(rv) ? v - rv : NaN;
      return `<td><div class="cmp-cell"><span class="num">${sig(v, 4)}</span>${badge(s || 'entered')}</div>
        ${max > 0 ? `<div class="cmp-bar"><span style="width:${Math.abs(v) / max * 100}%"></span></div>` : ''}
        ${isNum(diff) ? `<div class="small ${diff === 0 ? 'muted' : ''}">${diff >= 0 ? '+' : ''}${sig(diff, 3)}${rv ? ` (${diff >= 0 ? '+' : ''}${(diff / Math.abs(rv) * 100).toFixed(0)}%)` : ''} vs ${esc(ref.d.label)}</div>` : ''}</td>`;
    }).join('')}</tr>`;
  }).join('');
  box.innerHTML = `
    <div class="table-wrap"><table class="list-table cmp-table">
      <thead><tr><th></th>${cols.map((c) => `<th><a href="#/design/${c.d.id}/overview">${esc(designTitle(c.d))}</a></th>`).join('')}</tr></thead>
      <tbody>${body}</tbody></table></div>
    <p class="hint">Differences are relative to <strong>${esc(designTitle(ref.d))}</strong> (the first selected). Simulation values are estimates from the simplified model.
      Compare estimates only when the designs use similar assumptions — check the badges.</p>`;
}
