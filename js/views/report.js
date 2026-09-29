// Printable design report (browser Print → Save as PDF) + CSV/JSON exports.
import { db, getDesign, designTitle, today } from '../store.js';
import { FIELDS, FIELD } from '../fields.js';
import { evaluate, centerOfMass, sanityChecks, componentMass, partMassSource, pocketRemoval, SOURCE_LABEL } from '../model.js';
import { designCalcs, stabilityCalcs, structureCalcs, simulationSource } from '../calcs.js';
import { explain, sensitivity } from '../explain.js';
import { TrajectoryView } from '../trajectory.js';
import { lineChart } from '../charts.js';
import { simFor } from './tests.js';
import { LIMITATIONS_HTML } from './sim-tab.js';
import { esc, fmt, sig, badge, download, toCSV, slug } from '../ui.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function calcRows(cards) {
  return cards.map((c) => `<tr><td>${esc(c.title)}</td><td><code>${esc(c.eq)}</code></td>
    <td class="num">${isNum(c.result) ? `${sig(c.result, 4)} ${esc(c.unit)}` : `<span class="muted">${esc(c.missingText || 'n/a')}</span>`}</td><td>${badge(c.src)}</td></tr>`).join('');
}
const calcTable = (cards) => `<table class="list-table report-table"><thead><tr><th>Quantity</th><th>Equation</th><th>Result</th><th>Source</th></tr></thead><tbody>${calcRows(cards)}</tbody></table>`;

export function show(el, app, { id }) {
  const d = getDesign(id);
  const ev = evaluate(d);
  const { r, analysis: a } = ev;
  const com = centerOfMass(d, r);
  const tests = db.tests.filter((t) => t.designId === d.id).sort((x, y) => (x.number || 0) - (y.number || 0));
  const notes = db.notes.filter((n) => n.designId === d.id).sort((x, y) => String(x.date).localeCompare(String(y.date)));
  const checks = sanityChecks(d, r, a);
  const ex = a ? explain(ev, d, com, sensitivity(ev)) : null;
  const an = d.cad?.analysis;

  const inputRows = FIELDS.map((f) => {
    const v = r.v[f.id];
    const shown = v === undefined || v === '' ? '<span class="muted">Not provided</span>'
      : f.type === 'select' ? esc(f.options.find((o) => o[0] === v)?.[1] || v) : f.type === 'text' ? esc(v) : `${sig(v, 4)} ${esc(f.unit || '')}`;
    const note = d.sourceNote?.[f.id] ? `<br><small class="muted">${esc(d.sourceNote[f.id])}</small>` : '';
    return `<tr><td>${esc(f.label)}</td><td class="num">${shown}</td><td>${badge(v === undefined || v === '' ? 'missing' : r.src[f.id])}${note}</td></tr>`;
  }).join('');

  el.innerHTML = `
    <div class="report-actions no-print">
      <a class="btn" href="#/design/${d.id}/overview">← Back to design</a>
      <button class="btn primary" id="print">Print / Save as PDF</button>
      <button class="btn" id="csv-sim" ${a ? '' : 'disabled'}>Simulation data (.csv)</button>
      <button class="btn" id="csv-inputs">Inputs &amp; results (.csv)</button>
      <button class="btn" id="json-design">This design (.json)</button>
    </div>
    <article class="report">
      <header class="report-head">
        <h1>${esc(designTitle(d))}</h1>
        <p>Flugtag Lab design report · generated ${today()} · last edited ${esc((d.updated || '').slice(0, 10))}</p>
        <p class="report-disclaimer">Preliminary engineering estimates from simplified models. Not a prediction, certification or safety approval.
          Every value is labelled Measured (from CAD), Entered, Calculated or Estimated.</p>
        ${d.description ? `<p><strong>Description:</strong> ${esc(d.description)}</p>` : ''}
      </header>

      <h2>1. Key results</h2>
      ${a ? `<table class="list-table report-table"><tbody>
        <tr><td>Estimated distance</td><td class="num">${fmt(a.flight.distance)} m</td><td>${badge(simulationSource(r))}</td></tr>
        <tr><td>Estimated flight time</td><td class="num">${fmt(a.flight.time, 2)} s</td><td>${badge(simulationSource(r))}</td></tr>
        <tr><td>Estimated maximum height (above water)</td><td class="num">${fmt(a.flight.maxHeight)} m</td><td>${badge(simulationSource(r))}</td></tr>
        <tr><td>Estimated impact speed</td><td class="num">${fmt(a.flight.impactSpeed)} m/s</td><td>${badge(simulationSource(r))}</td></tr>
        <tr><td>Distance with no lift (comparison)</td><td class="num">${fmt(a.noLift.distance)} m</td><td>${badge(simulationSource(r))}</td></tr>
      </tbody></table>
      <canvas id="rep-traj" class="report-traj"></canvas>
      <div class="chart-grid">
        <div><h3>Height vs time</h3><canvas class="chart" id="rep-h"></canvas></div>
        <div><h3>Lift &amp; drag vs time</h3><canvas class="chart" id="rep-f"></canvas></div>
      </div>` : `<p>The simulation could not run. Missing: ${ev.missing.map((m) => esc(m.label)).join(', ')}.</p>`}

      <h2>2. Design inputs</h2>
      ${d.weather ? `<p class="small">Weather data: NASA POWER (MERRA-2) for ${fmt(d.weather.lat, 2)}, ${fmt(d.weather.lon, 2)}, ${d.weather.mode === 'actual' ? 'on ' + esc(d.weather.date) : 'typical for the week of ' + esc(d.weather.date)} — area average, not measured at the deck.</p>` : ''}
      <table class="list-table report-table"><thead><tr><th>Input</th><th>Value</th><th>Source</th></tr></thead><tbody>${inputRows}</tbody></table>

      <h2>3. CAD measurements</h2>
      ${an ? `<p>File: ${esc(d.cad.fileName)} · ${an.triangles.toLocaleString()} triangles · units ×${esc(d.cad.units)} m · ${esc(d.cad.up.toUpperCase())} up</p>
        <table class="list-table report-table"><tbody>
          <tr><td>Overall width × length × height</td><td class="num">${fmt(an.size.x, 3)} × ${fmt(an.size.z, 3)} × ${fmt(an.size.y, 3)} m</td></tr>
          <tr><td>Surface area</td><td class="num">${sig(an.surfaceArea, 4)} m²</td></tr>
          <tr><td>Enclosed volume</td><td class="num">${an.volume !== null ? sig(an.volume, 4) + ' m³' : 'Not available from CAD'}</td></tr>
          <tr><td>Geometric centroid (${an.centroid?.kind})</td><td class="num">${an.centroid ? `${fmt(an.centroid.fromNose, 2)} m from nose, ${fmt(an.centroid.height, 2)} m up` : '–'}</td></tr>
          <tr><td>Top-view area (whole craft)</td><td class="num">${sig(an.topArea.value, 3)} ± ${sig(an.topArea.pm, 2)} m²</td></tr>
          <tr><td>Separate parts</td><td class="num">${an.partCount ?? '–'}</td></tr>
          ${an.parts.filter((p) => d.cad.roles?.[p.i]).map((p) => `<tr><td>Part "${esc(p.name)}" (${esc(d.cad.roles[p.i])})</td><td class="num">${fmt(p.size.x, 2)} × ${fmt(p.size.z, 2)} × ${fmt(p.size.y, 2)} m, top area ${sig(p.topArea.value, 3)} m²</td></tr>`).join('')}
        </tbody></table>` : '<p class="muted">No CAD model analysed for this design.</p>'}

      <h2>4. Mass breakdown &amp; centre of mass</h2>
      ${d.components.length ? `<table class="list-table report-table"><thead><tr><th>Part</th><th>Category</th><th>Mass</th><th>Source</th><th>Pocketing removed</th><th>Material</th><th>From nose</th><th>Notes</th></tr></thead><tbody>
        ${d.components.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.category)}</td><td class="num">${isNum(componentMass(c)) ? `${fmt(componentMass(c), 2)} kg${(c.qty || 1) > 1 ? ` (${c.qty}×)` : ''}` : 'not provided'}</td>
          <td>${badge(isNum(componentMass(c)) ? partMassSource(c) : 'missing')}</td>
          <td class="num">${(() => { const p = pocketRemoval(c); return p.none ? '–' : p.ok ? `${fmt(p.mass, 3)} kg each${isNum(c.density) ? ` (ρ = ${c.density} kg/m³)` : ''}` : 'not subtracted: ' + esc(p.reason); })()}</td><td>${esc(c.material)}</td><td class="num">${isNum(c.x) ? fmt(c.x, 2) + ' m' : '–'}</td><td>${esc(c.notes)}</td></tr>`).join('')}
      </tbody></table>` : '<p class="muted">No parts listed.</p>'}
      <p>Centre of mass: ${isNum(com.x) ? `<strong>${fmt(com.x, 2)} m from nose</strong>${isNum(com.y) ? `, ${fmt(com.y, 2)} m above lowest point` : ''} ${badge(com.guessed ? 'estimated' : 'calculated')}` : `cannot be calculated${com.missingX.length ? ` (positions missing for: ${com.missingX.map(esc).join(', ')})` : ''}`}.</p>

      <h2>5. Engineering calculations</h2>
      ${designCalcs(ev).map((g) => `<h3>${esc(g.title)}</h3>${calcTable(g.cards)}`).join('')}

      <h2>6. Preliminary stability check</h2>
      ${calcTable(stabilityCalcs(r, com))}

      <h2>7. Preliminary structural estimates</h2>
      ${calcTable(structureCalcs(r, a))}

      <h2>8. Explanation, assumptions and missing information</h2>
      ${ex ? `<h3>What happened</h3><ul>${ex.happened.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
        <h3>Why</h3><ul>${ex.why.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
        <h3>Assumptions</h3><ul>${ex.assumptions.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
        <h3>Missing information</h3><ul>${ex.missing.map((x) => `<li>${esc(x)}</li>`).join('') || '<li>None essential for this model.</li>'}</ul>
        <h3>Suggested next tests</h3><ul>${ex.next.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="muted">Simulation not available.</p>'}
      <h3>Problem checks</h3>
      <ul>${checks.map((c) => `<li>[${c.level}] ${esc(c.text)}</li>`).join('') || '<li>No obvious problems found.</li>'}</ul>

      <h2>9. Physical tests &amp; simulation vs reality</h2>
      ${tests.length ? `<table class="list-table report-table"><thead><tr><th>Test</th><th>Date</th><th>Launch</th><th>Real distance</th><th>Sim distance</th><th>Real time</th><th>Sim time</th><th>Behaviour</th><th>Why different</th></tr></thead><tbody>
        ${tests.map((t) => { const s = simFor(t); const f = s.analysis?.flight; return `<tr><td>${esc(t.number)}</td><td>${esc(t.date)}</td>
          <td class="num">${isNum(t.launchSpeed) ? fmt(t.launchSpeed) + ' m/s' : '–'}</td><td class="num">${isNum(t.distance) ? fmt(t.distance) + ' m' : 'not measured'}</td>
          <td class="num">${f ? fmt(f.distance) + ' m' : 'n/a'}</td><td class="num">${isNum(t.time) ? fmt(t.time, 2) + ' s' : 'not measured'}</td>
          <td class="num">${f ? fmt(f.time, 2) + ' s' : 'n/a'}</td><td>${esc(t.behavior)}</td><td>${esc(t.diffNotes)}</td></tr>`; }).join('')}
      </tbody></table>` : '<p class="muted">No physical tests recorded for this design.</p>'}

      <h2>10. Engineering notebook</h2>
      ${notes.length ? notes.map((n) => `<div class="note"><div class="note-meta">${esc(n.date)} · ${esc(n.category)}${n.author ? ` · ${esc(n.author)}` : ''}</div><strong>${esc(n.title)}</strong><div class="note-body">${esc(n.body)}</div></div>`).join('') : '<p class="muted">No notebook entries linked to this design.</p>'}

      <h2>11. Model limitations</h2>
      <div class="limits-body">${LIMITATIONS_HTML}</div>
      <p class="muted small">Source labels: ${Object.values(SOURCE_LABEL).join(' · ')}.</p>
    </article>`;

  if (a) {
    const tv = new TrajectoryView(el.querySelector('#rep-traj'));
    tv.setData(a, ev.params);
    const pts = a.flight.points;
    lineChart(el.querySelector('#rep-h'), { xLabel: 'time (s)', yLabel: 'm', series: [{ name: 'height', color: '#0b5cd6', points: pts.map((q) => [q.t, q.y]) }] });
    lineChart(el.querySelector('#rep-f'), { xLabel: 'time (s)', yLabel: 'N', series: [
      { name: 'lift', color: '#0b5cd6', points: pts.map((q) => [q.t, q.L]) },
      { name: 'drag', color: '#e8792b', points: pts.map((q) => [q.t, q.D]) },
      { name: 'weight', color: '#6b7686', points: [[0, a.weightN], [a.flight.time, a.weightN]], dashed: true }] });
  }

  const base = `flugtag-design-${slug(d.label)}-${slug(d.name || 'design')}`;
  el.querySelector('#print').addEventListener('click', () => window.print());
  el.querySelector('#csv-sim').addEventListener('click', () => download(`${base}-simulation.csv`, toCSV([
    ['t (s)', 'x (m)', 'height (m)', 'vx (m/s)', 'vy (m/s)', 'airspeed (m/s)', 'lift (N)', 'drag (N)', 'ax (m/s²)', 'ay (m/s²)'],
    ...a.flight.points.map((q) => [q.t, q.x, q.y, q.vx, q.vy, q.V, q.L, q.D, q.ax, q.ay].map((x) => +x.toFixed(5))),
  ]), 'text/csv'));
  el.querySelector('#csv-inputs').addEventListener('click', () => download(`${base}-inputs-results.csv`, toCSV([
    ['Section', 'Quantity', 'Value', 'Unit', 'Source'],
    ...FIELDS.map((f) => ['Input', f.label, r.v[f.id] ?? '', f.unit || '', r.v[f.id] === undefined ? 'Not provided' : SOURCE_LABEL[r.src[f.id]]]),
    ...designCalcs(ev).flatMap((g) => g.cards.map((c) => [g.title, c.title, isNum(c.result) ? c.result : '', c.unit, SOURCE_LABEL[c.src]])),
  ]), 'text/csv'));
  el.querySelector('#json-design').addEventListener('click', () => download(`${base}.json`,
    JSON.stringify({ app: 'flugtag-lab', format: 2, designs: [d], tests, notes }, null, 2), 'application/json'));
}

export { FIELD };
