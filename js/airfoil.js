// Airfoil coordinate files (Selig or Lednicer style, any chord length) → shape numbers.
// Zero-lift angle and pitching moment come from thin-airfoil theory (ideal, no viscosity):
//   α0 = −(1/π) ∫₀^π (dz/dx)(cosθ − 1) dθ,   Cm,c/4 = ½ ∫₀^π (dz/dx)(cos2θ − cosθ) dθ,   x = (1 − cosθ)/2
// CLmax and drag can NOT be derived from the shape here — they need wind-tunnel or XFOIL-type data.

const DEG = 180 / Math.PI;

// Returns { name, x[], y[] } normalised to chord 1, plus chordInFile; throws on bad input.
export function parseAirfoil(text, fileName = '') {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let name = '';
  const pts = [];
  for (const l of lines) {
    const nums = l.split(/[\s,;]+/).map(Number);
    if (nums.length >= 2 && nums.slice(0, 2).every(Number.isFinite)) pts.push([nums[0], nums[1]]);
    else if (!pts.length && !name) name = l;
  }
  if (pts.length < 10) throw new Error('Could not find at least 10 coordinate pairs (x y) in this file.');
  // Lednicer format: first numeric line is "N_upper N_lower" (both > 1)
  let seq = pts;
  if (pts[0][0] > 1.5 && pts[0][1] > 1.5 && Number.isInteger(pts[0][0]) && Number.isInteger(pts[0][1]) && pts[0][0] + pts[0][1] === pts.length - 1) {
    const nu = pts[0][0];
    const upper = pts.slice(1, 1 + nu), lower = pts.slice(1 + nu);
    seq = [...upper.reverse(), ...lower.slice(1)]; // TE → upper → LE → lower → TE
  }
  const xs = seq.map((p) => p[0]);
  const xmin = Math.min(...xs), xmax = Math.max(...xs);
  const chord = xmax - xmin;
  if (!(chord > 0)) throw new Error('The x coordinates have no length.');
  const yLE = seq[xs.indexOf(xmin)][1];
  return {
    name: name || fileName.replace(/\.[^.]+$/, '') || 'Airfoil',
    fileName,
    chordInFile: chord,
    x: seq.map((p) => +((p[0] - xmin) / chord).toFixed(6)),
    y: seq.map((p) => +((p[1] - yLE) / chord).toFixed(6)),
  };
}

// Linear interpolation of y at xq on a polyline sorted by x
function interp(xsSorted, ys, xq) {
  if (xq <= xsSorted[0]) return ys[0];
  for (let i = 1; i < xsSorted.length; i++) {
    if (xq <= xsSorted[i]) {
      const t = (xq - xsSorted[i - 1]) / (xsSorted[i] - xsSorted[i - 1] || 1);
      return ys[i - 1] + t * (ys[i] - ys[i - 1]);
    }
  }
  return ys[ys.length - 1];
}

export function analyzeAirfoil(af) {
  const n = af.x.length;
  let iLE = 0;
  for (let i = 1; i < n; i++) if (af.x[i] < af.x[iLE]) iLE = i;
  // two surfaces from LE to TE
  const a = { x: af.x.slice(0, iLE + 1).reverse(), y: af.y.slice(0, iLE + 1).reverse() };
  const b = { x: af.x.slice(iLE), y: af.y.slice(iLE) };
  const mean = (s) => s.y.reduce((p, v) => p + v, 0) / s.y.length;
  const [up, lo] = mean(a) >= mean(b) ? [a, b] : [b, a];
  const sortSurf = (s) => { const idx = s.x.map((_, i) => i).sort((i, j) => s.x[i] - s.x[j]); return { x: idx.map((i) => s.x[i]), y: idx.map((i) => s.y[i]) }; };
  const U = sortSurf(up), Lw = sortSurf(lo);
  const z = (x) => (interp(U.x, U.y, x) + interp(Lw.x, Lw.y, x)) / 2;
  const t = (x) => interp(U.x, U.y, x) - interp(Lw.x, Lw.y, x);

  let tMax = 0, tAt = 0, cMax = 0, cAt = 0;
  for (let i = 1; i < 200; i++) {
    const x = i / 200;
    if (t(x) > tMax) { tMax = t(x); tAt = x; }
    if (Math.abs(z(x)) > Math.abs(cMax)) { cMax = z(x); cAt = x; }
  }
  // Thin-airfoil integrals with a central-difference camber slope
  const N = 800;
  let I0 = 0, Im = 0;
  for (let k = 0; k < N; k++) {
    const th = (k + 0.5) * Math.PI / N;
    const x = (1 - Math.cos(th)) / 2;
    const h = 0.002;
    const slope = (z(Math.min(1, x + h)) - z(Math.max(0, x - h))) / (Math.min(1, x + h) - Math.max(0, x - h));
    I0 += slope * (Math.cos(th) - 1);
    Im += slope * (Math.cos(2 * th) - Math.cos(th));
  }
  const dth = Math.PI / N;
  return {
    points: n,
    thickness: tMax, thicknessAt: tAt,
    camber: cMax, camberAt: cAt,
    alphaL0: -(1 / Math.PI) * I0 * dth * DEG,
    cmQuarter: 0.5 * Im * dth,
    upper: U, lower: Lw,
  };
}

// Analytic NACA 4-digit camber line (used only to check the numerical method)
export function naca4Camber(m, p, x) {
  return x < p ? (m / (p * p)) * (2 * p * x - x * x) : (m / ((1 - p) ** 2)) * (1 - 2 * p + 2 * p * x - x * x);
}
