// "How to make it fly further": each tip is a concrete change re-run through the same simulator,
// so the gain shown is the model's answer for that change (an estimate, like everything in the model).
import { analyze } from './physics.js';
import { engineeringFixes, rulesetOf } from './rules.js';
import { componentMass } from './model.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const FT = 0.3048, LB = 0.45359237, MPH = 0.44704;

// Scans the wing angle from 0° up to just past the stall angle and returns the longest flight.
export function bestAngle(p) {
  const base = analyze(p);
  const top = Math.min(30, (isNum(base.aero.alphaStallDeg) ? base.aero.alphaStallDeg : 20) + 2);
  let best = { aoa: p.aoa, distance: base.flight.distance, stalled: base.aero.stalled };
  for (let a = 0; a <= top + 1e-9; a += 0.5) {
    const r = analyze({ ...p, aoa: a });
    if (!r.aero.stalled && r.flight.distance > best.distance + 1e-6) best = { aoa: a, distance: r.flight.distance, stalled: false };
  }
  return { ...best, stallDeg: base.aero.alphaStallDeg };
}

export function flightTips(ev, d, com) {
  const p = ev.params;
  const a = ev.analysis;
  const D0 = a.flight.distance;
  const v = ev.r.v;
  const tips = [];
  const gainOf = (q) => analyze(q).flight.distance - D0;

  // 1. Faster push
  tips.push({
    title: 'Push 1 m/s (2.2 mph) faster',
    gain: gainOf({ ...p, launchSpeed: p.launchSpeed + 1 }),
    detail: `Speed at the deck edge from ${p.launchSpeed.toFixed(1)} to ${(p.launchSpeed + 1).toFixed(1)} m/s. A longer run-up, a practised crew push and good shoes for grip all help.`,
    tryIt: { launchSpeed: +(p.launchSpeed + 1).toFixed(1) },
  });

  // 2. Lighter
  const dm = 10 * LB;
  if (isNum(v.craftMass) && v.craftMass > dm) {
    const heavy = d.components.filter((c) => isNum(componentMass(c))).sort((x, y) => componentMass(y) - componentMass(x)).slice(0, 3);
    tips.push({
      title: 'Make the craft 10 lb (4.5 kg) lighter',
      gain: gainOf({ ...p, mass: p.mass - dm }),
      detail: `Total weight from ${(p.mass / LB).toFixed(0)} to ${((p.mass - dm) / LB).toFixed(0)} lb.${heavy.length ? ` Heaviest parts: ${heavy.map((c) => `${c.name} (${(componentMass(c) / LB).toFixed(1)} lb)`).join(', ')}.` : ''} Pocketing lightly-loaded parts is one way (Parts & balance → Lightweighting).`,
      tryIt: { craftMass: +(v.craftMass - dm).toFixed(2) },
    });
  }

  // 3. Less drag
  if (!isNum(p.knownCD) && isNum(p.cd0)) {
    tips.push({
      title: 'Cut the drag by a quarter',
      gain: gainOf({ ...p, cd0: p.cd0 * 0.75 }),
      detail: `Parasite drag (CD0) from ${p.cd0.toFixed(3)} to ${(p.cd0 * 0.75).toFixed(3)}. Cover the open frame, smooth the shape around the pilot, keep decorations tight and smooth, and avoid loose fabric.`,
      tryIt: { cd0: +(p.cd0 * 0.75).toFixed(3) },
    });
  }

  // 4. Best wing angle (only when lift comes from the angle of attack)
  if (!isNum(p.knownCL) && isNum(p.aoa)) {
    const b = bestAngle(p);
    if (b.distance - D0 > 0.3) {
      tips.push({
        title: `Fly the wing at about ${b.aoa}° instead of ${p.aoa}°`,
        gain: b.distance - D0,
        detail: `In this model ${b.aoa}° gives the longest flight (stall starts near ${isNum(b.stallDeg) ? b.stallDeg.toFixed(1) : '?'}°). In a real craft the angle comes from where the balance point is and how the wing is mounted on the frame, and the craft won't hold it exactly. Treat this as a direction to test, not a setting.`,
        tryIt: { aoa: b.aoa },
      });
    } else {
      tips.push({ title: `Your wing angle (${p.aoa}°) is already close to the best in this model`, gain: 0, detail: 'Changing the angle of attack alone wouldn’t add much distance here.', info: true });
    }
  }

  // 5. More wing area
  const widthNearLimit = rulesetOf(d) && isNum(v.width ?? v.span) && (v.width ?? v.span) > rulesetOf(d).limits.span * 0.95;
  tips.push({
    title: 'Add 10% more wing area',
    gain: gainOf({ ...p, wingArea: p.wingArea * 1.1 }),
    detail: `Wing area from ${(p.wingArea / (FT * FT)).toFixed(0)} to ${(p.wingArea * 1.1 / (FT * FT)).toFixed(0)} ft². ${widthNearLimit ? `Your width is already ${(v.width ?? v.span) >= rulesetOf(d).limits.span ? 'over' : 'near'} the 22 ft limit, so extra area would have to come from a wider chord (more weight too — this tip doesn’t include that).` : 'Extra area adds weight, which this tip doesn’t include.'}`,
    tryIt: null,
  });

  const distance = tips.filter((t) => !t.info).sort((x, y) => y.gain - x.gain);
  const info = tips.filter((t) => t.info);

  // Wind on the day — not something to change, but useful to expect
  const head = analyze({ ...p, headwind: p.headwind + 3 }).flight.distance - D0;
  const tail = analyze({ ...p, headwind: p.headwind - 3 }).flight.distance - D0;
  info.push({ title: 'Wind on the day', gain: 0, info: true,
    detail: `A 3 m/s (7 mph) headwind would change the distance by ${head >= 0 ? '+' : ''}${head.toFixed(1)} m; a 3 m/s tailwind by ${tail.toFixed(1)} m. You can't choose the wind, but it explains why real flights vary.` });

  // Balance / strength problems first if any are serious
  const safety = engineeringFixes(d, ev, com).filter((f) => f.level === 'bad' || f.level === 'warn')
    .map((f) => ({ title: f.title, detail: f.detail, tab: f.tab, safety: true, level: f.level }));

  return { distance, info, safety };
}
