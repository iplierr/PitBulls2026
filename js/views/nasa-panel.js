// "Get weather from NASA" panel on the Design numbers step.
import { PRESETS, getWeather, pressureAtSite, compass } from '../nasa.js';
import { touch } from '../store.js';
import { esc, fmt, badge, toast } from '../ui.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function nasaPanelHTML(d) {
  const w = d.weather || {};
  return `
    <details class="panel section nasa-panel" ${d.weather ? '' : 'open'}>
      <summary><strong>🌤 Get weather from NASA</strong> <span class="muted small">— real wind, temperature and pressure for your event site</span></summary>
      <p class="hint">Uses NASA POWER hourly data. For a past date you get what actually happened that day. For a future date you get the
        <strong>same week in the last 5 years</strong> (typical conditions). It's an average over an area about 50 km across, not a reading at your deck.
        Values you apply are labelled <strong>Estimated</strong> with the NASA source.</p>
      <div class="form-grid nasa-grid">
        <label>Location
          <select id="nasa-place">${PRESETS.map((p) => `<option value="${p.id}" ${w.placeId === p.id ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select></label>
        <label>Latitude <input id="nasa-lat" type="number" step="0.01" min="-90" max="90" value="${isNum(w.lat) ? w.lat : ''}" placeholder="e.g. 33.77"></label>
        <label>Longitude <input id="nasa-lon" type="number" step="0.01" min="-180" max="180" value="${isNum(w.lon) ? w.lon : ''}" placeholder="e.g. -118.19"></label>
        <label>Event date <input id="nasa-date" type="date" value="${esc(w.date || '')}"></label>
        <label>Flying hours (local) <span class="hour-range"><input id="nasa-h1" type="number" min="0" max="23" value="${w.hourFrom ?? 10}"> to <input id="nasa-h2" type="number" min="0" max="23" value="${w.hourTo ?? 16}"></span></label>
        <label>Flight heading (°) <input id="nasa-heading" type="number" min="0" max="360" step="1" value="${isNum(w.heading) ? w.heading : ''}" placeholder="optional, e.g. 90 = east">
          <small class="muted">Compass direction the craft flies toward (use a phone compass or a map). Needed to turn wind direction into head/tailwind.</small></label>
      </div>
      <div class="row-actions"><button class="btn primary small" id="nasa-fetch" type="button">Get NASA weather</button><span id="nasa-status" class="status"></span></div>
      <div id="nasa-result"></div>
    </details>`;
}

export function bindNasaPanel(root, ctx) {
  const $ = (s) => root.querySelector(s);
  const place = $('#nasa-place');
  place.addEventListener('change', () => {
    const p = PRESETS.find((x) => x.id === place.value);
    if (isNum(p.lat)) { $('#nasa-lat').value = p.lat; $('#nasa-lon').value = p.lon; }
    if (p.id === 'here') {
      if (!navigator.geolocation) { status('This browser cannot share its location.', 'error'); return; }
      status('Asking the browser for your location…');
      navigator.geolocation.getCurrentPosition(
        (pos) => { $('#nasa-lat').value = pos.coords.latitude.toFixed(3); $('#nasa-lon').value = pos.coords.longitude.toFixed(3); status('Location filled in.', 'ok'); },
        () => status('Location permission was not given. Type the coordinates instead.', 'error'),
        { timeout: 10000 });
    }
  });
  function status(msg, kind = '') { const s = $('#nasa-status'); s.textContent = msg; s.className = `status ${kind}`; }

  $('#nasa-fetch').addEventListener('click', async () => {
    const lat = parseFloat($('#nasa-lat').value), lon = parseFloat($('#nasa-lon').value);
    const date = $('#nasa-date').value;
    const h1 = parseInt($('#nasa-h1').value, 10), h2 = parseInt($('#nasa-h2').value, 10);
    const heading = $('#nasa-heading').value === '' ? null : parseFloat($('#nasa-heading').value);
    if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return status('Enter a valid latitude and longitude (or pick a location).', 'error');
    if (!date) return status('Choose the event date.', 'error');
    if (!(h1 >= 0 && h2 <= 23 && h1 <= h2)) return status('Flying hours must be between 0 and 23, first ≤ second.', 'error');
    status('Asking NASA… (a few seconds)');
    $('#nasa-fetch').disabled = true;
    try {
      const w = await getWeather({ lat, lon, date, hourFrom: h1, hourTo: h2 });
      w.placeId = place.value;
      w.placeLabel = PRESETS.find((p) => p.id === place.value)?.label;
      w.heading = isNum(heading) ? ((heading % 360) + 360) % 360 : null;
      ctx.d.weather = w;
      touch(ctx.d);
      status(`Received ${w.hours} hourly readings.`, 'ok');
      renderResult(root, ctx);
    } catch (err) {
      status(`Could not get NASA data: ${err.message}. Check the internet connection and try again.`, 'error');
    } finally {
      $('#nasa-fetch').disabled = false;
    }
  });

  $('#nasa-result').addEventListener('click', (e) => {
    if (e.target.id !== 'nasa-apply') return;
    applyWeather(root, ctx);
  });
  $('#nasa-result').addEventListener('change', (e) => {
    if (e.target.id === 'nasa-heading2') {
      const v = parseFloat(e.target.value);
      ctx.d.weather.heading = isNum(v) ? ((v % 360) + 360) % 360 : null;
      touch(ctx.d);
      renderResult(root, ctx);
    }
  });
  renderResult(root, ctx);
}

function siteElevation(ctx) {
  return isNum(ctx.ev.r.v.elevation) ? ctx.ev.r.v.elevation : null;
}

export function refreshNasaPanel(root, ctx) {
  if (root.querySelector('#nasa-result')) renderResult(root, ctx);
}

function renderResult(root, ctx) {
  const w = ctx.d.weather;
  const box = root.querySelector('#nasa-result');
  if (!w) { box.innerHTML = ''; return; }
  const siteEl = siteElevation(ctx);
  const pSite = w.PS && isNum(siteEl) && isNum(w.gridElevation) ? pressureAtSite(w.PS.median, w.gridElevation, siteEl) : null;
  const rel = isNum(w.windFrom) && isNum(w.heading) ? ((w.windFrom - w.heading) % 360 + 360) % 360 : null;
  const head = isNum(rel) ? w.WS.median * Math.cos(rel * Math.PI / 180) : null;
  const variable = w.steadiness < 0.3;
  box.innerHTML = `
    <h3>${w.mode === 'actual' ? 'Conditions on that day' : 'Typical conditions (same week, previous years)'}
      <span class="muted small">— ${esc(w.placeLabel || '')} ${fmt(w.lat, 2)}, ${fmt(w.lon, 2)} · ${w.hourFrom}:00–${w.hourTo}:00 local · ${w.hours} hourly readings</span></h3>
    <table class="meas-table"><tbody>
      <tr><th>Air temperature</th><td class="num">${fmt(w.T.median, 1)} °C typical</td><td class="small muted">range ${fmt(w.T.min, 1)} to ${fmt(w.T.max, 1)} °C</td></tr>
      <tr><th>Wind speed (10 m height)</th><td class="num">${fmt(w.WS.median, 1)} m/s typical</td><td class="small muted">windier hours (90th percentile): ${fmt(w.WS.p90, 1)} m/s · range ${fmt(w.WS.min, 1)}–${fmt(w.WS.max, 1)} m/s</td></tr>
      <tr><th>Wind comes from</th><td class="num">${isNum(w.windFrom) ? `${Math.round(w.windFrom)}° (${compass(w.windFrom)})` : '–'}</td>
        <td class="small muted">${variable ? '<strong>Direction changes a lot in this period</strong> — treat the average direction with caution. ' : ''}Hours by direction: ${Object.entries(w.sectorCounts).filter(([, n]) => n).map(([s, n]) => `${s} ${n}`).join(', ')}</td></tr>
      <tr><th>Relative to your flight</th><td class="num">${isNum(rel) ? `${Math.round(rel)}° → ${head >= 0 ? 'headwind' : 'tailwind'} part ≈ ${fmt(Math.abs(head), 1)} m/s` : '–'}</td>
        <td class="small">${isNum(w.heading) ? `Flight heading ${Math.round(w.heading)}°.` : 'Enter your flight heading to work this out:'} <input id="nasa-heading2" type="number" min="0" max="360" class="short" value="${isNum(w.heading) ? w.heading : ''}" placeholder="heading °"></td></tr>
      <tr><th>Air pressure</th><td class="num">${w.PS ? `${fmt(w.PS.median, 0)} hPa at NASA grid height` : '–'}</td>
        <td class="small muted">NASA's grid cell averages ${isNum(w.gridElevation) ? Math.round(w.gridElevation) : '?'} m above sea level.
          ${pSite ? `At your site elevation (${siteEl} m): <strong>${fmt(pSite, 0)} hPa</strong> (standard-atmosphere correction).` : '<strong>Enter the site elevation</strong> (Design numbers → Wind & air, Advanced) to correct pressure to your site — otherwise pressure is not applied.'}</td></tr>
    </tbody></table>
    <div class="apply-box">
      <strong>Apply to Design ${esc(ctx.d.label)}:</strong>
      <label><input type="checkbox" id="ap-temp" checked> temperature ${fmt(w.T.median, 1)} °C</label>
      <label><input type="checkbox" id="ap-wind" checked> wind speed
        <select id="ap-wind-which"><option value="median">typical ${fmt(w.WS.median, 1)} m/s</option><option value="p90">windier ${fmt(w.WS.p90, 1)} m/s</option></select></label>
      <label><input type="checkbox" id="ap-dir" ${isNum(rel) ? 'checked' : 'disabled'}> wind direction relative to flight ${isNum(rel) ? `${Math.round(rel)}°` : '(needs flight heading)'}</label>
      <label><input type="checkbox" id="ap-press" ${pSite ? 'checked' : 'disabled'}> pressure ${pSite ? `${fmt(pSite, 0)} hPa` : '(needs site elevation)'}</label>
      <button class="btn small" id="nasa-apply" type="button">Apply selected</button>
      <p class="hint">Applied values replace what is in those fields and are marked ${badge('estimated')}. Air density is then calculated from temperature and pressure.
        On the day, measure wind with an anemometer at the deck — it can differ a lot from the area average.</p>
    </div>
    <p class="hint">Data: NASA Langley Research Center POWER Project (MERRA-2). Periods used: ${w.periods.map(esc).join(', ')}. Fetched ${esc(w.fetched.slice(0, 10))}.</p>`;
}

function applyWeather(root, ctx) {
  const w = ctx.d.weather;
  const d = ctx.d;
  const $ = (s) => root.querySelector(s);
  const where = `${w.placeLabel && w.placeLabel !== 'Custom coordinates…' ? w.placeLabel + ', ' : ''}${fmt(w.lat, 2)}, ${fmt(w.lon, 2)}`;
  const when = w.mode === 'actual' ? `on ${w.date}` : `typical for the week of ${w.date.slice(5)} (last ${w.periods.length} years)`;
  const note = (what) => `NASA POWER ${what}, ${where}, ${when}, ${w.hourFrom}:00–${w.hourTo}:00 — area average, not measured at the deck.`;
  d.sourceNote ??= {};
  const set = (id, v, n) => { d.values[id] = +v.toFixed(id === 'pressure' ? 0 : 1); d.source[id] = 'estimated'; d.sourceNote[id] = n; };
  let count = 0;
  if ($('#ap-temp').checked) { set('temperature', w.T.median, note('median temperature')); count++; }
  if ($('#ap-wind').checked) {
    const which = $('#ap-wind-which').value;
    set('windSpeed', w.WS[which], note(which === 'p90' ? '90th-percentile wind speed at 10 m' : 'median wind speed at 10 m'));
    count++;
  }
  if ($('#ap-dir').checked && !$('#ap-dir').disabled) {
    const rel = ((w.windFrom - w.heading) % 360 + 360) % 360;
    d.values.windDir = Math.round(rel);
    d.source.windDir = 'estimated';
    d.sourceNote.windDir = note(`average wind direction (${Math.round(w.windFrom)}° from north) relative to flight heading ${Math.round(w.heading)}°`);
    count++;
  }
  if ($('#ap-press').checked && !$('#ap-press').disabled) {
    const p = pressureAtSite(w.PS.median, w.gridElevation, siteElevation(ctx));
    set('pressure', p, note(`median surface pressure corrected from grid height ${Math.round(w.gridElevation)} m to site elevation`));
    count++;
  }
  if (count && d.source.airDensity === 'estimated' && !d.sourceNote?.airDensity) {
    // An old "standard air" assumption would override the NASA-based calculation — remove it.
    delete d.values.airDensity;
    delete d.source.airDensity;
  }
  toast(`Applied ${count} NASA value(s), marked Estimated.`);
  ctx.changed(null);
}
