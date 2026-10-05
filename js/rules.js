// Event rules checks + "what could we fix?" suggestions with numbers.
// Rules are quoted from the official event page; nothing here is invented. When a rule can't be checked
// from the data we have, it says so.
import { componentMass, pocketRemoval } from './model.js';
import { stabilityCalcs, structureCalcs } from './calcs.js';
import { G } from './physics.js';

const FT = 0.3048;
const LB = 0.45359237;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const f2 = (v) => (isNum(v) ? v.toFixed(2) : '?');
const ft = (m) => (m / FT).toFixed(1);

export const RULESETS = {
  miami2026: {
    id: 'miami2026',
    name: 'Red Bull Flugtag Miami 2026',
    event: 'October 31, 2026 · Bayfront Park, Miami',
    source: 'https://www.redbull.com/us-en/events/flugtag-miami/flugtag-miami-rules-2026-06-09',
    checked: '2026-09-29',
    quote: 'Your design must be no longer than 28 feet from wing-tip to wing-tip and max. 20 feet from nose to tail. Craft and pilot cannot exceed 400 lbs. The pilot on must be in a good crouch position, not exceeding 10 ft high.',
    faqSource: 'https://www.redbull.com/us-en/events/flugtag-miami/ft-miami-faqs',
    faqQuote: 'All crafts must be human-powered – no engines or external energy sources allowed. Prefabricated crafts will not be accepted. Each craft must be less than 22-feet wide and not more than 400 lbs. (including the pilot), and craft pilots must be at least 18 years old.',
    spanConflict: 'Red Bull’s two Miami pages disagree: the FAQ says the craft must be less than 22 ft wide, the rules page says up to 28 ft wing-tip to wing-tip. The app checks the stricter 22 ft. Ask the organisers which applies.',
    limits: {
      span: 22 * FT,          // 6.706 m — FAQ "less than 22-feet wide" (stricter of the two official pages)
      length: 20 * FT,        // 6.096 m
      totalMass: 400 * LB,    // 181.4 kg, craft + pilot
      crouchHeight: 10 * FT,  // 3.048 m
    },
    // Confirmed by the team on 2026-10-05 (matches the "22-foot-high ramp" on the Miami rules page).
    deck: {
      ft: 22,
      m: 22 * FT, // 6.7056 m
      note: 'Official deck height 22 ft (6.71 m), confirmed by the team on 5 Oct 2026. Matches the "22-foot-high ramp" on the Miami rules page.',
    },
    // Rules that can't be checked from numbers — the team confirms them.
    manual: [
      ['human', 'Human power only — no motors, rockets, battery power or elastic bands.'],
      ['float', 'The craft floats; materials lighter than water (wood, foam) preferred over metal; nothing that gets waterlogged.'],
      ['toxic', 'No toxic materials that may dissolve in water; avoid materials that fragment or are hard to clear up.'],
      ['cockpit', 'No hard or sharp surfaces around the cockpit.'],
      ['strap', 'Pilot is NOT strapped in or enclosed in a capsule/cockpit they can\'t readily escape.'],
      ['teambuilt', 'Entirely designed and built by the team — not an adapted light aircraft or hang-glider. Prefabricated crafts are not accepted.'],
      ['team', 'Team of five: one pilot (18+) and four ground crew (16+).'],
      ['swim', 'Everyone who jumps can swim 100 yards unaided (in costume).'],
      ['costume', 'Costumes can\'t catch on the craft or stop the pilot seeing, breathing or floating.'],
    ],
  },
};
export const DEFAULT_RULESET = 'miami2026';
export const rulesetOf = (d) => (d.ruleset === 'none' ? null : RULESETS[d.ruleset || DEFAULT_RULESET] || null);

// ---------------------------------------------------------------------------
// Numeric rule checks
// status: 'ok' | 'close' (within 3% of the limit) | 'over' | 'unknown'
// ---------------------------------------------------------------------------
export function ruleChecks(d, ev, com) {
  const rs = rulesetOf(d);
  if (!rs) return [];
  const { v, src } = ev.r;
  const L = rs.limits;
  const out = [];
  const status = (val, lim) => (!isNum(val) ? 'unknown' : val > lim ? 'over' : val > lim * 0.97 ? 'close' : 'ok');

  // Wingspan
  {
    const useWidth = isNum(v.width) && (!isNum(v.span) || v.width > v.span);
    const val = useWidth ? v.width : v.span;
    const c = { id: 'span', label: 'Width (widest point, wing-tip to wing-tip)', limit: L.span, limitText: 'less than 22 ft (6.71 m)', value: val, unit: 'm', src: useWidth ? src.width : src.span,
      status: !isNum(val) ? 'unknown' : val >= L.span ? 'over' : val > L.span * 0.97 ? 'close' : 'ok', fixes: [],
      note: `${useWidth ? 'Uses the overall width (wider than the wingspan you entered). ' : ''}${rs.spanConflict}` };
    if (c.status === 'unknown') c.fixes.push('Enter the wingspan (Design numbers step) or measure it from CAD.');
    if (c.status === 'over' || c.status === 'close') {
      const cut = val - L.span;
      if (c.status === 'over') c.fixes.push(`Reduce the width by at least ${f2(cut)} m (${ft(cut)} ft) to under ${f2(L.span)} m (22 ft).`);
      if (c.status === 'close') c.fixes.push(`Only ${((L.span - val) / 0.0254).toFixed(1)} in to spare. Fabric, hinges, fastener heads and tip parts can push it over — measure the finished craft at its widest point.`);
      if (isNum(v.wingArea)) {
        const chord = v.wingArea / L.span;
        const ar = L.span ** 2 / v.wingArea;
        c.fixes.push(`To keep the same wing area (${f2(v.wingArea)} m²) at ${f2(L.span)} m span, the average chord would need to be ${f2(chord)} m. Aspect ratio would go from ${f2(v.AR)} to ${f2(ar)}, which adds some drag — try it in What if? → Wingspan.`);
      }
      c.fixes.push('Remember decorations or wing-tip features beyond the wing count if they make the craft wider — measure the widest point.');
    }
    out.push(c);
  }
  // Length
  {
    const val = v.length;
    const c = { id: 'length', label: 'Length (nose to tail)', limit: L.length, limitText: '20 ft (6.10 m)', value: val, unit: 'm', src: src.length, status: status(val, L.length), fixes: [] };
    if (c.status === 'unknown') c.fixes.push('Enter the overall length (Design numbers → More details) or measure it from CAD.');
    if (c.status === 'over') {
      const cut = val - L.length;
      c.fixes.push(`Shorten the craft by at least ${f2(cut)} m (${ft(cut)} ft).`);
      if (isNum(v.tailLEx) && isNum(v.wingLEx)) {
        c.fixes.push(`If you shorten the tail boom, the tail moves closer to the wing: its lever arm drops by up to ${f2(cut)} m, which reduces pitch stability. Re-check the static margin in Parts & balance — you may need a larger tail.`);
      }
    }
    out.push(c);
  }
  // Total mass
  {
    const val = v.totalMass;
    const c = { id: 'mass', label: 'Craft + pilot mass', limit: L.totalMass, limitText: '400 lb (181.4 kg)', value: val, unit: 'kg', src: src.totalMass, status: status(val, L.totalMass), fixes: [] };
    if (c.status === 'unknown') c.fixes.push('Enter the pilot mass and the craft mass (or list the parts in Parts & balance).');
    if (c.status === 'over' || c.status === 'close') {
      const cut = val - L.totalMass;
      if (c.status === 'over') c.fixes.push(`Remove at least ${f2(cut)} kg (${(cut / LB).toFixed(1)} lb) — that is ${((cut / (v.craftMass || val)) * 100).toFixed(0)}% of the craft mass.`);
      const parts = d.components.filter((p) => isNum(componentMass(p))).sort((a, b) => componentMass(b) - componentMass(a)).slice(0, 3);
      if (parts.length) c.fixes.push(`Heaviest parts: ${parts.map((p) => `${p.name || 'unnamed'} ${componentMass(p).toFixed(1)} kg`).join(', ')}. Lightening these helps most.`);
      const pocketable = d.components.filter((p) => isNum(p.mass) && p.mass > 2 && pocketRemoval(p).none);
      if (pocketable.length) c.fixes.push(`Consider pocketing lightly-loaded areas of heavy parts such as ${pocketable.slice(0, 3).map((p) => p.name || 'unnamed').join(', ')} (Parts & balance → Lightweighting) — for example webs and panels away from joints. Keep material around joints, fasteners and the spar.`);
      c.fixes.push('The pilot counts toward the limit, so pilot choice also matters.');
    }
    out.push(c);
  }
  // Height with pilot crouched
  {
    const val = v.height;
    const c = { id: 'height', label: 'Height with pilot crouched', limit: L.crouchHeight, limitText: '10 ft (3.05 m)', value: val, unit: 'm', src: src.height, status: status(val, L.crouchHeight), fixes: [],
      note: 'Checked against the overall craft height you entered. The rule is measured with the pilot in a crouch, so include the pilot.' };
    if (c.status === 'unknown') c.fixes.push('Enter the overall height with the pilot crouched (Design numbers → More details).');
    if (c.status === 'over') c.fixes.push(`Lower the craft by at least ${f2(val - L.crouchHeight)} m (${ft(val - L.crouchHeight)} ft) — e.g. mount the wing lower or reduce any tall decorations.`);
    out.push(c);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Parts-list scan for things the rules say no to (worded as "check", never as a ruling)
// ---------------------------------------------------------------------------
export function partsRuleWarnings(d) {
  if (!rulesetOf(d)) return [];
  const out = [];
  const text = (c) => `${c.name || ''} ${c.material || ''} ${c.notes || ''} ${c.dims || ''}`;
  // Whole words only, so e.g. "turnbuckles" is not mistaken for a buckle
  const restraint = d.components.filter((c) => /\b(restraints?|restrain(ed|ing)?|harness(es)?|seat ?belts?|straps?|strapped|buckles?|[456]-point)\b/i.test(text(c)));
  if (restraint.length) out.push({ level: 'bad', title: 'Pilot restraint in the parts list', detail: `"${restraint.map((c) => c.name).join('", "')}" looks like a restraint or harness. The Miami rules say: "The Pilot MUST NOT be strapped into the plane, or enclosed in any capsule or cockpit from which they can’t readily escape." Confirm in writing with the organisers before building it.` });
  const foam = d.components.filter((c) => /\b(EPS|XPS)\b/.test(text(c)) || /styrofoam|polystyrene/i.test(text(c)));
  if (foam.length) out.push({ level: 'warn', title: 'Polystyrene ("Styrofoam") in the parts list', detail: `"${foam.map((c) => c.name).join('", "')}" — Red Bull’s general Flugtag rules list Styrofoam as prohibited, and the Miami rules ask you to avoid materials that fragment or are hard to clear up. Closed-cell polyethylene (XLPE) is the usual alternative.` });
  const motor = d.components.filter((c) => /motor|engine|battery|elastic|bungee|spring-loaded|catapult/i.test(text(c)));
  if (motor.length) out.push({ level: 'warn', title: 'Check: possible stored or external energy', detail: `"${motor.map((c) => c.name).join('", "')}" — only human power is allowed (no motors, batteries or elastic bands). Make sure these parts don’t store or supply energy.` });
  return out;
}

// ---------------------------------------------------------------------------
// Engineering suggestions: "the model doesn't seem good — what could we change?"
// Each item: { title, detail, level: 'bad' | 'warn' | 'info', tab }
// ---------------------------------------------------------------------------
export function engineeringFixes(d, ev, com) {
  const out = [];
  const a = ev.analysis;
  const { v } = ev.r;
  if (!a) {
    out.push({ level: 'warn', title: 'The simulation can\'t run yet', detail: `Missing: ${ev.missing.map((m) => m.label.toLowerCase()).join(', ')}. Fill these in first (Design numbers step).`, tab: 'inputs' });
    return out;
  }
  const W = a.weightN;
  const rho = v.airDensity;

  if (a.aero.stalled) {
    out.push({ level: 'bad', title: 'The wing is stalled', tab: 'whatif',
      detail: `The chosen angle of attack (${v.aoa}°) is past the estimated stall angle (≈${a.aero.alphaStallDeg.toFixed(1)}°). Try an angle below ${Math.max(0, a.aero.alphaStallDeg - 2).toFixed(0)}° — in a real craft this is set by where the centre of mass sits and how the wing is mounted.` });
  }

  // Lift at launch vs weight
  if (a.aero.CL > 0 && a.launchAirspeed < a.flySpeed) {
    const V = a.launchAirspeed;
    const Sreq = 2 * W / (rho * V * V * a.aero.CL);
    const massFor = rho * V * V * v.wingArea * a.aero.CL / (2 * G);
    const lim = rulesetOf(d)?.limits.span;
    const maxChordArea = isNum(lim) && isNum(v.chord) ? lim * v.chord : null;
    out.push({ level: 'info', title: `At launch the wing carries only ${Math.round(a.flight.points[0].L / W * 100)}% of the weight`, tab: 'whatif',
      detail: `To carry the full weight at the launch airspeed of ${V.toFixed(1)} m/s, the wing would need about ${Sreq.toFixed(0)} m² (you have ${v.wingArea.toFixed(1)} m²), `
        + `or the total mass would have to be about ${massFor.toFixed(0)} kg. ${maxChordArea ? `At the maximum legal span with your chord you'd have ${maxChordArea.toFixed(1)} m². ` : ''}`
        + 'This is normal for Flugtag: most craft glide downward from the start. The practical levers are a faster push, lower mass, and a cleaner (lower-drag) craft so it sinks more slowly — check the sensitivity list in What if?.' });
  }

  // Launch speed sensitivity hint
  if (ev.r.src.launchSpeed !== 'measured') {
    out.push({ level: 'info', title: 'Launch speed is not measured yet', tab: 'inputs',
      detail: 'It is usually the input the distance depends on most. Time a practice push over a marked distance (phone video) and enter the real value.' });
  }

  // Pitch stability
  const stab = stabilityCalcs(ev.r, com);
  const sm = stab.find((c) => c.id === 'sm');
  const np = stab.find((c) => c.id === 'xnp');
  if (isNum(sm.result) && sm.result < 5 && isNum(com.x) && isNum(np.result)) {
    const refC = isNum(v.macLength) ? v.macLength : v.chord;
    const targetX = np.result - 0.10 * refC; // 10% static margin as a target
    const move = com.x - targetX;
    const pilotMove = isNum(v.pilotMass) && com.mass ? move * com.mass / v.pilotMass : NaN;
    out.push({ level: sm.result < 0 ? 'bad' : 'warn', title: `Centre of mass is ${sm.result < 0 ? 'behind' : 'close to'} the estimated neutral point (static margin ${sm.result.toFixed(0)}% of chord)`, tab: 'mass',
      detail: `To reach about 10% static margin, move the centre of mass forward by ${move.toFixed(2)} m`
        + `${isNum(pilotMove) ? ` — for example by moving the pilot about ${pilotMove.toFixed(2)} m forward` : ''}, or enlarge the horizontal tail / move it further back. `
        + 'This is a preliminary estimate; it does not prove the craft will be stable.' });
  } else if (!isNum(sm.result)) {
    out.push({ level: 'info', title: 'Pitch balance not checked yet', tab: 'mass',
      detail: 'Add part positions, the pilot position, the wing position and the tail size in Parts & balance to get a preliminary stability estimate. An unbalanced craft is one of the most common reasons Flugtag flights end quickly.' });
  }

  // Structure
  const st = structureCalcs(ev.r, a);
  const fos = st.find((c) => c.id === 'fos');
  const I = st.find((c) => c.id === 'I');
  if (isNum(fos.result) && fos.result < 1.5) {
    const needI = isNum(I.result) ? I.result * 1.5 / fos.result : NaN;
    out.push({ level: fos.result < 1 ? 'bad' : 'warn', title: `Spar factor of safety is ${fos.result.toFixed(2)} at the design load`, tab: 'structure',
      detail: `To reach 1.5 (the factor used in certified aircraft design — a home-built craft may want more), the spar needs to be about ${(1.5 / fos.result).toFixed(2)}× stronger in bending (section modulus I/c)`
        + `${isNum(needI) ? ` — e.g. a second moment of area of about ${needI.toExponential(2)} m⁴ if the spar height stays the same` : ''}. Options: a taller spar (bending strength grows roughly with height²), a thicker wall, a second spar, a stronger material, or struts/wires that shorten the unsupported span. Preliminary estimate only.` });
  }

  // Impact
  if (a.flight.impactSpeed > 12) {
    out.push({ level: 'info', title: `Water impact at ${a.flight.impactSpeed.toFixed(1)} m/s`, tab: 'structure',
      detail: 'Make sure there are no hard or sharp surfaces around the cockpit (a Miami rule) and that the pilot can get out easily. See Structure → water impact for estimated loads.' });
  }
  return out;
}
