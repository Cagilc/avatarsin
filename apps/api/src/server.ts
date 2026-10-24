import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.ts';
import { MockPlatform } from './platform/mock.ts';
import { configFromEnv, createProvider } from './providers/index.ts';
import { MemoryStore, SqliteStore } from './storage.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const envFile = join(root, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const env = process.env;
const config = configFromEnv();
const provider = createProvider(config);
const port = Number(env['PORT'] ?? 8787);
const host = env['HOST'] ?? '127.0.0.1';
const corsOrigin = env['CORS_ORIGIN'] ?? true;
const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';

// VEX_DB=memory keeps nothing; otherwise a SQLite file (default apps/api/data/vex.db).
const dbSetting = env['VEX_DB'] ?? 'data/vex.db';
const store = dbSetting === 'memory' ? new MemoryStore() : new SqliteStore(isAbsolute(dbSetting) ? dbSetting : join(root, dbSetting));

const app = buildApp({
  provider,
  platform: new MockPlatform(),
  store,
  hostName: 'MNEE',
  corsOrigin,
  rateLimit: { messages: Number(env['VEX_RATE_LIMIT'] ?? 20), windowMs: 60_000 },
  // The model proxy spends the key without a user token: only on a local server, unless forced.
  enableProviderProxy: env['VEX_PROVIDER_PROXY'] === '1' || (env['VEX_PROVIDER_PROXY'] !== '0' && loopback),
  logger: true,
});

app
  .listen({ port, host })
  .then((address) => {
    app.log.info(`Vex Core en ${address} · proveedor ${provider.name} · datos ${dbSetting}`);
    if (provider.name === 'scripted') app.log.warn('Sin ANTHROPIC_API_KEY: modo guion (planificador por palabras clave). Copia .env.example a .env para usar Claude.');
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
