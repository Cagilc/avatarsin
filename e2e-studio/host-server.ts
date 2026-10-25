import { createServer } from 'node:http';

/**
 * Stand-ins for third-party sites. `/` embeds the avatar exactly as the studio's snippet says;
 * `/asistente` embeds the whole operator panel with the two lines a host pastes. The values
 * (studio, endpoint, key, Vex Core) arrive in the query string so a test can paste them.
 */
const avatarPage = `<!doctype html>
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

/** A plain page with no framework: the script Vex Core serves and the tag. The demo login stands in for the host's token function. */
const assistantPage = (api: string) => `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Página simple con Vex</title>
<script type="module" src="${api}/assistant.js"></script>
</head>
<body style="font-family:sans-serif;background:#f4f6fb;margin:0;display:grid;grid-template-columns:1fr 420px;height:100vh">
<main style="padding:24px">
  <h1 data-vex-id="titulo">Página simple</h1>
  <p>Un sitio sin React ni nada: dos líneas y Vex opera.</p>
  <label>Contraseña <input type="password" data-vex-id="clave" value="no-se-lee"></label>
  <p id="status">cargando</p>
</main>
<vex-assistant id="vex" api="${api}" demo-user="u-cesar"></vex-assistant>
<script>
  const el = document.getElementById('vex');
  const status = document.getElementById('status');
  el.addEventListener('vex-ready', () => { status.textContent = 'listo:' + el.info.personality.name; });
  el.addEventListener('vex-avatar', (e) => { status.textContent += ' avatar:' + e.detail.name; });
  el.addEventListener('vex-error', (e) => { status.textContent = 'error:' + e.detail.message; });
</script>
</body></html>`;

for (const port of process.argv.slice(2).map(Number)) {
  createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);
    if (url.pathname === '/health') return void res.end('ok');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    if (url.pathname === '/asistente') return void res.end(assistantPage(url.searchParams.get('api') ?? 'http://127.0.0.1:8787'));
    res.end(avatarPage);
  }).listen(port);
}
