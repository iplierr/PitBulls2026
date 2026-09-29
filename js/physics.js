// Simplified 2D point-mass flight model for a Flugtag craft.
// Assumptions (also shown to users in the UI):
//  - The craft holds a constant angle of attack relative to the oncoming air (perfect trim, no pitch dynamics).
//  - Lift slope from finite-wing theory: CLa = 2*pi*AR / (AR + 2), capped at CLmax.
//  - Drag polar: CD = CD0 + CL^2 / (pi * e * AR)  (unless a measured CL / CD is supplied).
//  - Steady uniform wind (only the head/tail component acts in this 2D model), constant air density,
//    flat water surface at y = 0.
//
// Input p (all SI): mass (total kg), wingArea, span, aoa (deg), clMax, cd0, oswald, knownCL, knownCD,
//                   airDensity, headwind, launchSpeed, launchAngle (deg), deckHeight.

export const G = 9.81;
const DEG = Math.PI / 180;
export const DT = 0.005;    // integration step (s)
const MAX_TIME = 120;       // safety cap (s)
const SAMPLE_EVERY = 2;     // keep every Nth step for drawing

const num = (v) => typeof v === 'number' && Number.isFinite(v);

export function aeroCoefficients(p) {
  const S = p.wingArea;
  const AR = (p.span * p.span) / S;
  const clAlpha = (2 * Math.PI * AR) / (AR + 2); // per radian
  const alphaStallDeg = num(p.clMax) ? p.clMax / clAlpha / DEG : NaN;
  const k = num(p.oswald) ? 1 / (Math.PI * p.oswald * AR) : NaN;

  let CL;
  let stalled = false;
  let clSource;
  if (num(p.knownCL)) {
    CL = p.knownCL;
    stalled = num(p.clMax) && Math.abs(CL) > p.clMax;
    clSource = 'known';
  } else {
    const alpha = p.aoa * DEG;
    CL = clAlpha * alpha;
    clSource = 'aoa';
    if (num(p.clMax) && Math.abs(CL) > p.clMax) {
      // Very rough post-stall: lift collapses to 60% of CLmax, drag jumps.
      CL = Math.sign(alpha) * 0.6 * p.clMax;
      stalled = true;
    }
  }

  let CD;
  if (num(p.knownCD)) CD = p.knownCD;
  else CD = p.cd0 + k * CL * CL + (stalled ? 0.3 : 0);

  return { S, AR, clAlpha, alphaStallDeg, CL, CD, stalled, k, clSource };
}

// Runs one flight. If withLift is false, the same craft is flown with zero lift (comparison case).
export function simulate(p, withLift = true) {
  const aero = aeroCoefficients(p);
  const m = p.mass;
  const S = aero.S;
  const CL = withLift ? aero.CL : 0;
  const CD = withLift ? aero.CD : (num(p.cd0) ? p.cd0 : aero.CD);
  const rho = p.airDensity;
  const hw = p.headwind;

  function forces(s) {
    const [, , vx, vy] = s;
    const rx = vx + hw; // velocity relative to the air
    const ry = vy;
    const V = Math.hypot(rx, ry) || 1e-9;
    const qS = 0.5 * rho * V * V * S;
    const L = qS * CL;
    const D = qS * CD;
    // Lift is perpendicular to the relative wind; drag is opposite to it.
    const fx = L * (-ry / V) - D * (rx / V);
    const fy = L * (rx / V) - D * (ry / V) - m * G;
    return { V, L, D, ax: fx / m, ay: fy / m };
  }
  const deriv = (s) => { const f = forces(s); return [s[2], s[3], f.ax, f.ay]; };
  const record = (t, s) => {
    const f = forces(s);
    return { t, x: s[0], y: s[1], vx: s[2], vy: s[3], V: f.V, L: f.L, D: f.D, ax: f.ax, ay: f.ay };
  };

  const a0 = p.launchAngle * DEG;
  let s = [0, p.deckHeight, p.launchSpeed * Math.cos(a0), p.launchSpeed * Math.sin(a0)];
  let t = 0;
  let step = 0;
  const points = [record(0, s)];

  while (t < MAX_TIME) {
    const k1 = deriv(s);
    const k2 = deriv(s.map((v, i) => v + (DT / 2) * k1[i]));
    const k3 = deriv(s.map((v, i) => v + (DT / 2) * k2[i]));
    const k4 = deriv(s.map((v, i) => v + DT * k3[i]));
    const next = s.map((v, i) => v + (DT / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));

    if (next[1] <= 0) {
      // Interpolate the exact moment the craft touches the water.
      const f = s[1] / (s[1] - next[1]);
      const hit = s.map((v, i) => v + f * (next[i] - v));
      t += f * DT;
      s = [hit[0], 0, hit[2], hit[3]];
      points.push(record(t, s));
      break;
    }
    s = next;
    t += DT;
    if (++step % SAMPLE_EVERY === 0) points.push(record(t, s));
  }

  let maxY = -Infinity, maxL = 0, maxD = 0, maxV = 0;
  for (const pt of points) {
    maxY = Math.max(maxY, pt.y);
    maxL = Math.max(maxL, pt.L);
    maxD = Math.max(maxD, pt.D);
    maxV = Math.max(maxV, Math.hypot(pt.vx, pt.vy));
  }
  const [x, , vx, vy] = s;
  return {
    points,
    distance: x,
    time: t,
    maxHeight: maxY,
    impactSpeed: Math.hypot(vx, vy),
    impactVx: vx,
    impactVy: vy,
    impactAngleDeg: Math.atan2(-vy, vx) / DEG,
    maxLift: maxL,
    maxDrag: maxD,
    maxSpeed: maxV,
    peakLoadFactor: maxL / (m * G),
    timedOut: t >= MAX_TIME,
  };
}

// Everything the results panel needs.
export function analyze(p) {
  const aero = aeroCoefficients(p);
  const m = p.mass;
  const W = m * G;
  const flight = simulate(p, true);
  const noLift = simulate(p, false);

  const stallSpeed = num(p.clMax) ? Math.sqrt((2 * W) / (p.airDensity * aero.S * p.clMax)) : NaN;
  // Airspeed at which lift at this CL equals weight.
  const flySpeed = aero.CL > 0 ? Math.sqrt((2 * W) / (p.airDensity * aero.S * aero.CL)) : Infinity;
  const bestLD = num(p.cd0) && num(aero.k) ? 1 / (2 * Math.sqrt(aero.k * p.cd0)) : NaN;
  const vImpact = flight.impactSpeed;

  return {
    mass: m,
    weightN: W,
    wingLoading: W / aero.S,
    aero,
    LD: aero.CL / aero.CD,
    bestLD,
    stallSpeed,
    flySpeed,
    launchAirspeed: Math.hypot(p.launchSpeed * Math.cos(p.launchAngle * DEG) + p.headwind, p.launchSpeed * Math.sin(p.launchAngle * DEG)),
    energy: {
      ke0: 0.5 * m * p.launchSpeed ** 2,
      pe0: m * G * p.deckHeight,
      keImpact: 0.5 * m * vImpact ** 2,
    },
    flight,
    noLift,
  };
}
