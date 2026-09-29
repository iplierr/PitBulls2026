// Tiny static file server with live reload and no dependencies. Run: node server.js  (or npm start)
// Browsers block JavaScript modules on file:// pages, so the app must be served over http.
// Live reload: when you save any file in this folder, open browser tabs refresh automatically.
// (Local preview only — the published GitHub Pages site does not include the reload script.)
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 8080;
const ROOT = __dirname;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.md': 'text/plain; charset=utf-8',
  '.stl': 'model/stl',
  '.glb': 'model/gltf-binary',
};
const RELOAD_SNIPPET = '<script>new EventSource("/__livereload").onmessage = () => location.reload();</script>';

// ---- live reload
const clients = new Set();
let timer = null;
try {
  fs.watch(ROOT, { recursive: true }, (_event, file) => {
    if (!file || /(^|[\\/])(\.git|node_modules)([\\/]|$)/.test(file)) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      for (const res of clients) res.write('data: reload\n\n');
      if (clients.size) console.log(`Changed: ${file} → refreshing ${clients.size} tab(s)`);
    }, 150);
  });
} catch {
  console.log('(Live reload is not available on this system — refresh the browser manually.)');
}

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);

  if (urlPath === '/__livereload') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(': connected\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  const file = path.normalize(path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    const ext = path.extname(file).toLowerCase();
    if (ext === '.html') data = Buffer.from(data.toString('utf8').replace('</body>', `${RELOAD_SNIPPET}\n</body>`));
    res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`Flugtag Lab preview: http://localhost:${PORT}  (auto-refreshes when you save; Ctrl+C to stop)`);
});
