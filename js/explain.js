// Plain-English explanations of a simulation, plus one-at-a-time sensitivity and what-if helpers.
import { analyze, G } from './physics.js';
import { FIELD } from './fields.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const f1 = (v) => (isNum(v) ? v.toFixed(1) : '?');

// Variables the what-if tool and sensitivity analysis can change.
// apply(params, value, ev) returns new params. get(params) returns the current value.
export function whatIfVariables(ev) {
  const r = ev.r;
  const areaFromChord = (r.src.wingArea === 'calculated' || r.src.wingArea === 'estimated') && r.how.wingArea?.startsWith('Wingspan ×');
  const vars = [
    { id: 'mass', label: 'Total mass (craft + pilot)', unit: 'kg', get: (p) => p.mass, apply: (p, x) => ({ ...p, mass: x }) },
    { id: 'span', label: 'Wingspan', unit: 'm', get: (p) => p.span,
      apply: (p, x) => ({ ...p, span: x, wingArea: areaFromChord ? x * r.v.chord : p.wingArea }),
      note: areaFromChord ? `Wing area is recalculated as span × chord (chord kept at ${f1(r.v.chord)} m).` : 'Wing area is kept fixed, so the wing gets more slender (aspect ratio changes).' },
    { id: 'wingArea', label: 'Wing area', unit: 'm²', get: (p) => p.wingArea, apply: (p, x) => ({ ...p, wingArea: x }), note: 'Wingspan kept fixed (the chord changes).' },
    { id: 'launchSpeed', label: 'Launch speed', unit: 'm/s', get: (p) => p.launchSpeed, apply: (p, x) => ({ ...p, launchSpeed: x }) },
    { id: 'launchAngle', label: 'Launch angle', unit: '°', get: (p) => p.launchAngle, apply: (p, x) => ({ ...p, launchAngle: x }), additive: 5 },
    { id: 'headwind', label: 'Headwind (negative = tailwind)', unit: 'm/s', get: (p) => p.headwind, apply: (p, x) => ({ ...p, headwind: x }), additive: 2 },
    { id: 'deckHeight', label: 'Deck height', unit: 'm', get: (p) => p.deckHeight, apply: (p, x) => ({ ...p, deckHeight: x }) },
  ];
  if (isNum(r.v.knownCL)) {
    vars.push({ id: 'knownCL', label: 'Lift coefficient CL', unit: '', get: (p) => p.knownCL, apply: (p, x) => ({ ...p, knownCL: x }) });
  } else {
    vars.push({ id: 'aoa', label: 'Angle of attack', unit: '°', get: (p) => p.aoa, apply: (p, x) => ({ ...p, aoa: x }), additive: 1 });
    vars.push({ id: 'knownCL', label: 'Lift coefficient CL (fixed, replaces angle of attack)', unit: '', get: (p) => analyze(p).aero.CL, apply: (p, x) => ({ ...p, knownCL: x }), skipSensitivity: true });
  }
  if (isNum(r.v.knownCD)) vars.push({ id: 'knownCD', label: 'Drag coefficient CD', unit: '', get: (p) => p.knownCD, apply: (p, x) => ({ ...p, knownCD: x }) });
  else vars.push({ id: 'cd0', label: 'Parasite drag coefficient CD0', unit: '', get: (p) => p.cd0, apply: (p, x) => ({ ...p, cd0: x }) });
  if (isNum(r.v.clMax)) vars.push({ id: 'clMax', label: 'CLmax (stall limit)', unit: '', get: (p) => p.clMax, apply: (p, x) => ({ ...p, clMax: x }) });
  return vars;
}

export function outputsOf(a) {
  return {
    distance: a.flight.distance, time: a.flight.time, maxHeight: a.flight.maxHeight,
    impactSpeed: a.flight.impactSpeed, stallSpeed: a.stallSpeed, stalled: a.aero.stalled,
  };
}

export const OUTPUTS = [
  { id: 'distance', label: 'Distance', unit: 'm' },
  { id: 'time', label: 'Flight time', unit: 's' },
  { id: 'maxHeight', label: 'Max height', unit: 'm' },
  { id: 'impactSpeed', label: 'Impact speed', unit: 'm/s' },
  { id: 'stallSpeed', label: 'Stall speed', unit: 'm/s' },
];

// One-at-a-time: change each input by ±10% (or a fixed step) and see how distance changes.
export function sensitivity(ev) {
  const base = outputsOf(ev.analysis);
  const out = [];
  for (const v of whatIfVariables(ev)) {
    if (v.skipSensitivity) continue;
    const x0 = v.get(ev.params);
    if (!isNum(x0)) continue;
    const step = v.additive ?? Math.abs(x0) * 0.1;
    if (!step) continue;
    const lo = outputsOf(analyze(v.apply(ev.params, x0 - step, ev)));
    const hi = outputsOf(analyze(v.apply(ev.params, x0 + step, ev)));
    out.push({ ...v, x0, step, lo, hi, dLo: lo.distance - base.distance, dHi: hi.distance - base.distance, stepText: v.additive ? `±${v.additive} ${v.unit}` : '±10%' });
  }
  return out.sort((a, b) => Math.max(Math.abs(b.dLo), Math.abs(b.dHi)) - Math.max(Math.abs(a.dLo), Math.abs(a.dHi)));
}

// ---------------------------------------------------------------------------
// "What happened? Why? Assumptions? Missing? What to test next?"
// ---------------------------------------------------------------------------
export function explain(ev, d, com, sens) {
  const { r, analysis: a, params: p } = ev;
  const f = a.flight;
  const out = { happened: [], why: [], assumptions: [], missing: [], next: [] };

  out.happened.push(`The craft left the ${f1(p.deckHeight)} m deck at ${f1(p.launchSpeed)} m/s and reached the water ${f1(f.distance)} m out, after ${f.time.toFixed(2)} s, at ${f1(f.impactSpeed)} m/s.`);
  if (f.maxHeight > p.deckHeight + 0.05) out.happened.push(`It climbed ${f1(f.maxHeight - p.deckHeight)} m above the deck before descending.`);
  const gain = f.distance - a.noLift.distance;
  out.happened.push(`Without any lift, the same craft would have landed at ${f1(a.noLift.distance)} m, so the wings added about ${f1(gain)} m in this model.`);

  const V0 = a.launchAirspeed;
  const L0W = f.points[0].L / a.weightN;
  if (a.aero.stalled) {
    out.why.push(`The wing is stalled: the requested lift (angle of attack ${f1(p.aoa)}°) is beyond the stall limit (about ${f1(a.aero.alphaStallDeg)}°). After a stall, lift drops and drag rises sharply.`);
  }
  if (a.aero.CL <= 0) out.why.push('The wing is making no upward lift at this setting, so the craft simply falls.');
  else if (isNum(a.flySpeed)) {
    out.why.push(`To hold the craft up, the wing needs about ${f1(a.flySpeed)} m/s of airspeed at this lift setting. At launch the airspeed was ${f1(V0)} m/s, so lift started at ${Math.round(L0W * 100)}% of the weight.`);
    if (L0W < 1) out.why.push('Because lift was less than the weight, the craft started sinking immediately. Falling then speeds it up, which increases lift — that is why the path curves and then flattens a little.');
    else out.why.push('Lift was greater than the weight at launch, so the craft could initially hold or gain height, until drag slowed it down.');
  }
  if (Math.abs(p.headwind) > 0.05) {
    out.why.push(p.headwind > 0
      ? `The ${f1(p.headwind)} m/s headwind adds to the airspeed over the wing (more lift), but also pushes the craft back relative to the ground.`
      : `The ${f1(-p.headwind)} m/s tailwind reduces the airspeed over the wing (less lift).`);
  }
  if (sens?.length) {
    const top = sens.slice(0, 3).map((s) => `${s.label.toLowerCase()} (${s.stepText} changed distance by ${f1(Math.min(s.dLo, s.dHi))} to +${f1(Math.max(s.dLo, s.dHi))} m)`);
    out.why.push(`In this model the distance is most sensitive to: ${top.join('; ')}.`);
  }

  // Assumptions: every estimated input, plus the model assumptions
  const estimated = Object.keys(r.src).filter((id) => r.src[id] === 'estimated' && (FIELD[id] || id === 'headwind' || id === 'totalMass'));
  for (const id of estimated) {
    const label = FIELD[id]?.label || { headwind: 'Headwind component', totalMass: 'Total mass' }[id];
    const note = d.sourceNote?.[id] || FIELD[id]?.assume?.note || r.how[id] || 'Marked as estimated.';
    out.assumptions.push(`${label}: ${isNum(r.v[id]) ? +r.v[id].toPrecision(4) : r.v[id]} ${FIELD[id]?.unit || ''} — ${note}`);
  }
  out.assumptions.push('The craft holds a constant angle of attack the whole flight (no pitching, no pilot input).');
  out.assumptions.push('2D model: only the head/tail part of the wind is used; crosswind, gusts and turning are ignored.');
  out.assumptions.push('No structural failure, wing flex, ground effect over the water, or ramp effects.');

  if (!isNum(com.x)) out.missing.push('Centre of mass — needed to judge pitch balance. Add parts with positions in Mass & balance.');
  if (!isNum(r.v.tailArea)) out.missing.push('Tail size and position — needed for the preliminary stability check.');
  if (!isNum(r.v.knownCD) && r.src.cd0 === 'estimated') out.missing.push('Real drag data — CD0 is an assumption and strongly affects distance.');
  if (!isNum(r.v.knownCL) && r.src.clMax === 'estimated') out.missing.push('Real CLmax for your airfoil — decides when the wing stalls.');
  if (r.src.launchSpeed !== 'measured' && r.src.launchSpeed !== 'entered') out.missing.push('A measured launch speed.');
  if (!d.components.length) out.missing.push('A parts list with masses — to know where the weight comes from.');

  if (r.src.launchSpeed !== 'measured') out.next.push('Measure your real push speed: mark 5 m before the deck edge and time the craft over it with a phone video (count frames).');
  if (r.src.craftMass === 'estimated' || !isNum(d.values.craftMass)) out.next.push('Weigh the craft (or each part) on a scale and enter the real masses.');
  if (r.src.cd0 === 'estimated' || r.src.clMax === 'estimated') out.next.push('Glide-test a small scale model from a known height and record distance and time; compare with a simulation of the model to calibrate the drag assumption (scale effects apply — treat as a rough check).');
  if (sens?.length) out.next.push(`Focus measurement effort on ${sens[0].label.toLowerCase()} — it changes the result the most in this model.`);
  if (a.aero.stalled) out.next.push('Try a smaller angle of attack in the What-if tab to see the effect of avoiding the stall.');
  out.next.push('Record every real test in Physical tests so you can compare them with this simulation.');
  return out;
}

export { G };
