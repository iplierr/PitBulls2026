// Fly it step: 3D view, animated trajectory (play/pause/restart/speed), graphs, results, explanation, limitations.
import { TrajectoryView } from '../trajectory.js';
import { lineChart } from '../charts.js';
import { explain, sensitivity } from '../explain.js';
import { simulationSource } from '../calcs.js';
import { getCadFile } from '../idb.js';
import { esc, fmt, badge } from '../ui.js';
import { missingBlockHTML, bindMissingBlock } from './design.js';
import { evaluate, withoutPocketing, hasPocketing } from '../model.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
let T = null; // trajectory view (one per render)

export const LIMITATIONS_HTML = `
  <p><strong>What it does:</strong> a 2D point-mass model. The craft leaves the deck edge at your launch speed and angle,
    then gravity, lift and drag act on it until it reaches the water (Runge–Kutta 4 integration, 0.005 s steps).</p>
  <ul>
    <li>Lift uses a fixed angle of attack (or a measured CL). Lift slope comes from the wing's aspect ratio
      (<code>CLα = 2π·AR/(AR+2)</code>), capped at CL<sub>max</sub> with a crude post-stall drop.</li>
    <li>Drag = parasite drag (C<sub>D0</sub>) + induced drag (<code>CL²/(π·e·AR)</code>), or a measured CD.</li>
    <li>The wing feels the <em>relative airflow</em>: the craft's own velocity combined with the wind. A headwind increases airspeed over the wing even though it slows ground progress.</li>
    <li>Only the head/tail component of the wind is used. Air density is constant.</li>
  </ul>
  <p><strong>What it ignores:</strong> pitch stability and control (the craft is assumed to hold its angle perfectly),
    centre-of-mass effects on flight, ground effect over the water, wing flex, structural failure, gusts, crosswind, the ramp run-up itself,
    and the pilot's movement. Real Flugtag craft often pitch up, stall or break. <strong>Treat results as rough comparisons
    between your own design options, not as predictions.</strong></p>`;

export function leave() {
  T?.stop();
}

export function render(panel, ctx) {
  const { d, ev } = ctx;
  T?.stop();
  T = null;
  if (!ev.analysis) {
    panel.innerHTML = `<div class="panel section"><h2>Flight simulation</h2>${missingBlockHTML(ev)}</div>
      <details class="panel limits"><summary>⚠ Simplified physics: what this simulation does and does not do</summary><div class="limits-body">${LIMITATIONS_HTML}</div></details>`;
    bindMissingBlock(panel);
    return;
  }
  panel.innerHTML = `
    <div class="ws-top">
      <div class="panel viewer-panel">
        <div class="panel-head"><h2>3D model</h2><span id="model-source" class="muted small"></span></div>
        <div class="viewer-host" id="sim-viewer"></div>
      </div>
      <div class="panel results-panel">
        <div class="panel-head"><h2>Results</h2><span id="res-badge"></span></div>
        <div id="results"></div>
      </div>
    </div>

    <div class="panel traj-panel">
      <div class="panel-head">
        <h2>Flight simulation (side view)</h2>
        <div class="traj-controls">
          <select id="play-speed" aria-label="Playback speed">
            <option value="1">Real time</option>
            <option value="0.5">½ speed</option>
            <option value="0.25">¼ speed</option>
          </select>
          <button id="play" class="btn primary small" type="button">▶ Play</button>
          <button id="restart" class="btn small" type="button">⟲ Restart</button>
        </div>
      </div>
      <canvas id="traj-canvas"></canvas>
      <div class="traj-legend">
        <span><i class="swatch line"></i> Your craft (estimated path)</span>
        <span><i class="swatch dashed"></i> Same craft with no lift (for comparison)</span>
        <span class="muted">The arrow shows the head/tail wind the model uses.</span>
      </div>
    </div>

    <div class="panel section">
      <h2>Graphs over the flight</h2>
      <div class="chart-grid">
        <div><h3>Height above water</h3><canvas class="chart" id="ch-height"></canvas></div>
        <div><h3>Horizontal distance</h3><canvas class="chart" id="ch-dist"></canvas></div>
        <div><h3>Velocity</h3><canvas class="chart" id="ch-vel"></canvas></div>
        <div><h3>Lift &amp; drag</h3><canvas class="chart" id="ch-force"></canvas></div>
      </div>
      <p class="hint">All values are from the simplified model. Lift is shown against the craft's weight: where lift is below the weight line, the craft is being pulled down faster.</p>
    </div>

    <div class="panel section" id="explain"></div>

    <details class="panel limits"><summary>⚠ Simplified physics: what this simulation does and does not do</summary><div class="limits-body">${LIMITATIONS_HTML}</div></details>`;

  T = new TrajectoryView(panel.querySelector('#traj-canvas'));
  const playBtn = panel.querySelector('#play');
  const speedSel = panel.querySelector('#play-speed');
  T.onState = (s) => { playBtn.textContent = s === 'playing' ? '❚❚ Pause' : '▶ Play'; };
  playBtn.addEventListener('click', () => (T.playing ? T.pause() : T.play(parseFloat(speedSel.value))));
  panel.querySelector('#restart').addEventListener('click', () => T.play(parseFloat(speedSel.value), true));
  speedSel.addEventListener('change', () => T.setSpeed(parseFloat(speedSel.value)));

  setup3D(panel, ctx);
  update(panel, ctx);
  T.play(parseFloat(speedSel.value), true);
}

export function update(panel, ctx) {
  if (!T || !ctx.ev.analysis) return render(panel, ctx);
  const { ev, d, com } = ctx;
  const a = ev.analysis, f = a.flight, p = ev.params;
  const src = simulationSource(ev.r);
  panel.querySelector('#res-badge').innerHTML = badge(src);

  const airspeed = a.launchAirspeed;
  const gain = f.distance - a.noLift.distance;
  let verdict;
  if (a.aero.stalled) verdict = ['bad', `The wing is stalled (past the stall angle of ≈${fmt(a.aero.alphaStallDeg)}°), so lift drops and drag rises. Try a smaller angle.`];
  else if (a.aero.CL <= 0) verdict = ['bad', 'At this setting the wing makes no upward lift.'];
  else if (airspeed < 0.6 * a.flySpeed) verdict = ['warn', `Launch airspeed (${fmt(airspeed)} m/s) is far below the ${fmt(a.flySpeed)} m/s the wing needs to hold the craft up at this setting. Expect mostly a drop.`];
  else if (gain > 1) verdict = ['good', `The wings add about ${fmt(gain)} m compared with the same craft with no lift.`];
  else verdict = ['warn', 'The wings add very little distance in this setup.'];

  const cell = (label, val, unit, d2 = 1) => `<div class="metric"><div class="label">${label}</div><div class="value">${fmt(val, d2)} <small>${unit}</small></div></div>`;
  panel.querySelector('#results').innerHTML = `
    <div class="verdict ${verdict[0]}">${esc(verdict[1])}</div>
    <div class="metrics">
      ${cell('Flight distance', f.distance, 'm')}
      ${cell('Flight time', f.time, 's', 2)}
      ${cell('Highest point (above water)', f.maxHeight, 'm')}
      ${cell('Water impact speed', f.impactSpeed, 'm/s')}
    </div>
    <table class="details-table">
      <tr><td>Total mass (craft + pilot)</td><td>${fmt(a.mass, 0)} kg</td></tr>
      <tr><td>Wing loading</td><td>${fmt(a.wingLoading, 0)} N/m²</td></tr>
      <tr><td>Aspect ratio</td><td>${fmt(a.aero.AR, 2)}</td></tr>
      <tr><td>Lift coefficient used (CL)</td><td>${fmt(a.aero.CL, 2)}</td></tr>
      <tr><td>Glide ratio (L/D) at this setting</td><td>${fmt(a.LD, 1)}</td></tr>
      <tr><td>Best glide ratio (model)</td><td>${isNum(a.bestLD) ? fmt(a.bestLD, 1) : 'n/a'}</td></tr>
      <tr><td>Stall speed</td><td>${isNum(a.stallSpeed) ? fmt(a.stallSpeed) + ' m/s' : 'n/a (no CLmax)'}</td></tr>
      <tr><td>Airspeed at launch</td><td>${fmt(airspeed)} m/s</td></tr>
      <tr><td>Velocity at impact (horizontal / vertical)</td><td>${fmt(f.impactVx)} / ${fmt(f.impactVy)} m/s</td></tr>
      <tr><td>Max lift / max drag</td><td>${fmt(f.maxLift, 0)} / ${fmt(f.maxDrag, 0)} N</td></tr>
      <tr><td>Peak load factor (lift ÷ weight)</td><td>${fmt(f.peakLoadFactor, 2)} g</td></tr>
      <tr><td>Distance with no lift (comparison)</td><td>${fmt(a.noLift.distance)} m</td></tr>
      ${pocketRow(d, ev)}
    </table>
    <p class="hint">Every result here is labelled ${badge(src)} because it comes from the model${src === 'estimated' ? ' and uses estimated inputs' : ''}.
      <a href="#/design/${d.id}/calcs">How were these calculated? →</a></p>`;

  T.setData(a, p);
  panel.querySelector('#play').textContent = '▶ Play';

  // Graphs
  const pts = f.points;
  const series = (fn) => pts.map((q) => [q.t, fn(q)]);
  lineChart(panel.querySelector('#ch-height'), { xLabel: 'time (s)', yLabel: 'm', series: [{ name: 'height', color: '#0b5cd6', points: series((q) => q.y) }] });
  lineChart(panel.querySelector('#ch-dist'), { xLabel: 'time (s)', yLabel: 'm', series: [{ name: 'distance', color: '#0b5cd6', points: series((q) => q.x) }] });
  lineChart(panel.querySelector('#ch-vel'), { xLabel: 'time (s)', yLabel: 'm/s', series: [
    { name: 'horizontal', color: '#0b5cd6', points: series((q) => q.vx) },
    { name: 'vertical', color: '#e8792b', points: series((q) => q.vy) },
    { name: 'airspeed', color: '#17803d', points: series((q) => q.V), dashed: true },
  ] });
  lineChart(panel.querySelector('#ch-force'), { xLabel: 'time (s)', yLabel: 'N', series: [
    { name: 'lift', color: '#0b5cd6', points: series((q) => q.L) },
    { name: 'drag', color: '#e8792b', points: series((q) => q.D) },
    { name: 'weight', color: '#6b7686', points: [[0, a.weightN], [f.time, a.weightN]], dashed: true },
  ] });

  // Explanation
  const sens = sensitivity(ev);
  const ex = explain(ev, d, com, sens);
  const list = (arr) => `<ul>${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
  panel.querySelector('#explain').innerHTML = `
    <h2>What does this mean?</h2>
    <div class="explain-grid">
      <div><h3>What happened?</h3>${list(ex.happened)}</div>
      <div><h3>Why did it happen?</h3>${list(ex.why)}</div>
    </div>
    <details class="explain"><summary>What assumptions were used?</summary>${list(ex.assumptions)}</details>
    <details class="explain" ${ex.missing.length ? 'open' : ''}><summary>What information is missing?</summary>${ex.missing.length ? list(ex.missing) : '<p class="muted">Nothing essential for this simplified model.</p>'}</details>
    <details class="explain" open><summary>What could we test next?</summary>${list(ex.next)}</details>`;

  updateMarkers(ctx);
}

// If parts are pocketed, show what the flight would be without it.
function pocketRow(d, ev) {
  if (!hasPocketing(d) || typeof d.values.craftMass === 'number') return '';
  const ev0 = evaluate(withoutPocketing(d));
  if (!ev0.analysis) return '';
  const dm = ev.r.v.totalMass - ev0.r.v.totalMass;
  return `<tr><td>Pocketing (lightweighting)</td><td>${fmt(dm, 1)} kg · distance without pocketing ${fmt(ev0.analysis.flight.distance)} m</td></tr>`;
}

async function setup3D(panel, ctx) {
  const { d, app } = ctx;
  const viewer = app.viewer;
  viewer.mount(panel.querySelector('#sim-viewer'));
  const label = panel.querySelector('#model-source');
  let cad = false;
  if (d.cad?.cadKey) {
    if (viewer.hasCad && viewer.loadedKey === d.cad.cadKey) cad = true;
    else {
      label.textContent = 'Loading CAD model…';
      const file = await getCadFile(d.cad.cadKey);
      if (file && T && panel.isConnected) {
        try {
          await viewer.loadFile(file);
          viewer.loadedKey = d.cad.cadKey;
          cad = true;
        } catch { /* fall back to simple shape */ }
      }
    }
    if (cad) viewer.setCadTransform(parseFloat(d.cad.units), d.cad.up, d.cad.swapped, d.cad.noseFlip);
  }
  if (!panel.isConnected) return;
  const v = ctx.ev.r.v;
  if (!cad) {
    const guessed = !isNum(v.length) || !isNum(v.height);
    viewer.buildPlaceholder({ ...v, length: isNum(v.length) ? v.length : v.span * 0.5, height: isNum(v.height) ? v.height : 1.5, chord: v.chord });
    label.innerHTML = `Simple shape drawn from your inputs (not the real shape)${guessed ? ' — length/height not provided, so drawn with placeholder proportions' : ''}`;
  } else {
    label.innerHTML = `Your CAD model ${badge('measured')}`;
  }
  viewer.showCad(cad);
  updateMarkers(ctx);
}

function updateMarkers({ com, app }) {
  const pts = com.items.filter((i) => isNum(i.x)).map((i) => ({ kind: 'part', x: i.x, y: i.y, m: i.m }));
  if (isNum(com.x)) pts.push({ kind: 'com', x: com.x, y: com.y, m: com.mass });
  app.viewer.setMarkers(pts);
}
