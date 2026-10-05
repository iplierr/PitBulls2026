// Shared UI helpers: escaping, number formatting, source badges, field forms, calculation cards, downloads.
import { FIELD, GROUPS, LEVELS, groupFields } from './fields.js';
import { SOURCE_LABEL } from './model.js';
import { parseWithUnit, altUnitText, acceptsUnits, altUnitName } from './units.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Fixed decimals
export const fmt = (v, d = 1) => (isNum(v) ? v.toFixed(d) : '–');
// Significant figures, readable
export function sig(v, n = 3) {
  if (!isNum(v)) return '–';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e6 || a < 1e-3) return v.toExponential(n - 1);
  const s = Number(v.toPrecision(n));
  return a >= 1000 ? s.toLocaleString('en-US', { maximumFractionDigits: 0 }) : String(s);
}

export function badge(src) {
  const s = SOURCE_LABEL[src] ? src : 'missing';
  return `<span class="badge ${s}">${SOURCE_LABEL[s]}</span>`;
}
export const constantBadge = '<span class="badge constant">Constant</span>';

export function toast(msg, kind = '') {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
  el.className = `toast show ${kind}`;
  el.textContent = msg;
  clearTimeout(el._t);
  el._t = setTimeout(() => (el.className = 'toast'), 2600);
}

export function download(filename, text, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

export function toCSV(rows) {
  return rows.map((r) => r.map((c) => {
    const s = c === null || c === undefined || (typeof c === 'number' && !Number.isFinite(c)) ? '' : String(c);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\n');
}

export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'design';

// ---------------------------------------------------------------------------
// Calculation cards ("How did you get this?")
// ---------------------------------------------------------------------------
export function calcCardHTML(c, { open = false } = {}) {
  const val = isNum(c.result) ? `${sig(c.result, c.digits || 3)} <small>${esc(c.unit)}</small>` : '<span class="muted">Cannot be calculated</span>';
  const rows = c.inputs.filter((i) => i.sym !== 'model' && i.sym !== 'shape').map((i) => `
    <tr><td><code>${esc(i.sym)}</code></td><td>${esc(i.label)}</td>
      <td class="num">${isNum(i.value) ? `${sig(i.value, 4)} ${esc(i.unit)}` : '<span class="muted">not provided</span>'}</td>
      <td>${i.src === 'constant' ? constantBadge : badge(i.src)}</td></tr>`).join('');
  return `
    <div class="calc-card ${c.src === 'missing' ? 'is-missing' : ''}" data-calc="${esc(c.id)}">
      <div class="calc-head">
        <div><div class="calc-title">${esc(c.title)}</div><div class="calc-what">${esc(c.what)}</div></div>
        <div class="calc-value">${val}<div>${badge(c.src)}</div></div>
      </div>
      ${c.missingText ? `<div class="calc-missing">${esc(c.missingText)}${c.missingIds?.length ? ` <button type="button" class="linkbtn" data-goto-field="${esc(c.missingIds[0])}">Enter it →</button>` : ''}</div>` : ''}
      <details ${open ? 'open' : ''}><summary>How did you get this?</summary>
        <div class="calc-body">
          ${c.eq ? `<div class="eq">${esc(c.eq)}</div>` : ''}
          ${rows ? `<table class="calc-inputs"><tbody>${rows}</tbody></table>` : ''}
          ${isNum(c.result) ? `<div class="calc-result">Result: <strong>${sig(c.result, 4)} ${esc(c.unit)}</strong></div>` : ''}
          ${c.note ? `<p class="hint">${esc(c.note)}</p>` : ''}
        </div>
      </details>
    </div>`;
}

// ---------------------------------------------------------------------------
// Field forms (used on Inputs, Parts & balance and Strength tabs)
// ---------------------------------------------------------------------------
export function fieldHTML(f) {
  const control = f.type === 'select'
    ? `<select id="f-${f.id}">${f.options.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select>`
    : f.type === 'text'
      ? `<input id="f-${f.id}" type="text" maxlength="120" placeholder="${f.example ? `e.g. ${esc(f.example)}` : ''}">`
      : `<input id="f-${f.id}" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" placeholder="${f.example ? `e.g. ${esc(f.example)}${f.unit ? ' ' + esc(f.unit) : ''}${acceptsUnits(f.unit) && altUnitName(f.unit) ? ` (or ${esc(altUnitName(f.unit))})` : ''}` : ''}">`;
  return `
    <div class="field" data-id="${f.id}">
      <div class="field-top">
        <label for="f-${f.id}">${esc(f.label)} ${f.unit ? `<span class="unit">(${esc(f.unit)})</span>` : ''}</label>
        ${f.help ? `<button type="button" class="help-btn" data-help="${f.id}" aria-label="What is this?">What is this?</button>` : ''}
      </div>
      <div class="field-row">
        ${control}
        <span class="src-badge"></span>
        <button type="button" class="reset" title="Clear (or return to the CAD-measured value)" aria-label="Reset ${esc(f.label)}">↺</button>
      </div>
      <small class="conv-hint"></small>
      <small class="what">${esc(f.what)}</small>
      ${f.help ? `<div class="help-text" hidden>${esc(f.help)}</div>` : ''}
      <div class="derived-how"></div>
      ${f.assume ? `<div class="assume"><button type="button" class="btn tiny assume-btn" data-assume="${f.id}">Use typical value: ${esc(f.assume.value)}${f.unit ? ' ' + esc(f.unit) : ''}</button> <small>${esc(f.assume.note)}</small></div>` : ''}
    </div>`;
}

export function groupsHTML(tab, groupIds = null) {
  return GROUPS.filter((g) => g.tab === tab && (!groupIds || groupIds.includes(g.id))).map((g) => `
    <fieldset class="field-group" data-group="${g.id}">
      <legend>${esc(g.label)}</legend>
      ${g.intro ? `<p class="hint">${esc(g.intro)}</p>` : ''}
      ${groupFields(g.id).map(fieldHTML).join('')}
    </fieldset>`).join('');
}

// Writes values/badges into a rendered form. skipId = the input the user is typing in.
export function refreshFields(container, d, r, { level = 'advanced', requiredIds = [], skipId = null } = {}) {
  const li = LEVELS.indexOf(level);
  container.querySelectorAll('.field').forEach((div) => {
    const id = div.dataset.id;
    const f = FIELD[id];
    const stored = d.values[id];
    const hasStored = stored !== undefined && stored !== null && stored !== '';
    const derived = !hasStored && r.v[id] !== undefined;
    const input = div.querySelector('input, select');
    if (id !== skipId) {
      if (hasStored) input.value = stored;
      else if (derived && isNum(r.v[id])) input.value = Number(r.v[id].toPrecision(4));
      else input.value = '';
    }
    input.classList.toggle('derived', derived);
    const hint = div.querySelector('.conv-hint');
    if (hint && id !== skipId) hint.textContent = isNum(r.v[id]) && !f.type ? altUnitText(r.v[id], f.unit) : '';
    const src = hasStored ? (d.source[id] || 'entered') : derived ? r.src[id] : 'missing';
    div.querySelector('.src-badge').innerHTML = badge(src);
    div.querySelector('.reset').hidden = !hasStored;
    const how = div.querySelector('.derived-how');
    how.textContent = derived && r.how[id] ? `How: ${r.how[id]}` : hasStored && d.sourceNote?.[id] ? `Source: ${d.sourceNote[id]}` : '';
    const assume = div.querySelector('.assume');
    if (assume) assume.hidden = hasStored || derived;
    const required = requiredIds.includes(id);
    div.classList.toggle('required-missing', required && !hasStored && !derived);
    const visible = LEVELS.indexOf(f.level) <= li || hasStored || required;
    div.hidden = !visible;
  });
  container.querySelectorAll('.field-group').forEach((g) => {
    g.hidden = ![...g.querySelectorAll('.field')].some((x) => !x.hidden);
  });
}

// Wires input/reset/assume/help events. onChange(fieldId) is called after the design is updated.
export function bindFields(container, getDesign, onChange) {
  container.addEventListener('input', (e) => {
    const div = e.target.closest('.field');
    if (!div || !e.target.matches('input, select')) return;
    const f = FIELD[div.dataset.id];
    const d = getDesign();
    const raw = e.target.value;
    let invalid = false;
    if (raw === '' || raw === null) {
      delete d.values[f.id];
      delete d.source[f.id];
    } else if (f.type === 'text' || f.type === 'select') {
      d.values[f.id] = raw;
      d.source[f.id] = 'entered';
    } else {
      const p = parseWithUnit(raw, f.unit);
      const v = p.value;
      const hint = div.querySelector('.conv-hint');
      if (p.error || !Number.isFinite(v) || v < f.min || v > f.max) {
        invalid = true;
        div.dataset.err = p.error || `Enter a value from ${f.min} to ${f.max}${f.unit ? ' ' + f.unit : ''}.`;
        if (hint) hint.textContent = '';
      } else {
        d.values[f.id] = +v.toPrecision(6);
        d.source[f.id] = 'entered';
        if (hint) hint.textContent = p.converted ? `= ${+v.toPrecision(4)} ${f.unit} (converted from ${p.converted})` : altUnitText(v, f.unit);
      }
    }
    if (d.sourceNote) delete d.sourceNote[f.id]; // typed over: no longer from that source
    div.classList.toggle('invalid', invalid);
    const what = div.querySelector('.what');
    what.textContent = invalid ? `${div.dataset.err || 'Check this value.'} (Not saved until it's valid.)` : f.what;
    what.classList.toggle('error-msg', invalid);
    if (!invalid) onChange(f.id);
  });
  container.addEventListener('click', (e) => {
    const d = getDesign();
    const reset = e.target.closest('.reset');
    if (reset) {
      const id = reset.closest('.field').dataset.id;
      if (d.sourceNote) delete d.sourceNote[id];
      if (id in d.measured) { d.values[id] = d.measured[id]; d.source[id] = 'measured'; }
      else { delete d.values[id]; delete d.source[id]; }
      reset.closest('.field').classList.remove('invalid');
      onChange(null);
      return;
    }
    const assume = e.target.closest('.assume-btn');
    if (assume) {
      const f = FIELD[assume.dataset.assume];
      d.values[f.id] = f.assume.value;
      d.source[f.id] = 'estimated';
      if (d.sourceNote) delete d.sourceNote[f.id];
      onChange(null);
      return;
    }
    const help = e.target.closest('.help-btn');
    if (help) {
      const t = help.closest('.field').querySelector('.help-text');
      t.hidden = !t.hidden;
    }
  });
}

export function focusField(container, id) {
  const div = container.querySelector(`.field[data-id="${id}"]`);
  if (!div) return false;
  div.hidden = false;
  div.closest('.field-group')?.removeAttribute('hidden');
  div.scrollIntoView({ block: 'center', behavior: 'smooth' });
  div.classList.add('flash');
  setTimeout(() => div.classList.remove('flash'), 1600);
  div.querySelector('input, select')?.focus({ preventScroll: true });
  return true;
}
