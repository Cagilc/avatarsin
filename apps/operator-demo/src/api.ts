import type { AuditEntry, OperatorEvent, Principal } from '@vex/operator';

export const API_URL = (import.meta.env['VITE_VEX_API'] as string | undefined) ?? 'http://127.0.0.1:8787';

export interface Estado {
  contactos: Array<{ id: string; nombre: string; email: string; nacionalidad?: string; etiquetas: string[] }>;
  expedientes: Array<{ id: string; contactoId: string; tipo: string; estado: string; notas: string; creadoEn: string }>;
  tareas: Array<{ id: string; titulo: string; equipo: string; expedienteId: string | null; estado: string }>;
  correos: Array<{ id: string; para: string; asunto: string; cuerpo: string; enviadoEn: string }>;
  equipos: string[];
}

export interface OperatorInfo {
  provider: string;
  personality: { name: string; tone: string; greets: boolean; talkMs: number };
  tools: Array<{ name: string; driver: string; risk: string; description: string }>;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function demoUsers(): Promise<Principal[]> {
  return json(await fetch(`${API_URL}/platform/auth/demo-users`));
}

export async function login(userId: string): Promise<{ token: string; principal: Principal }> {
  return json(await fetch(`${API_URL}/platform/auth/demo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId }) }));
}

export async function info(): Promise<OperatorInfo> {
  return json(await fetch(`${API_URL}/operator/info`));
}

export async function estado(token: string): Promise<Estado> {
  return json(await fetch(`${API_URL}/platform/estado`, { headers: { authorization: `Bearer ${token}` } }));
}

export async function audit(token: string, sessionId: string): Promise<AuditEntry[]> {
  return json(await fetch(`${API_URL}/operator/audit?sessionId=${encodeURIComponent(sessionId)}`, { headers: { authorization: `Bearer ${token}` } }));
}

export async function confirm(token: string, sessionId: string, actionId: string, approved: boolean): Promise<void> {
  await json(
    await fetch(`${API_URL}/operator/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ sessionId, actionId, approved }),
    }),
  );
}

/** Stops the run in progress for this session; the stream then ends with a `cancelled` event. */
export async function stop(token: string, sessionId: string): Promise<{ stopped: boolean }> {
  return json(
    await fetch(`${API_URL}/operator/stop`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ sessionId }),
    }),
  );
}

export type StreamEvent = OperatorEvent | { type: 'session'; sessionId: string };

/** POST /operator/chat and deliver each SSE event as it arrives. Resolves when the stream ends. */
export async function chat(
  token: string,
  body: { sessionId?: string; message: string; context: Record<string, unknown> },
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API_URL}/operator/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
  if (!res.ok || !res.body) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep = buffer.indexOf('\n\n');
    while (sep >= 0) {
      const chunk = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const data = chunk.split('\n').find((l) => l.startsWith('data: '));
      if (data) onEvent(JSON.parse(data.slice(6)) as StreamEvent);
      sep = buffer.indexOf('\n\n');
    }
  }
}
