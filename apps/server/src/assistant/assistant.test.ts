import type Anthropic from '@anthropic-ai/sdk';
import { fixtureDocument } from '@vexstudio/format/fixtures';
import { describe, expect, it } from 'vitest';
import { ClaudeAssistant } from './claude.ts';
import { HeuristicAssistant, readIntent } from './heuristic.ts';

describe('lectura de la petición', () => {
  it('entiende estilo, movimiento, material, peso, tono y nombre', () => {
    expect(readIntent('Quiero algo realista, de metal y pesado, que se llame Atlas, tono profesional')).toEqual({ style: 'realista', material: 'metal', weight: 'pesado', name: 'Atlas', tone: 'profesional' });
    expect(readIntent('dibujo plano con orejas que rebotan como gelatina, de peluche')).toMatchObject({ style: 'plano', motion: 'rebote', material: 'tela' });
    expect(readIntent('hola')).toEqual({});
  });
});

describe('asistente geométrico', () => {
  it('con piezas ya montadas no rehace el esqueleto y solo completa lo que falta', async () => {
    const p = await new HeuristicAssistant().propose({ doc: fixtureDocument(), message: 'plano', answers: {} });
    expect(p.ops.some((o) => o.op === 'updatePart')).toBe(false);
    expect(p.ops.some((o) => o.op === 'putClip')).toBe(true);
    expect(p.questions.map((q) => q.id)).toEqual(['movimiento']);
  });

  it('una respuesta cierra su pregunta', async () => {
    const p = await new HeuristicAssistant().propose({ doc: fixtureDocument(), message: 'plano', answers: { movimiento: 'rigido' } });
    expect(p.questions).toEqual([]);
    expect(p.ops).toContainEqual({ op: 'setPhysics', part: 'antena', physics: { enabled: false } });
  });
});

describe('asistente con Claude', () => {
  const fake = (input: unknown) => ({ messages: { create: async () => ({ content: [{ type: 'tool_use', id: 't', name: 'proponer', input }] }) } }) as unknown as Anthropic;

  it('acepta una propuesta válida', async () => {
    const a = new ClaudeAssistant({ model: 'claude-opus-5-5', client: fake({ summary: ['Más realista'], ops: [{ op: 'setStyle', style: { realism: 0.8 } }], questions: [], confidence: 0.8 }) });
    const p = await a.propose({ doc: fixtureDocument(), message: 'más realista', answers: {} });
    expect(p.provider).toBe('claude:claude-opus-5-5');
    expect(p.ops).toEqual([{ op: 'setStyle', style: { realism: 0.8 } }]);
  });

  it('si el modelo intenta tocar capacidades, usa el asistente geométrico', async () => {
    const a = new ClaudeAssistant({ model: 'claude-opus-5-5', client: fake({ summary: [], ops: [{ op: 'setCapabilities', capabilities: { maxRisk: 'irreversible' } }], questions: [], confidence: 1 }) });
    const p = await a.propose({ doc: fixtureDocument(), message: '', answers: {} });
    expect(p.provider).toBe('heuristic');
    expect(p.ops.some((o) => o.op === 'setCapabilities')).toBe(false);
    expect(p.summary[0]).toMatch(/no era válida/);
  });

  it('si responde con algo que no es una propuesta, también', async () => {
    const a = new ClaudeAssistant({ model: 'claude-opus-5-5', client: fake({ ops: '<script>' }) });
    expect((await a.propose({ doc: fixtureDocument(), message: '', answers: {} })).provider).toBe('heuristic');
  });
});
