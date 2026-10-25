// Exports a real session as a draft case of the eval bank, into evals/cases.local.json.
//
//   node evals/export.ts --list                                  recent sessions with their feedback
//   node evals/export.ts --session <id> [--turn n] [--anonymize]  append that turn as a case
//
// Talks to a running Vex Core (--api, default http://127.0.0.1:8787) as an administrator: with
// --token <token>, or with the local demo login (--user u-cesar by default).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { evalCaseJsonSchema, type EvalCaseJson } from '../src/cases.ts';
import { LOCAL_CASES_PATH } from './cases.ts';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const api = (arg('api') ?? 'http://127.0.0.1:8787').replace(/\/+$/, '');

async function token(): Promise<string> {
  const given = arg('token');
  if (given) return given;
  const res = await fetch(`${api}/platform/auth/demo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: arg('user') ?? 'u-cesar' }) });
  if (!res.ok) throw new Error(`No hay login de demo en ${api} (${res.status}); pasa --token.`);
  return ((await res.json()) as { token: string }).token;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${api}${path}`, { headers: { authorization: `Bearer ${await token()}` } });
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

if (flag('list')) {
  const sessions = await get<Array<{ id: string; principal: { name: string }; turns: number; updatedAt: string; feedback: { up: number; down: number; reasons: Array<{ turn: number; verdict: string; reason: string }> } }>>('/admin/sessions');
  for (const s of sessions) {
    console.log(`${s.id}  ${s.principal.name.padEnd(16)} ${String(s.turns).padStart(2)} turnos  👍${s.feedback.up} 👎${s.feedback.down}  ${s.updatedAt}`);
    for (const r of s.feedback.reasons) console.log(`    turno ${r.turn} ${r.verdict === 'down' ? '👎' : '👍'} ${r.reason}`);
  }
  process.exit(0);
}

const session = arg('session');
if (!session) {
  console.error('Uso: node evals/export.ts --list | --session <id> [--turn n] [--anonymize]');
  process.exit(2);
}
const query = new URLSearchParams({ ...(arg('turn') ? { turn: arg('turn')! } : {}), ...(flag('anonymize') ? { anonymize: '1' } : {}) }).toString();
const exported = evalCaseJsonSchema.parse(await get<EvalCaseJson>(`/admin/sessions/${encodeURIComponent(session)}/case${query ? `?${query}` : ''}`));

const existing: EvalCaseJson[] = existsSync(LOCAL_CASES_PATH) ? (JSON.parse(readFileSync(LOCAL_CASES_PATH, 'utf8')) as EvalCaseJson[]) : [];
const merged = [...existing.filter((c) => c.id !== exported.id), exported];
writeFileSync(LOCAL_CASES_PATH, `${JSON.stringify(merged, null, 2)}\n`);
console.log(JSON.stringify(exported, null, 2));
console.log(`\nGuardado en ${LOCAL_CASES_PATH} (${merged.length} casos locales). Revisa las expectativas y quita "scripted" si el modo guion también debe pasarlo.`);
