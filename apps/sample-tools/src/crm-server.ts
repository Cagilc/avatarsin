import { createCrmApp } from './crm.ts';

const port = Number(process.env['CRM_PORT'] ?? 8792);
const baseUrl = `http://127.0.0.1:${port}`;
const app = createCrmApp({ baseUrl, ...(process.env['CRM_TOKEN'] ? { token: process.env['CRM_TOKEN'] } : {}) });

app
  .listen({ port, host: '127.0.0.1' })
  .then(() => console.log(`CRM de clientes en ${baseUrl} · especificación en ${baseUrl}/openapi.json`))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
