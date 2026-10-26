import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.ts';
import { TokenService } from './auth.ts';
import { HostManifestError, loadHostManifest } from './host.ts';
import { MockPlatform } from './platform/mock.ts';
import { configFromEnv, createProvider } from './providers/index.ts';
import { MemoryStore, SqliteStore } from './storage.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const envFile = join(root, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const env = process.env;
// The host manifest: a preset name or a path (relative to apps/api). A manifest that does not
// validate stops the start here, with the field and the reason. Unset = a bare operator.
let manifest;
try {
  manifest = env['VEX_HOST_MANIFEST'] ? loadHostManifest(env['VEX_HOST_MANIFEST'], { cwd: root }) : undefined;
} catch (err) {
  if (!(err instanceof HostManifestError)) throw err;
  console.error(`VEX_HOST_MANIFEST: ${err.message}`);
  process.exit(1);
}
const config = configFromEnv();
const provider = createProvider(config);
const port = Number(env['PORT'] ?? 8787);
const host = env['HOST'] ?? '127.0.0.1';
const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
// Pages that may call Vex Core from a browser. Unset on a local server = the demo on 5174.
const allowedOrigins = (env['CORS_ORIGIN'] ?? (loopback ? 'http://localhost:5174,http://127.0.0.1:5174' : '')).split(',').map((s) => s.trim()).filter(Boolean);
// Tokens: a fixed secret keeps sessions valid across restarts; without one they die with the process.
const tokens = env['VEX_TOKEN_SECRET'] ? new TokenService(env['VEX_TOKEN_SECRET']) : TokenService.ephemeral();
// The demo login (no password) only on a local server, unless forced.
const demoLogin = env['VEX_DEMO_LOGIN'] === '1' || (env['VEX_DEMO_LOGIN'] !== '0' && loopback);

// VEX_DB=memory keeps nothing; otherwise a SQLite file (default apps/api/data/vex.db).
const dbSetting = env['VEX_DB'] ?? 'data/vex.db';
const store = dbSetting === 'memory' ? new MemoryStore() : new SqliteStore(isAbsolute(dbSetting) ? dbSetting : join(root, dbSetting));

// Local MCP servers are processes started on this machine: only the listed commands may run.
// Unset on a local server = `node` (the sample notes server); set it explicitly anywhere else.
const mcpAllow = (env['VEX_MCP_ALLOW'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const app = buildApp({
  provider,
  platform: new MockPlatform(),
  store,
  ...(manifest ? { manifest } : {}),
  assistantBundle: join(root, '..', '..', 'packages', 'assistant', 'dist', 'vex-assistant.js'),
  allowedOrigins,
  tokens,
  demoLogin,
  rateLimit: { messages: Number(env['VEX_RATE_LIMIT'] ?? 20), windowMs: 60_000 },
  confirmTimeoutMs: Number(env['VEX_CONFIRM_TIMEOUT_MS'] ?? 5 * 60_000),
  // Approval links (channel approvals) point here and are signed with the token secret when there is one.
  publicUrl: env['VEX_PUBLIC_URL'] ?? `http://127.0.0.1:${port}`,
  ...(env['VEX_TOKEN_SECRET'] ? { approvalSecret: env['VEX_TOKEN_SECRET'] } : {}),
  // Model usage caps, on by default: tokens per person and day, USD per installation and month. 0 = no cap.
  spendLimits: {
    ...(env['VEX_LIMIT_USER_DAY_TOKENS'] !== undefined ? { userDayTokens: Number(env['VEX_LIMIT_USER_DAY_TOKENS']) } : {}),
    ...(env['VEX_LIMIT_MONTH_USD'] !== undefined ? { monthUsd: Number(env['VEX_LIMIT_MONTH_USD']) } : {}),
    ...(env['VEX_WARN_RATIO'] !== undefined ? { warnRatio: Number(env['VEX_WARN_RATIO']) } : {}),
  },
  // The model proxy spends the key without a user token: only on a local server, unless forced.
  enableProviderProxy: env['VEX_PROVIDER_PROXY'] === '1' || (env['VEX_PROVIDER_PROXY'] !== '0' && loopback),
  // Connector secrets are read from the environment by name (e.g. CITAS_TOKEN); never stored.
  // Import URLs: https only and no private networks, except on a local server for the sample tools.
  connectors: { env, mcpAllow, urlPolicy: { allowHttp: loopback, allowInternal: loopback } },
  logger: true,
});

app
  .listen({ port, host })
  .then((address) => {
    app.log.info(`Vex Core en ${address} · proveedor ${provider.name} · datos ${dbSetting} · host ${manifest ? `${manifest.host.name} (manifiesto ${env['VEX_HOST_MANIFEST']})` : 'sin manifiesto'}`);
    if (provider.name === 'scripted') app.log.warn('Sin ANTHROPIC_API_KEY: modo guion (planificador por palabras clave). Copia .env.example a .env para usar Claude.');
    if (demoLogin && !loopback) app.log.warn('VEX_DEMO_LOGIN=1 en un servidor no local: cualquiera puede entrar como usuario de demo.');
    if (!env['VEX_TOKEN_SECRET']) app.log.info('Sin VEX_TOKEN_SECRET: las sesiones caducan al reiniciar.');
    if (mcpAllow.length === 0) app.log.info('Sin VEX_MCP_ALLOW: no se puede arrancar ningún servidor MCP local.');
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
