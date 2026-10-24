import type { Risk } from '@vex/operator';

export const RISK_ORDER: Record<Risk, number> = { read: 0, write: 1, irreversible: 2 };

export function lowerThan(a: Risk, b: Risk): boolean {
  return RISK_ORDER[a] < RISK_ORDER[b];
}

export interface RiskSuggestion {
  risk: Risk;
  reason: string;
}

/**
 * Words that make a write irreversible in practice: it leaves the system (a message, a payment,
 * a publication) or it destroys something. English and Spanish, stems.
 */
const OUTBOUND =
  /(send|enviar|envia|envio|mail|email|correo|sms|whatsapp|notif|message|mensaje|publish|publica|post_to|tweet|pay|pago|pagar|charge|cobr|refund|reembols|transfer|invoice_send|invite|invita|approve|aprueba|aprobar|sign|firma|recordatorio|reminder|delete|borra|elimina|remove|purge|destroy|cancel|anula|revoke|revoca)/i;

function outboundWord(...texts: Array<string | undefined>): string | null {
  for (const t of texts) {
    const m = t?.match(OUTBOUND);
    if (m) return m[0].toLowerCase();
  }
  return null;
}

/** HTTP operation: the method decides, words in the name, path or summary escalate. */
export function suggestHttpRisk(method: string, path: string, operationId?: string, summary?: string): RiskSuggestion {
  const m = method.toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return { risk: 'read', reason: `Solo lee: método ${m}.` };
  if (m === 'DELETE') return { risk: 'irreversible', reason: 'Borra datos: método DELETE.' };
  const word = outboundWord(operationId, path, summary);
  if (word) return { risk: 'irreversible', reason: `Escribe y parece enviar, cobrar o borrar ("${word}"): método ${m}.` };
  return { risk: 'write', reason: `Crea o modifica datos: método ${m}.` };
}

export interface McpAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
  title?: string;
}

/**
 * MCP tool: the server's annotations are hints, not guarantees, so they only feed the suggestion.
 * The spec's defaults are pessimistic (not read-only, destructive, open world) and so are we.
 */
export function suggestMcpRisk(name: string, description: string | undefined, a: McpAnnotations | undefined): RiskSuggestion {
  if (a?.readOnlyHint === true) return { risk: 'read', reason: 'El servidor la declara de solo lectura (readOnlyHint).' };
  const word = outboundWord(name, description);
  if (a?.destructiveHint === false) {
    if (a.openWorldHint === true) return { risk: 'irreversible', reason: 'No destructiva, pero actúa fuera del servidor (openWorldHint).' };
    if (word) return { risk: 'irreversible', reason: `No destructiva según el servidor, pero parece enviar o borrar ("${word}").` };
    return { risk: 'write', reason: 'Modifica sin destruir (destructiveHint: false).' };
  }
  if (!a || a.destructiveHint === undefined) return { risk: 'irreversible', reason: 'Sin anotaciones de riesgo: se asume destructiva, como dice la especificación MCP.' };
  return { risk: 'irreversible', reason: 'El servidor la declara destructiva (destructiveHint).' };
}
