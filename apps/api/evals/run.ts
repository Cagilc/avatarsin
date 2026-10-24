// Runs the eval bank and writes a report.
//
//   node evals/run.ts                       provider from .env (Claude with a key, scripted without)
//   node evals/run.ts --provider scripted   keyword planner: regression gate, free
//   node evals/run.ts --provider anthropic  Claude: real measure, costs money
//   node evals/run.ts --only flujo-laura-completo,negativo-sin-destinatario
//   node evals/run.ts --min-pass 0.8        exit 1 below this pass rate
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ScriptedProvider, type ModelProvider } from '@vex/operator';
import { AnthropicProvider } from '../src/providers/anthropic.ts';
import { configFromEnv, createProvider } from '../src/providers/index.ts';
import { CASES } from './cases.ts';
import { runBank, toMarkdown } from './harness.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const envFile = join(root, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const config = configFromEnv();
const which = arg('provider');
let provider: ModelProvider;
if (which === 'scripted') provider = new ScriptedProvider();
else if (which === 'anthropic') {
  if (!config.apiKey) {
    console.error('Falta ANTHROPIC_API_KEY en apps/api/.env para evaluar con Claude.');
    process.exit(2);
  }
  provider = new AnthropicProvider({ model: config.model });
} else provider = createProvider(config);

const only = arg('only')?.split(',');
const cases = only ? CASES.filter((c) => only.includes(c.id)) : CASES;
const minPass = Number(arg('min-pass') ?? (provider.name === 'scripted' ? 1 : 0));

console.log(`Banco de encargos: ${cases.length} casos con ${provider.name}\n`);
const report = await runBank(cases, provider, (r) => {
  const mark = r.skipped ? '·' : r.pass ? 'OK' : 'XX';
  console.log(`${mark.padEnd(3)} ${r.id.padEnd(34)} ${String(r.calls.length).padStart(2)} acciones ${String(r.ms).padStart(6)} ms${r.failures.length ? `  ${r.failures.join('; ')}` : ''}`);
});

const outDir = join(here, 'reports');
mkdirSync(outDir, { recursive: true });
const stamp = report.date.replace(/[:.]/g, '-');
const slug = provider.name.replace(/[^a-z0-9-]+/gi, '_');
writeFileSync(join(outDir, `${slug}-${stamp}.json`), `${JSON.stringify(report, null, 2)}\n`);
const md = toMarkdown(report);
writeFileSync(join(outDir, `latest-${slug}.md`), md);
if (process.env['GITHUB_STEP_SUMMARY']) writeFileSync(process.env['GITHUB_STEP_SUMMARY'], md, { flag: 'a' });

console.log(`\n${report.passed}/${report.run} superados (${Math.round(report.passRate * 100)} %), ${report.skipped} omitidos · p50 ${report.msP50} ms · ${report.costUsd.toFixed(4)} USD`);
console.log(`Informe: ${join('evals', 'reports', `latest-${slug}.md`)}`);
if (report.passRate < minPass) process.exit(1);
