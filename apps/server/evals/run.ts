// Runs the assistant bank and writes a report.
//
//   node evals/run.ts                        assistant from .env (Claude with a key, geometric without)
//   node evals/run.ts --provider heuristic   the geometric assistant: regression gate, free
//   node evals/run.ts --provider claude      Claude: the real measure, costs money
//   node evals/run.ts --only esqueleto-mascota,peticion-plano-rebote
//   node evals/run.ts --min-pass 0.8         exit 1 below this pass rate
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClaudeAssistant, HeuristicAssistant, createAssistant, type Assistant } from '../src/assistant/index.ts';
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

const which = arg('provider');
let assistant: Assistant;
if (which === 'heuristic') assistant = new HeuristicAssistant();
else if (which === 'claude') {
  if (!process.env['ANTHROPIC_API_KEY']) {
    console.error('Falta ANTHROPIC_API_KEY en apps/server/.env para medir con Claude.');
    process.exit(2);
  }
  assistant = new ClaudeAssistant({ model: process.env['STUDIO_MODEL'] ?? 'claude-opus-5-5' });
} else assistant = createAssistant(process.env);

const only = arg('only')?.split(',');
const cases = only ? CASES.filter((c) => only.includes(c.id)) : CASES;
const minPass = Number(arg('min-pass') ?? (assistant.name === 'heuristic' ? 1 : 0));

console.log(`Banco del asistente del estudio: ${cases.length} casos con ${assistant.name}\n`);
const report = await runBank(cases, assistant, (r) => {
  const mark = r.skipped ? '·' : r.pass ? 'OK' : 'XX';
  console.log(`${mark.padEnd(3)} ${r.id.padEnd(40)} ${String(r.ops).padStart(3)} ops ${String(r.ms).padStart(6)} ms${r.questions.length ? `  pregunta: ${r.questions.join(', ')}` : ''}${r.failures.length ? `  ${r.failures.join('; ')}` : ''}`);
});

const outDir = join(here, 'reports');
mkdirSync(outDir, { recursive: true });
const stamp = report.date.replace(/[:.]/g, '-');
const slug = report.provider.replace(/[^a-z0-9-]+/gi, '_');
writeFileSync(join(outDir, `${slug}-${stamp}.json`), `${JSON.stringify(report, null, 2)}\n`);
const md = toMarkdown(report);
writeFileSync(join(outDir, `latest-${slug}.md`), md);
if (process.env['GITHUB_STEP_SUMMARY']) writeFileSync(process.env['GITHUB_STEP_SUMMARY'], md, { flag: 'a' });

console.log(`\n${report.passed}/${report.run} superados (${Math.round(report.passRate * 100)} %), ${report.skipped} omitidos · p50 ${report.msP50} ms`);
console.log(`Informe: ${join('evals', 'reports', `latest-${slug}.md`)}`);
if (report.passRate < minPass) process.exit(1);
