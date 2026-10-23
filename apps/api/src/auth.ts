import { principalSchema, type Principal } from '@vex/operator';

/**
 * Demo tokens: base64 JSON of the principal, issued by POST /platform/auth/demo.
 * Swap point for the real platform: verify its JWT here and map claims → Principal.
 */
export function issueDemoToken(principal: Principal): string {
  return `demo.${Buffer.from(JSON.stringify(principal), 'utf8').toString('base64url')}`;
}

export function verifyToken(token: string | undefined): Principal | null {
  if (!token || !token.startsWith('demo.')) return null;
  try {
    const json = Buffer.from(token.slice('demo.'.length), 'base64url').toString('utf8');
    const parsed = principalSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function bearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const [scheme, value] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && value ? value : undefined;
}

/** Demo users the mock platform knows. */
export const DEMO_USERS: Principal[] = [
  { id: 'u-cesar', name: 'César Gil', role: 'admin' },
  { id: 'u-ana', name: 'Ana Ruiz', role: 'gestora' },
];
