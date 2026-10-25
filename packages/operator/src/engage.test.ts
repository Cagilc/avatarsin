import { describe, expect, it } from 'vitest';
import { announcementSchema, applicable, quickActionSchema } from './schema/engage.ts';
import { hostManifestSchema, type HostManifestInput } from './schema/host.ts';
import { DirectProvider } from './providers/direct.ts';

const MINIMAL: HostManifestInput = { format: 'vex-host', version: 1, host: { name: 'Demo', domain: 'demo.example' } };
const NOW = Date.parse('2026-10-25T12:00:00.000Z');

describe('announcements and quick actions', () => {
  it('accepts an announcement with a plain-text body and a call to action', () => {
    const a = announcementSchema.parse({ id: 'citas', title: 'Ya puedo reservar citas', body: 'Pídeme una cita y la reservo.', cta: { kind: 'quickAction', id: 'reservar' } });
    expect(a.source).toBe('manual');
    expect(announcementSchema.safeParse({ id: 'x', title: 'T', body: 'B', cta: { kind: 'link', label: 'Más', url: 'http://inseguro.example' } }).success).toBe(false);
    expect(announcementSchema.safeParse({ id: 'x', title: 'T', body: 'B', since: '2026-10-25T12:00:00.000Z', until: '2026-10-25T11:00:00.000Z' }).success).toBe(false);
    expect(announcementSchema.safeParse({ id: 'x', title: 'T', body: 'B', html: '<b>no</b>' }).success).toBe(false);
  });

  it('a quick action carries a prompt or a tool, never both, and params only with a tool', () => {
    expect(quickActionSchema.safeParse({ id: 'qa-buscar', label: 'Buscar', tool: 'buscar', params: { consulta: 'Laura', tipo: 'contactos' } }).success).toBe(true);
    expect(quickActionSchema.safeParse({ id: 'qa-novedades', label: 'Novedades', prompt: '¿Qué hay de nuevo?' }).success).toBe(true);
    expect(quickActionSchema.safeParse({ id: 'qa-ambos', label: 'Ambos', prompt: 'x', tool: 'buscar' }).success).toBe(false);
    expect(quickActionSchema.safeParse({ id: 'qa-nada', label: 'Nada' }).success).toBe(false);
    expect(quickActionSchema.safeParse({ id: 'qa-params', label: 'Params sueltos', prompt: 'x', params: {} }).success).toBe(false);
    expect(quickActionSchema.safeParse({ id: 'a', label: 'Corto', prompt: 'x' }).success).toBe(false);
  });

  it('filters by role and dates, keeping the order', () => {
    const items = [
      { id: 'todos', roles: undefined },
      { id: 'admins', roles: ['admin'] },
      { id: 'futuro', since: '2026-11-01T00:00:00.000Z' },
      { id: 'caducado', until: '2026-10-01T00:00:00.000Z' },
      { id: 'vigente', since: '2026-10-01T00:00:00.000Z', until: '2026-11-01T00:00:00.000Z' },
    ];
    expect(applicable(items, { role: 'gestora', nowMs: NOW }).map((i) => i.id)).toEqual(['todos', 'vigente']);
    expect(applicable(items, { role: 'admin', nowMs: NOW }).map((i) => i.id)).toEqual(['todos', 'admins', 'vigente']);
  });

  it('enters the host manifest in place of the reserved markers', () => {
    const m = hostManifestSchema.parse({
      ...MINIMAL,
      announcements: [{ id: 'hola', title: 'Hola', body: 'Vex ya opera aquí.' }],
      quickActions: [{ id: 'buscar-laura', label: 'Buscar a Laura', tool: 'buscar', params: { consulta: 'Laura' } }],
    });
    expect(m.announcements).toHaveLength(1);
    expect(m.quickActions[0]?.tool).toBe('buscar');
    expect(hostManifestSchema.parse(MINIMAL).quickActions).toEqual([]);
    expect(hostManifestSchema.safeParse({ ...MINIMAL, quickActions: [{ id: 'dup', label: 'A', prompt: 'a' }, { id: 'dup', label: 'B', prompt: 'b' }] }).success).toBe(false);
    expect(hostManifestSchema.safeParse({ ...MINIMAL, announcements: [{ id: 'x', title: 'T', body: 'B', cta: { kind: 'quickAction', id: 'no-existe' } }] }).success).toBe(false);
  });
});

describe('the direct provider', () => {
  it('asks for exactly the button\'s tool, then reports the result as text', async () => {
    const p = new DirectProvider({ tool: 'buscar', params: { consulta: 'Laura', tipo: 'contactos' }, label: 'Buscar a Laura' });
    const first = await p.complete({ system: '', messages: [{ role: 'user', content: [{ type: 'text', text: 'Botón: Buscar a Laura' }] }], tools: [] });
    expect(first.stopReason).toBe('tool_use');
    expect(first.content[0]).toMatchObject({ type: 'tool_use', name: 'buscar', input: { consulta: 'Laura', tipo: 'contactos' } });
    const id = (first.content[0] as { id: string }).id;
    const deltas: string[] = [];
    const second = await p.complete({ system: '', messages: [{ role: 'user', content: [{ type: 'tool_result', toolUseId: id, content: '{"resultados":[{"id":"c-001"}]}' }] }], tools: [], onTextDelta: (d) => deltas.push(d) });
    expect(second.stopReason).toBe('end_turn');
    expect(second.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('Hecho (Buscar a Laura)') });
    expect(deltas.join('')).toContain('c-001');
    const failed = await p.complete({ system: '', messages: [{ role: 'user', content: [{ type: 'tool_result', toolUseId: id, content: 'ERROR (denied): La política no permite buscar.', isError: true }] }], tools: [] });
    expect(failed.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('No se pudo') });
  });
});
