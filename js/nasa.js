// Weather from NASA POWER (https://power.larc.nasa.gov) — free, no key, works from the browser.
// Hourly data (MERRA-2 reanalysis) for a grid cell of roughly 50 km: an area average, not your exact deck.
// Past dates: the actual conditions that day. Future / very recent dates: the same calendar days in
// previous years, summarised as "typical conditions".

const BASE = 'https://power.larc.nasa.gov/api/temporal/hourly/point';
const LATENCY_DAYS = 10; // hourly data usually appears within a few days; stay safely behind that

export const PRESETS = [
  { id: 'custom', label: 'Custom coordinates…' },
  { id: 'here', label: 'This device\'s location' },
  { id: 'longbeach', label: 'Long Beach, CA', lat: 33.77, lon: -118.19 },
  { id: 'chicago', label: 'Chicago, IL', lat: 41.88, lon: -87.63 },
  { id: 'miami', label: 'Miami, FL', lat: 25.76, lon: -80.19 },
  { id: 'austin', label: 'Austin, TX', lat: 30.27, lon: -97.74 },
  { id: 'boston', label: 'Boston, MA', lat: 42.36, lon: -71.06 },
  { id: 'seattle', label: 'Seattle, WA', lat: 47.61, lon: -122.33 },
  { id: 'dc', label: 'Washington, DC', lat: 38.89, lon: -77.04 },
  { id: 'stpaul', label: 'St. Paul, MN', lat: 44.95, lon: -93.09 },
];

const ymd = (d) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

async function fetchHourly(lat, lon, start, end) {
  const url = `${BASE}?parameters=T2M,WS10M,WD10M,PS&community=RE&longitude=${lon.toFixed(4)}&latitude=${lat.toFixed(4)}` +
    `&start=${ymd(start)}&end=${ymd(end)}&format=JSON&time-standard=LST`;
  const res = await fetch(url);
  if (!res.ok) {
    let msg = `NASA POWER replied ${res.status}`;
    try { const j = await res.json(); if (j.messages?.length) msg += `: ${j.messages.join(' ')}`; } catch { /* ignore */ }
    throw new Error(msg);
  }
  const j = await res.json();
  const p = j.properties?.parameter;
  if (!p?.T2M) throw new Error('Unexpected reply from NASA POWER.');
  const fill = j.header?.fill_value ?? -999;
  const hours = Object.keys(p.T2M).map((k) => ({
    key: k, hour: Number(k.slice(8, 10)),
    T: p.T2M[k], WS: p.WS10M[k], WD: p.WD10M[k], PS: p.PS[k],
  })).map((h) => { for (const f of ['T', 'WS', 'WD', 'PS']) if (h[f] === fill || h[f] <= -900) h[f] = null; return h; });
  return { hours, gridElevation: j.geometry?.coordinates?.[2] ?? null, url };
}

const quantile = (arr, q) => {
  const s = [...arr].sort((a, b) => a - b);
  if (!s.length) return NaN;
  const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
};
const summary = (arr) => ({ median: quantile(arr, 0.5), p90: quantile(arr, 0.9), min: Math.min(...arr), max: Math.max(...arr), n: arr.length });

const SECTORS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const compass = (deg) => SECTORS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];

// Main entry. date: 'YYYY-MM-DD'. Returns a plain object (saved with the design).
export async function getWeather({ lat, lon, date, hourFrom = 10, hourTo = 16, years = 5, halfWindow = 3 }) {
  const target = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(target.getTime())) throw new Error('Choose a valid date.');
  const latest = addDays(new Date(), -LATENCY_DAYS);
  const ranges = [];
  let mode;
  if (target <= latest) {
    mode = 'actual';
    ranges.push([target, target]);
  } else {
    mode = 'typical';
    for (let k = 1; ranges.length < years && k <= years + 2; k++) {
      const y = new Date(Date.UTC(target.getUTCFullYear() - k, target.getUTCMonth(), target.getUTCDate()));
      const end = addDays(y, halfWindow);
      if (end > latest) continue;
      ranges.push([addDays(y, -halfWindow), end]);
    }
  }
  const results = await Promise.all(ranges.map(([a, b]) => fetchHourly(lat, lon, a, b)));
  const hours = results.flatMap((r) => r.hours).filter((h) => h.hour >= hourFrom && h.hour <= hourTo);
  const pick = (f) => hours.map((h) => h[f]).filter((x) => x !== null);
  const T = pick('T'), WS = pick('WS'), PS = pick('PS');
  const dirs = hours.filter((h) => h.WD !== null && h.WS !== null);
  if (!T.length || !WS.length) throw new Error('NASA POWER returned no usable data for this place and time.');

  // Wind direction: circular mean weighted by wind speed; R near 0 = direction keeps changing.
  let sx = 0, sy = 0, sw = 0;
  for (const h of dirs) { const r = h.WD * Math.PI / 180; sx += h.WS * Math.sin(r); sy += h.WS * Math.cos(r); sw += h.WS; }
  const meanDir = ((Math.atan2(sx, sy) * 180 / Math.PI) + 360) % 360;
  const steadiness = sw > 0 ? Math.hypot(sx, sy) / sw : 0;
  const sectorCounts = Object.fromEntries(SECTORS.map((s) => [s, 0]));
  for (const h of dirs) sectorCounts[compass(h.WD)]++;

  return {
    source: 'NASA POWER hourly (MERRA-2 reanalysis)',
    fetched: new Date().toISOString(),
    lat, lon, date, hourFrom, hourTo, mode,
    periods: ranges.map(([a, b]) => (ymd(a) === ymd(b) ? ymd(a) : `${ymd(a)}–${ymd(b)}`)),
    gridElevation: results[0]?.gridElevation ?? null,
    hours: hours.length,
    T: summary(T),
    WS: summary(WS),
    PS: PS.length ? summary(PS.map((x) => x * 10)) : null, // kPa → hPa
    windFrom: dirs.length ? meanDir : null,
    steadiness,
    sectorCounts,
    exampleUrl: results[0]?.url,
  };
}

// Pressure measured at the NASA grid-cell elevation, moved to the site elevation (standard-atmosphere ratio).
export function pressureAtSite(pGrid, gridElev, siteElev) {
  const f = (h) => (1 - 2.25577e-5 * h) ** 5.25588;
  return pGrid * f(siteElev) / f(gridElev);
}
