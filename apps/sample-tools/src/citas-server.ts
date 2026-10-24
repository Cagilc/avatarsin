import { createCitasApp } from './citas.ts';

const port = Number(process.env['CITAS_PORT'] ?? 8790);
const baseUrl = `http://127.0.0.1:${port}`;
const app = createCitasApp({ baseUrl, ...(process.env['CITAS_TOKEN'] ? { token: process.env['CITAS_TOKEN'] } : {}) });

app
  .listen({ port, host: '127.0.0.1' })
  .then(() => console.log(`Agenda de citas en ${baseUrl} · especificación en ${baseUrl}/openapi.json`))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
