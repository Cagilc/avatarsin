import { z } from 'zod';
import type { AuditEntry, ChatMessage } from '@vex/operator';
import { DEMO_USERS } from './auth.ts';
import type { StoredSession } from './storage.ts';

/**
 * From a real session to a case of the eval bank: a turn of a stored conversation (what the
 * person asked, with their screen context) plus what the audit says happened (which tools ran,
 * what was confirmed, what was rejected) become the expectations a model must meet again. The
 * administrator reviews the draft, trims it, and keeps it in evals/cases.local.json.
 */

export const CATEGORIES = ['flujo', 'contexto', 'busqueda', 'negativo', 'inyeccion', 'permisos', 'lenguaje', 'conector'] as const;

/** The JSON-safe shape of an eval case (no `setup` function). */
export const evalCaseJsonSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/, 'id: minúsculas, dígitos y guiones'),
  category: z.enum(CATEGORIES),
  request: z.string().min(1).max(4000),
  context: z.record(z.string(), z.unknown()).optional(),
  user: z.enum(['u-cesar', 'u-ana']).optional(),
  confirm: z.enum(['approve', 'reject']).optional(),
  connectors: z.array(z.literal('citas')).optional(),
  expect: z.strictObject({
    calls: z.array(z.string()).optional(),
    forbidden: z.array(z.string()).optional(),
    sent: z.number().int().min(0).optional(),
    sentTo: z.array(z.string()).optional(),
    expedientes: z.array(z.strictObject({ contactoId: z.string(), tipo: z.string().optional() })).optional(),
    tareas: z.array(z.strictObject({ equipo: z.string(), titulo: z.string().optional(), expedienteId: z.string().nullable().optional() })).optional(),
    replyIncludes: z.array(z.string()).optional(),
    maxToolCalls: z.number().int().min(0).optional(),
    auditPrincipal: z.string().optional(),
    citas: z.strictObject({ creadas: z.number().int().min(0).optional(), inicio: z.string().optional(), recordatorios: z.number().int().min(0).optional(), canal: z.enum(['sms', 'email']).optional() }).optional(),
  }),
  scripted: z.literal('skip').optional(),
  note: z.string().max(500).optional(),
});
export type EvalCaseJson = z.infer<typeof evalCaseJsonSchema>;

export interface SessionTurn {
  /** 1-based. */
  index: number;
  request: string;
  context: Record<string, unknown>;
  toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }>;
  /** Outcome of each tool use, from the tool_result the loop wrote back. */
  outcomes: Map<string, string>;
}

const CONTEXT_RE = /^\[Contexto de pantalla\] (\{.*\})\n\n/;

/** The turns of a conversation: each user text message with the tool uses that followed it. */
export function sessionTurns(history: ChatMessage[]): SessionTurn[] {
  const turns: SessionTurn[] = [];
  let current: SessionTurn | null = null;
  for (const message of history) {
    for (const block of message.content) {
      if (message.role === 'user' && block.type === 'text') {
        const match = CONTEXT_RE.exec(block.text);
        let context: Record<string, unknown> = {};
        if (match?.[1]) {
          try {
            context = JSON.parse(match[1]) as Record<string, unknown>;
          } catch {
            context = {};
          }
        }
        current = { index: turns.length + 1, request: block.text.replace(CONTEXT_RE, ''), context, toolUses: [], outcomes: new Map() };
        turns.push(current);
      } else if (message.role === 'assistant' && block.type === 'tool_use' && current) {
        current.toolUses.push({ id: block.id, name: block.name, input: (block.input ?? {}) as Record<string, unknown> });
      } else if (message.role === 'user' && block.type === 'tool_result' && current) {
        const m = /^ERROR \(([a-z]+)\): /.exec(block.content);
        current.outcomes.set(block.toolUseId, m?.[1] ?? 'ok');
      }
    }
  }
  return turns;
}

export interface CaseFromSessionOptions {
  session: StoredSession;
  audit: AuditEntry[];
  /** 1-based; default: the last turn. */
  turn?: number;
  anonymize?: boolean;
  now?: Date;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);

/** A draft case from one turn. Throws when the session has no such turn. */
export function caseFromSession(opts: CaseFromSessionOptions): EvalCaseJson {
  const turns = sessionTurns(opts.session.history);
  const turn = turns[(opts.turn ?? turns.length) - 1];
  if (!turn) throw new Error(`La sesión no tiene el turno ${opts.turn ?? turns.length} (tiene ${turns.length}).`);
  const byAction = new Map(opts.audit.map((a) => [a.actionId, a]));
  const actions = turn.toolUses.map((use) => {
    const entry = byAction.get(use.id);
    return { name: use.name, outcome: entry?.outcome ?? turn.outcomes.get(use.id) ?? 'ok', params: entry?.params ?? use.input, details: entry?.details };
  });
  const ok = actions.filter((a) => a.outcome === 'ok');
  const refused = actions.filter((a) => a.outcome === 'rejected' || a.outcome === 'denied');

  const expect: EvalCaseJson['expect'] = { calls: ok.map((a) => a.name), auditPrincipal: opts.session.principal.id, maxToolCalls: actions.length + 2 };
  const forbidden = [...new Set(refused.map((a) => a.name))];
  if (forbidden.length) expect.forbidden = forbidden;
  const sent = ok.filter((a) => a.name === 'enviar_correo');
  if (actions.some((a) => a.name === 'enviar_correo')) {
    expect.sent = sent.length;
    const to = sent.map((a) => str(a.details?.['para'])).filter((v): v is string => v !== undefined);
    if (to.length === sent.length && to.length > 0) expect.sentTo = to;
  }
  const expedientes = ok.filter((a) => a.name === 'crear_expediente').map((a) => ({ contactoId: str(a.params['contactoId']) ?? '', ...(str(a.params['tipo']) ? { tipo: str(a.params['tipo'])! } : {}) }));
  if (expedientes.length || actions.some((a) => a.name === 'crear_expediente')) expect.expedientes = expedientes;
  const tareas = ok.filter((a) => a.name === 'crear_tarea').map((a) => ({ equipo: str(a.params['equipo']) ?? '', ...(str(a.params['titulo']) ? { titulo: str(a.params['titulo'])! } : {}), expedienteId: str(a.params['expedienteId']) ?? null }));
  if (tareas.length || actions.some((a) => a.name === 'crear_tarea')) expect.tareas = tareas;
  const citas = ok.filter((a) => a.name.startsWith('citas_'));
  const usesCitas = actions.some((a) => a.name.startsWith('citas_'));
  if (usesCitas) {
    const creadas = citas.filter((a) => a.name === 'citas_crear_cita');
    const recordatorios = citas.filter((a) => a.name === 'citas_enviar_recordatorio');
    const body = (a: { params: Record<string, unknown> }) => (a.params['body'] ?? {}) as Record<string, unknown>;
    const inicio = creadas.map((a) => str(body(a)['inicio'])).find((v) => v !== undefined);
    const canal = recordatorios.map((a) => str(body(a)['canal'])).find((v) => v === 'sms' || v === 'email');
    expect.citas = { creadas: creadas.length, recordatorios: recordatorios.length, ...(inicio ? { inicio } : {}), ...(canal ? { canal: canal as 'sms' | 'email' } : {}) };
  }

  const when = (opts.now ?? new Date()).toISOString().slice(0, 10);
  const draft: EvalCaseJson = {
    id: `sesion-${opts.session.id.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 12) || 'x'}-t${turn.index}`,
    category: usesCitas ? 'conector' : refused.length && ok.length === 0 ? 'negativo' : 'flujo',
    request: turn.request,
    ...(Object.keys(turn.context).length ? { context: turn.context } : {}),
    ...(DEMO_USERS.some((u) => u.id === opts.session.principal.id) ? { user: opts.session.principal.id as 'u-cesar' | 'u-ana' } : {}),
    ...(refused.some((a) => a.outcome === 'rejected') ? { confirm: 'reject' as const } : {}),
    ...(usesCitas ? { connectors: ['citas' as const] } : {}),
    expect,
    scripted: 'skip',
    note: `Exportado de la sesión ${opts.session.id}, turno ${turn.index}, el ${when}. Revisa las expectativas antes de darlo por bueno.`,
  };
  return evalCaseJsonSchema.parse(opts.anonymize ? anonymizeCase(draft) : draft);
}

const EMAIL_RE = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
const PHONE_RE = /(?<!\d)\+?\d[\d .-]{7,}\d(?!\d)/g;

/** Masks e-mail addresses and phone numbers everywhere in the case, the same way each time, so the expectations still match the request. */
export function anonymizeCase(c: EvalCaseJson): EvalCaseJson {
  const emails = new Map<string, string>();
  const mask = (value: unknown): unknown => {
    if (typeof value === 'string') {
      return value
        .replace(EMAIL_RE, (m) => {
          const known = emails.get(m.toLowerCase());
          if (known) return known;
          const alias = `persona${emails.size + 1}@ejemplo.test`;
          emails.set(m.toLowerCase(), alias);
          return alias;
        })
        .replace(PHONE_RE, '600000000');
    }
    if (Array.isArray(value)) return value.map(mask);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, mask(v)]));
    return value;
  };
  return evalCaseJsonSchema.parse(mask(c));
}
