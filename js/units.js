// Lets people type values with units ("28 ft", "400 lb", "15 mph", "8' 6\"") into any number box.
// Everything is still stored in metric (SI). Also gives the "≈ 28.0 ft" hint shown under a box.

const LENGTH_M = { m: 1, meter: 1, meters: 1, metre: 1, metres: 1, cm: 0.01, mm: 0.001, ft: 0.3048, feet: 0.3048, foot: 0.3048, "'": 0.3048, in: 0.0254, inch: 0.0254, inches: 0.0254, '"': 0.0254, yd: 0.9144, yard: 0.9144, yards: 0.9144 };

// For each unit used by a field: accepted suffixes → multiply to get the field unit.
const TABLES = {
  'm': LENGTH_M,
  'mm': { mm: 1, cm: 10, m: 1000, in: 25.4, inch: 25.4, inches: 25.4, '"': 25.4 },
  'm²': { 'm²': 1, m2: 1, sqm: 1, 'sq m': 1, 'ft²': 0.09290304, ft2: 0.09290304, sqft: 0.09290304, 'sq ft': 0.09290304, 'in²': 0.00064516, in2: 0.00064516 },
  'kg': { kg: 1, kgs: 1, kilo: 1, kilos: 1, g: 0.001, lb: 0.45359237, lbs: 0.45359237, pound: 0.45359237, pounds: 0.45359237, oz: 0.028349523 },
  'm/s': { 'm/s': 1, mps: 1, mph: 0.44704, 'km/h': 1 / 3.6, kmh: 1 / 3.6, kph: 1 / 3.6, kn: 0.514444, kt: 0.514444, kts: 0.514444, knot: 0.514444, knots: 0.514444, 'ft/s': 0.3048, fps: 0.3048 },
  'hPa': { hpa: 1, mbar: 1, mb: 1, kpa: 10, pa: 0.01, inhg: 33.8639, psi: 68.9476 },
  'MPa': { mpa: 1, psi: 0.00689476, ksi: 6.89476, gpa: 1000 },
  'GPa': { gpa: 1, mpa: 0.001, msi: 6.89476, ksi: 0.00689476 },
  'kg/m³': { 'kg/m³': 1, 'kg/m3': 1, 'g/cm³': 1000, 'g/cm3': 1000, 'lb/ft³': 16.018463, 'lb/ft3': 16.018463 },
  '°': { '°': 1, deg: 1, degree: 1, degrees: 1, rad: 180 / Math.PI },
};

const FRIENDLY = {
  'm': `m, cm, mm, ft, in, or feet and inches like 8' 6"`,
  'mm': 'mm, cm, in',
  'm²': 'm², ft² (or sqft)',
  'kg': 'kg, g, lb, oz',
  'm/s': 'm/s, mph, km/h, knots, ft/s',
  'hPa': 'hPa, mbar, inHg, psi, kPa',
  'MPa': 'MPa, psi, ksi',
  'GPa': 'GPa, MPa, Msi',
  'kg/m³': 'kg/m³, g/cm³, lb/ft³',
  '°': '° (degrees) or rad',
};

// Shown under a box: the value in the other common unit.
const ALT = {
  'm': [1 / 0.3048, 'ft', 1],
  'mm': [1 / 25.4, 'in', 2],
  'm²': [1 / 0.09290304, 'ft²', 1],
  'kg': [1 / 0.45359237, 'lb', 1],
  'm/s': [1 / 0.44704, 'mph', 1],
  'hPa': [1 / 33.8639, 'inHg', 2],
  'MPa': [1 / 6.89476, 'ksi', 1],
  'GPa': [1 / 6.89476, 'Msi', 2],
  'kg/m³': [1 / 16.018463, 'lb/ft³', 1],
};

const NUM = '([-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[-+]?\\d+)?)';

// Returns { value } in the field's unit, or { error }. converted = original text if a unit was given.
export function parseWithUnit(raw, unit) {
  let text = String(raw).trim();
  // "1,013" = thousands separator; "1,5" = decimal comma
  text = /^[-+]?\d{1,3}(,\d{3})+(\.\d+)?(\D.*)?$/.test(text) ? text.replace(/,/g, '') : text.replace(/,/g, '.');
  if (unit === 'm' || unit === 'mm') {
    // feet + inches, e.g. 8' 6" or 8 ft 6 in
    const fi = text.match(new RegExp(`^${NUM}\\s*(?:'|ft|feet|foot)\\s*${NUM}\\s*(?:"|in|inch|inches)?$`, 'i'));
    if (fi) {
      const inches = parseFloat(fi[1]) * 12 + parseFloat(fi[2]);
      return { value: unit === 'm' ? inches * 0.0254 : inches * 25.4, converted: text };
    }
  }
  const m = text.match(new RegExp(`^${NUM}\\s*(.*)$`, 'i'));
  if (!m) return { error: 'Type a number (you can add a unit, e.g. "28 ft").' };
  const x = parseFloat(m[1]);
  const suffix = m[2].trim().toLowerCase().replace(/\.$/, '').replace(/^°\s*/, (s) => (unit === '°C' ? '' : s));
  if (!suffix) return { value: x };
  if (unit === '°C') {
    if (['c', '°c', 'degc', 'celsius'].includes(suffix)) return { value: x };
    if (['f', '°f', 'degf', 'fahrenheit'].includes(suffix)) return { value: (x - 32) * 5 / 9, converted: text };
    if (['k', 'kelvin'].includes(suffix)) return { value: x - 273.15, converted: text };
    return { error: `Unknown unit "${m[2].trim()}". Use °C or °F.` };
  }
  const table = TABLES[unit];
  if (!table) {
    if (suffix === String(unit).toLowerCase()) return { value: x };
    return { error: `This box takes a plain number${unit ? ` in ${unit}` : ''}.` };
  }
  const key = Object.keys(table).find((k) => k.toLowerCase() === suffix);
  if (key === undefined) {
    return { error: `Unknown unit "${m[2].trim()}". You can use: ${FRIENDLY[unit] || Object.keys(table).slice(0, 5).join(', ')}.` };
  }
  const factor = table[key];
  return factor === 1 ? { value: x } : { value: x * factor, converted: text };
}

// "≈ 28.0 ft" for a value in the field's unit (or '' when there's no common alternative)
export function altUnitText(value, unit) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  if (unit === '°C') return `≈ ${(value * 9 / 5 + 32).toFixed(0)} °F`;
  const a = ALT[unit];
  if (!a) return '';
  const v = value * a[0];
  if (unit === 'm' && Math.abs(v) >= 1) {
    const totalIn = Math.round(Math.abs(value) / 0.0254);
    return `≈ ${v.toFixed(1)} ft (${Math.floor(totalIn / 12)}′ ${totalIn % 12}″)`;
  }
  return `≈ ${v.toFixed(a[2])} ${a[1]}`;
}

export const acceptsUnits = (unit) => unit === '°C' || !!TABLES[unit];
export const altUnitName = (unit) => (unit === '°C' ? '°F' : ALT[unit]?.[1] || '');
