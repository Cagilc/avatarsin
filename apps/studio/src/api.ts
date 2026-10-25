import type { AvatarDocument, Op } from '@vexstudio/format';

/** The studio server API. Same-origin (Vite proxies /api in development). */

const TOKEN_KEY = 'vexstudio.token';

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'editor';
}

export interface Config {
  devLogin: boolean;
  assistant: string;
  publicUrl: string;
  runtimeReady: boolean;
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export function getToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private mode: the session lives only in memory for this tab.
  }
}

async function call<T>(method: string, url: string, body?: unknown, raw?: Blob | ArrayBuffer): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers['authorization'] = `Bearer ${token}`;
  if (raw) headers['content-type'] = 'application/octet-stream';
  else if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(url, { method, headers, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    if (res.status === 401 && token) setToken(null);
    throw new ApiError(res.status, data.error ?? `Error ${res.status}`, data);
  }
  return data as T;
}

export interface AvatarSummary {
  id: string;
  name: string;
  revision: number;
  updatedAt: string;
  published: number | null;
}

export interface QuestionOption {
  id: string;
  label: string;
  detail: string;
  ops: Op[];
}
export interface Question {
  id: string;
  text: string;
  why: string;
  options: QuestionOption[];
  recommended: string;
}
export interface Proposal {
  id: string;
  summary: string[];
  ops: Op[];
  questions: Question[];
  confidence: number;
  provider: string;
}

export interface Revision {
  n: number;
  actor: 'user' | 'ai';
  userId: string;
  summary: string;
  createdAt: string;
}

export interface EmbedKey {
  id: string;
  avatarId: string;
  label: string;
  origins: string[];
  tools: string[] | null;
  maxRisk: 'read' | 'write' | 'irreversible';
  createdAt: string;
  revokedAt: string | null;
}

export type Saved = { doc: AvatarDocument; revision: number };

export const api = {
  config: () => call<Config>('GET', '/api/config'),
  login: (email: string, password: string) => call<{ token: string; user: User }>('POST', '/api/login', { email, password }),
  devLogin: () => call<{ token: string; user: User }>('POST', '/api/dev-login', {}),
  me: () => call<{ user: User }>('GET', '/api/me'),
  avatars: () => call<{ avatars: AvatarSummary[] }>('GET', '/api/avatars'),
  createAvatar: (name: string) => call<{ id: string } & Saved>('POST', '/api/avatars', { name }),
  avatar: (id: string) => call<Saved & { published: Array<{ revision: number; createdAt: string }> }>('GET', `/api/avatars/${id}`),
  ops: (id: string, ops: Op[], baseRevision: number, opts: { lock?: boolean; summary?: string } = {}) => call<Saved>('POST', `/api/avatars/${id}/ops`, { ops, baseRevision, ...opts }),
  history: (id: string) => call<{ history: Revision[] }>('GET', `/api/avatars/${id}/history`),
  revert: (id: string, revision: number, baseRevision: number) => call<Saved>('POST', `/api/avatars/${id}/revert`, { revision, baseRevision }),
  propose: (id: string, message: string, answers: Record<string, string>) => call<Proposal>('POST', `/api/avatars/${id}/assistant`, { message, answers }),
  accept: (id: string, proposalId: string, baseRevision: number) => call<Saved>('POST', `/api/avatars/${id}/proposals/${proposalId}/accept`, { baseRevision }),
  upload: (file: Blob) => call<{ hash: string; type: string; kind: 'svg' | 'png'; size: number; width: number; height: number }>('POST', '/api/assets', undefined, file),
  publish: (id: string) => call<{ revision: number; keyId: string; already?: boolean }>('POST', `/api/avatars/${id}/publish`, {}),
  keys: (id: string) => call<{ keys: EmbedKey[]; publicKey: string; keyId: string }>('GET', `/api/avatars/${id}/keys`),
  createKey: (id: string, body: { label: string; origins: string[]; tools?: string[]; maxRisk?: EmbedKey['maxRisk'] }) => call<{ key: EmbedKey }>('POST', `/api/avatars/${id}/keys`, body),
  revokeKey: (key: string) => call<{ revoked: boolean }>('DELETE', `/api/keys/${key}`),
};

/** Downloads an asset with the session token (assets are private until published). */
export async function fetchAsset(hash: string): Promise<Response> {
  const token = getToken();
  const res = await fetch(`/api/assets/${hash}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new ApiError(res.status, 'No se pudo descargar un recurso.', null);
  return res;
}
