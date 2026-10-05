// Airfoil panel (Design numbers step): load a coordinate file, see the shape, and optionally use its zero-lift angle.
import { parseAirfoil, analyzeAirfoil } from '../airfoil.js';
import { esc, fmt, badge, toast } from '../ui.js';

export function airfoilPanelHTML(d) {
  return `
    <details class="panel section airfoil-panel" ${d.airfoil ? 'open' : ''}>
      <summary><strong>✈ Airfoil shape</strong> <span class="muted small">— optional: load your wing section's coordinate file (e.g. NACA 4415 .txt or .dat)</span></summary>
      <p class="hint">Any chord length works (e.g. coordinates in inches for an 85.3 in rib) — the shape is scaled automatically.
        From the shape the app calculates thickness, camber and the <strong>zero-lift angle</strong> using thin-airfoil theory. It cannot calculate maximum lift (CLmax) or drag from the shape — those need wind-tunnel or XFOIL-type data at your Reynolds number.</p>
      <div class="row-actions">
        <label class="btn small">Choose coordinate file… <input type="file" id="af-file" accept=".txt,.dat,.csv" hidden></label>
        <span class="muted small">or paste coordinates:</span>
      </div>
      <textarea id="af-paste" rows="3" placeholder="x y&#10;1.0 0.0&#10;0.95 0.012&#10;…" style="margin-top:6px"></textarea>
      <div class="row-actions" style="margin-top:6px"><button class="btn small" id="af-load" type="button">Use pasted coordinates</button>
        ${d.airfoil ? '<button class="btn small danger" id="af-clear" type="button">Remove airfoil</button>' : ''}<span class="status" id="af-status"></span></div>
      <div id="af-result"></div>
    </details>`;
}

export function bindAirfoilPanel(root, ctx) {
  const $ = (s) => root.querySelector(s);
  const status = (m, k = '') => { const s = $('#af-status'); s.textContent = m; s.className = `status ${k}`; };
  const load = (text, fileName) => {
    try {
      const af = parseAirfoil(text, fileName);
      analyzeAirfoil(af); // validates
      ctx.d.airfoil = af;
      status(`Loaded ${af.x.length} points.`, 'ok');
      toast(`Airfoil "${af.name}" loaded.`);
      ctx.changed(null);
      render();
    } catch (err) { status(err.message, 'error'); }
  };
  $('#af-file').addEventListener('change', async (e) => { const f = e.target.files[0]; if (f) load(await f.text(), f.name); });
  $('#af-load').addEventListener('click', () => load($('#af-paste').value, 'pasted'));
  $('#af-clear')?.addEventListener('click', () => { delete ctx.d.airfoil; ctx.changed(null); render(); });
  $('#af-result').addEventListener('click', (e) => {
    if (e.target.id !== 'af-use') return;
    const a = analyzeAirfoil(ctx.d.airfoil);
    ctx.d.values.alphaL0 = +a.alphaL0.toFixed(1);
    ctx.d.source.alphaL0 = 'calculated';
    ctx.d.sourceNote = { ...(ctx.d.sourceNote || {}), alphaL0: `Thin-airfoil theory from the "${ctx.d.airfoil.name}" coordinates (ideal flow; real airfoils at low speed are usually within about a degree).` };
    toast(`Zero-lift angle ${ctx.d.values.alphaL0}° now used by the simulation.`);
    ctx.changed(null);
    render();
  });
  function render() {
    const af = ctx.d.airfoil;
    const box = $('#af-result');
    if (!af) { box.innerHTML = ''; return; }
    const a = analyzeAirfoil(af);
    const W = 600, H = 150, pad = 10, sx = W - 2 * pad, sy = sx;
    const yMid = H / 2 + 10;
    const path = af.x.map((x, i) => `${i ? 'L' : 'M'}${(pad + x * sx).toFixed(1)},${(yMid - af.y[i] * sy).toFixed(1)}`).join(' ') + ' Z';
    const camber = Array.from({ length: 51 }, (_, i) => {
      const x = i / 50;
      const zu = interpSorted(a.upper, x), zl = interpSorted(a.lower, x);
      return `${i ? 'L' : 'M'}${(pad + x * sx).toFixed(1)},${(yMid - ((zu + zl) / 2) * sy).toFixed(1)}`;
    }).join(' ');
    const used = ctx.d.values.alphaL0;
    box.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" class="airfoil-svg" role="img" aria-label="Airfoil shape">
        <line x1="${pad}" y1="${yMid}" x2="${W - pad}" y2="${yMid}" stroke="#c9d1dd" stroke-dasharray="4 4"/>
        <path d="${path}" fill="#e8f0fe" stroke="#0b5cd6" stroke-width="1.5"/>
        <path d="${camber}" fill="none" stroke="#e8792b" stroke-width="1.2" stroke-dasharray="5 3"/>
      </svg>
      <p class="hint">Blue: the airfoil. Dashed orange: camber line (the curve halfway between top and bottom). Dashed grey: chord line.</p>
      <table class="meas-table"><tbody>
        <tr><th>Name / file</th><td>${esc(af.name)} <small class="muted">${esc(af.fileName || '')} · ${a.points} points · chord in file ${fmt(af.chordInFile, 2)}</small></td><td></td></tr>
        <tr><th>Maximum thickness</th><td class="num">${fmt(a.thickness * 100, 1)}% of chord at ${fmt(a.thicknessAt * 100, 0)}%</td><td>${badge('calculated')}</td></tr>
        <tr><th>Maximum camber</th><td class="num">${fmt(a.camber * 100, 1)}% of chord at ${fmt(a.camberAt * 100, 0)}%</td><td>${badge('calculated')}</td></tr>
        <tr><th>Zero-lift angle α0</th><td class="num">${fmt(a.alphaL0, 1)}°</td><td>${badge('calculated')} <small class="muted">thin-airfoil theory</small></td></tr>
        <tr><th>Pitching moment Cm (¼ chord)</th><td class="num">${fmt(a.cmQuarter, 3)}</td><td>${badge('calculated')} <small class="muted">negative = nose-down</small></td></tr>
        <tr><th>CLmax, drag</th><td class="muted">Not available from the shape</td><td>${badge('missing')}</td></tr>
      </tbody></table>
      <div class="row-actions" style="margin-top:8px">
        ${Number.isFinite(used) ? `<span class="muted small">The simulation uses α0 = ${used}° (${esc(ctx.d.source.alphaL0 || 'entered')}).</span>`
          : '<button class="btn small primary" id="af-use" type="button">Use this zero-lift angle in the simulation</button>'}
      </div>
      ${a.cmQuarter < -0.02 ? `<p class="hint"><strong>For flying wings:</strong> a cambered airfoil like this pitches nose-down (Cm ${fmt(a.cmQuarter, 2)}). A craft without a tail needs sweep with washout (twist), or a reflexed airfoil, to balance that. The simulation does not model this — it assumes the craft holds its angle.</p>` : ''}`;
  }
  render();
}

function interpSorted(s, x) {
  if (x <= s.x[0]) return s.y[0];
  for (let i = 1; i < s.x.length; i++) if (x <= s.x[i]) { const t = (x - s.x[i - 1]) / (s.x[i] - s.x[i - 1] || 1); return s.y[i - 1] + t * (s.y[i] - s.y[i - 1]); }
  return s.y[s.y.length - 1];
}
