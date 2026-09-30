// Overview panel: event rules check (Miami 2026) + "what could we fix?" engineering suggestions.
import { RULESETS, DEFAULT_RULESET, rulesetOf, ruleChecks, engineeringFixes } from '../rules.js';
import { esc, badge, toast } from '../ui.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const ICON = { ok: '✓', close: '!', over: '✕', unknown: '?' };
const STATUS = { ok: 'within limit', close: 'within 3% of the limit', over: 'OVER the limit', unknown: 'cannot check yet' };

export function rulesPanelHTML(d, ev, com) {
  const rs = rulesetOf(d);
  const sel = d.ruleset || DEFAULT_RULESET;
  const picker = `<select id="ruleset-pick" aria-label="Event rules">
      ${Object.values(RULESETS).map((r) => `<option value="${r.id}" ${sel === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}
      <option value="none" ${sel === 'none' ? 'selected' : ''}>No event rules (use the custom limits on the Inputs tab)</option>
    </select>`;
  let rules = '';
  if (rs) {
    const checks = ruleChecks(d, ev, com);
    const over = checks.filter((c) => c.status === 'over').length;
    const unknown = checks.filter((c) => c.status === 'unknown').length;
    const done = d.ruleChecks || {};
    const deckVal = ev.r.v.deckHeight;
    rules = `
      <p class="hint">${esc(rs.event)} · Official rule: <em>"${esc(rs.quote)}"</em>
        <a href="${rs.source}" target="_blank" rel="noopener">Rules page</a> (read ${rs.checked}). Rules can change — check the page before the event.</p>
      <div class="verdict ${over ? 'bad' : unknown ? 'warn' : 'good'}">
        ${over ? `<strong>${over} size/weight rule${over > 1 ? 's are' : ' is'} not met.</strong> Suggested fixes are listed below.`
          : unknown ? `No rule broken so far, but ${unknown} can't be checked yet — some measurements are missing.`
          : 'Wingspan, length, mass and height are all within the limits, based on the values entered.'}
      </div>
      <table class="list-table rules-table"><thead><tr><th></th><th>Rule</th><th>Limit</th><th>Your design</th><th>Margin</th></tr></thead><tbody>
        ${checks.map((c) => `
          <tr class="rule-${c.status}">
            <td class="rule-icon" title="${STATUS[c.status]}">${ICON[c.status]}</td>
            <td>${esc(c.label)}${c.note ? `<br><small class="muted">${esc(c.note)}</small>` : ''}</td>
            <td class="num">${esc(c.limitText)}</td>
            <td class="num">${isNum(c.value) ? `${c.value.toFixed(2)} ${c.unit} ${badge(c.src)}` : '<span class="muted">not provided</span>'}</td>
            <td class="num">${isNum(c.value) ? `${c.limit - c.value >= 0 ? '' : '−'}${Math.abs(c.limit - c.value).toFixed(2)} ${c.unit} ${c.limit - c.value >= 0 ? 'to spare' : 'over'}` : '–'}</td>
          </tr>
          ${c.fixes.length ? `<tr class="rule-fix"><td></td><td colspan="4"><strong>${c.status === 'unknown' ? 'To check:' : 'What to fix:'}</strong><ul>${c.fixes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></td></tr>` : ''}`).join('')}
      </tbody></table>

      <div class="deck-note">
        <strong>Deck height:</strong> ${esc(rs.deck.advice)}
        ${rs.deck.options.map((o) => `<br>• ${o.ft} ft (${(o.ft * 0.3048).toFixed(2)} m) — ${esc(o.note)} <button class="btn tiny" data-deck="${o.ft}">Use ${o.ft} ft</button>`).join('')}
        <br><small class="muted">Currently in the design: ${isNum(deckVal) ? `${deckVal.toFixed(2)} m` : 'not provided'}. The buttons mark the value <strong>Estimated</strong> with this note, because it isn't confirmed.</small>
      </div>

      <h3>Rules you confirm yourselves</h3>
      <p class="hint">These can't be checked from numbers. Tick each one once the team has checked it — this is just a checklist, not an inspection.</p>
      <ul class="rule-manual">
        ${rs.manual.map(([id, text]) => `<li><label><input type="checkbox" data-rulecheck="${id}" ${done[id] ? 'checked' : ''}> ${esc(text)}</label></li>`).join('')}
      </ul>
      <p class="hint">${rs.manual.filter(([id]) => done[id]).length} of ${rs.manual.length} confirmed. The event's Safety Team inspects every craft.</p>`;
  } else {
    rules = '<p class="hint">No event rules selected. Custom limits can be entered on the Inputs tab (Event rules), and are checked under Problem checks.</p>';
  }

  const fixes = engineeringFixes(d, ev, com);
  return `
    <div class="panel section" id="rules-panel">
      <div class="panel-head"><h2>Event rules check</h2>${picker}</div>
      ${rules}
    </div>
    <div class="panel section" id="fixes-panel">
      <h2>What could we fix?</h2>
      <p class="hint">Suggestions worked out from your current inputs. They show what the numbers say — they don't guarantee a better flight.</p>
      ${fixes.length ? `<ul class="fix-list">${fixes.map((f) => `
        <li class="fix-${f.level}"><strong>${esc(f.title)}</strong><br>${esc(f.detail)}
          ${f.tab ? `<button class="linkbtn" data-go-tab="${f.tab}">Open ${esc({ inputs: 'Inputs', mass: 'Mass & balance', whatif: 'What if?', structure: 'Structure', simulate: 'Simulate' }[f.tab] || f.tab)} →</button>` : ''}</li>`).join('')}</ul>`
      : '<p class="muted">Nothing stands out with the information entered so far.</p>'}
    </div>`;
}

// Events for the panel. onChange() re-renders the overview.
export function bindRulesPanel(root, ctx, onChange) {
  root.addEventListener('change', (e) => {
    if (e.target.id === 'ruleset-pick') {
      ctx.d.ruleset = e.target.value;
      ctx.changed(null);
      onChange();
    } else if (e.target.dataset.rulecheck) {
      ctx.d.ruleChecks = { ...(ctx.d.ruleChecks || {}), [e.target.dataset.rulecheck]: e.target.checked };
      ctx.changed(null);
      onChange();
    }
  });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-deck]');
    if (!b) return;
    const rs = rulesetOf(ctx.d);
    const opt = rs.deck.options.find((o) => String(o.ft) === b.dataset.deck);
    const d = ctx.d;
    d.values.deckHeight = +(opt.ft * 0.3048).toFixed(3);
    d.source.deckHeight = 'estimated';
    d.sourceNote = { ...(d.sourceNote || {}), deckHeight: `${opt.ft} ft from ${rs.name}: ${opt.note} Not confirmed — ${rs.deck.advice}` };
    toast(`Deck height set to ${opt.ft} ft (${(opt.ft * 0.3048).toFixed(2)} m), marked Estimated.`);
    ctx.changed(null);
    onChange();
  });
}
