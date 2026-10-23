import { describe, expect, it } from 'vitest';
import { planFor, ScriptedProvider } from './providers/scripted.ts';
import type { ChatMessage } from './provider.ts';

const TOOLS = ['buscar', 'crear_expediente', 'crear_tarea', 'redactar_correo', 'enviar_correo'].map((name) => ({ name, description: '', inputSchema: {} }));

describe('planFor', () => {
  it('turns a Spanish request into an ordered plan', () => {
    const plan = planFor('Busca a Laura Pérez, abre expediente de residencia y mándale un correo pidiendo documentación', {});
    expect(plan.map((p) => p.name)).toEqual(['buscar', 'crear_expediente', 'redactar_correo', 'enviar_correo']);
    expect(plan[0]!.input({})).toEqual({ consulta: 'Laura Pérez', tipo: 'contactos' });
    const file = plan[1]!.input({ buscar: { resultados: [{ id: 'c7', email: 'l@x.es' }] } }) as { contactoId: string; tipo: string };
    expect(file.contactoId).toBe('c7');
    expect(file.tipo).toBe('residencia');
  });

  it('uses the screen context instead of searching when a contact is open', () => {
    const plan = planFor('Crea una tarea para extranjería y envíale el presupuesto por correo', { contactoId: 'c1', contactoEmail: 'c1@x.es' });
    expect(plan.map((p) => p.name)).toEqual(['crear_tarea', 'redactar_correo', 'enviar_correo']);
    expect(plan[0]!.input({})).toMatchObject({ equipo: 'extranjeria' });
    expect(plan[1]!.input({})).toMatchObject({ para: 'c1@x.es', proposito: 'enviar presupuesto' });
  });
});

describe('ScriptedProvider', () => {
  it('issues one tool call per round and summarises at the end', async () => {
    const provider = new ScriptedProvider();
    const messages: ChatMessage[] = [{ role: 'user', content: [{ type: 'text', text: 'Busca a Laura' }] }];
    const first = await provider.complete({ system: '', messages, tools: TOOLS });
    expect(first.content[0]).toMatchObject({ type: 'tool_use', name: 'buscar' });
    messages.push({ role: 'assistant', content: first.content });
    messages.push({ role: 'user', content: [{ type: 'tool_result', toolUseId: (first.content[0] as { id: string }).id, content: JSON.stringify({ resultados: [{ id: 'c1', nombre: 'Laura', email: 'laura@x.es' }] }) }] });
    const second = await provider.complete({ system: '', messages, tools: TOOLS });
    expect(second.stopReason).toBe('end_turn');
    expect(second.content[0]).toEqual({ type: 'text', text: 'He encontrado a Laura (laura@x.es).' });
  });

  it('explains itself when nothing matches', async () => {
    const provider = new ScriptedProvider();
    const out = await provider.complete({ system: '', messages: [{ role: 'user', content: [{ type: 'text', text: '¿Qué hora es?' }] }], tools: TOOLS });
    expect(out.stopReason).toBe('end_turn');
    expect((out.content[0] as { text: string }).text).toMatch(/Puedo buscar/);
  });
});
