import type { Risk } from '@vex/operator';
import { API_URL } from './api';

/**
 * The part of a connector manifest this page shows. Declared here (not imported from
 * @vex/connectors) because that package also holds the Node-only MCP client.
 */
export interface ConnectorToolView {
  name: string;
  description: string;
  binding: { kind: 'http'; method: string; path: string } | { kind: 'mcp'; tool: string };
  suggestedRisk: Risk;
  riskReason: string;
  risk: Risk | null;
  enabled: boolean;
  review: { by: string; at: string; lowerRiskReason?: string } | null;
}

export interface ConnectorView {
  id: string;
  name: string;
  description: string;
  source: { kind: 'openapi'; url?: string } | { kind: 'mcp-stdio'; command: string; args: string[] } | { kind: 'mcp-http'; url: string };
  baseUrl?: string;
  auth: { kind: 'none' } | { kind: 'bearer'; env: string } | { kind: 'header'; name: string; env: string };
  guide: string;
  tools: ConnectorToolView[];
  updatedAt: string;
}

export interface Decision {
  name: string;
  risk: Risk;
  enabled: boolean;
  lowerRiskReason?: string;
}

async function call<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

export const listConnectors = (token: string) => call<ConnectorView[]>(token, '/connectors');

export const importOpenApi = (token: string, body: { id: string; url: string; baseUrl?: string; auth?: ConnectorView['auth'] }) =>
  call<ConnectorView>(token, '/connectors/import/openapi', { method: 'POST', body: JSON.stringify(body) });

export const importMcp = (token: string, body: { id: string; transport: 'stdio'; command: string; args: string[] } | { id: string; transport: 'http'; url: string }) =>
  call<ConnectorView>(token, '/connectors/import/mcp', { method: 'POST', body: JSON.stringify(body) });

export const reviewConnector = (token: string, id: string, body: { decisions: Decision[]; guide: string }) =>
  call<ConnectorView>(token, `/connectors/${encodeURIComponent(id)}/review`, { method: 'POST', body: JSON.stringify(body) });

export const refreshConnector = (token: string, id: string) =>
  call<{ added: string[]; changed: string[]; removed: string[] }>(token, `/connectors/${encodeURIComponent(id)}/refresh`, { method: 'POST' });

export const deleteConnector = (token: string, id: string) => call<{ ok: true }>(token, `/connectors/${encodeURIComponent(id)}`, { method: 'DELETE' });
