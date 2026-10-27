import { createHmac, timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';

/**
 * A stand-in for the client's own web: the page a presenter shows, with a few registered
 * elements, the two lines that embed Vex, and the host side of the demo reset hook. It is what
 * `docs/vex-en-30-minutos.md` builds up to, so every piece here is one a host would copy.
 */

export interface HostDemoOptions {
  /** Vex Core, as the browser reaches it. */
  vexCore: string;
  /** The secret Vex Core signs the reset with (the manifest names its variable; the value lives here and there). */
  resetSecret: string;
  /** Demo user for the local Vex Core (`demo-user` attribute). */
  demoUser?: string;
}

/**
 * Checks `x-vex-signature` (`sha256=<HMAC-SHA256 hex of the raw body>`) against the shared secret,
 * in constant time. A host copies this function; it is the whole contract of a signed hook.
 */
export function verifyVexSignature(secret: string, rawBody: string, header: string | undefined): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(rawBody).digest('hex'), 'utf8');
  const given = Buffer.from(header.slice('sha256='.length), 'utf8');
  return expected.length === given.length && timingSafeEqual(expected, given);
}

const page = (o: HostDemoOptions) => `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Demo Negocio · con Vex</title>
<script type="module" src="${o.vexCore}/assistant.js"></script>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; display: grid; grid-template-columns: 1fr 420px; height: 100vh; background: #f4f6fb; }
  main { padding: 24px 32px; overflow: auto; }
  h1 { margin-top: 0; }
  section { margin: 18px 0; padding: 14px 16px; background: #fff; border: 1px solid #dfe3ee; border-radius: 10px; }
  ul { margin: 6px 0 0; padding-left: 18px; }
  .muted { color: #667; font-size: 13px; }
  vex-assistant { height: 100vh; }
</style></head>
<body>
<main>
  <h1 data-vex-id="titulo">Demo Negocio</h1>
  <p class="muted">Esta página es el «cliente»: lo que ya existía. Vex entra con dos líneas y señala lo que la página registra con <code>data-vex-id</code>.</p>
  <section data-vex-id="expedientes">
    <strong>Expedientes</strong>
    <ul id="expedientes"><li class="muted">Los que Vex abra aparecerán aquí (evento <code>vex-effect</code>).</li></ul>
  </section>
  <section data-vex-id="pizarra">
    <strong>Pizarra de la demo</strong>
    <ul id="pizarra"><li class="muted">Vacía. El botón «Reiniciar demo» del presentador la vacía por el gancho firmado.</li></ul>
  </section>
  <section>
    <label>Un campo privado que Vex nunca lee: <input type="password" data-vex-private value="secreto"></label>
  </section>
  <p id="status" class="muted">conectando…</p>
</main>
<vex-assistant id="vex" api="${o.vexCore}" demo-user="${o.demoUser ?? 'u-cesar'}" presenter></vex-assistant>
<script>
  const el = document.getElementById('vex');
  const status = document.getElementById('status');
  el.context = { pantalla: 'inicio' };
  el.suggestions = ['Busca a Laura Pérez', '¿Quién es Marco Rossi?'];
  el.addEventListener('vex-ready', () => { status.textContent = 'Vex listo'; });
  el.addEventListener('vex-error', (e) => { status.textContent = 'error: ' + e.detail.message; });
  // A write the host cares about: refresh just that part of the screen.
  el.addEventListener('vex-effect', (e) => {
    const d = e.detail;
    if (d.tool !== 'crear_expediente' || !d.confirmed) return;
    const li = document.createElement('li');
    li.textContent = (d.details && d.details.id ? d.details.id + ' · ' : '') + d.summary;
    document.getElementById('expedientes').appendChild(li);
  });
  async function pizarra() {
    const r = await fetch('/pizarra');
    const items = await r.json();
    const ul = document.getElementById('pizarra');
    ul.replaceChildren(...(items.length ? items.map((t) => Object.assign(document.createElement('li'), { textContent: t })) : [Object.assign(document.createElement('li'), { className: 'muted', textContent: 'Vacía.' })]));
  }
  el.addEventListener('vex-script', (e) => { if (e.detail.event === 'reset') setTimeout(pizarra, 300); });
  el.addEventListener('vex-turn', () => { fetch('/pizarra', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ texto: 'Encargo terminado a las ' + new Date().toLocaleTimeString() }) }).then(pizarra); });
  pizarra();
</script>
</body></html>`;

/** The demo host: the page, a small board the page writes on, and the signed reset hook that wipes it. */
export function createHostDemoApp(opts: HostDemoOptions): FastifyInstance & { estado: () => { pizarra: string[]; reinicios: number } } {
  const app = Fastify({ logger: false });
  let pizarra: string[] = [];
  let reinicios = 0;

  // The hook needs the raw body: the signature covers the bytes as sent, not a re-serialisation.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));

  app.get('/', async (_req, reply) => reply.type('text/html; charset=utf-8').send(page(opts)));
  app.get('/health', async () => 'ok');
  app.get('/pizarra', async () => pizarra);
  app.post('/pizarra', async (req) => {
    const b = JSON.parse(String(req.body ?? '{}')) as { texto?: string };
    if (b.texto) pizarra.push(String(b.texto).slice(0, 200));
    return pizarra;
  });

  // POST /vex/reset: only a request Vex Core signed with the shared secret puts the demo back.
  app.post('/vex/reset', async (req, reply) => {
    const raw = String(req.body ?? '');
    if (req.headers['x-vex-event'] !== 'presenter_reset') return reply.code(400).send({ error: 'No es un reinicio de Vex' });
    if (!verifyVexSignature(opts.resetSecret, raw, req.headers['x-vex-signature'] as string | undefined)) return reply.code(401).send({ error: 'Firma no válida' });
    const body = JSON.parse(raw) as { principal?: { name?: string } };
    pizarra = [];
    reinicios += 1;
    return { ok: true, por: body.principal?.name ?? 'desconocido', reinicios };
  });

  return Object.assign(app, { estado: () => ({ pizarra: [...pizarra], reinicios }) });
}
