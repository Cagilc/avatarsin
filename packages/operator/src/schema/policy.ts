import { z } from 'zod';
import { riskSchema, type Driver, type Risk } from './action.ts';

/**
 * Capability-based permissions. Nothing is allowed unless listed in `allow`.
 * Patterns: a tool name ("crear_expediente"), a driver wildcard ("platform:*") or "*".
 */
export const permissionPolicySchema = z.object({
  allow: z.array(z.string().min(1)),
  deny: z.array(z.string().min(1)),
  /** Risk levels that pause the loop until the user confirms. */
  confirm: z.array(riskSchema),
});
export type PermissionPolicy = z.infer<typeof permissionPolicySchema>;

export type PolicyDecision = 'allow' | 'confirm' | 'deny';

function matches(pattern: string, tool: string, driver: Driver): boolean {
  if (pattern === '*') return true;
  if (pattern.endsWith(':*')) return pattern.slice(0, -2) === driver;
  return pattern === tool;
}

/** `deny` wins over `allow`; anything not allowed is denied; confirmation depends on risk. */
export function decide(policy: PermissionPolicy, tool: { name: string; driver: Driver; risk: Risk }): PolicyDecision {
  if (policy.deny.some((p) => matches(p, tool.name, tool.driver))) return 'deny';
  if (!policy.allow.some((p) => matches(p, tool.name, tool.driver))) return 'deny';
  return policy.confirm.includes(tool.risk) ? 'confirm' : 'allow';
}

/** Sensible default: everything on the platform driver, confirm the irreversible. */
export const DEFAULT_POLICY: PermissionPolicy = {
  allow: ['platform:*'],
  deny: [],
  confirm: ['irreversible'],
};
