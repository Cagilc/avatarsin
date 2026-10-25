import { describe, expect, it } from 'vitest';
import { NO_GRANT, grantExpired, grantMatchesHost, grantSchema, hostManifestSchema, permittedTools, signedGrantSchema, type HostManifestInput } from './schema/host.ts';
import { DEFAULT_POLICY, decide } from './schema/policy.ts';

const MINIMAL: HostManifestInput = { format: 'vex-host', version: 1, host: { name: 'Demo Negocio', domain: 'demo-negocio.example' } };

describe('host manifest', () => {
  it('fills the defaults: no connectors, empty screen context, every feature off', () => {
    const m = hostManifestSchema.parse(MINIMAL);
    expect(m.connectors).toEqual([]);
    expect(m.screenContext).toEqual({});
    expect(m.features).toEqual({ tours: false, announcements: false, quickActions: false, domDriver: false });
    expect(m.policy).toBeUndefined();
    expect(m.avatar).toBeUndefined();
  });

  it('rejects unknown keys and says where', () => {
    const r = hostManifestSchema.safeParse({ ...MINIMAL, host: { ...MINIMAL.host, theme: {} } });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map((i) => i.path.join('.'))).toContain('host');
    const top = hostManifestSchema.safeParse({ ...MINIMAL, personality: { name: 'Otro' } });
    expect(top.success).toBe(false);
  });

  it('accepts proposed connectors with their source and the name of their secret, never the secret', () => {
    const m = hostManifestSchema.parse({
      ...MINIMAL,
      connectors: [
        { id: 'citas', source: { kind: 'openapi', url: 'https://citas.example/openapi.json' }, auth: { kind: 'bearer', env: 'CITAS_TOKEN' } },
        { id: 'notas', source: { kind: 'mcp-stdio', command: 'node', args: ['notas.ts'] } },
      ],
    });
    expect(m.connectors.map((c) => c.id)).toEqual(['citas', 'notas']);
    expect(hostManifestSchema.safeParse({ ...MINIMAL, connectors: [{ id: 'citas', source: { kind: 'openapi', url: 'https://x/openapi.json' }, auth: { kind: 'bearer', token: 'abc' } }] }).success).toBe(false);
    expect(hostManifestSchema.safeParse({ ...MINIMAL, connectors: [{ id: 'citas', source: { kind: 'openapi', url: 'https://x/a.json' } }, { id: 'citas', source: { kind: 'mcp-http', url: 'https://y' } }] }).success).toBe(false);
  });

  it('keeps tours, announcements and quick actions reserved until their workflow exists', () => {
    expect(hostManifestSchema.parse({ ...MINIMAL, tours: [] }).tours).toEqual([]);
    const r = hostManifestSchema.safeParse({ ...MINIMAL, tours: [{ id: 'bienvenida' }] });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toMatch(/paso posterior/);
  });

  it('validates the domain and the avatar reference', () => {
    expect(hostManifestSchema.safeParse({ ...MINIMAL, host: { name: 'X', domain: 'https://demo.example' } }).success).toBe(false);
    expect(hostManifestSchema.safeParse({ ...MINIMAL, host: { name: 'X', domain: 'localhost' } }).success).toBe(true);
    const avatar = { endpoint: 'https://estudio.example/v1/embed/vk_abcdefghijklmnopqrstuvwx', publicKey: 'A'.repeat(43), keyId: 'abcdef0123456789' };
    expect(hostManifestSchema.safeParse({ ...MINIMAL, avatar }).success).toBe(true);
    expect(hostManifestSchema.safeParse({ ...MINIMAL, avatar: { ...avatar, publicKey: 'corta' } }).success).toBe(false);
  });
});

describe('the one permission rule: approved ∩ policy ∩ grant', () => {
  const buscar = { name: 'buscar', driver: 'platform', risk: 'read' } as const;
  const enviar = { name: 'enviar_correo', driver: 'platform', risk: 'irreversible' } as const;
  const reservar = { name: 'citas_reservar', driver: 'api', risk: 'write' } as const;
  const approved = [buscar, enviar, reservar];
  const policy = { allow: ['platform:*', 'api:*'], deny: [], confirm: ['irreversible' as const] };
  const grant = { tools: ['buscar', 'enviar_correo', 'citas_reservar', 'crear_tarea'], maxRisk: 'write' as const };

  it('without a grant, the policy alone decides', () => {
    expect(permittedTools(approved, policy).map((t) => t.name)).toEqual(['buscar', 'enviar_correo', 'citas_reservar']);
    expect(permittedTools(approved, DEFAULT_POLICY).map((t) => t.name)).toEqual(['buscar', 'enviar_correo']);
  });

  it('the grant removes tools above its risk ceiling and never adds one nobody approved', () => {
    const names = permittedTools(approved, policy, grant).map((t) => t.name);
    expect(names).toEqual(['buscar', 'citas_reservar']);
    expect(names).not.toContain('crear_tarea');
  });

  it('a tool outside the grant is out even if the policy allows it', () => {
    expect(permittedTools(approved, policy, { tools: ['buscar'], maxRisk: 'irreversible' }).map((t) => t.name)).toEqual(['buscar']);
  });

  it('a tool the policy denies is out even if the grant lists it', () => {
    expect(permittedTools(approved, { ...policy, deny: ['citas_reservar'] }, grant).map((t) => t.name)).toEqual(['buscar']);
    expect(permittedTools(approved, { ...policy, deny: ['api:*'] }, grant).map((t) => t.name)).toEqual(['buscar']);
  });

  it('a host with an avatar and no valid grant runs nothing', () => {
    expect(permittedTools(approved, policy, NO_GRANT)).toEqual([]);
  });

  it('keeps the confirmation step for what survives', () => {
    const kept = permittedTools(approved, policy, { tools: ['enviar_correo'], maxRisk: 'irreversible' });
    expect(kept).toEqual([enviar]);
    expect(decide(policy, enviar)).toBe('confirm');
  });
});

describe('grant checks', () => {
  const grant = grantSchema.parse({
    integration: 'vk_1',
    avatarId: 'av_1',
    revision: 3,
    origins: ['https://demo-negocio.example', 'http://localhost:5174'],
    tools: ['buscar'],
    maxRisk: 'read',
    issuedAt: '2026-10-25T10:00:00.000Z',
    expiresAt: '2026-10-25T10:10:00.000Z',
  });

  it('expires at the instant the studio set', () => {
    expect(grantExpired(grant, Date.parse('2026-10-25T10:09:59.000Z'))).toBe(false);
    expect(grantExpired(grant, Date.parse('2026-10-25T10:10:00.000Z'))).toBe(true);
  });

  it('belongs to a host only when one of its origins is on that domain', () => {
    expect(grantMatchesHost(grant, 'demo-negocio.example')).toBe(true);
    expect(grantMatchesHost(grant, 'DEMO-NEGOCIO.example')).toBe(true);
    expect(grantMatchesHost(grant, 'localhost')).toBe(true);
    expect(grantMatchesHost(grant, 'otro.example')).toBe(false);
    expect(grantMatchesHost({ origins: ['no es un origen'] }, 'demo-negocio.example')).toBe(false);
  });

  it('requires an expiry and refuses extra fields in the payload; the envelope keeps the payload opaque', () => {
    expect(grantSchema.safeParse({ ...grant, expiresAt: undefined }).success).toBe(false);
    expect(grantSchema.safeParse({ ...grant, extra: 1 }).success).toBe(false);
    expect(signedGrantSchema.safeParse({ grant: { anything: true }, signature: 'x'.repeat(64), keyId: 'abcdef0123456789' }).success).toBe(true);
  });
});
