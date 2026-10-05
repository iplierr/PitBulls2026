// Engineering calculations shown as transparent "cards":
// what is calculated, the equation, the inputs (with sources), the result and units.
// A result is "estimated" if any input is estimated, otherwise "calculated".
import { FIELD } from './fields.js';
import { G } from './physics.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const DEG = Math.PI / 180;

const DERIVED_LABEL = {
  totalMass: 'Total mass', weight: 'Weight', AR: 'Aspect ratio', headwind: 'Headwind component', mu: 'Air viscosity',
};
const labelOf = (id) => FIELD[id]?.label || DERIVED_LABEL[id] || id;
const unitOf = (id) => FIELD[id]?.unit ?? { totalMass: 'kg', weight: 'N', AR: '', headwind: 'm/s', mu: 'Pa·s' }[id] ?? '';

// in(): an input taken from the resolved design
function input(r, id, sym, scale = 1, unit = unitOf(id)) {
  return { sym, label: labelOf(id), value: isNum(r.v[id]) ? r.v[id] * scale : NaN, unit, src: r.src[id] || 'missing', id };
}
// lit(): an input that is itself the result of another calculation or the simulation
const lit = (sym, label, value, unit, src = 'calculated') => ({ sym, label, value, unit, src });
const constant = (sym, label, value, unit) => ({ sym, label, value, unit, src: 'constant' });

function card({ id, title, what, eq, inputs, compute, unit, note, digits = 3, src }) {
  const missing = inputs.filter((i) => !isNum(i.value));
  if (missing.length) {
    return { id, title, what, eq, inputs, unit, note, result: NaN, src: 'missing', digits,
      missingText: `Cannot be calculated: ${missing.map((m) => m.label).join(', ')} not provided.`,
      missingIds: missing.map((m) => m.id).filter(Boolean) };
  }
  const result = compute(...inputs.map((i) => i.value));
  const worst = src || (inputs.some((i) => i.src === 'estimated') ? 'estimated' : 'calculated');
  return { id, title, what, eq, inputs, unit, note, result, src: worst, digits };
}

// ---------------------------------------------------------------------------
// Main calculation list for a design
// ---------------------------------------------------------------------------
export function designCalcs(ev) {
  const { r, analysis: a, params: p } = ev;
  const simSrc = a ? simulationSource(r) : 'missing';
  const groups = [];

  groups.push({ title: 'Mass & weight', cards: [
    card({ id: 'totalMass', title: 'Total mass', what: 'Everything the wings have to carry.', eq: 'm = m_craft + m_pilot',
      inputs: [input(r, 'craftMass', 'm_craft'), input(r, 'pilotMass', 'm_pilot')], compute: (a1, b) => a1 + b, unit: 'kg' }),
    card({ id: 'weight', title: 'Weight', what: 'The downward force of gravity on the whole craft.', eq: 'W = m × g',
      inputs: [input(r, 'totalMass', 'm'), constant('g', 'Gravity', G, 'm/s²')], compute: (m, g) => m * g, unit: 'N' }),
  ] });

  groups.push({ title: 'Wing geometry', cards: [
    r.src.wingArea === 'calculated' || r.src.wingArea === 'estimated'
      ? card({ id: 'wingArea', title: 'Wing area', what: 'Top-view area of the wing.', eq: r.how.wingArea?.startsWith('Wingspan²') ? 'S = b² ÷ AR' : 'S = b × c',
        inputs: r.how.wingArea?.startsWith('Wingspan²') ? [input(r, 'span', 'b'), input(r, 'aspectRatio', 'AR')] : [input(r, 'span', 'b'), input(r, 'chord', 'c')],
        compute: r.how.wingArea?.startsWith('Wingspan²') ? (b, ar) => b * b / ar : (b, c) => b * c, unit: 'm²',
        note: 'Assumes a roughly rectangular wing. For other shapes, enter the real area.' })
      : card({ id: 'wingArea', title: 'Wing area', what: 'Top-view area of the wing.', eq: 'S (entered or measured)', inputs: [input(r, 'wingArea', 'S')], compute: (s) => s, unit: 'm²', src: r.src.wingArea }),
    card({ id: 'AR', title: 'Aspect ratio', what: 'How long and slender the wing is. Higher = less drag caused by lift.', eq: 'AR = b² ÷ S',
      inputs: [input(r, 'span', 'b'), input(r, 'wingArea', 'S')], compute: (b, s) => b * b / s, unit: '' }),
    card({ id: 'wingLoading', title: 'Wing loading', what: 'How much weight each square metre of wing carries. Lower = can fly slower.', eq: 'W/S = W ÷ S',
      inputs: [input(r, 'weight', 'W'), input(r, 'wingArea', 'S')], compute: (w, s) => w / s, unit: 'N/m²', digits: 1 }),
  ] });

  const V0 = a ? a.launchAirspeed : NaN;
  groups.push({ title: 'Air & airflow', cards: [
    card({ id: 'airDensity', title: 'Air density', what: 'Mass of one cubic metre of air. Thinner air = less lift.',
      eq: r.src.airDensity === 'calculated' ? 'ρ = P ÷ (R × T)' : 'ρ (entered, assumed or standard-atmosphere)',
      inputs: r.src.airDensity === 'calculated'
        ? [input(r, 'pressure', 'P', 100, 'Pa'), constant('R', 'Gas constant for air', 287.05, 'J/(kg·K)'), lit('T', 'Temperature', r.v.temperature + 273.15, 'K', r.src.temperature)]
        : [input(r, 'airDensity', 'ρ')],
      compute: r.src.airDensity === 'calculated' ? (P, R, T) => P / (R * T) : (x) => x, unit: 'kg/m³', note: r.how.airDensity,
      src: r.src.airDensity === 'calculated' ? undefined : r.src.airDensity }),
    card({ id: 'headwind', title: 'Headwind component', what: 'The part of the wind blowing straight at the craft. The 2D model only uses this part; crosswind is ignored.',
      eq: 'V_head = V_wind × cos(θ)', inputs: [input(r, 'windSpeed', 'V_wind'), lit('θ', 'Wind direction', isNum(r.v.windDir) ? r.v.windDir : (r.v.windSpeed === 0 ? 0 : NaN), '°', r.src.windDir || r.src.windSpeed)],
      compute: (w, th) => w * Math.cos(th * DEG), unit: 'm/s', note: 'Positive = headwind (helps lift), negative = tailwind.' }),
    card({ id: 'airspeed0', title: 'Airspeed at launch', what: 'Speed of the air flowing over the wing. This is what makes lift — not ground speed. A headwind adds to it, a tailwind subtracts.',
      eq: 'V_air = |launch velocity + headwind|', inputs: [input(r, 'launchSpeed', 'V_launch'), input(r, 'headwind', 'V_head'), input(r, 'launchAngle', 'γ')],
      compute: (vl, hw, g) => Math.hypot(vl * Math.cos(g * DEG) + hw, vl * Math.sin(g * DEG)), unit: 'm/s' }),
    card({ id: 'q0', title: 'Dynamic pressure at launch', what: 'The "push" of the oncoming air. Lift and drag are both proportional to it.', eq: 'q = ½ × ρ × V²',
      inputs: [input(r, 'airDensity', 'ρ'), lit('V', 'Airspeed at launch', V0, 'm/s', simSrc)], compute: (rho, v) => 0.5 * rho * v * v, unit: 'Pa', digits: 1 }),
    card({ id: 'mu', title: 'Air viscosity', what: 'How "sticky" the air is. Needed for the Reynolds number.', eq: 'μ = 1.458×10⁻⁶ × T^1.5 ÷ (T + 110.4)',
      inputs: [lit('T', 'Temperature', isNum(r.v.temperature) ? r.v.temperature + 273.15 : NaN, 'K', r.src.temperature || 'missing')],
      compute: (T) => (1.458e-6 * T ** 1.5) / (T + 110.4), unit: 'Pa·s', digits: 3 }),
    card({ id: 're', title: 'Reynolds number at launch', what: 'Compares inertia to stickiness of the air. Airfoil data is only valid near the Reynolds number it was measured at — use this when looking up airfoil CL/CD data.',
      eq: 'Re = ρ × V × c ÷ μ', inputs: [input(r, 'airDensity', 'ρ'), lit('V', 'Airspeed at launch', V0, 'm/s', simSrc), input(r, 'chord', 'c'), input(r, 'mu', 'μ')],
      compute: (rho, v, c, mu) => rho * v * c / mu, unit: '', digits: 3 }),
  ] });

  const aero = a?.aero;
  groups.push({ title: 'Aerodynamics', cards: [
    card({ id: 'clAlpha', title: 'Lift curve slope', what: 'How quickly lift grows as the angle of attack increases. Long slender wings get more lift per degree.',
      eq: 'a = 2π × AR ÷ (AR + 2)   [per radian]', inputs: [input(r, 'AR', 'AR')], compute: (ar) => 2 * Math.PI * ar / (ar + 2), unit: '/rad',
      note: 'Finite-wing approximation (Helmbold-type). Real airfoils differ a little.' }),
    isNum(r.v.knownCL)
      ? card({ id: 'CL', title: 'Lift coefficient used', what: 'How strongly the wing makes lift.', eq: 'CL (measured, entered)', inputs: [input(r, 'knownCL', 'CL')], compute: (x) => x, unit: '', src: r.src.knownCL })
      : card({ id: 'CL', title: 'Lift coefficient (CL)', what: 'How strongly the wing makes lift at the chosen angle of attack.', eq: 'CL = a × (α − α0)   (capped at CLmax)',
        inputs: [input(r, 'AR', 'AR'), input(r, 'aoa', 'α'), isNum(r.v.alphaL0) ? input(r, 'alphaL0', 'α0') : constant('α0', 'Zero-lift angle (not entered, so 0)', 0, '°'), input(r, 'clMax', 'CLmax')],
        compute: (ar, al, a0, cm) => { const cl = 2 * Math.PI * ar / (ar + 2) * (al - a0) * DEG; return Math.abs(cl) > cm ? Math.sign(cl) * 0.6 * cm : cl; }, unit: '', note: aero?.stalled ? 'STALLED: α is past the stall angle; the model drops CL to 60% of CLmax.' : `Stall would start at about α = ${isNum(aero?.alphaStallDeg) ? aero.alphaStallDeg.toFixed(1) : '?'}°.` }),
    isNum(r.v.knownCD)
      ? card({ id: 'CD', title: 'Drag coefficient used', what: 'How much the craft resists moving through the air.', eq: 'CD (measured, entered)', inputs: [input(r, 'knownCD', 'CD')], compute: (x) => x, unit: '', src: r.src.knownCD })
      : card({ id: 'CD', title: 'Drag coefficient (CD)', what: 'How much the craft resists moving through the air: parasite drag plus drag caused by making lift.',
        eq: 'CD = CD0 + CL² ÷ (π × e × AR)', inputs: [input(r, 'cd0', 'CD0'), lit('CL', 'Lift coefficient', aero?.CL ?? NaN, '', simSrc), input(r, 'oswald', 'e'), input(r, 'AR', 'AR')],
        compute: (cd0, cl, e, ar) => cd0 + cl * cl / (Math.PI * e * ar) + (aero?.stalled ? 0.3 : 0), unit: '', note: aero?.stalled ? 'Includes +0.3 rough post-stall drag.' : '' }),
    card({ id: 'LD', title: 'Glide ratio (L/D) at this angle', what: 'Metres forward per metre down in a steady glide.', eq: 'L/D = CL ÷ CD',
      inputs: [lit('CL', 'Lift coefficient', aero?.CL ?? NaN, '', simSrc), lit('CD', 'Drag coefficient', aero?.CD ?? NaN, '', simSrc)], compute: (l, d) => l / d, unit: '', digits: 2 }),
    card({ id: 'bestLD', title: 'Best possible glide ratio (this model)', what: 'The highest L/D the drag model allows, at the ideal angle.', eq: '(L/D)max = 1 ÷ (2 × √(k × CD0)),  k = 1 ÷ (π e AR)',
      inputs: [input(r, 'cd0', 'CD0'), input(r, 'oswald', 'e'), input(r, 'AR', 'AR')], compute: (cd0, e, ar) => 1 / (2 * Math.sqrt(cd0 / (Math.PI * e * ar))), unit: '', digits: 2 }),
    card({ id: 'stallSpeed', title: 'Stall speed', what: 'Slowest airspeed at which the wing can hold up the craft’s weight. Below it, the craft cannot fly level.', eq: 'Vs = √(2W ÷ (ρ × S × CLmax))',
      inputs: [input(r, 'weight', 'W'), input(r, 'airDensity', 'ρ'), input(r, 'wingArea', 'S'), input(r, 'clMax', 'CLmax')],
      compute: (w, rho, s, cl) => Math.sqrt(2 * w / (rho * s * cl)), unit: 'm/s', digits: 3 }),
    card({ id: 'flySpeed', title: 'Airspeed needed to hold the craft up at this CL', what: 'If launch airspeed is well below this, the craft mostly drops.', eq: 'V = √(2W ÷ (ρ × S × CL))',
      inputs: [input(r, 'weight', 'W'), input(r, 'airDensity', 'ρ'), input(r, 'wingArea', 'S'), lit('CL', 'Lift coefficient', aero?.CL ?? NaN, '', simSrc)],
      compute: (w, rho, s, cl) => (cl > 0 ? Math.sqrt(2 * w / (rho * s * cl)) : NaN), unit: 'm/s', digits: 3 }),
    card({ id: 'glideRef', title: 'Steady-glide reference distance', what: 'How far a craft ALREADY gliding steadily would travel from the deck height. A slow launch never reaches steady glide, so the real flight is usually much shorter — compare with the simulation.',
      eq: 'x = h × L/D', inputs: [input(r, 'deckHeight', 'h'), lit('L/D', 'Glide ratio', a ? a.LD : NaN, '', simSrc)], compute: (h, ld) => h * ld, unit: 'm', digits: 3 }),
  ] });

  const L0 = a ? a.flight.points[0] : null;
  groups.push({ title: 'Forces at launch', cards: [
    card({ id: 'L0', title: 'Lift at launch', what: 'Upward force from the wing at the moment the craft leaves the deck.', eq: 'L = q × S × CL',
      inputs: [lit('q', 'Dynamic pressure', a ? 0.5 * p.airDensity * V0 * V0 : NaN, 'Pa', simSrc), input(r, 'wingArea', 'S'), lit('CL', 'Lift coefficient', aero?.CL ?? NaN, '', simSrc)],
      compute: (q, s, cl) => q * s * cl, unit: 'N', digits: 1 }),
    card({ id: 'D0', title: 'Drag at launch', what: 'Backward force from the air at the moment the craft leaves the deck.', eq: 'D = q × S × CD',
      inputs: [lit('q', 'Dynamic pressure', a ? 0.5 * p.airDensity * V0 * V0 : NaN, 'Pa', simSrc), input(r, 'wingArea', 'S'), lit('CD', 'Drag coefficient', aero?.CD ?? NaN, '', simSrc)],
      compute: (q, s, cd) => q * s * cd, unit: 'N', digits: 1 }),
    card({ id: 'LW0', title: 'Lift as a fraction of weight at launch', what: 'Below 1 (100%), the craft starts to sink immediately.', eq: 'L ÷ W',
      inputs: [lit('L', 'Lift at launch', L0 ? L0.L : NaN, 'N', simSrc), input(r, 'weight', 'W')], compute: (l, w) => l / w, unit: '', digits: 2 }),
    card({ id: 'acc0', title: 'Acceleration at launch', what: 'How quickly the velocity is changing when the craft leaves the deck (gravity + lift + drag combined).', eq: 'a = √(ax² + ay²),  a = ΣF ÷ m',
      inputs: [lit('ax', 'Horizontal acceleration', L0 ? L0.ax : NaN, 'm/s²', simSrc), lit('ay', 'Vertical acceleration', L0 ? L0.ay : NaN, 'm/s²', simSrc)],
      compute: (ax, ay) => Math.hypot(ax, ay), unit: 'm/s²', digits: 3 }),
  ] });

  const f = a?.flight;
  groups.push({ title: 'Energy & momentum', cards: [
    card({ id: 'ke0', title: 'Kinetic energy at launch', what: 'Energy of motion given by the push crew.', eq: 'KE = ½ × m × v²',
      inputs: [input(r, 'totalMass', 'm'), input(r, 'launchSpeed', 'v')], compute: (m, v) => 0.5 * m * v * v, unit: 'J', digits: 4 }),
    card({ id: 'pe0', title: 'Potential energy at deck height', what: 'Energy available from falling to the water. Usually much bigger than the push energy.', eq: 'PE = m × g × h',
      inputs: [input(r, 'totalMass', 'm'), constant('g', 'Gravity', G, 'm/s²'), input(r, 'deckHeight', 'h')], compute: (m, g, h) => m * g * h, unit: 'J', digits: 4 }),
    card({ id: 'keImp', title: 'Kinetic energy at water impact', what: 'Energy that the water (and the structure and pilot) must absorb.', eq: 'KE = ½ × m × v_impact²',
      inputs: [input(r, 'totalMass', 'm'), lit('v', 'Impact speed (simulation)', f ? f.impactSpeed : NaN, 'm/s', simSrc)], compute: (m, v) => 0.5 * m * v * v, unit: 'J', digits: 4 }),
    card({ id: 'eLost', title: 'Energy removed by the air', what: 'Starting energy minus impact energy. In calm air this is the energy drag took away.', eq: 'ΔE = KE₀ + PE₀ − KE_impact',
      inputs: [lit('KE₀', 'KE at launch', a ? a.energy.ke0 : NaN, 'J', simSrc), lit('PE₀', 'PE at deck', a ? a.energy.pe0 : NaN, 'J', simSrc), lit('KE_imp', 'KE at impact', a ? a.energy.keImpact : NaN, 'J', simSrc)],
      compute: (k, pe, ki) => k + pe - ki, unit: 'J', digits: 4, note: 'With wind, the air can also add energy, so this is not purely drag loss.' }),
    card({ id: 'p0', title: 'Momentum at launch', what: 'Mass × velocity at the deck edge.', eq: 'p = m × v',
      inputs: [input(r, 'totalMass', 'm'), input(r, 'launchSpeed', 'v')], compute: (m, v) => m * v, unit: 'kg·m/s', digits: 4 }),
    card({ id: 'pImp', title: 'Momentum at impact', what: 'Mass × velocity when hitting the water.', eq: 'p = m × v_impact',
      inputs: [input(r, 'totalMass', 'm'), lit('v', 'Impact speed (simulation)', f ? f.impactSpeed : NaN, 'm/s', simSrc)], compute: (m, v) => m * v, unit: 'kg·m/s', digits: 4 }),
  ] });

  const simHow = 'Step-by-step numerical integration (Runge–Kutta 4, 0.005 s steps) of gravity, lift and drag until the craft reaches the water.';
  const simInputs = [lit('model', 'Flight simulation', a ? 1 : NaN, '', simSrc)];
  const simCard = (id, title, what, val, unit, digits = 3) =>
    card({ id, title, what, eq: 'from simulation', inputs: simInputs, compute: () => val, unit, digits, note: simHow });
  groups.push({ title: 'Simulation results', cards: f ? [
    simCard('dist', 'Horizontal distance', 'From the deck edge to where the craft touches the water.', f.distance, 'm'),
    simCard('time', 'Flight time', 'From leaving the deck to touching the water.', f.time, 's'),
    simCard('maxH', 'Maximum height above water', 'Highest point of the flight path.', f.maxHeight, 'm'),
    simCard('vImp', 'Impact speed', 'Ground speed when touching the water.', f.impactSpeed, 'm/s'),
    simCard('vxImp', 'Horizontal velocity at impact', '', f.impactVx, 'm/s'),
    simCard('vyImp', 'Vertical velocity at impact', 'Negative = downward.', f.impactVy, 'm/s'),
    simCard('maxL', 'Maximum lift during flight', 'Largest wing force during the flight.', f.maxLift, 'N', 4),
    simCard('maxD', 'Maximum drag during flight', '', f.maxDrag, 'N', 4),
    simCard('nMax', 'Peak load factor', 'Largest lift ÷ weight. Useful as a starting point for the structure check.', f.peakLoadFactor, 'g', 3),
  ] : [card({ id: 'sim', title: 'Simulation', what: '', eq: '', inputs: simInputs, compute: () => 0, unit: '' })] });

  return groups;
}

function usesEstimated(r) {
  return ['totalMass', 'wingArea', 'span', 'aoa', 'clMax', 'cd0', 'oswald', 'knownCL', 'knownCD', 'airDensity', 'headwind', 'launchSpeed', 'launchAngle', 'deckHeight']
    .some((id) => r.src[id] === 'estimated');
}
export const simulationSource = (r) => (usesEstimated(r) ? 'estimated' : 'calculated');

// ---------------------------------------------------------------------------
// Preliminary pitch stability (static margin) and tail volume coefficients
// ---------------------------------------------------------------------------
export const TAIL_VOLUME_REFERENCE = 'Typical values from Raymer, "Aircraft Design: A Conceptual Approach" (Table 6.4): sailplane Vh ≈ 0.50, Vv ≈ 0.02; homebuilt aircraft Vh ≈ 0.50, Vv ≈ 0.04. For comparison only — they are not requirements for a Flugtag craft.';

export function stabilityCalcs(r, com) {
  const cgSrc = com.guessed ? 'estimated' : 'calculated';
  const cg = lit('x_cg', 'Centre of mass (from nose)', com.x, 'm', isNum(com.x) ? cgSrc : 'missing');
  // Reference chord: the mean aerodynamic chord if given, otherwise the average chord
  const useMac = isNum(r.v.macLength);
  const cId = useMac ? 'macLength' : 'chord';
  const C = r.v[cId];
  const cIn = () => input(r, cId, useMac ? 'MAC' : 'c');
  const cName = useMac ? 'MAC' : 'chord';
  const tailless = r.v.tailType === 'none';

  const cards = [
    card({ id: 'cgChord', title: `Centre of mass position on the wing (% ${cName})`, what: 'Where the CoM sits along the wing chord, as a % from the leading edge. Gliders usually balance somewhere in the front third of the chord.',
      eq: `(x_cg − x_LE) ÷ ${useMac ? 'MAC' : 'c'} × 100%`, inputs: [cg, input(r, 'wingLEx', 'x_LE'), cIn()], compute: (x, le, c) => (x - le) / c * 100, unit: `% ${cName}`, digits: 3 }),
    card({ id: 'xacw', title: 'Wing aerodynamic centre', what: 'Point on the wing where lift effectively acts without changing pitch moment with angle — about ¼ of the chord back from the leading edge.',
      eq: `x_ac,w = x_LE + 0.25 × ${useMac ? 'MAC' : 'c'}`, inputs: [input(r, 'wingLEx', 'x_LE'), cIn()], compute: (le, c) => le + 0.25 * c, unit: 'm from nose',
      note: useMac ? 'Uses the mean aerodynamic chord you entered.' : 'Uses the average chord; for tapered or swept wings enter the MAC and its leading-edge position for a better estimate.' }),
  ];

  let np;
  if (tailless) {
    // Flying wing: the neutral point is approximately the wing's own aerodynamic centre.
    np = card({ id: 'xnp', title: 'Estimated neutral point (flying wing)', what: 'Without a horizontal tail, the neutral point is roughly the wing’s aerodynamic centre. The centre of mass must be ahead of it.',
      eq: `x_np ≈ x_ac,w = x_LE + 0.25 × ${useMac ? 'MAC' : 'c'}`, inputs: [input(r, 'wingLEx', 'x_LE'), cIn()], compute: (le, c) => le + 0.25 * c, unit: 'm from nose', digits: 3,
      src: 'estimated',
      note: 'Assumption: neutral point at 25% of the MAC (the same screening assumption as a typical design report). Sweep, washout, the pilot’s body, the pilot frame and the downturned tips all move the real neutral point. Treat as a first estimate until tested.' });
    cards.push(np);
  } else {
    const aw = isNum(r.v.AR) ? 2 * Math.PI * r.v.AR / (r.v.AR + 2) : NaN;
    const ct = isNum(r.v.tailArea) && isNum(r.v.tailSpan) ? r.v.tailArea / r.v.tailSpan : NaN;
    const ARt = isNum(r.v.tailArea) && isNum(r.v.tailSpan) ? r.v.tailSpan ** 2 / r.v.tailArea : NaN;
    const at = isNum(ARt) ? 2 * Math.PI * ARt / (ARt + 2) : NaN;
    const xacw = r.v.wingLEx + 0.25 * C;
    const xact = r.v.tailLEx + 0.25 * ct;
    const lt = xact - xacw;
    const tailSrc = ['tailArea', 'tailSpan', 'tailLEx', 'wingLEx', cId].some((id) => r.src[id] === 'estimated') ? 'estimated' : 'calculated';
    cards.push(card({ id: 'VH', title: 'Horizontal tail volume coefficient', what: 'Size of the tail × its lever arm, compared with the wing. Bigger = more pitch "weathervane" effect.',
      eq: 'V_H = S_t × l_t ÷ (S × c)', inputs: [input(r, 'tailArea', 'S_t'), lit('l_t', 'Wing AC to tail AC distance', lt, 'm', tailSrc), input(r, 'wingArea', 'S'), cIn()],
      compute: (st, l, s2, c) => st * l / (s2 * c), unit: '', digits: 3, note: TAIL_VOLUME_REFERENCE }));
    const npInputs = [input(r, 'wingLEx', 'x_LE'), cIn(), lit('V_H', 'Tail volume coefficient', r.v.tailArea * lt / (r.v.wingArea * C), '', tailSrc),
      input(r, 'tailEff', 'η'), lit('a_t', 'Tail lift slope', at, '/rad', tailSrc), lit('a_w', 'Wing lift slope', aw, '/rad', r.src.AR || 'missing'), input(r, 'AR', 'AR')];
    np = card({ id: 'xnp', title: 'Estimated neutral point', what: 'If the centre of mass is behind this point, the simplified model predicts the craft will not naturally return to its pitch attitude after a disturbance.',
      eq: 'x_np = x_ac,w + c × η × V_H × (a_t ÷ a_w) × (1 − dε/dα),   dε/dα = 2a_w ÷ (π AR)',
      inputs: npInputs, compute: (le, c, vh, eta, a_t, a_w, ar) => le + 0.25 * c + c * eta * vh * (a_t / a_w) * (1 - 2 * a_w / (Math.PI * ar)), unit: 'm from nose', digits: 3,
      note: 'Classical textbook estimate. Ignores fuselage and pilot body effects, which usually move the neutral point forward (less stable). If your craft has no horizontal tail, set "Type of craft" to flying wing.' });
    cards.push(np);
  }
  cards.push(card({ id: 'sm', title: 'Static margin', what: `Distance from the centre of mass to the neutral point, as a % of the ${cName}. Positive = CoM ahead of the neutral point.`,
    eq: `SM = (x_np − x_cg) ÷ ${useMac ? 'MAC' : 'c'}`, inputs: [lit('x_np', 'Neutral point (needs the inputs listed in the card above)', np.result, 'm', np.src), cg, cIn()],
    compute: (n, x, c) => (n - x) / c * 100, unit: `% ${cName}`, digits: 3,
    note: 'Many conventional aircraft are designed with a static margin of roughly 5–15% chord. A positive number here does NOT prove your craft is stable: the pilot moving, flexible structure and body effects are not modelled.' }));
  if (!tailless) {
    const lv = r.v.vtailLEx - com.x;
    cards.push(card({ id: 'VV', title: 'Vertical tail volume coefficient', what: 'Size of the fin × its lever arm, compared with the wing. Helps the craft point into the airflow (yaw).',
      eq: 'V_V = S_v × l_v ÷ (S × b)', inputs: [input(r, 'vtailArea', 'S_v'), lit('l_v', 'CoM to fin leading edge', lv, 'm', isNum(lv) ? cgSrc : 'missing'), input(r, 'wingArea', 'S'), input(r, 'span', 'b')],
      compute: (sv, l, s2, b) => sv * l / (s2 * b), unit: '', digits: 3, note: 'Uses the distance to the fin leading edge, so it slightly underestimates the true lever arm. ' + TAIL_VOLUME_REFERENCE }));
  }
  return cards;
}

// ---------------------------------------------------------------------------
// Preliminary structural estimates
// ---------------------------------------------------------------------------
export function sectionProperties(v) {
  const H = v.sparH / 1000, W = v.sparW / 1000, t = v.sparWall / 1000;
  switch (v.sparShape) {
    case 'roundTube': if (!(t < H / 2)) return null; return { I: Math.PI * (H ** 4 - (H - 2 * t) ** 4) / 64, c: H / 2, needs: ['sparH', 'sparWall'] };
    case 'rectTube': if (!(t < H / 2 && t < W / 2)) return null; return { I: (W * H ** 3 - (W - 2 * t) * (H - 2 * t) ** 3) / 12, c: H / 2, needs: ['sparH', 'sparW', 'sparWall'] };
    case 'roundSolid': return { I: Math.PI * H ** 4 / 64, c: H / 2, needs: ['sparH'] };
    case 'rectSolid': return { I: W * H ** 3 / 12, c: H / 2, needs: ['sparH', 'sparW'] };
    default: return null;
  }
}

// Load and bending moment of the wing between station a (m from centreline) and the tip s.
// Elliptical: w(y) = w0·√(1−(y/s)²) with ∫0..s w = F.  Uniform: w = F/s.
export function outerBay(F, s, a, uniform) {
  if (!(F > 0 && s > 0) || !(a >= 0 && a < s)) return { Fout: NaN, M: NaN };
  if (uniform) { const w = F / s; return { Fout: w * (s - a), M: w * (s - a) ** 2 / 2 }; }
  const w0 = 4 * F / (Math.PI * s);
  const N = 400, h = (s - a) / N;
  let Fo = 0, Mo = 0;
  for (let i = 0; i <= N; i++) {
    const y = a + i * h;
    const wy = w0 * Math.sqrt(Math.max(0, 1 - (y / s) ** 2));
    const k = i === 0 || i === N ? 1 : i % 2 ? 4 : 2; // Simpson's rule
    Fo += k * wy;
    Mo += k * wy * (y - a);
  }
  return { Fout: Fo * h / 3, M: Mo * h / 3 };
}

export function structureCalcs(r, analysis) {
  const v = r.v;
  const sec = sectionProperties(v);
  const secSrc = ['sparH', 'sparW', 'sparWall'].some((id) => r.src[id] === 'estimated') ? 'estimated' : 'entered';
  const Ival = sec && [sec.I].every(isNum) ? sec.I : NaN;
  const halfSpan = v.span / 2;
  const loadSrc = ['loadFactor', 'totalMass', 'span', 'braceStation'].some((id) => r.src[id] === 'estimated') ? 'estimated' : 'calculated';
  const Fhalf = v.loadFactor * v.weight / 2;
  // Braced wing: only the part outside the stays/struts is checked as a cantilever.
  const braced = isNum(v.braceStation) && v.braceStation > 0 && v.braceStation < halfSpan;
  const a = braced ? v.braceStation : 0;
  const uniform = v.liftDist === 'uniform';
  const outer = outerBay(Fhalf, halfSpan, a, uniform);
  const M = outer.M;
  const distText = uniform ? 'uniform lift along the span' : 'elliptical lift distribution';
  const shapeNote = !v.sparShape ? 'Choose a spar cross-section.' : (!sec ? 'Wall thickness must be less than half the outer size.' : '');

  const cards = [
    card({ id: 'Fwing', title: 'Load carried by each half-wing', what: 'Lift each wing half must carry at the design load factor.', eq: 'F = n × W ÷ 2',
      inputs: [input(r, 'loadFactor', 'n'), input(r, 'weight', 'W')], compute: (n, w) => n * w / 2, unit: 'N', digits: 4,
      note: 'Conservative: uses the whole weight, ignoring that the wing\'s own weight partly cancels its lift.' }),
    ...(braced ? [card({ id: 'Fout', title: 'Load on the wing outside the bracing point', what: 'The part of the half-wing load carried by the wing beyond the stays/struts.',
      eq: 'F_out = ∫ w(y) dy  from the bracing point to the tip', inputs: [lit('F', 'Half-wing load', Fhalf, 'N', loadSrc), input(r, 'span', 'b'), input(r, 'braceStation', 'a')],
      compute: () => outer.Fout, unit: 'N', digits: 4, note: `Uses ${distText}.` })] : []),
    card({ id: 'Mroot', title: braced ? 'Bending moment at the bracing point' : 'Bending moment at the wing root',
      what: braced ? 'How hard the lift on the outer wing tries to bend the spar where the stays/struts attach.' : 'How hard the lift tries to bend the wing upward where it joins the body. This is usually the most loaded point.',
      eq: braced ? 'M = ∫ w(y) × (y − a) dy  from a to b/2' : (uniform ? 'M = F × (b/2) ÷ 2' : 'M = F × 4(b/2) ÷ (3π)'),
      inputs: [lit('F', 'Half-wing load', Fhalf, 'N', loadSrc), input(r, 'span', 'b'), ...(braced ? [input(r, 'braceStation', 'a')] : [])],
      compute: () => M, unit: 'N·m', digits: 4,
      note: braced
        ? `Treats the wing outside the bracing point as a cantilever, with ${distText}. The inner wing, the stays/struts, their end fittings and the centre joint carry the rest of the load and are NOT checked here — they are often the parts that fail first.`
        : `Assumes ${distText} and a cantilever wing (no struts or wires). If your wing has stays or struts, enter the bracing point.` }),
    card({ id: 'I', title: 'Second moment of area of one spar', what: 'How well the spar\'s shape resists bending. Taller sections resist far better.',
      eq: { roundTube: 'I = π(D⁴ − (D−2t)⁴) ÷ 64', rectTube: 'I = (B·H³ − (B−2t)(H−2t)³) ÷ 12', roundSolid: 'I = π·D⁴ ÷ 64', rectSolid: 'I = B·H³ ÷ 12' }[v.sparShape] || 'depends on cross-section',
      inputs: [lit('shape', 'Spar cross-section', v.sparShape ? 1 : NaN, '', 'entered'), ...(sec?.needs || ['sparH']).map((id) => input(r, id, { sparH: 'H', sparW: 'B', sparWall: 't' }[id]))],
      compute: () => Ival, unit: 'm⁴', digits: 3, note: shapeNote, src: secSrc === 'estimated' ? 'estimated' : 'calculated' }),
    card({ id: 'stress', title: 'Bending stress at the root', what: 'Force per area in the most-stressed fibre of the spar.', eq: 'σ = M × c ÷ (I × N_spars)',
      inputs: [lit('M', 'Root bending moment', M, 'N·m', loadSrc), lit('c', 'Distance to outer fibre', sec ? sec.c : NaN, 'm', secSrc), lit('I', 'Second moment of area', Ival, 'm⁴', secSrc), input(r, 'sparCount', 'N')],
      compute: (m, c, I, n) => m * c / (I * n) / 1e6, unit: 'MPa', digits: 3, note: 'Assumes the spars share the load equally and the skin/ribs carry no bending.' }),
  ];
  // Look the stress card up by id (card positions change when a braced wing adds a card)
  const stressCard = cards.find((c) => c.id === 'stress');
  const sigma = stressCard.result;
  cards.push(card({ id: 'strain', title: 'Strain at the root', what: 'How much the material stretches (as a fraction of its length).', eq: 'ε = σ ÷ E',
    inputs: [lit('σ', 'Bending stress', sigma, 'MPa', stressCard.src), input(r, 'youngsModulus', 'E')], compute: (s, E) => s / (E * 1000), unit: '', digits: 3 }));
  cards.push(card({ id: 'fos', title: 'Factor of safety (bending, root)', what: 'Material strength ÷ calculated stress. 1.0 means it would just reach its limit at the design load.', eq: 'FoS = σ_strength ÷ σ',
    inputs: [input(r, 'yieldStrength', 'σ_strength'), lit('σ', 'Bending stress', sigma, 'MPa', stressCard.src)], compute: (y, s) => y / s, unit: '', digits: 3,
    note: 'Only as good as the strength value you entered. Does not include joints, bolt holes, buckling of thin walls, glue lines or fatigue — these often fail first.' }));
  cards.push(card({ id: 'defl', title: braced ? 'Approximate tip deflection of the outer wing' : 'Approximate wing-tip deflection', what: 'How far the tip bends up at the design load.',
    eq: 'δ ≈ w × L⁴ ÷ (8 × E × I × N),  w = F_out ÷ L,  L = length outside the support',
    inputs: [lit('F_out', braced ? 'Load outside the bracing point' : 'Half-wing load', outer.Fout, 'N', loadSrc), lit('L', braced ? 'Outer wing length' : 'Half-span', halfSpan - a, 'm', loadSrc), input(r, 'youngsModulus', 'E', 1e9, 'Pa'), lit('I', 'Second moment of area', Ival, 'm⁴', secSrc), input(r, 'sparCount', 'N')],
    compute: (F, L, E, I, n) => (F / L) * L ** 4 / (8 * E * I * n), unit: 'm', digits: 3,
    note: `Uniform-load cantilever approximation with a constant spar section${braced ? ', measured from the bracing point (stretch of the stays is ignored)' : ''}.` }));

  const f = analysis?.flight;
  const vImp = f ? f.impactSpeed : NaN;
  cards.push(card({ id: 'aImp', title: 'Average deceleration in the water', what: 'How quickly the craft is stopped by the water.', eq: 'a = v² ÷ (2 × d)',
    inputs: [lit('v', 'Impact speed (simulation)', vImp, 'm/s', f ? simulationSource(r) : 'missing'), input(r, 'stopDistance', 'd')], compute: (vv, d) => vv * vv / (2 * d), unit: 'm/s²', digits: 3,
    note: 'Average only; peak forces are higher. Stopping distance is very uncertain.' }));
  cards.push(card({ id: 'gImp', title: 'Average impact load (in g)', what: 'Deceleration compared with gravity.', eq: 'n = a ÷ g',
    inputs: [lit('a', 'Average deceleration', cards[cards.length - 1].result, 'm/s²', cards[cards.length - 1].src), constant('g', 'Gravity', G, 'm/s²')], compute: (a, g) => a / g, unit: 'g', digits: 3 }));
  cards.push(card({ id: 'FImp', title: 'Average impact force', what: 'Average force the water applies to stop the whole craft.', eq: 'F = m × a',
    inputs: [input(r, 'totalMass', 'm'), lit('a', 'Average deceleration', cards[cards.length - 2].result, 'm/s²', cards[cards.length - 2].src)], compute: (m, a) => m * a, unit: 'N', digits: 4 }));
  return cards;
}
