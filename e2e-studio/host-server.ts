import { createServer } from 'node:http';

/**
 * Stand-ins for third-party sites. The page embeds the avatar exactly as the studio's snippet
 * says; the snippet's values arrive in the query string so a test can paste them.
 */
const page = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Sitio del cliente</title></head>
<body style="font-family:sans-serif;background:#f4f6fb">
<h1>Sitio del cliente</h1>
<div id="slot"></div>
<p id="status">cargando</p>
<script>
  const q = new URLSearchParams(location.search);
  const s = document.createElement('script');
  s.type = 'module';
  s.src = q.get('server') + '/v1/vex-avatar.js';
  document.head.appendChild(s);
  const el = document.createElement('vex-avatar');
  el.setAttribute('endpoint', q.get('endpoint'));
  el.setAttribute('public-key', q.get('pk'));
  el.setAttribute('key-id', q.get('kid'));
  el.setAttribute('state', q.get('state') || 'idle');
  el.style.width = '320px';
  el.style.height = '320px';
  el.addEventListener('vex-ready', (e) => { document.getElementById('status').textContent = 'listo:' + e.detail.name; });
  el.addEventListener('vex-error', (e) => { document.getElementById('status').textContent = 'error:' + e.detail.reason; });
  document.getElementById('slot').appendChild(el);
</script>
</body></html>`;

for (const port of process.argv.slice(2).map(Number)) {
  createServer((req, res) => {
    if (req.url === '/health') return void res.end('ok');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(page);
  }).listen(port);
}
