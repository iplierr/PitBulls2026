// Dashboard: start a design (CAD or manual), open / version / duplicate designs, backups.
import { uid, touch } from '../store.js';
import { db, createDesign, newVersion, duplicateAsNew, deleteDesign, sortedDesigns, designTitle, exportJSON, importJSON, today, restoreFromTrash, purgeTrash } from '../store.js';
import { cleanupFiles } from './cad-history.js';
import { evaluate } from '../model.js';
import { esc, fmt, download, toast, toCSV } from '../ui.js';
import { testsCSV } from './tests.js';

const KIND_LABEL = { design: 'Design', test: 'Physical test', note: 'Notebook entry' };
function trashHTML() {
  const items = db.trash || [];
  if (!items.length) return '';
  const name = (t) => t.kind === 'design' ? designTitle(t.item) : t.kind === 'test' ? `Test ${t.item.number} (${t.item.date})` : t.item.title;
  return `
    <div class="panel section" id="trash">
      <div class="panel-head"><h2>Recently deleted</h2><button class="btn small danger" data-trash="empty">Empty</button></div>
      <p class="hint">Deleted designs, tests and notebook entries stay here for 30 days. Restore anything deleted by mistake.</p>
      <table class="list-table"><tbody>
        ${items.map((t) => `<tr><td>${KIND_LABEL[t.kind]}</td><td>${esc(name(t))}</td><td class="muted small">deleted ${esc(t.deletedAt.slice(0, 16).replace('T', ' '))}</td>
          <td class="row-actions"><button class="btn tiny" data-trash="restore" data-id="${t.id}">Restore</button><button class="btn tiny danger" data-trash="purge" data-id="${t.id}">Delete forever</button></td></tr>`).join('')}
      </tbody></table>
    </div>`;
}

// A filled-in practice design so new teammates can see results straight away.
// Every value is marked Estimated with a note saying it is made up.
function createExampleDesign() {
  const d = createDesign({ name: 'Example glider (made-up numbers)' });
  d.example = true;
  d.description = 'Example for learning the app. All numbers are invented — not a real craft.';
  const v = { span: 8, chord: 1.4, length: 4.5, height: 2.4, pilotMass: 70, launchSpeed: 6, deckHeight: 6.71, launchAngle: 0,
    windSpeed: 3, windDir: 0, temperature: 27, pressure: 1013, aoa: 6, clMax: 1.2, cd0: 0.08, oswald: 0.7,
    pilotX: 1.6, pilotY: 0.6, wingLEx: 1.1, tailArea: 1.5, tailSpan: 2.4, tailLEx: 3.8, tailEff: 0.9 };
  d.sourceNote = {};
  for (const [k, x] of Object.entries(v)) { d.values[k] = x; d.source[k] = 'estimated'; d.sourceNote[k] = 'Example value (made up) for learning the app.'; }
  const part = (name, category, mass, x, y) => ({ id: uid(), name, category, mass, qty: 1, massSource: 'estimated', material: '', dims: '', x, y, notes: 'Example value (made up).' });
  d.components = [part('Frame', 'Frame', 22, 1.9, 0.5), part('Main wing', 'Main wing', 20, 1.45, 1.9), part('Tail', 'Tail', 4, 4.1, 0.8),
    part('Landing skid', 'Landing structure', 3, 1.5, 0.1), part('Decorations', 'Decorations', 3, 1.0, 1.2)];
  touch(d);
  return d;
}

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
      <p class="lead">Plan your Red Bull Flugtag craft, check it against the Miami 2026 rules, see an estimated flight, and compare with your real tests.</p>
    </div>
    <ol class="how-it-works">
      <li><span class="hiw-num">1</span><strong>Describe your craft</strong><span>Type in its size and weight (feet and pounds are fine), or upload a CAD file.</span></li>
      <li><span class="hiw-num">2</span><strong>Check it</strong><span>See if it meets the Miami rules and whether it's balanced.</span></li>
      <li><span class="hiw-num">3</span><strong>Watch it fly</strong><span>An estimated flight path, with a plain-English explanation.</span></li>
      <li><span class="hiw-num">4</span><strong>Test &amp; improve</strong><span>Record real tests, compare, and try changes as new versions.</span></li>
    </ol>
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
    <p class="first-time">New here? <button class="btn small" id="try-example">Try an example design</button> to see how everything works with made-up numbers,
      or read the <a href="#/help">quick guide</a>.</p>

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

${trashHTML()}

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

  el.querySelector('#try-example').addEventListener('click', () => {
    const d = createExampleDesign();
    toast('Example design created — the numbers are made up, just for learning.');
    app.go(`#/design/${d.id}/overview`);
  });

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
      if (!confirm(`Delete ${designTitle(d)}?

It moves to "Recently deleted" below, where you can restore it for 30 days.${tests ? ` Its ${tests} physical test(s) are kept.` : ''}`)) return;
      deleteDesign(d.id);
      toast(`${designTitle(d)} moved to Recently deleted.`);
      show(el, app);
      app.refreshNav();
    }
  });

  el.querySelector('#trash')?.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-trash]');
    if (!b) return;
    const id = b.dataset.id;
    if (b.dataset.trash === 'restore') {
      const r = restoreFromTrash(id);
      if (r) toast(r.kind === 'design' ? `Restored ${designTitle(r.item)}.` : `Restored the ${r.kind}.`);
    } else if (b.dataset.trash === 'purge') {
      if (!confirm('Delete this permanently? This cannot be undone.')) return;
      purgeTrash(id);
      cleanupFiles();
    } else if (b.dataset.trash === 'empty') {
      if (!confirm(`Permanently delete all ${db.trash.length} item(s) in Recently deleted? This cannot be undone.`)) return;
      purgeTrash(null);
      cleanupFiles();
    }
    show(el, app);
    app.refreshNav();
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
