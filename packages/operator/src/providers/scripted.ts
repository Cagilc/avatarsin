import type { ChatMessage, Completion, CompletionRequest, ContentBlock, ModelProvider } from '../provider.ts';

/**
 * A deterministic planner for demos and tests without an API key. It reads the last user
 * message, turns Spanish keywords into an ordered plan over the platform tools, issues one
 * tool call per round and finishes with a summary. It is not smart; it is predictable.
 */
interface PlannedCall {
  name: string;
  input: (results: Record<string, unknown>) => unknown;
}

function lastUserText(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (!m || m.role !== 'user') continue;
    const text = m.content.find((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text');
    if (text) return text.text.replace(/^\[Contexto de pantalla\][^\n]*\n\n/, '');
  }
  return '';
}

function screenContext(messages: ChatMessage[]): Record<string, unknown> {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (!m || m.role !== 'user') continue;
    const text = m.content.find((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text');
    const match = text?.text.match(/^\[Contexto de pantalla\] (\{.*\})\n\n/);
    if (match?.[1]) {
      try {
        return JSON.parse(match[1]) as Record<string, unknown>;
      } catch {
        return {};
      }
    }
    if (text) return {};
  }
  return {};
}

/** Tool uses and their results since the last user text message. */
function exchange(messages: ChatMessage[]): { calls: string[]; results: Record<string, unknown>; lastError: string | null } {
  let start = messages.length - 1;
  while (start >= 0) {
    const m = messages[start];
    if (m?.role === 'user' && m.content.some((b) => b.type === 'text')) break;
    start -= 1;
  }
  const calls: string[] = [];
  const results: Record<string, unknown> = {};
  const idToName = new Map<string, string>();
  let lastError: string | null = null;
  for (const m of messages.slice(Math.max(0, start))) {
    for (const b of m.content) {
      if (b.type === 'tool_use') {
        calls.push(b.name);
        idToName.set(b.id, b.name);
      } else if (b.type === 'tool_result') {
        const name = idToName.get(b.toolUseId) ?? 'unknown';
        if (b.isError) {
          lastError = b.content.replace(/^ERROR ([a-z]+): /, '');
        } else {
          try {
            results[name] = JSON.parse(b.content);
          } catch {
            results[name] = b.content;
          }
        }
      }
    }
  }
  return { calls, results, lastError };
}

function quoted(text: string): string | null {
  const m = text.match(/["“«]([^"”»]+)["”»]/);
  return m?.[1]?.trim() ?? null;
}

function nameAfter(text: string, keys: RegExp): string | null {
  const m = text.match(keys);
  if (!m) return null;
  const rest = text.slice((m.index ?? 0) + m[0].length);
  const stop = rest.search(/[,.;?!]| y | e | para | con | sobre | del | de la | en | que | un | una | crea| abre| asigna| m[aá]nda| env[ií]a|$/);
  const candidate = rest.slice(0, stop < 0 ? undefined : stop).trim();
  return candidate.length > 1 ? candidate : null;
}

// The JSON part is captured up to the end even if malformed, so a typo gets an explanation.
const DIRECT_RE = /^\s*(?:usa|ejecuta|llama a)\s+([a-z][a-z0-9_]*)(?:\s+con)?\s*(\{[\s\S]*)?\s*$/i;

/** Parses "usa <tool> {json}". Null when the text is not a direct call. */
export function directCall(text: string): { name: string; args: Record<string, unknown> } | { error: string } | null {
  const m = DIRECT_RE.exec(text);
  if (!m?.[1]) return null;
  if (!m[2]) return { name: m[1], args: {} };
  try {
    const args = JSON.parse(m[2]) as unknown;
    if (typeof args !== 'object' || args === null || Array.isArray(args)) return { error: 'Los parámetros tienen que ser un objeto JSON, p. ej. {"fecha":"2026-10-27"}.' };
    return { name: m[1], args: args as Record<string, unknown> };
  } catch {
    return { error: 'Los parámetros no son JSON válido. Ejemplo: usa citas_listar_huecos {"fecha":"2026-10-27"}' };
  }
}

const MAIL_RE = /\b(correo|email|mail|escr[ií]bele|m[aá]ndale|env[ií]ale)\b/;
// `\b` treats accented letters as non-word characters, so "Envía un…" would match " a ";
// a Unicode letter lookbehind keeps "a" and "para" whole words.
const CONTACT_KEYS = /(?<!\p{L})(?:busca|buscar|encuentra|localiza|qui[eé]n es|a|para)\s+(?:a\s+)?/iu;

function contactNameIn(text: string): string | null {
  return quoted(text) ?? nameAfter(text, CONTACT_KEYS);
}

/**
 * A question to ask instead of acting, when the request lacks something the plan cannot guess.
 * Today: an email with no recipient (no name in the request and no contact open on screen).
 */
export function missingInfo(text: string, context: Record<string, unknown>): string | null {
  const t = text.toLowerCase();
  if (MAIL_RE.test(t) && !context['contactoEmail'] && !context['contactoId'] && !contactNameIn(text)) {
    return '¿A quién se lo envío? Dime su nombre o abre su ficha y vuelve a pedírmelo.';
  }
  return null;
}

function teamIn(text: string): string {
  const t = text.toLowerCase();
  if (/extranjer/.test(t)) return 'extranjeria';
  if (/marketing/.test(t)) return 'marketing';
  if (/admin/.test(t)) return 'administracion';
  if (/venta|comercial/.test(t)) return 'ventas';
  return 'administracion';
}

function pick<T>(obj: unknown, path: string[]): T | undefined {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur as T | undefined;
}

export function planFor(text: string, context: Record<string, unknown>): PlannedCall[] {
  const t = text.toLowerCase();
  const plan: PlannedCall[] = [];
  const wantsSearch = /\b(busca|buscar|encuentra|localiza|qui[eé]n es)\b/.test(t);
  const wantsFile = /expediente/.test(t) && /\b(crea|crear|abre|abrir|nuevo|nueva|inicia)\b/.test(t);
  const wantsTask = /\b(tarea|asigna|asignar|p[aá]salo|p[aá]saselo|encarga)\b/.test(t);
  const wantsMail = MAIL_RE.test(t) && missingInfo(text, context) === null;
  const contextContact = context['contactoId'] as string | undefined;
  const tramite = /residencia|arraigo|nacionalidad|visado/.exec(t)?.[0] ?? null;
  const asunto = /documentaci[oó]n/.test(t) ? 'documentación' : /presupuesto/.test(t) ? 'presupuesto' : null;

  const contactName = contactNameIn(text);
  if (wantsSearch || ((wantsFile || wantsMail) && !contextContact && contactName)) {
    plan.push({ name: 'buscar', input: () => ({ consulta: contactName ?? text.slice(0, 60), tipo: 'contactos' }) });
  }
  const contactId = (results: Record<string, unknown>) => contextContact ?? pick<string>(results['buscar'], ['resultados', '0', 'id']);
  const contactEmail = (results: Record<string, unknown>) => pick<string>(results['buscar'], ['resultados', '0', 'email']) ?? (context['contactoEmail'] as string | undefined);

  if (wantsFile) {
    plan.push({
      name: 'crear_expediente',
      input: (results) => ({
        contactoId: contactId(results) ?? 'desconocido',
        tipo: tramite ?? 'general',
        notas: `Petición: ${text}`,
      }),
    });
  }
  if (wantsTask) {
    plan.push({
      name: 'crear_tarea',
      input: (results) => ({
        titulo: quoted(text) ?? (tramite ? `Seguimiento del expediente de ${tramite}` : asunto ? `Seguimiento de ${asunto}` : `Seguimiento: ${text.slice(0, 60)}`),
        equipo: teamIn(text),
        expedienteId: pick<string>(results['crear_expediente'], ['id']) ?? (context['expedienteId'] as string | undefined) ?? null,
      }),
    });
  }
  if (wantsMail) {
    plan.push({
      name: 'redactar_correo',
      input: (results) => ({
        para: contactEmail(results) ?? 'contacto@desconocido.es',
        proposito: /documentaci[oó]n/.test(t) ? 'pedir documentación' : /presupuesto/.test(t) ? 'enviar presupuesto' : text.slice(0, 80),
        expedienteId: pick<string>(results['crear_expediente'], ['id']) ?? (context['expedienteId'] as string | undefined) ?? null,
      }),
    });
    plan.push({ name: 'enviar_correo', input: (results) => ({ borradorId: pick<string>(results['redactar_correo'], ['id']) ?? 'desconocido' }) });
  }
  return plan;
}

function summary(results: Record<string, unknown>, calls: string[]): string {
  const lines: string[] = [];
  if (calls.includes('buscar')) {
    const first = pick<Record<string, unknown>>(results['buscar'], ['resultados', '0']);
    lines.push(first ? `He encontrado a ${String(first['nombre'])} (${String(first['email'])}).` : 'No he encontrado ningún contacto con ese nombre.');
  }
  if (calls.includes('crear_expediente')) {
    const id = pick<string>(results['crear_expediente'], ['id']);
    lines.push(id ? `He abierto el expediente ${id}.` : 'No he podido abrir el expediente.');
  }
  if (calls.includes('crear_tarea')) {
    const t = results['crear_tarea'] as Record<string, unknown> | undefined;
    lines.push(t ? `Tarea "${String(t['titulo'])}" asignada al equipo de ${String(t['equipo'])}.` : 'No he podido crear la tarea.');
  }
  if (calls.includes('enviar_correo')) {
    const sent = results['enviar_correo'] as Record<string, unknown> | undefined;
    lines.push(sent ? `Correo enviado a ${String(sent['para'])}.` : 'El correo no se ha enviado.');
  } else if (calls.includes('redactar_correo')) {
    lines.push('El correo quedó redactado pero sin enviar.');
  }
  return lines.length > 0 ? lines.join(' ') : 'Hecho.';
}

export class ScriptedProvider implements ModelProvider {
  readonly name = 'scripted';

  async complete(req: CompletionRequest): Promise<Completion> {
    const text = lastUserText(req.messages);
    const context = screenContext(req.messages);
    const plan = planFor(text, context);
    const { calls, results, lastError } = exchange(req.messages);
    const available = new Set(req.tools.map((t) => t.name));

    const say = (reply: string): Completion => {
      req.onTextDelta?.(reply);
      return { content: [{ type: 'text', text: reply }], stopReason: 'end_turn' };
    };

    // "usa <herramienta> {json}": a direct call, for tools the keyword planner knows nothing about
    // (imported connectors). It still goes through validation, policy, confirmation and audit.
    const direct = directCall(text);
    if (direct) {
      if ('error' in direct) return say(direct.error);
      if (!available.has(direct.name)) return say(`No tengo ninguna herramienta llamada ${direct.name}. Las que puedo usar ahora: ${[...available].join(', ')}.`);
      if (!calls.includes(direct.name) && !lastError) {
        return { content: [{ type: 'tool_use', id: `call_${calls.length + 1}_${direct.name}`, name: direct.name, input: direct.args }], stopReason: 'tool_use' };
      }
      if (lastError) return say(`No se pudo ejecutar ${direct.name}: ${lastError}`);
      const out = results[direct.name];
      const shown = typeof out === 'string' ? out : JSON.stringify(out);
      return say(`Hecho (${direct.name}): ${shown.length > 600 ? `${shown.slice(0, 600)}…` : shown}`);
    }

    const question = missingInfo(text, context);
    if (plan.length === 0) {
      return say(question ?? 'Puedo buscar contactos, abrir expedientes, crear tareas para un equipo y redactar o enviar correos. Dime qué necesitas.');
    }
    // The person was not found: do not open records or write emails for nobody.
    const found = pick<unknown[]>(results['buscar'], ['resultados']);
    if (calls.includes('buscar') && found !== undefined && found.length === 0 && plan.some((p) => p.name !== 'buscar')) {
      const consulta = pick<string>(req.messages.flatMap((m) => m.content).find((b) => b.type === 'tool_use' && b.name === 'buscar'), ['input', 'consulta']);
      return say(`No encuentro a "${consulta ?? 'esa persona'}" en la plataforma, así que no he hecho nada más. ¿Me das su nombre completo o su email?`);
    }
    const next = plan.find((p) => !calls.includes(p.name));
    if (next && !lastError && available.has(next.name)) {
      return {
        content: [{ type: 'tool_use', id: `call_${calls.length + 1}_${next.name}`, name: next.name, input: next.input(results) }],
        stopReason: 'tool_use',
      };
    }
    const reply = lastError ? `${summary(results, calls)} Me he detenido: ${lastError}` : summary(results, calls);
    req.onTextDelta?.(reply);
    return { content: [{ type: 'text', text: reply }], stopReason: 'end_turn' };
  }
}
