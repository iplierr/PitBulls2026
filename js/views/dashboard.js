// Dashboard: start a design (CAD or manual), open / version / duplicate designs, backups.
import { db, createDesign, newVersion, duplicateAsNew, deleteDesign, sortedDesigns, designTitle, exportJSON, importJSON, today } from '../store.js';
import { evaluate } from '../model.js';
import { esc, fmt, download, toast, toCSV } from '../ui.js';
import { testsCSV } from './tests.js';

export function show(el, app) {
  const designs = sortedDesigns();
  const rows = designs.map((d) => {
    const ev = evaluate(d);
    const sim = ev.analysis
      ? `${fmt(ev.analysis.flight.distance)} m · ${fmt(ev.analysis.flight.time, 2)} s`
      : `<span class="muted">needs ${ev.missing.length} input${ev.missing.length > 1 ? 's' : ''}</span>`;
    const tests = db.tests.filter((t) => t.designId === d.id).length;
    const isMinor = String(d.label).includes('.');
    return `
      <tr data-id="${d.id}" class="${isMinor ? 'minor' : ''}">
        <td><a href="#/design/${d.id}/overview" class="design-link">${isMinor ? '↳ ' : ''}Design ${esc(d.label)}</a></td>
        <td>${esc(d.name) || '<span class="muted">—</span>'}</td>
        <td>${d.cad ? '✓' : '<span class="muted">—</span>'}</td>
        <td>${sim}</td>
        <td>${tests || '<span class="muted">0</span>'}</td>
        <td class="muted small">${esc((d.updated || '').slice(0, 10))}</td>
        <td class="row-actions">
          <button class="btn tiny" data-act="open">Open</button>
          <button class="btn tiny" data-act="version" title="Copy this design as the next version (e.g. 1 → 1.1)">New version</button>
          <button class="btn tiny" data-act="dup" title="Copy as a brand new design number">Duplicate</button>
          <button class="btn tiny danger" data-act="del">Delete</button>
        </td>
      </tr>`;
  }).join('');

  const recentTests = [...db.tests].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 5);
  const recentNotes = [...db.notes].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 5);
  const dTitle = (id) => { const d = db.designs.find((x) => x.id === id); return d ? designTitle(d) : 'deleted design'; };

  el.innerHTML = `
    <div class="hero">
      <h1>Flugtag Design &amp; Flight Lab</h1>
      <p class="lead">Design → measure → calculate → simulate → test for real → compare → improve.
        Every number shows where it came from, and nothing unknown is filled in for you.</p>
    </div>
    <div class="choice-grid">
      <button class="choice" data-start="cad">
        <span class="choice-icon" aria-hidden="true">⬆</span>
        <span class="choice-title">Upload CAD Model</span>
        <span class="choice-text">Start a new design from an STL or GLB file. Sizes, areas and parts are measured from the model.</span>
      </button>
      <button class="choice" data-start="inputs">
        <span class="choice-icon" aria-hidden="true">✎</span>
        <span class="choice-title">Enter Design Manually</span>
        <span class="choice-text">Start a new design by typing in measurements, masses and launch conditions. No CAD needed.</span>
      </button>
    </div>

    <div class="panel section">
      <div class="panel-head">
        <h2>Designs</h2>
        <div class="row-actions">
          <a class="btn small" href="#/compare">Compare designs</a>
        </div>
      </div>
      ${designs.length ? `
        <div class="table-wrap"><table class="list-table" id="design-table">
          <thead><tr><th>Version</th><th>Name</th><th>CAD</th><th>Simulation estimate</th><th>Tests</th><th>Updated</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
        <p class="hint">"New version" makes a copy numbered 1.1, 1.2 … so you can change something and still compare with the original.
          "Duplicate" starts a new design number.</p>`
      : '<p class="muted">No designs yet. Start with one of the two options above.</p>'}
    </div>

    <div class="two-col">
      <div class="panel section">
        <div class="panel-head"><h2>Recent physical tests</h2><a class="btn small" href="#/tests">All tests →</a></div>
        ${recentTests.length ? `<ul class="plain-list">${recentTests.map((t) => `<li><strong>Test ${esc(t.number)}</strong> · ${esc(t.date)} · ${esc(dTitle(t.designId))} · ${Number.isFinite(t.distance) ? fmt(t.distance) + ' m' : 'no distance'}</li>`).join('')}</ul>` : '<p class="muted">No tests recorded yet.</p>'}
      </div>
      <div class="panel section">
        <div class="panel-head"><h2>Recent notebook entries</h2><a class="btn small" href="#/notebook">Notebook →</a></div>
        ${recentNotes.length ? `<ul class="plain-list">${recentNotes.map((n) => `<li><strong>${esc(n.title)}</strong> · ${esc(n.date)} · <span class="muted">${esc(n.category)}</span></li>`).join('')}</ul>` : '<p class="muted">No entries yet.</p>'}
      </div>
    </div>

    <div class="panel section">
      <h2>Backup &amp; sharing</h2>
      <p class="hint">Everything is saved in <strong>this browser on this computer only</strong>. To share with teammates or move to another laptop,
        export a backup file and import it on the other computer. Importing adds to (and updates) what is already here. CAD files are not included — re-upload them.</p>
      <div class="row-actions">
        <button class="btn" id="export-all">Export backup (.json)</button>
        <label class="btn">Import backup… <input type="file" id="import-all" accept=".json,application/json" hidden></label>
        <button class="btn" id="export-tests">Export tests (.csv)</button>
      </div>
    </div>`;

  el.querySelectorAll('[data-start]').forEach((b) => b.addEventListener('click', () => {
    const d = createDesign();
    app.go(`#/design/${d.id}/${b.dataset.start}`);
  }));

  el.querySelector('#design-table')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const d = db.designs.find((x) => x.id === btn.closest('tr').dataset.id);
    if (!d) return;
    const act = btn.dataset.act;
    if (act === 'open') app.go(`#/design/${d.id}/overview`);
    if (act === 'version') { const n = newVersion(d); toast(`Created Design ${n.label}`); app.go(`#/design/${n.id}/overview`); }
    if (act === 'dup') { const n = duplicateAsNew(d); toast(`Created Design ${n.label}`); app.go(`#/design/${n.id}/overview`); }
    if (act === 'del') {
      const tests = db.tests.filter((t) => t.designId === d.id).length;
      if (!confirm(`Delete ${designTitle(d)}?${tests ? ` Its ${tests} physical test(s) will be kept but lose their design link.` : ''} This cannot be undone.`)) return;
      deleteDesign(d.id);
      show(el, app);
      app.refreshNav();
    }
  });

  el.querySelector('#export-all').addEventListener('click', () => download(`flugtag-lab-backup-${today()}.json`, exportJSON(), 'application/json'));
  el.querySelector('#export-tests').addEventListener('click', () => download(`flugtag-tests-${today()}.csv`, toCSV(testsCSV()), 'text/csv'));
  el.querySelector('#import-all').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const n = importJSON(await file.text());
      toast(`Imported ${n.designs} designs, ${n.tests} tests, ${n.notes} notes.`);
      show(el, app);
      app.refreshNav();
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    }
  });
}
