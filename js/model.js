// Turns a stored design into resolved values with sources, lists what is missing,
// runs sanity checks and builds the completeness checklist.
// Rule: nothing unknown is ever filled in silently. Derived values are "calculated"
// (or "estimated" if any input to them is estimated).
import { FIELDS, FIELD } from './fields.js';
import { analyze, G } from './physics.js';

const R_AIR = 287.05;
const DEG = Math.PI / 180;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export const SOURCE_LABEL = {
  measured: 'Measured', entered: 'Entered', calculated: 'Calculated', estimated: 'Estimated', missing: 'Not provided',
};

// ---------------------------------------------------------------------------
// Pocketing (lightweighting): material removed from a part.
// Pocket sizes in mm. shape 'rect': a × b × depth; 'round': Ø a × depth. count = how many identical pockets.
// Removed mass = total pocket volume × the part's material density (entered by the user, never assumed),
// plus any directly entered removed mass (e.g. weighed offcuts). Applied per item, times quantity.
// ---------------------------------------------------------------------------
export function pocketVolume(p) {
  const n = isNum(p.count) ? p.count : 1;
  const depth = p.depth / 1000;
  if (p.shape === 'round') return isNum(p.a) && isNum(p.depth) ? n * Math.PI * (p.a / 2000) ** 2 * depth : NaN;
  return isNum(p.a) && isNum(p.b) && isNum(p.depth) ? n * (p.a / 1000) * (p.b / 1000) * depth : NaN;
}

export function pocketRemoval(c) {
  const pockets = c.pockets || [];
  const hasManual = isNum(c.removedMass) && c.removedMass > 0;
  if (!pockets.length && !hasManual) return { none: true, mass: 0, volume: 0 };
  const vols = pockets.map(pocketVolume);
  const incomplete = vols.filter((v) => !isNum(v)).length;
  const volume = vols.filter(isNum).reduce((a, v) => a + v, 0);
  if (volume > 0 && !isNum(c.density)) return { ok: false, reason: 'material density not entered', volume, mass: hasManual ? c.removedMass : 0, incomplete };
  const mass = volume * (c.density || 0) + (hasManual ? c.removedMass : 0);
  return { ok: true, volume, mass, incomplete };
}

// Mass of one parts-list row including quantity, after pocketing.
export function componentMass(c) {
  const qty = isNum(c.qty) ? c.qty : 1;
  if (!isNum(c.mass)) return NaN;
  const rem = pocketRemoval(c);
  return Math.max(0, c.mass - (rem.none ? 0 : rem.mass)) * qty;
}

// Source label of a part's final mass: pocketing turns a weighed/spec mass into a calculated one.
export function partMassSource(c) {
  const src = c.massSource || 'entered';
  const rem = pocketRemoval(c);
  if (rem.none || rem.ok === false || src === 'estimated') return src;
  return 'calculated';
}

// Same design with every pocket removed (for "with vs without pocketing" comparisons).
export function withoutPocketing(d) {
  const copy = JSON.parse(JSON.stringify(d));
  for (const c of copy.components) { c.pockets = []; delete c.removedMass; }
  return copy;
}
export const hasPocketing = (d) => d.components.some((c) => !pocketRemoval(c).none);

// ---------------------------------------------------------------------------
// resolve(design) -> { v, src, how }
//   v:   value per id (fields + derived keys: totalMass, weight, AR, headwind, mu)
//   src: 'measured' | 'entered' | 'calculated' | 'estimated'
//   how: plain-English explanation for derived values
// ---------------------------------------------------------------------------
export function resolve(d) {
  const v = {}, src = {}, how = {};
  for (const f of FIELDS) {
    const x = d.values[f.id];
    if (x === undefined || x === null || x === '') continue;
    if (f.type !== 'text' && f.type !== 'select' && !isNum(x)) continue;
    v[f.id] = x;
    src[f.id] = d.source[f.id] || 'entered';
  }
  const has = (id) => isNum(v[id]);
  const worst = (ids, extra = []) =>
    ids.some((i) => src[i] === 'estimated') || extra.includes('estimated') ? 'estimated' : 'calculated';
  const put = (id, value, inputs, text, extra) => { v[id] = value; src[id] = worst(inputs, extra); how[id] = text; };

  // Mass from the parts list
  const parts = d.components.filter((c) => isNum(componentMass(c)));
  if (!has('craftMass') && parts.length) {
    const sum = parts.reduce((a, c) => a + componentMass(c), 0);
    const guessed = parts.some((c) => c.massSource === 'estimated' || (!pocketRemoval(c).none && c.densitySource === 'estimated')) ? ['estimated'] : [];
    put('craftMass', sum, [], `Sum of ${parts.length} part${parts.length > 1 ? 's' : ''} in the Parts & balance tab.`, guessed);
  }
  if (has('craftMass') && has('pilotMass')) {
    put('totalMass', v.craftMass + v.pilotMass, ['craftMass', 'pilotMass'], 'Craft mass + pilot mass.');
    put('weight', v.totalMass * G, ['totalMass'], 'Total mass × g (9.81 m/s²).');
  }

  // Wing geometry
  if (!has('wingArea')) {
    if (has('span') && has('chord')) put('wingArea', v.span * v.chord, ['span', 'chord'], 'Wingspan × average chord (assumes a roughly rectangular wing).');
    else if (has('span') && has('aspectRatio')) put('wingArea', v.span ** 2 / v.aspectRatio, ['span', 'aspectRatio'], 'Wingspan² ÷ aspect ratio.');
  }
  if (!has('chord') && has('wingArea') && has('span')) put('chord', v.wingArea / v.span, ['wingArea', 'span'], 'Wing area ÷ wingspan (mean geometric chord).');
  if (has('span') && has('wingArea')) put('AR', v.span ** 2 / v.wingArea, ['span', 'wingArea'], 'Wingspan² ÷ wing area.');

  // Atmosphere
  if (!has('pressure') && has('elevation')) {
    put('pressure', 1013.25 * (1 - 2.25577e-5 * v.elevation) ** 5.25588, ['elevation'],
      'Standard-atmosphere pressure at this elevation (real pressure varies with weather).', ['estimated']);
  }
  if (!has('airDensity')) {
    if (has('temperature') && has('pressure')) {
      put('airDensity', (v.pressure * 100) / (R_AIR * (v.temperature + 273.15)), ['temperature', 'pressure'], 'Ideal gas law: ρ = P ÷ (R × T).');
    } else if (has('elevation')) {
      const T = 288.15 - 0.0065 * v.elevation;
      const P = 101325 * (1 - 2.25577e-5 * v.elevation) ** 5.25588;
      put('airDensity', P / (R_AIR * T), ['elevation'], 'Standard-atmosphere density at this elevation (assumes standard temperature and pressure for that height).', ['estimated']);
    }
  }
  if (has('temperature')) {
    const T = v.temperature + 273.15;
    put('mu', (1.458e-6 * T ** 1.5) / (T + 110.4), ['temperature'], "Sutherland's law for air viscosity at this temperature.");
  }

  // Wind: only the head/tail component enters the 2D model
  if (has('windSpeed')) {
    if (v.windSpeed === 0) put('headwind', 0, ['windSpeed'], 'No wind.');
    else if (has('windDir')) put('headwind', v.windSpeed * Math.cos(v.windDir * DEG), ['windSpeed', 'windDir'], 'Wind speed × cos(wind direction). Positive = headwind.');
  }

  // CLmax from a known stall speed
  if (!has('clMax') && has('stallSpeed') && has('totalMass') && has('wingArea') && has('airDensity')) {
    put('clMax', (2 * v.weight) / (v.airDensity * v.wingArea * v.stallSpeed ** 2),
      ['stallSpeed', 'totalMass', 'wingArea', 'airDensity'], 'From stall speed: CLmax = 2W ÷ (ρ × S × Vs²).');
  }

  return { v, src, how };
}

// ---------------------------------------------------------------------------
// What the simulation needs and why
// ---------------------------------------------------------------------------
export function simulationMissing(r) {
  const { v } = r;
  const has = (id) => isNum(v[id]);
  const out = [];
  const need = (id, why, fieldIds = [id]) => { if (!has(id)) out.push({ id, fieldIds, label: FIELD[id]?.label || id, why }); };

  need('span', 'Wingspan sets the aspect ratio, which controls how efficiently the wing makes lift.');
  need('wingArea', 'Lift and drag both scale with wing area. Enter wing area, or wingspan and chord.', ['wingArea', 'chord']);
  need('craftMass', 'Gravity pulls on the total mass. Enter it, or list parts in Parts & balance.');
  need('pilotMass', 'The pilot is part of the total mass.');
  need('launchSpeed', 'The starting speed decides how much lift the wing can make at first.');
  need('deckHeight', 'The deck height is the height the craft falls from.');
  need('launchAngle', 'The starting direction of travel.');
  if (!has('headwind')) {
    if (!has('windSpeed')) out.push({ id: 'windSpeed', fieldIds: ['windSpeed'], label: 'Wind speed', why: 'Wind changes the airspeed over the wing. Enter 0 for calm air.' });
    else out.push({ id: 'windDir', fieldIds: ['windDir'], label: 'Wind direction', why: 'Needed to know whether the wind helps (headwind) or hurts (tailwind).' });
  }
  need('airDensity', 'Thinner air makes less lift. Enter density, or temperature and pressure/elevation.', ['airDensity', 'temperature', 'pressure', 'elevation']);
  if (!has('knownCL')) {
    need('aoa', 'Angle of attack sets how much lift the wing makes (or enter a measured CL).');
    need('clMax', 'Needed to detect a stall (or enter a known stall speed).');
  }
  if (!has('knownCD')) {
    need('cd0', 'Parasite drag slows the craft down (or enter a measured total CD).');
    need('oswald', 'Needed to calculate the drag caused by lift.');
  }
  return out;
}

export function simParams(r) {
  const v = r.v;
  return {
    mass: v.totalMass, wingArea: v.wingArea, span: v.span, aoa: v.aoa, clMax: v.clMax, cd0: v.cd0,
    oswald: v.oswald, knownCL: v.knownCL, knownCD: v.knownCD, airDensity: v.airDensity, headwind: v.headwind,
    launchSpeed: v.launchSpeed, launchAngle: v.launchAngle, deckHeight: v.deckHeight,
  };
}

// Returns { r, missing, params, analysis|null }
export function evaluate(d, overrides = null) {
  const r = resolve(d);
  if (overrides) {
    for (const [k, val] of Object.entries(overrides)) { r.v[k] = val; r.src[k] = 'entered'; }
  }
  const missing = simulationMissing(r);
  if (missing.length) return { r, missing, params: null, analysis: null };
  const params = simParams(r);
  return { r, missing, params, analysis: analyze(params) };
}

// Fields whose explicit "typical assumption" could unblock the simulation
export function assumableMissing(missing) {
  const ids = new Set();
  for (const m of missing) for (const id of m.fieldIds) if (FIELD[id]?.assume) ids.add(id);
  // Air: only assume density if nothing that could calculate it is present
  return [...ids];
}

export function applyAssumptions(d, ids) {
  for (const id of ids) {
    const f = FIELD[id];
    if (!f?.assume) continue;
    d.values[id] = f.assume.value;
    d.source[id] = 'estimated';
    if (d.sourceNote) delete d.sourceNote[id];
  }
}

// ---------------------------------------------------------------------------
// Centre of mass
// ---------------------------------------------------------------------------
export function centerOfMass(d, r) {
  const items = d.components.filter((c) => isNum(componentMass(c)) && componentMass(c) > 0)
    .map((c) => ({ name: c.name || 'Unnamed part', m: componentMass(c), x: c.x, y: c.y }));
  if (isNum(r.v.pilotMass)) items.push({ name: 'Pilot', m: r.v.pilotMass, x: r.v.pilotX, y: r.v.pilotY, pilot: true });
  const missingX = items.filter((i) => !isNum(i.x)).map((i) => i.name);
  const noMass = d.components.filter((c) => !isNum(componentMass(c))).map((c) => c.name || 'Unnamed part');
  const result = { items, missingX, noMass, x: NaN, y: NaN, mass: 0, missingY: [] };
  if (!items.length) return result;
  result.mass = items.reduce((a, i) => a + i.m, 0);
  if (!missingX.length) result.x = items.reduce((a, i) => a + i.m * i.x, 0) / result.mass;
  result.missingY = items.filter((i) => !isNum(i.y)).map((i) => i.name);
  if (!result.missingY.length) result.y = items.reduce((a, i) => a + i.m * i.y, 0) / result.mass;
  // Craft mass typed directly but parts don't add up -> CoM would be misleading
  result.partsIncomplete = isNum(d.values.craftMass) && d.components.length > 0 &&
    Math.abs(items.filter((i) => !i.pilot).reduce((a, i) => a + i.m, 0) - d.values.craftMass) > 0.05 * d.values.craftMass;
  result.guessed = d.components.some((c) => c.massSource === 'estimated');
  return result;
}

// ---------------------------------------------------------------------------
// Sanity checks: { level: 'error'|'warn'|'info', text, fieldId? }
// ---------------------------------------------------------------------------
export function sanityChecks(d, r, analysis) {
  const { v } = r;
  const out = [];
  const has = (id) => isNum(v[id]);
  const add = (level, text, fieldId) => out.push({ level, text, fieldId });

  if (has('span') && has('chord') && v.chord > v.span) add('error', 'Chord is larger than wingspan (aspect ratio below 1). Check that span and chord are not swapped.', 'chord');
  if (has('span') && (v.span < 1 || v.span > 20)) add('warn', `Wingspan of ${v.span} m is unusual for a Flugtag craft. Check units (feet vs metres, mm vs m).`, 'span');
  if (has('deckHeight') && v.deckHeight > 15) add('warn', `Deck height of ${v.deckHeight} m is higher than usual. Did you enter feet instead of metres?`, 'deckHeight');
  if (has('launchSpeed') && v.launchSpeed > 12) add('warn', `Launch speed of ${v.launchSpeed} m/s is faster than elite sprinters run (about 10–12 m/s). A push crew with a craft is usually slower. Check you used m/s, not km/h or mph.`, 'launchSpeed');
  if (has('pilotMass') && (v.pilotMass < 35 || v.pilotMass > 150)) add('warn', `Pilot mass of ${v.pilotMass} kg looks unusual. Did you enter pounds?`, 'pilotMass');
  if (has('airDensity') && (v.airDensity < 0.9 || v.airDensity > 1.35)) add('warn', `Air density of ${v.airDensity.toFixed(3)} kg/m³ is outside normal ground-level values (about 0.9–1.35).`, 'airDensity');
  if (has('temperature') && has('pressure') && has('airDensity') && r.src.airDensity !== 'calculated') {
    const calc = (v.pressure * 100) / (R_AIR * (v.temperature + 273.15));
    if (Math.abs(calc - v.airDensity) / calc > 0.05) add('warn', `Entered air density (${v.airDensity}) differs from the value calculated from temperature and pressure (${calc.toFixed(3)}).`, 'airDensity');
  }
  if (isNum(d.values.aspectRatio) && has('span') && has('wingArea') && r.src.wingArea !== 'calculated') {
    const ar = v.span ** 2 / v.wingArea;
    if (Math.abs(ar - d.values.aspectRatio) / ar > 0.05) add('warn', `Entered aspect ratio (${d.values.aspectRatio}) does not match span² ÷ area (${ar.toFixed(2)}). The simulation uses span² ÷ area.`, 'aspectRatio');
  }
  if (isNum(d.values.wingArea) && has('span') && has('chord') && d.source.chord !== 'calculated') {
    const rect = v.span * v.chord;
    if (Math.abs(rect - v.wingArea) / v.wingArea > 0.25) add('info', `Wing area (${v.wingArea} m²) differs from span × chord (${rect.toFixed(2)} m²) by more than 25%. Fine for tapered or unusual wings — otherwise check.`, 'wingArea');
  }
  const partsSum = d.components.reduce((a, c) => a + (isNum(componentMass(c)) ? componentMass(c) : 0), 0);
  if (isNum(d.values.craftMass) && partsSum > 0 && Math.abs(partsSum - d.values.craftMass) > 0.05 * d.values.craftMass) {
    add('warn', `Craft mass entered (${d.values.craftMass} kg) differs from the sum of parts (${partsSum.toFixed(1)} kg).`, 'craftMass');
  }
  for (const c of d.components) {
    const rem = pocketRemoval(c);
    if (rem.ok === false) add('warn', `Pockets on "${c.name || 'unnamed part'}" are not subtracted: ${rem.reason}.`);
    if (rem.incomplete) add('info', `${rem.incomplete} pocket(s) on "${c.name || 'unnamed part'}" are missing a size and are ignored.`);
    if (!rem.none && c.massSource === 'calculated' && c.massFromCad) add('warn', `"${c.name || 'unnamed part'}" already gets its mass from the CAD volume. If the CAD model is already pocketed, adding pockets here subtracts them twice.`);
    if (!rem.none && isNum(c.mass) && rem.mass > c.mass) add('error', `Pockets on "${c.name || 'unnamed part'}" remove more mass (${rem.mass.toFixed(2)} kg) than the part has (${c.mass} kg). Check sizes and density.`);
  }
  const noMass = d.components.filter((c) => !isNum(componentMass(c)));
  if (noMass.length) add('info', `${noMass.length} part(s) in Parts & balance have no mass yet: ${noMass.map((c) => c.name || 'unnamed').join(', ')}.`);
  if (has('ruleMaxSpan') && has('span') && v.span > v.ruleMaxSpan) add('error', `Wingspan ${v.span.toFixed(2)} m exceeds the rule limit you entered (${v.ruleMaxSpan} m).`, 'span');
  if (has('ruleMaxMass') && has('craftMass') && v.craftMass > v.ruleMaxMass) add('error', `Craft mass ${v.craftMass.toFixed(1)} kg exceeds the rule limit you entered (${v.ruleMaxMass} kg).`, 'craftMass');
  if (has('knownCL') && has('aoa')) add('info', 'A measured CL is entered, so the angle of attack is not used for lift.', 'aoa');
  if (d.cad?.analysis && has('span') && r.src.span === 'entered' && isNum(d.cad.analysis.size?.x)) {
    const cadSpan = d.cad.analysis.size.x;
    if (Math.abs(cadSpan - v.span) / cadSpan > 0.1) add('info', `Entered wingspan (${v.span} m) differs from the CAD width (${cadSpan.toFixed(2)} m).`, 'span');
  }
  if (analysis) {
    if (analysis.aero.stalled) add('warn', 'The wing is stalled at the chosen angle of attack / CL (above CLmax). Results are very uncertain.', 'aoa');
    if (analysis.aero.CL <= 0) add('warn', 'The wing makes no upward lift with these inputs.', 'aoa');
    if (analysis.flight.timedOut) add('warn', 'The simulation hit its 120 s safety limit. Inputs are probably unrealistic.');
  }
  return out;
}

// ---------------------------------------------------------------------------
// Completeness checklist (no score — just what is and isn't there)
// status: 'ok' | 'est' | 'missing' | 'optional'
// ---------------------------------------------------------------------------
export function completeness(d, r, ev, com, tests) {
  const { v, src } = r;
  const st = (ids) => {
    if (!ids.every((id) => isNum(v[id]) || (typeof v[id] === 'string' && v[id]))) return 'missing';
    return ids.some((id) => src[id] === 'estimated') ? 'est' : 'ok';
  };
  const srcText = (id) => (src[id] ? SOURCE_LABEL[src[id]].toLowerCase() : '');
  const items = [
    { label: 'CAD model', status: d.cad ? 'ok' : 'optional', detail: d.cad ? d.cad.fileName : 'Optional — everything also works with manual entry', go: 'cad' },
    { label: 'Wingspan', status: st(['span']), detail: srcText('span'), go: 'inputs', field: 'span' },
    { label: 'Wing area', status: st(['wingArea']), detail: srcText('wingArea'), go: 'inputs', field: 'wingArea' },
    { label: 'Craft mass', status: st(['craftMass']), detail: srcText('craftMass'), go: 'inputs', field: 'craftMass' },
    { label: 'Pilot mass', status: st(['pilotMass']), detail: srcText('pilotMass'), go: 'inputs', field: 'pilotMass' },
    { label: 'Launch speed', status: st(['launchSpeed']), detail: srcText('launchSpeed'), go: 'inputs', field: 'launchSpeed' },
    { label: 'Deck height', status: st(['deckHeight']), detail: srcText('deckHeight'), go: 'inputs', field: 'deckHeight' },
    { label: 'Wind', status: st(['headwind']), detail: isNum(v.headwind) ? srcText('headwind') : '', go: 'inputs', field: 'windSpeed' },
    { label: 'Air density', status: st(['airDensity']), detail: srcText('airDensity'), go: 'inputs', field: 'airDensity' },
    { label: 'Lift data (CL / angle of attack, CLmax)', status: isNum(v.knownCL) ? st(['knownCL']) : st(['aoa', 'clMax']), detail: '', go: 'inputs', field: 'aoa' },
    { label: 'Drag data (CD0, e — or measured CD)', status: isNum(v.knownCD) ? st(['knownCD']) : st(['cd0', 'oswald']), detail: '', go: 'inputs', field: 'cd0' },
    { label: 'Parts / mass breakdown', status: d.components.length ? (d.components.some((c) => c.massSource === 'estimated') ? 'est' : 'ok') : 'missing', detail: `${d.components.length} part(s)`, go: 'mass' },
    { label: 'Centre of mass', status: isNum(com.x) ? (com.guessed ? 'est' : 'ok') : 'missing', detail: isNum(com.x) ? `${com.x.toFixed(2)} m from nose` : 'needs part positions and pilot position', go: 'mass' },
    { label: 'Tail geometry (for stability check)', status: st(['wingLEx', 'tailArea', 'tailSpan', 'tailLEx']), detail: '', go: 'mass' },
    { label: 'Spar & material (for structure check)', status: st(['sparH', 'yieldStrength']), detail: '', go: 'structure' },
    { label: 'Physical tests recorded', status: tests.length ? 'ok' : 'missing', detail: `${tests.length} test(s)`, go: 'tests' },
  ];
  const analyses = [
    { label: 'Basic flight simulation', ok: !!ev.analysis, why: ev.missing.map((m) => m.label).join(', ') },
    { label: 'Centre of mass', ok: isNum(com.x), why: 'needs positions of all parts and the pilot' },
  ];
  return { items, analyses };
}
