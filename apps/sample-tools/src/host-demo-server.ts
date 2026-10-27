import { createHostDemoApp } from './host-demo.ts';

// The client's web for the guided demo:  pnpm dev:host-demo  →  http://127.0.0.1:8793/
// Vex Core must run with VEX_HOST_MANIFEST=demo-guiada and the same DEMO_RESET_SECRET.
const port = Number(process.env['HOST_DEMO_PORT'] ?? 8793);
const app = createHostDemoApp({
  vexCore: process.env['VEX_CORE_URL'] ?? 'http://127.0.0.1:8787',
  resetSecret: process.env['DEMO_RESET_SECRET'] ?? 'cambia-este-secreto-en-los-dos-lados',
  ...(process.env['DEMO_USER'] ? { demoUser: process.env['DEMO_USER'] } : {}),
});

app
  .listen({ port, host: '127.0.0.1' })
  .then(() => console.log(`Web del cliente (demo guiada) en http://127.0.0.1:${port}/ · gancho de reinicio en POST /vex/reset`))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
