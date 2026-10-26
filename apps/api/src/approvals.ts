import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { ActionRequest, ApprovalChannel, Principal } from '@vex/operator';

/**
 * Approvals by channel. When a run parks on a confirmation, the same card can travel out of the
 * page: a signed webhook the host turns into an e-mail or a message, or the server log. The link
 * carries a short-lived, single-use token bound to that one confirmation; whoever opens it sees
 * what will really happen (the preview from the system of record) and approves or rejects. The
 * host decides who receives the link: that is how an approval can be delegated.
 */

export interface ApprovalClaim {
  sessionId: string;
  actionId: string;
  principalId: string;
}

interface ApprovalPayload extends ApprovalClaim {
  kind: 'approval';
  /** Unix milliseconds. */
  exp: number;
}

/** `v1.<payload>.<signature>`, HMAC-SHA256 with the server secret; expires with the confirmation. */
export class ApprovalTokens {
  private readonly secret: Buffer;
  private readonly now: () => number;

  constructor(secret?: string | Buffer, now: () => number = () => Date.now()) {
    const buf = secret === undefined ? randomBytes(32) : typeof secret === 'string' ? Buffer.from(secret, 'utf8') : secret;
    if (buf.length < 32) throw new Error('El secreto de los enlaces de aprobación debe tener al menos 32 bytes.');
    this.secret = buf;
    this.now = now;
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.secret).update(`approval:${payload}`).digest('base64url');
  }

  issue(claim: ApprovalClaim, ttlMs: number): string {
    const body: ApprovalPayload = { kind: 'approval', ...claim, exp: this.now() + ttlMs };
    const payload = Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
    return `v1.${payload}.${this.sign(payload)}`;
  }

  verify(token: string | undefined): ApprovalClaim | null {
    if (!token) return null;
    const [version, payload, signature] = token.split('.');
    if (version !== 'v1' || !payload || !signature) return null;
    const expected = Buffer.from(this.sign(payload));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    try {
      const body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<ApprovalPayload>;
      if (body.kind !== 'approval' || typeof body.exp !== 'number' || body.exp < this.now()) return null;
      if (typeof body.sessionId !== 'string' || typeof body.actionId !== 'string' || typeof body.principalId !== 'string') return null;
      return { sessionId: body.sessionId, actionId: body.actionId, principalId: body.principalId };
    } catch {
      return null;
    }
  }
}

export interface Delivery {
  sessionId: string;
  principal: Principal;
  action: ActionRequest;
  approveUrl: string;
  expiresAt: string;
}

export interface DeliveryResult {
  kind: ApprovalChannel['kind'];
  ok: boolean;
  error?: string;
}

export interface NotifierOptions {
  channels: readonly ApprovalChannel[];
  /** Where the secrets named by `secretEnv` live. */
  env: Record<string, string | undefined>;
  /** Returns a reason when a webhook URL is not one this server may call. */
  checkUrl: (url: string) => string | null;
  fetch?: typeof fetch;
  log: (line: string) => void;
}

/** The body a webhook receives: everything the card shows, plus the link. */
export function webhookBody(d: Delivery): string {
  return JSON.stringify({
    type: 'approval_requested',
    sessionId: d.sessionId,
    actionId: d.action.id,
    principal: d.principal,
    tool: d.action.tool,
    risk: d.action.risk,
    summary: d.action.summary,
    details: d.action.details ?? null,
    params: d.action.params,
    approveUrl: d.approveUrl,
    expiresAt: d.expiresAt,
  });
}

export function signature(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

export class ApprovalNotifier {
  private readonly opts: NotifierOptions;

  constructor(opts: NotifierOptions) {
    this.opts = opts;
  }

  /** Sends the card out through every channel; a channel that fails never blocks the confirmation. */
  async notify(d: Delivery): Promise<DeliveryResult[]> {
    return Promise.all(
      this.opts.channels.map(async (channel): Promise<DeliveryResult> => {
        if (channel.kind === 'log') {
          this.opts.log(`Vex necesita el OK de ${d.principal.name}: ${d.action.summary} → ${d.approveUrl}`);
          return { kind: 'log', ok: true };
        }
        const blocked = this.opts.checkUrl(channel.url);
        if (blocked) return { kind: 'webhook', ok: false, error: blocked };
        const secret = channel.secretEnv ? this.opts.env[channel.secretEnv] : undefined;
        if (channel.secretEnv && !secret) return { kind: 'webhook', ok: false, error: `Falta ${channel.secretEnv} en el entorno.` };
        const body = webhookBody(d);
        try {
          const res = await (this.opts.fetch ?? fetch)(channel.url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-vex-event': 'approval_requested', ...(secret ? { 'x-vex-signature': signature(secret, body) } : {}) },
            body,
            signal: AbortSignal.timeout(10_000),
          });
          if (!res.ok) return { kind: 'webhook', ok: false, error: `HTTP ${res.status}` };
          return { kind: 'webhook', ok: true };
        } catch (err) {
          return { kind: 'webhook', ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }),
    );
  }
}

const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const LABEL: Record<string, string> = { para: 'Para', asunto: 'Asunto', cuerpo: 'Mensaje', servicio: 'Servicio', metodo: 'Método', url: 'URL', herramienta: 'Herramienta', argumentos: 'Datos' };

function page(title: string, body: string): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;background:#111214;color:#ecedee;margin:0;padding:24px;display:grid;place-items:start center}main{max-width:560px;width:100%;display:grid;gap:14px}h1{font-size:18px;margin:0}dl{display:grid;grid-template-columns:auto 1fr;gap:6px 12px;margin:0;padding:12px;border:1px solid #3a3d44;border-radius:8px;background:#1a1b1f}dt{color:#a1a4ab}dd{margin:0;white-space:pre-wrap;word-break:break-word}form{display:flex;gap:10px}button{font:inherit;padding:10px 16px;border-radius:8px;border:1px solid #3a3d44;background:#1f2125;color:#ecedee;cursor:pointer}button.primary{background:#2f5fe8;border-color:#2f5fe8;color:#fff}.muted{color:#a1a4ab;font-size:14px}</style>
</head><body><main>${body}</main></body></html>`;
}

/** The approval page: the card as the person would see it in the panel, and two buttons. */
export function approvalPage(action: ActionRequest, who: Principal, base: string): string {
  const rows = action.details ? Object.entries(action.details).map(([k, v]) => `<dt>${esc(LABEL[k] ?? k)}</dt><dd>${esc(typeof v === 'string' ? v : JSON.stringify(v))}</dd>`).join('') : `<dt>Parámetros</dt><dd>${esc(JSON.stringify(action.params))}</dd>`;
  return page(
    'Vex necesita tu OK',
    `<h1>Vex necesita tu OK</h1><p><strong>${esc(action.summary)}</strong></p><p class="muted">Pedido por ${esc(who.name)}. Acción irreversible (${esc(action.tool)}): esto es lo que se enviará tal cual.</p><dl>${rows}</dl>
<form method="post" action="${esc(base)}/approve"><button class="primary" type="submit">Aprobar</button><button type="submit" formaction="${esc(base)}/reject">Rechazar</button></form>`,
  );
}

export function resultPage(kind: 'approved' | 'rejected' | 'gone' | 'invalid'): string {
  switch (kind) {
    case 'approved':
      return page('Aprobado', '<h1>Aprobado</h1><p>Vex sigue con ello. Puedes cerrar esta página.</p>');
    case 'rejected':
      return page('Rechazado', '<h1>Rechazado</h1><p>Vex no lo hará y se detiene ahí. Puedes cerrar esta página.</p>');
    case 'gone':
      return page('Ya resuelto', '<h1>Ya resuelto</h1><p class="muted">Esta confirmación ya se respondió o caducó. Si hace falta, pídeselo a Vex otra vez.</p>');
    case 'invalid':
      return page('Enlace no válido', '<h1>Enlace no válido</h1><p class="muted">El enlace está incompleto, alterado o caducado.</p>');
  }
}
