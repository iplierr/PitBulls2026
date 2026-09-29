// Calculations tab (every equation with inputs and sources) and Structure tab (preliminary loads).
import { designCalcs, structureCalcs } from '../calcs.js';
import { esc, fmt, calcCardHTML, groupsHTML, refreshFields, bindFields } from '../ui.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function bindGoto(panel, ctx) {
  panel.addEventListener('click', (e) => {
    const g = e.target.closest('[data-goto-field]');
    if (g) ctx.gotoField(g.dataset.gotoField);
  });
}

export const calcs = {
  render(panel, ctx) {
    panel.innerHTML = `
      <div class="panel section">
        <div class="panel-head">
          <h2>Engineering calculations</h2>
          <div class="row-actions"><button class="btn small" id="expand-all" type="button">Show all workings</button></div>
        </div>
        <p class="hint">Each card shows what is calculated, the equation, the inputs (with where each came from), and the result with units.
          Open <strong>How did you get this?</strong> to check the working yourself. A result is <strong>Estimated</strong> whenever any input is estimated.</p>
        <div id="calc-groups"></div>
      </div>`;
    panel.querySelector('#expand-all').addEventListener('click', (e) => {
      const open = e.target.textContent.startsWith('Show');
      panel.querySelectorAll('.calc-card details').forEach((d) => { d.open = open; });
      e.target.textContent = open ? 'Hide all workings' : 'Show all workings';
    });
    bindGoto(panel, ctx);
    calcs.update(panel, ctx);
  },
  update(panel, ctx) {
    const groups = designCalcs(ctx.ev);
    panel.querySelector('#calc-groups').innerHTML = groups.map((g) => `
      <h3 class="calc-group-title">${esc(g.title)}</h3>
      <div class="calc-grid">${g.cards.map((c) => calcCardHTML(c)).join('')}</div>`).join('');
  },
};

export const structure = {
  render(panel, ctx) {
    panel.innerHTML = `
      <div class="verdict warn prelim-banner"><strong>PRELIMINARY ESTIMATES.</strong> These simple hand-calculation models help you spot obvious problems and compare options.
        They do <strong>not</strong> show that the craft is structurally safe. Joints, bolts, glue lines, buckling, fatigue and impact damage are not modelled.
        Material strength is never guessed — enter it from a datasheet or your own test.</div>
      <div class="inputs-layout">
        <div class="panel section">
          <h2>Structure inputs</h2>
          <div id="nload"></div>
          <form id="struct-form" novalidate>${groupsHTML('structure')}</form>
        </div>
        <div class="panel section">
          <h2>Results</h2>
          <div id="struct-summary"></div>
          <div class="calc-grid one" id="struct-cards"></div>
        </div>
      </div>`;
    const form = panel.querySelector('#struct-form');
    bindFields(form, () => ctx.d, (id) => ctx.changed(id));
    panel.querySelector('#nload').addEventListener('click', (e) => {
      if (!e.target.matches('#use-peak')) return;
      ctx.d.values.loadFactor = +ctx.ev.analysis.flight.peakLoadFactor.toFixed(2);
      ctx.d.source.loadFactor = 'calculated';
      ctx.changed(null);
    });
    bindGoto(panel, ctx);
    structure.update(panel, ctx, null);
  },
  update(panel, ctx, skipId) {
    const { d, ev } = ctx;
    refreshFields(panel.querySelector('#struct-form'), d, ev.r, { level: 'advanced', skipId });
    const f = ev.analysis?.flight;
    panel.querySelector('#nload').innerHTML = f
      ? `<p class="hint">Peak load factor in the simulation: <strong>${fmt(f.peakLoadFactor, 2)} g</strong>.
          Real flights see extra loads from gusts, pitching and a rough launch, so teams usually design for more than this.
          <button type="button" class="btn tiny" id="use-peak">Use ${fmt(f.peakLoadFactor, 2)} g</button></p>`
      : '<p class="hint">Run the simulation (Inputs tab) to see the peak load factor it predicts.</p>';
    const cards = structureCalcs(ev.r, ev.analysis);
    const fos = cards.find((c) => c.id === 'fos');
    let summary;
    if (isNum(fos.result)) {
      summary = fos.result < 1
        ? `<div class="verdict bad">Calculated root bending stress is <strong>higher than the strength you entered</strong> (factor of safety ${fmt(fos.result, 2)}). At the design load, this spar would be expected to yield or break at the root in this simple model.</div>`
        : `<div class="verdict warn">Factor of safety for root bending: <strong>${fmt(fos.result, 2)}</strong> at the design load. This covers <em>only</em> spar bending at the root with the stated assumptions — it does not show the structure is safe.</div>`;
    } else {
      summary = `<p class="muted">Enter the load factor, spar section and material strength to get a stress and factor of safety.</p>`;
    }
    panel.querySelector('#struct-summary').innerHTML = summary;
    panel.querySelector('#struct-cards').innerHTML = cards.map((c) => calcCardHTML(c)).join('');
  },
};
