import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.ts';
import { createAssistant } from './assistant/index.ts';
import { TokenService } from './auth.ts';
import { loadSigner } from './signing.ts';
import { StudioStore } from './store.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const envFile = join(root, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const env = process.env;
const port = Number(env['PORT'] ?? 8788);
const host = env['HOST'] ?? '127.0.0.1';
const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
const resolve = (p: string) => (isAbsolute(p) ? p : join(root, p));

// The studio UI in development is served by Vite on 5180 (it proxies /api, so it is same-origin).
const allowedOrigins = (env['STUDIO_ORIGIN'] ?? (loopback ? 'http://localhost:5180,http://127.0.0.1:5180' : '')).split(',').map((s) => s.trim()).filter(Boolean);
const tokens = env['STUDIO_TOKEN_SECRET'] ? new TokenService(env['STUDIO_TOKEN_SECRET']) : TokenService.ephemeral();
// Password-less entry as the owner: only on a local server, unless forced.
const devLogin = env['STUDIO_DEV_LOGIN'] === '1' || (env['STUDIO_DEV_LOGIN'] !== '0' && loopback);
const dbPath = env['STUDIO_DB'] === 'memory' ? ':memory:' : resolve(env['STUDIO_DB'] ?? 'data/studio.db');
const store = new StudioStore(dbPath);
// Production: STUDIO_SIGNING_KEY. Local: a key file generated on first start.
const { signer, source } = await loadSigner({ env: env['STUDIO_SIGNING_KEY'], file: env['STUDIO_SIGNING_KEY'] ? undefined : resolve('data/signing-key.json') });
const assistant = createAssistant(env);

const app = buildApp({
  store,
  tokens,
  signer,
  assistant,
  allowedOrigins,
  devLogin,
  publicUrl: env['STUDIO_PUBLIC_URL'] ?? `http://localhost:${port}`,
  runtimeBundle: join(root, '..', '..', 'packages', 'runtime', 'dist', 'vex-avatar.js'),
  logger: true,
});

app
  .listen({ port, host })
  .then((address) => {
    app.log.info(`Estudio en ${address} · asistente ${assistant.name} · clave de firma ${signer.keyId} (${source}) · datos ${dbPath}`);
    if (devLogin && !loopback) app.log.warn('STUDIO_DEV_LOGIN=1 en un servidor no local: cualquiera puede entrar como propietario.');
    if (!loopback && source !== 'env') app.log.warn('Servidor no local sin STUDIO_SIGNING_KEY: la clave de firma está en un archivo del disco.');
    if (!env['STUDIO_TOKEN_SECRET']) app.log.info('Sin STUDIO_TOKEN_SECRET: las sesiones caducan al reiniciar.');
    if (store.countUsers() === 0 && !devLogin) app.log.warn('No hay cuentas: crea la primera con pnpm user:add.');
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
