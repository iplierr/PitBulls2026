// App shell: routing between views, shared state, settings, unit converter.
import * as store from './store.js';
import { Viewer } from './viewer.js';
import * as dashboard from './views/dashboard.js';
import * as designView from './views/design.js';
import * as testsView from './views/tests.js';
import * as compareView from './views/compare.js';
import * as notebookView from './views/notebook.js';
import * as reportView from './views/report.js';

store.load();

const app = {
  store,
  viewer: new Viewer(),
  go(hash) {
    if (location.hash === hash) route();
    else location.hash = hash;
  },
  afterSave() {
    document.getElementById('save-error').hidden = !store.lastSaveError();
  },
  refreshNav() {
    const d = store.current();
    const link = document.getElementById('nav-design');
    link.textContent = d ? store.designTitle(d) : 'Design';
    link.href = d ? `#/design/${d.id}/overview` : '#/dashboard';
  },
};

const VIEWS = {
  dashboard: [dashboard, 'view-dashboard'],
  design: [designView, 'view-design'],
  tests: [testsView, 'view-tests'],
  compare: [compareView, 'view-compare'],
  notebook: [notebookView, 'view-notebook'],
  report: [reportView, 'view-report'],
};

function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  let [view = 'dashboard', id, tab] = parts;

  // Links from the first version of the app
  if (view === 'manual' || view === 'upload') {
    const d = store.current() || store.createDesign();
    location.replace(`#/design/${d.id}/${view === 'upload' ? 'cad' : 'inputs'}`);
    return;
  }
  if (!VIEWS[view]) view = 'dashboard';
  if ((view === 'design' || view === 'report') && !store.getDesign(id)) {
    view = 'dashboard';
  }
  if (view === 'design' || view === 'report') store.db.currentId = id;

  designView.leave?.(app);
  for (const [name, [, el]] of Object.entries(VIEWS)) document.getElementById(el).classList.toggle('active', name === view);
  document.querySelectorAll('.navlink[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === view));
  app.refreshNav();
  const [mod, el] = VIEWS[view];
  mod.show(document.getElementById(el), app, { id, tab });
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);
window.addEventListener('flugtag-saved', () => app.afterSave());

// 3D quality setting
const quality = document.getElementById('quality-select');
quality.value = store.db.settings.quality || 'normal';
app.viewer.setQuality(quality.value);
quality.addEventListener('change', () => {
  store.db.settings.quality = quality.value;
  store.save();
  app.viewer.setQuality(quality.value);
});

// ---------------------------------------------------------------------------
// Unit converter
// ---------------------------------------------------------------------------
const UNITS = [
  ['Length', [['m', 1], ['mm', 0.001], ['cm', 0.01], ['in', 0.0254], ['ft', 0.3048]]],
  ['Mass', [['kg', 1], ['g', 0.001], ['lb', 0.45359237], ['oz', 0.028349523]]],
  ['Speed', [['m/s', 1], ['km/h', 1 / 3.6], ['mph', 0.44704], ['knot', 0.514444], ['ft/s', 0.3048]]],
  ['Area', [['m²', 1], ['ft²', 0.09290304], ['in²', 0.00064516], ['cm²', 0.0001]]],
  ['Pressure', [['hPa', 1], ['inHg', 33.8639], ['psi', 68.9476], ['kPa', 10]]],
  ['Force', [['N', 1], ['lbf', 4.448222], ['kgf', 9.80665]]],
  ['Stress', [['MPa', 1], ['psi', 0.00689476], ['ksi', 6.89476]]],
  ['Temperature', [['°C', 'C'], ['°F', 'F']]],
];
const convFrom = document.getElementById('conv-from');
convFrom.innerHTML = UNITS.map(([cat, us], ci) => `<optgroup label="${cat}">${us.map(([u], ui) => `<option value="${ci}:${ui}">${u}</option>`).join('')}</optgroup>`).join('');
function convert() {
  const [ci, ui] = convFrom.value.split(':').map(Number);
  const [, us] = UNITS[ci];
  const x = parseFloat(document.getElementById('conv-value').value);
  const out = document.getElementById('conv-out');
  if (!Number.isFinite(x)) { out.innerHTML = ''; return; }
  let rows;
  if (us[0][1] === 'C') {
    const c = us[ui][1] === 'C' ? x : (x - 32) * 5 / 9;
    rows = [['°C', c], ['°F', c * 9 / 5 + 32]];
  } else {
    const base = x * us[ui][1];
    rows = us.map(([u, f]) => [u, base / f]);
  }
  out.innerHTML = rows.map(([u, v]) => `<tr><th>${u}</th><td>${Number(v.toPrecision(6))}</td></tr>`).join('');
}
convFrom.addEventListener('change', convert);
document.getElementById('conv-value').addEventListener('input', convert);
document.getElementById('open-converter').addEventListener('click', () => { convert(); document.getElementById('converter').showModal(); });

route();
