import type { Risk } from '@vex/operator';
import type { ConnectorManifest, ConnectorTool } from './manifest.ts';
import { lowerThan } from './risk.ts';

export interface ToolDecision {
  name: string;
  /** The risk the person approves. */
  risk: Risk;
  enabled: boolean;
  /** Mandatory when `risk` is lower than the suggested one. */
  lowerRiskReason?: string;
}

export class ReviewError extends Error {}

/**
 * Applies a person's decisions. Rules: a tool is enabled only after a review; choosing a lower
 * risk than suggested needs a written reason; every decision records who and when.
 */
export function reviewConnector(manifest: ConnectorManifest, decisions: ToolDecision[], reviewer: string, now: Date = new Date()): ConnectorManifest {
  const byName = new Map(manifest.tools.map((t) => [t.name, t]));
  for (const d of decisions) {
    const tool = byName.get(d.name);
    if (!tool) throw new ReviewError(`El conector ${manifest.id} no tiene la herramienta ${d.name}.`);
    if (lowerThan(d.risk, tool.suggestedRisk) && !d.lowerRiskReason?.trim()) {
      throw new ReviewError(`${d.name}: has elegido "${d.risk}" por debajo de lo sugerido ("${tool.suggestedRisk}"); explica por qué.`);
    }
  }
  const at = now.toISOString();
  const decided = new Map(decisions.map((d) => [d.name, d]));
  const tools = manifest.tools.map((t): ConnectorTool => {
    const d = decided.get(t.name);
    if (!d) return t;
    const lower = lowerThan(d.risk, t.suggestedRisk) ? { lowerRiskReason: d.lowerRiskReason!.trim() } : {};
    return { ...t, risk: d.risk, enabled: d.enabled, review: { by: reviewer, at, ...lower } };
  });
  return { ...manifest, tools, updatedAt: at };
}

export interface RefreshReport {
  manifest: ConnectorManifest;
  added: string[];
  removed: string[];
  /** Tools whose contract changed: their review was cleared and they were disabled. */
  changed: string[];
}

/**
 * Merges a fresh import into the stored connector. Unchanged tools keep their review; changed
 * ones lose it (and are disabled) because what was approved is no longer what will run.
 */
export function refreshConnector(stored: ConnectorManifest, fresh: ConnectorManifest, now: Date = new Date()): RefreshReport {
  const old = new Map(stored.tools.map((t) => [t.name, t]));
  const added: string[] = [];
  const changed: string[] = [];
  const tools = fresh.tools.map((t): ConnectorTool => {
    const prev = old.get(t.name);
    if (!prev) {
      added.push(t.name);
      return t;
    }
    if (prev.fingerprint !== t.fingerprint) {
      changed.push(t.name);
      return t;
    }
    return { ...t, risk: prev.risk, enabled: prev.enabled, review: prev.review };
  });
  const fresher = new Set(fresh.tools.map((t) => t.name));
  const removed = stored.tools.filter((t) => !fresher.has(t.name)).map((t) => t.name);
  return {
    manifest: { ...fresh, id: stored.id, name: stored.name, guide: stored.guide, auth: stored.auth, baseUrl: fresh.baseUrl ?? stored.baseUrl, importedAt: stored.importedAt, updatedAt: now.toISOString(), tools },
    added,
    removed,
    changed,
  };
}

/** Tools the operator may use: reviewed and switched on. */
export function liveTools(manifest: ConnectorManifest): Array<ConnectorTool & { risk: Risk }> {
  return manifest.tools.filter((t): t is ConnectorTool & { risk: Risk } => t.enabled && t.risk !== null && t.review !== null);
}
