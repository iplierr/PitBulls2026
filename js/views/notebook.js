// Engineering notebook: dated entries for decisions, changes, observations, ideas, meetings, findings.
import { db, uid, save, today, sortedDesigns, designTitle, getDesign, deleteItem } from '../store.js';
import { esc, toast, download, toCSV } from '../ui.js';

export const CATEGORIES = ['Design decision', 'Change made', 'Test observation', 'Measurement', 'Problem', 'Idea', 'Meeting notes', 'Simulation finding', 'Physical test finding'];
let editingId = null;
let filter = { cat: '', design: '', q: '' };

export function show(el) {
  const designs = sortedDesigns();
  const e = editingId ? db.notes.find((n) => n.id === editingId) : null;
  el.innerHTML = `
    <h1>Engineering notebook</h1>
    <p class="lead left">Write down decisions, changes, measurements, problems and ideas as they happen. Future you (and next year's team) will thank you.</p>
    <div class="panel section">
      <h2>${e ? 'Edit entry' : 'New entry'}</h2>
      <form id="note-form" novalidate>
        <div class="form-grid">
          <label>Date <input name="date" type="date" value="${esc(e?.date || today())}"></label>
          <label>Type <select name="category">${CATEGORIES.map((c) => `<option ${e?.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
          <label>Related design <select name="designId"><option value="">— none —</option>${designs.map((d) => `<option value="${d.id}" ${(e ? e.designId : db.currentId) === d.id ? 'selected' : ''}>${esc(designTitle(d))}</option>`).join('')}</select></label>
          <label>Author <input name="author" maxlength="60" value="${esc(e?.author || db.settings.author || '')}" placeholder="optional"></label>
        </div>
        <label class="block">Title <input name="title" maxlength="120" required value="${esc(e?.title || '')}" placeholder="e.g. Moved pilot seat 15 cm forward"></label>
        <label class="block">Description <textarea name="body" rows="4" placeholder="What, why, and what you expect to happen">${esc(e?.body || '')}</textarea></label>
        <div class="row-actions">
          <button class="btn primary" type="submit">${e ? 'Save changes' : 'Add entry'}</button>
          ${e ? '<button class="btn" type="button" id="cancel">Cancel</button>' : ''}
        </div>
      </form>
    </div>
    <div class="panel section">
      <div class="panel-head">
        <h2>Entries</h2>
        <div class="row-actions">
          <select id="f-cat"><option value="">All types</option>${CATEGORIES.map((c) => `<option ${filter.cat === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
          <select id="f-design"><option value="">All designs</option>${designs.map((d) => `<option value="${d.id}" ${filter.design === d.id ? 'selected' : ''}>${esc(designTitle(d))}</option>`).join('')}</select>
          <input id="f-q" placeholder="Search…" value="${esc(filter.q)}">
          <button class="btn small" id="notes-csv" type="button">Export CSV</button>
        </div>
      </div>
      <div id="note-list"></div>
    </div>`;

  const form = el.querySelector('#note-form');
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    const title = String(fd.get('title') || '').trim();
    if (!title) { toast('Please add a title.', 'error'); return; }
    const n = e || { id: uid(), created: new Date().toISOString() };
    Object.assign(n, { date: fd.get('date') || today(), category: fd.get('category'), designId: fd.get('designId') || null,
      author: String(fd.get('author') || '').slice(0, 60), title: title.slice(0, 120), body: String(fd.get('body') || '').slice(0, 10000) });
    db.settings.author = n.author;
    if (!e) db.notes.push(n);
    editingId = null;
    save();
    toast('Saved.');
    show(el);
  });
  el.querySelector('#cancel')?.addEventListener('click', () => { editingId = null; show(el); });
  el.querySelector('#f-cat').addEventListener('change', (x) => { filter.cat = x.target.value; renderList(el); });
  el.querySelector('#f-design').addEventListener('change', (x) => { filter.design = x.target.value; renderList(el); });
  el.querySelector('#f-q').addEventListener('input', (x) => { filter.q = x.target.value; renderList(el); });
  el.querySelector('#notes-csv').addEventListener('click', () => download(`flugtag-notebook-${today()}.csv`, toCSV([
    ['Date', 'Type', 'Design', 'Author', 'Title', 'Description'],
    ...sortedNotes().map((n) => [n.date, n.category, getDesign(n.designId) ? designTitle(getDesign(n.designId)) : '', n.author, n.title, n.body]),
  ]), 'text/csv'));
  el.querySelector('#note-list').addEventListener('click', (x) => {
    const b = x.target.closest('button[data-act]');
    if (!b) return;
    const id = b.closest('[data-id]').dataset.id;
    if (b.dataset.act === 'edit') { editingId = id; show(el); window.scrollTo(0, 0); }
    if (b.dataset.act === 'del' && confirm('Delete this entry? You can restore it from Dashboard → Recently deleted.')) { deleteItem('note', id); toast('Entry moved to Recently deleted.'); renderList(el); }
  });
  renderList(el);
}

export const sortedNotes = () => [...db.notes].sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.created).localeCompare(String(a.created)));

function renderList(el) {
  const q = filter.q.toLowerCase();
  const list = sortedNotes().filter((n) => (!filter.cat || n.category === filter.cat) && (!filter.design || n.designId === filter.design)
    && (!q || `${n.title} ${n.body} ${n.author}`.toLowerCase().includes(q)));
  el.querySelector('#note-list').innerHTML = list.length ? list.map((n) => {
    const d = getDesign(n.designId);
    return `<article class="note" data-id="${n.id}">
      <div class="note-head"><strong>${esc(n.title)}</strong>
        <span class="row-actions"><button class="btn tiny" data-act="edit">Edit</button><button class="btn tiny danger" data-act="del">Delete</button></span></div>
      <div class="note-meta">${esc(n.date)} · <span class="tag">${esc(n.category)}</span>${d ? ` · ${esc(designTitle(d))}` : ''}${n.author ? ` · ${esc(n.author)}` : ''}</div>
      <div class="note-body">${esc(n.body)}</div>
    </article>`;
  }).join('') : '<p class="muted">No entries match.</p>';
}
