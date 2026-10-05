// Fly it step: "try different numbers" sliders, 3D model / 3D flight view, animated side view (play/pause/restart/speed),
// spec sheet, tips to fly further, graphs, explanation and limitations.
import { TrajectoryView } from '../trajectory.js';
import { lineChart } from '../charts.js';
import { explain, sensitivity } from '../explain.js';
import { simulationSource, stabilityCalcs } from '../calcs.js';
import { flightTips, FT, LB, MPH } from '../tips.js';
import { FIELD } from '../fields.js';
import { getCadFile } from '../idb.js';
import { esc, fmt, badge, toast } from '../ui.js';
import { missingBlockHTML, bindMissingBlock } from './design.js';
import { evaluate, centerOfMass, withoutPocketing, hasPocketing } from '../model.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
let T = null;             // side-view trajectory (one per render)
const trials = new Map(); // design id -> slider values being tried (not saved)
let view3d = 'flight';    // 'flight' | 'model'

export const LIMITATIONS_HTML = `
  <p><strong>What it does:</strong> a 2D point-mass model. The craft leaves the deck edge at your launch speed and angle,
    then gravity, lift and drag act on it until it reaches the water (Runge–Kutta 4 integration, 0.005 s steps).</p>
  <ul>
    <li>Lift uses a fixed angle of attack (or a measured CL). Lift slope comes from the wing's aspect ratio
      (<code>CLα = 2π·AR/(AR+2)</code>), capped at CL<sub>max</sub> with a crude post-stall drop.</li>
    <li>Drag = parasite drag (C<sub>D0</sub>) + induced drag (<code>CL²/(π·e·AR)</code>), or a measured CD.</li>
    <li>The wing feels the <em>relative airflow</em>: the craft's own velocity combined with the wind. A headwind increases airspeed over the wing even though it slows ground progress.</li>
    <li>Only the head/tail component of the wind is used. Air density is constant.</li>
    <li>Values you haven't entered use typical values (marked Estimated) when "fill unknowns with typical values" is on.</li>
  </ul>
  <p><strong>What it ignores:</strong> pitch stability and control (the craft is assumed to hold its angle perfectly),
    centre-of-mass effects on flight, ground effect over the water, wing flex, structural failure, gusts, crosswind, the ramp run-up itself,
    and the pilot's movement. Real Flugtag craft often pitch up, stall or break. <strong>Treat results as rough comparisons
    between your own design options, not as predictions.</strong> The 3D flight view shows the same simple path with the craft tilted along it.</p>`;

// Sliders: what can be tried quickly. key = override id used by evaluate().
function sliderDefs(ev) {
  const v = ev.r.v;
  const defs = [
    { key: 'launchSpeed', label: 'Push speed at the deck edge', min: 2, max: 12, step: 0.1, value: v.launchSpeed, fmt: (x) => `${x.toFixed(1)} m/s · ${(x / MPH).toFixed(1)} mph` },
    { key: 'headwind', label: 'Wind (head + / tail −)', min: -6, max: 8, step: 0.5, value: v.headwind, fmt: (x) => (Math.abs(x) < 0.05 ? 'calm' : `${Math.abs(x).toFixed(1)} m/s ${x > 0 ? 'headwind' : 'tailwind'} · ${(Math.abs(x) / MPH).toFixed(0)} mph`) },
  ];
  if (!isNum(v.knownCL)) defs.push({ key: 'aoa', label: 'Wing angle (angle of attack)', min: 0, max: 22, step: 0.5, value: v.aoa, fmt: (x) => `${x.toFixed(1)}°` });
  if (!isNum(v.knownCD)) defs.push({ key: 'cd0', label: 'Drag (CD0) — lower is cleaner', min: 0.03, max: 0.25, step: 0.005, value: v.cd0, fmt: (x) => x.toFixed(3) });
  if (isNum(v.craftMass)) defs.push({ key: 'craftMass', label: 'Craft weight (without pilot)', min: Math.max(1, +(v.craftMass * 0.5).toFixed(1)), max: +(v.craftMass * 1.5).toFixed(1), step: 0.5, value: v.craftMass, fmt: (x) => `${(x / LB).toFixed(0)} lb · ${x.toFixed(1)} kg` });
  return defs;
}

const trialOf = (d) => trials.get(d.id) || {};
function currentEv(ctx) {
  const t = trialOf(ctx.d);
  return Object.keys(t).length ? evaluate(ctx.d, t, 'estimated') : ctx.ev;
}

export function leave(_panel, ctx) {
  T?.stop();
  ctx?.app?.viewer.exitFlight();
}

export function render(panel, ctx) {
  const { ev } = ctx;
  T?.stop();
  T = null;
  ctx.app.viewer.exitFlight();
  if (!ev.analysis) {
    panel.innerHTML = `<div class="panel section"><h2>Fly it</h2>${missingBlockHTML(ev)}</div>
      <details class="panel limits"><summary>⚠ Simplified physics: what this simulation does and does not do</summary><div class="limits-body">${LIMITATIONS_HTML}</div></details>`;
    bindMissingBlock(panel);
    return;
  }
  panel.innerHTML = `
    <div class="panel section" id="try-panel">
      <div class="panel-head">
        <h2>Try different numbers</h2>
        <div class="row-actions"><button class="btn small" id="trial-reset" type="button">Reset</button><button class="btn small primary" id="trial-save" type="button" disabled>Save these to the design</button></div>
      </div>
      <p class="hint">Move a slider to see how the flight changes. Nothing is saved until you click <em>Save</em>.</p>
      <div class="slider-grid" id="sliders"></div>
      <div id="assumed-note"></div>
    </div>

    <div class="ws-top">
      <div class="panel viewer-panel">
        <div class="panel-head"><h2>3D</h2>
          <div class="seg" role="group" aria-label="3D view">
            <button type="button" data-view3d="flight">Flight</button><button type="button" data-view3d="model">Model</button>
          </div>
        </div>
        <div class="viewer-host" id="sim-viewer"></div>
        <p class="hint" id="model-source"></p>
      </div>
      <div class="panel results-panel">
        <div class="panel-head"><h2>Results</h2><span id="res-badge"></span></div>
        <div id="results"></div>
      </div>
    </div>

    <div class="panel traj-panel">
      <div class="panel-head">
        <h2>Side view</h2>
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

    <div class="two-col">
      <div class="panel section" id="tips"></div>
      <div class="panel section" id="specs"></div>
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
  T.onFrame = (t, flight) => poseFlight(ctx, t, flight);
  playBtn.addEventListener('click', () => (T.playing ? T.pause() : T.play(parseFloat(speedSel.value))));
  panel.querySelector('#restart').addEventListener('click', () => T.play(parseFloat(speedSel.value), true));
  speedSel.addEventListener('change', () => T.setSpeed(parseFloat(speedSel.value)));

  // sliders
  let raf = null;
  panel.querySelector('#sliders').addEventListener('input', (e) => {
    const k = e.target.dataset.key;
    if (!k) return;
    const t = { ...trialOf(ctx.d), [k]: parseFloat(e.target.value) };
    trials.set(ctx.d.id, t);
    const sl = e.target.closest('.slider');
    sl.querySelector('.sl-val').textContent = sliderDefs(ctx.ev).find((s) => s.key === k).fmt(parseFloat(e.target.value));
    const top = sl.querySelector('.sl-top');
    top.querySelector('.chip-typ')?.remove();
    if (!top.querySelector('.chip-try')) top.insertAdjacentHTML('beforeend', '<span class="chip-try">trying</span>');
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => update(panel, ctx, null, true));
  });
  panel.querySelector('#trial-reset').addEventListener('click', () => { trials.delete(ctx.d.id); update(panel, ctx); });
  panel.querySelector('#trial-save').addEventListener('click', () => saveTrial(panel, ctx));
  panel.querySelector('#tips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-try]');
    if (b) {
      trials.set(ctx.d.id, { ...trialOf(ctx.d), ...JSON.parse(b.dataset.try) });
      update(panel, ctx);
      panel.querySelector('#try-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
      T?.play(parseFloat(speedSel.value), true);
      return;
    }
    const g = e.target.closest('[data-go-tab]');
    if (g) ctx.goTab(g.dataset.goTab);
  });
  panel.querySelector('.seg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-view3d]');
    if (!b) return;
    view3d = b.dataset.view3d;
    apply3dView(panel, ctx);
  });

  setup3D(panel, ctx);
  update(panel, ctx);
  T.play(parseFloat(speedSel.value), true);
}

function saveTrial(panel, ctx) {
  const t = trialOf(ctx.d);
  const d = ctx.d;
  d.sourceNote ??= {};
  const note = 'Chosen with the "Try different numbers" sliders — a trial value, not a measurement.';
  for (const [k, val] of Object.entries(t)) {
    if (k === 'headwind') {
      d.values.windSpeed = Math.abs(val); d.source.windSpeed = 'estimated'; d.sourceNote.windSpeed = note;
      d.values.windDir = val >= 0 ? 0 : 180; d.source.windDir = 'estimated'; d.sourceNote.windDir = note;
    } else {
      d.values[k] = val; d.source[k] = 'estimated'; d.sourceNote[k] = note;
    }
  }
  trials.delete(d.id);
  toast(`Saved ${Object.keys(t).length} value(s) to the design, marked Estimated.`);
  ctx.changed(null);
}

// skipSliders: don't rebuild the sliders while one is being dragged
export function update(panel, ctx, _fieldId, skipSliders = false) {
  if (!T || !ctx.ev.analysis) return render(panel, ctx);
  const ev = currentEv(ctx);
  const { d } = ctx;
  const com = centerOfMass(d, ev.r);
  const a = ev.analysis, f = a.flight, p = ev.params;
  const trial = trialOf(d);
  const trying = Object.keys(trial).length > 0;
  const src = simulationSource(ev.r);

  // sliders + assumptions
  if (!skipSliders) {
    panel.querySelector('#sliders').innerHTML = sliderDefs(ev).map((s) => {
      const assumed = (ctx.ev.r.assumed || []).includes(s.key) || (s.key === 'headwind' && (ctx.ev.r.assumed || []).includes('windSpeed'));
      return `<label class="slider">
        <span class="sl-top"><span>${esc(s.label)}</span>${trial[s.key] !== undefined ? '<span class="chip-try">trying</span>' : assumed ? '<span class="chip-typ">typical</span>' : ''}</span>
        <input type="range" data-key="${s.key}" min="${s.min}" max="${s.max}" step="${s.step}" value="${s.value}">
        <span class="sl-val">${s.fmt(s.value)}</span>
      </label>`;
    }).join('');
  }
  panel.querySelector('#trial-save').disabled = !trying;
  const assumed = (ctx.ev.r.assumed || []).filter((id) => trial[id] === undefined);
  panel.querySelector('#assumed-note').innerHTML = assumed.length
    ? `<p class="hint"><strong>Still typical values:</strong> ${assumed.map((id) => esc(FIELD[id].label.toLowerCase())).join(', ')}. Add real numbers under <a href="#/design/${d.id}/inputs">Design numbers → Add more info</a>.</p>` : '';

  panel.querySelector('#res-badge').innerHTML = `${trying ? '<span class="chip-try">with tried values</span> ' : ''}${badge(src)}`;
  const airspeed = a.launchAirspeed;
  const gain = f.distance - a.noLift.distance;
  let verdict;
  if (a.aero.stalled) verdict = ['bad', `The wing is stalled (past the stall angle of ≈${fmt(a.aero.alphaStallDeg)}°), so lift drops and drag rises. Try a smaller wing angle.`];
  else if (a.aero.CL <= 0) verdict = ['bad', 'At this setting the wing makes no upward lift.'];
  else if (airspeed < 0.6 * a.flySpeed) verdict = ['warn', `It mostly drops at first: the push gives ${fmt(airspeed)} m/s of airspeed, but the wing needs about ${fmt(a.flySpeed)} m/s to hold the craft up. The wings still add ${fmt(gain)} m compared with no lift.`];
  else if (gain > 1) verdict = ['good', `The wings add about ${fmt(gain)} m compared with the same craft with no lift.`];
  else verdict = ['warn', 'The wings add very little distance in this setup.'];

  const cell = (label, val, unit, alt, d2 = 1) => `<div class="metric"><div class="label">${label}</div><div class="value">${fmt(val, d2)} <small>${unit}</small></div>${alt ? `<small class="muted">${alt}</small>` : ''}</div>`;
  panel.querySelector('#results').innerHTML = `
    <div class="verdict ${verdict[0]}">${esc(verdict[1])}</div>
    <div class="metrics">
      ${cell('Flight distance', f.distance, 'm', `${fmt(f.distance / FT, 0)} ft`)}
      ${cell('Flight time', f.time, 's', '', 2)}
      ${cell('Highest point (above water)', f.maxHeight, 'm', `${fmt(f.maxHeight / FT, 0)} ft`)}
      ${cell('Water impact speed', f.impactSpeed, 'm/s', `${fmt(f.impactSpeed / MPH, 0)} mph`)}
    </div>
    <p class="hint">Flugtag record: 78.6 m (258 ft), Long Beach 2013. Results are labelled ${badge(src)} because they come from a simple model${src === 'estimated' ? ' that uses typical values' : ''}.
      <a href="#/design/${d.id}/calcs">How were these calculated? →</a></p>`;

  // spec sheet
  const stab = stabilityCalcs(ev.r, com);
  const cgPct = stab.find((c) => c.id === 'cgChord'), sm = stab.find((c) => c.id === 'sm');
  const row = (label, val, alt, s) => `<tr><td>${label}</td><td class="num">${val}${alt ? ` <small class="muted">${alt}</small>` : ''}</td><td>${s ? badge(s) : ''}</td></tr>`;
  const v = ev.r.v;
  panel.querySelector('#specs').innerHTML = `
    <h2>Spec sheet</h2>
    <table class="spec-table"><tbody>
      ${row('Wingspan', `${fmt(v.span, 2)} m`, `${fmt(v.span / FT, 1)} ft`, ev.r.src.span)}
      ${row('Wing area', `${fmt(v.wingArea, 2)} m²`, `${fmt(v.wingArea / (FT * FT), 0)} ft²`, ev.r.src.wingArea)}
      ${row('Aspect ratio', fmt(a.aero.AR, 2), '', ev.r.src.AR)}
      ${row('Total weight (craft + pilot)', `${fmt(a.mass, 1)} kg`, `${fmt(a.mass / LB, 0)} lb`, ev.r.src.totalMass)}
      ${row('Wing loading', `${fmt(a.wingLoading, 0)} N/m²`, `${fmt(a.wingLoading * 0.020885, 2)} lb/ft²`, ev.r.src.totalMass === 'estimated' ? 'estimated' : 'calculated')}
      ${row('Stall speed', isNum(a.stallSpeed) ? `${fmt(a.stallSpeed)} m/s` : '–', isNum(a.stallSpeed) ? `${fmt(a.stallSpeed / MPH, 0)} mph` : '', src)}
      ${row('Airspeed needed to hold altitude', isNum(a.flySpeed) ? `${fmt(a.flySpeed)} m/s` : '–', isNum(a.flySpeed) ? `${fmt(a.flySpeed / MPH, 0)} mph` : '', src)}
      ${row('Glide ratio at this wing angle', fmt(a.LD, 1), 'm forward per m down', src)}
      ${row('Best possible glide ratio', isNum(a.bestLD) ? fmt(a.bestLD, 1) : '–', '', src)}
      ${row('Balance point', isNum(cgPct.result) ? `${fmt(cgPct.result, 1)}% ${cgPct.unit.replace('% ', '')}` : 'needs Parts & balance', '', isNum(cgPct.result) ? cgPct.src : 'missing')}
      ${row('Static margin', isNum(sm.result) ? `${fmt(sm.result, 1)}%` : '–', isNum(sm.result) ? (sm.result > 0 ? 'balance point ahead of neutral point' : 'balance point BEHIND neutral point') : '', isNum(sm.result) ? sm.src : 'missing')}
      ${row('Push speed', `${fmt(p.launchSpeed, 1)} m/s`, `${fmt(p.launchSpeed / MPH, 1)} mph`, trial.launchSpeed !== undefined ? 'estimated' : ev.r.src.launchSpeed)}
      ${row('Deck height', `${fmt(p.deckHeight, 2)} m`, `${fmt(p.deckHeight / FT, 0)} ft`, ev.r.src.deckHeight)}
      ${row('Peak load on the wings', `${fmt(f.peakLoadFactor, 2)} g`, '', src)}
      ${pocketRow(d, ev)}
    </tbody></table>`;

  // tips
  const tips = flightTips(ev, d, com);
  const gainTxt = (g) => `${g >= 0 ? '+' : ''}${fmt(g, 1)} m <small>(${g >= 0 ? '+' : ''}${fmt(g / FT, 0)} ft)</small>`;
  panel.querySelector('#tips').innerHTML = `
    <h2>How to make it fly further</h2>
    <p class="hint">Each tip is re-run through the same simulator. Biggest gain first. "Try it" moves the sliders so you can see it.</p>
    ${tips.safety.length ? `<div class="tip-safety">${tips.safety.map((t) => `<div class="tip tip-${t.level}"><strong>${esc(t.title)}</strong><p>${esc(t.detail)}</p>${t.tab ? `<button class="linkbtn" data-go-tab="${t.tab}">Open →</button>` : ''}</div>`).join('')}</div>` : ''}
    <ol class="tips">${tips.distance.map((t) => `<li class="tip">
      <div class="tip-head"><strong>${esc(t.title)}</strong><span class="tip-gain ${t.gain > 0.05 ? 'pos' : 'flat'}">${gainTxt(t.gain)}</span></div>
      <p>${esc(t.detail)}</p>
      ${t.tryIt ? `<button type="button" class="btn tiny" data-try='${esc(JSON.stringify(t.tryIt))}'>Try it</button>` : ''}
    </li>`).join('')}</ol>
    ${tips.info.map((t) => `<p class="hint"><strong>${esc(t.title)}:</strong> ${esc(t.detail)}</p>`).join('')}`;

  T.setData(a, p);
  panel.querySelector('#play').textContent = '▶ Play';

  // graphs
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

  // explanation
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
    <details class="explain"><summary>What information is missing?</summary>${ex.missing.length ? list(ex.missing) : '<p class="muted">Nothing essential for this simplified model.</p>'}</details>
    <details class="explain"><summary>What could we test next?</summary>${list(ex.next)}</details>`;

  updateMarkers(ctx, com);
}

// If parts are pocketed, show what the flight would be without it.
function pocketRow(d, ev) {
  if (!hasPocketing(d) || typeof d.values.craftMass === 'number') return '';
  const ev0 = evaluate(withoutPocketing(d));
  if (!ev0.analysis) return '';
  const dm = ev.r.v.totalMass - ev0.r.v.totalMass;
  return `<tr><td>Pocketing (lightweighting)</td><td class="num">${fmt(dm, 1)} kg <small class="muted">without it: ${fmt(ev0.analysis.flight.distance)} m</small></td><td>${badge('calculated')}</td></tr>`;
}

// ---------------------------------------------------------------------------
// 3D: model view or flight view (craft moved along the path in sync with the side view)
// ---------------------------------------------------------------------------
let lastPose = null;
function poseFlight(ctx, t, flight) {
  lastPose = { t, flight };
  if (view3d !== 'flight') return;
  const viewer = ctx.app.viewer;
  if (!viewer.flightOn) return;
  const pts = flight.points;
  let i = 1;
  while (i < pts.length - 1 && pts[i].t < t) i++;
  const p0 = pts[i - 1], p1 = pts[i];
  const k = p1.t > p0.t ? Math.min(1, Math.max(0, (t - p0.t) / (p1.t - p0.t))) : 1;
  const lerp = (a, b) => a + (b - a) * k;
  const x = lerp(p0.x, p1.x), y = lerp(p0.y, p1.y);
  const path = Math.atan2(lerp(p0.vy, p1.vy), lerp(p0.vx, p1.vx));
  const aoa = (currentEv(ctx).params.aoa || 0) * Math.PI / 180;
  viewer.setFlightPose(x, y, path + aoa);
}

function apply3dView(panel, ctx) {
  panel.querySelectorAll('[data-view3d]').forEach((b) => b.classList.toggle('active', b.dataset.view3d === view3d));
  const viewer = ctx.app.viewer;
  if (view3d === 'flight') {
    viewer.enterFlight(currentEv(ctx).params.deckHeight);
    if (lastPose) poseFlight(ctx, lastPose.t, lastPose.flight);
  } else {
    viewer.exitFlight();
  }
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
    label.innerHTML = `Simple shape drawn from your numbers (not the real shape)${guessed ? ' — length/height not entered, so drawn with placeholder proportions' : ''}. Upload a CAD file on step 2 to see the real craft.`;
  } else {
    label.innerHTML = `Your CAD model ${badge('measured')}`;
  }
  viewer.showCad(cad);
  updateMarkers(ctx);
  apply3dView(panel, ctx);
}

function updateMarkers(ctx, com = ctx.com) {
  const pts = com.items.filter((i) => isNum(i.x)).map((i) => ({ kind: 'part', x: i.x, y: i.y, m: i.m }));
  if (isNum(com.x)) pts.push({ kind: 'com', x: com.x, y: com.y, m: com.mass });
  ctx.app.viewer.setMarkers(pts);
}

