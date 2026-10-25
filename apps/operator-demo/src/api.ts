import type { AuditEntry, Principal, VexPersonality } from '@vex/operator';

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
  personality: VexPersonality;
  host: { name: string; manifest: boolean; avatar?: { endpoint: string; publicKey: string; keyId: string } };
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
