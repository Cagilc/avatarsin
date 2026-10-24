import { fingerprintOf, toolNameFor, type ConnectorManifest, type ConnectorSource, type ConnectorTool } from '../manifest.ts';
import { suggestMcpRisk } from '../risk.ts';
import type { McpServerInfo, McpToolInfo } from './client.ts';

export interface McpImportOptions {
  id: string;
  name?: string;
  source: Extract<ConnectorSource, { kind: 'mcp-stdio' | 'mcp-http' }>;
  server: McpServerInfo;
  now?: () => Date;
}

const MAX_DESCRIPTION = 900;

/** Turns the server's tool list into a connector draft: suggested risks, nothing enabled. */
export function importMcp(tools: McpToolInfo[], opts: McpImportOptions): ConnectorManifest {
  if (tools.length === 0) throw new Error('El servidor MCP no ofrece herramientas.');
  const taken = new Set<string>();
  const converted: ConnectorTool[] = tools.map((t) => {
    const description = [t.title && t.title !== t.name ? t.title : '', t.description ?? ''].filter(Boolean).join('. ').slice(0, MAX_DESCRIPTION) || t.name;
    const inputSchema = t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : { type: 'object', properties: {} };
    const binding = { kind: 'mcp' as const, tool: t.name };
    const suggestion = suggestMcpRisk(t.name, t.description, t.annotations);
    return {
      name: toolNameFor(opts.id, t.name, taken),
      description,
      inputSchema,
      binding,
      suggestedRisk: suggestion.risk,
      riskReason: suggestion.reason,
      risk: null,
      enabled: false,
      review: null,
      fingerprint: fingerprintOf({ binding, inputSchema, description }),
    };
  });
  const now = (opts.now ?? (() => new Date()))().toISOString();
  return {
    id: opts.id,
    name: opts.name ?? opts.server.title ?? opts.server.name,
    description: `Servidor MCP ${opts.server.name}${opts.server.version ? ` ${opts.server.version}` : ''}.`,
    source: opts.source,
    auth: { kind: 'none' },
    guide: '',
    tools: converted,
    importedAt: now,
    updatedAt: now,
  };
}
