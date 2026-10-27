import { createCatalogoApp } from './catalogo.ts';

const port = Number(process.env['CATALOGO_PORT'] ?? 8791);
const baseUrl = `http://127.0.0.1:${port}`;
const app = createCatalogoApp({ baseUrl, ...(process.env['CATALOGO_TOKEN'] ? { token: process.env['CATALOGO_TOKEN'] } : {}) });

app
  .listen({ port, host: '127.0.0.1' })
  .then(() => console.log(`Catálogo y pedidos en ${baseUrl} · especificación en ${baseUrl}/openapi.json`))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
