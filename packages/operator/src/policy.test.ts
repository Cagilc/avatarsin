import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, decide, permissionPolicySchema } from './schema/policy.ts';

const read = { name: 'buscar', driver: 'platform', risk: 'read' } as const;
const send = { name: 'enviar_correo', driver: 'platform', risk: 'irreversible' } as const;
const dom = { name: 'click', driver: 'dom', risk: 'write' } as const;

describe('decide', () => {
  it('allows reads on the platform driver and confirms the irreversible by default', () => {
    expect(decide(DEFAULT_POLICY, read)).toBe('allow');
    expect(decide(DEFAULT_POLICY, send)).toBe('confirm');
  });

  it('denies drivers that are not allowed', () => {
    expect(decide(DEFAULT_POLICY, dom)).toBe('deny');
  });

  it('lets deny win over allow, by tool name or driver wildcard', () => {
    expect(decide({ allow: ['*'], deny: ['enviar_correo'], confirm: [] }, send)).toBe('deny');
    expect(decide({ allow: ['*'], deny: ['dom:*'], confirm: [] }, dom)).toBe('deny');
    expect(decide({ allow: ['*'], deny: [], confirm: [] }, send)).toBe('allow');
  });

  it('can require confirmation for writes too', () => {
    expect(decide({ allow: ['platform:*', 'dom:*'], deny: [], confirm: ['write', 'irreversible'] }, dom)).toBe('confirm');
  });

  it('validates the policy shape', () => {
    expect(permissionPolicySchema.safeParse({ allow: ['*'], deny: [], confirm: ['nope'] }).success).toBe(false);
    expect(permissionPolicySchema.safeParse(DEFAULT_POLICY).success).toBe(true);
  });
});
