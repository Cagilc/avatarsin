import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.ts';
import { AuditLog } from './audit.ts';
import { MockPlatform } from './platform/mock.ts';
import { configFromEnv, createProvider } from './providers/index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const envFile = join(root, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const config = configFromEnv();
const provider = createProvider(config);
const port = Number(process.env['PORT'] ?? 8787);
const corsOrigin = process.env['CORS_ORIGIN'] ?? true;

const app = buildApp({
  provider,
  platform: new MockPlatform(),
  audit: new AuditLog(join(root, 'audit', 'audit.jsonl')),
  hostName: 'MNEE',
  corsOrigin,
  logger: true,
});

app
  .listen({ port, host: '127.0.0.1' })
  .then((address) => {
    app.log.info(`Vex Core en ${address} · proveedor ${provider.name}`);
    if (provider.name === 'scripted') app.log.warn('Sin ANTHROPIC_API_KEY: modo guion (planificador por palabras clave). Copia .env.example a .env para usar Claude.');
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
