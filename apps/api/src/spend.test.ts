import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ScriptedProvider, type Completion, type CompletionRequest, type ModelProvider, type OperatorEvent } from '@vex/operator';
import type { FastifyInstance } from 'fastify';
import { buildApp, type AppOptions } from './app.ts';
import { parseHostManifest } from './host.ts';
import { MockPlatform } from './platform/mock.ts';
import { DEFAULT_LIMITS, SpendMeter } from './spend.ts';
import { MemoryStore, SqliteStore } from './storage.ts';

const T0 = Date.parse('2026-10-26T10:00:00.000Z');
const OPUS = 'anthropic:claude-opus-5-5';

type Streamed = OperatorEvent | { type: 'session'; sessionId: string };
function parseSse(body: string): Streamed[] {
  return body
    .split('\n\n')
    .filter((chunk) => chunk.includes('data: '))
    .map((chunk) => JSON.parse(chunk.split('\n').find((l) => l.startsWith('data: '))!.slice(6)) as Streamed);
}

/** A model that answers "ia" and bills `tokens` of input per call. */
class Billing implements ModelProvider {
  readonly name = OPUS;
  calls = 0;
  private readonly tokens: number;
  constructor(tokens: number) {
    this.tokens = tokens;
  }
  async complete(_req: CompletionRequest): Promise<Completion> {
    this.calls += 1;
    return { content: [{ type: 'text', text: 'ia' }], stopReason: 'end_turn', usage: { input: this.tokens, output: 0, cacheRead: 0, cacheWrite: 0 } };
  }
}

describe('the spend meter', () => {
  it('adds up tokens per person and day and dollars per installation and month, in UTC', () => {
    const store = new MemoryStore();
    let now = T0;
    const meter = new SpendMeter(store, { userDayTokens: 1000, monthUsd: 1 }, () => now);
    meter.record({ id: 'ana' }, OPUS, { input: 100_000, output: 10_000, cacheRead: 0, cacheWrite: 0 });
    // 100k input at 4 USD/M + 10k output at 20 USD/M.
    expect(store.spend[0]?.usd).toBeCloseTo(0.6, 6);
    const ana = meter.status({ id: 'ana' });
    expect(ana.userDay.tokens).toBe(110_000);
    expect(ana.month.usd).toBeCloseTo(0.6, 6);
    expect(ana.blocked).toBe('user-day');
    // Yesterday's usage is not today's; last month's is not this month's.
    now = Date.parse('2026-10-27T00:00:00.000Z');
    expect(meter.status({ id: 'ana' }).userDay.tokens).toBe(0);
    expect(meter.status({ id: 'ana' }).month.usd).toBeCloseTo(0.6, 6);
    now = Date.parse('2026-11-01T00:00:00.000Z');
    expect(meter.status({ id: 'ana' }).month.usd).toBe(0);
    // A model the table does not price costs 0 but its tokens count.
    now = T0;
    meter.record({ id: 'ana' }, 'otro:modelo', { input: 5, output: 5, cacheRead: 0, cacheWrite: 0 });
    expect(meter.status({ id: 'ana' }).userDay.tokens).toBe(110_010);
    expect(meter.report().today).toEqual([{ principalId: 'ana', tokens: 110_010, usd: expect.closeTo(0.6, 6), calls: 2 }]);
  });

  it('warns past the ratio, blocks at the cap, and 0 means no cap', () => {
    const store = new MemoryStore();
    const meter = new SpendMeter(store, { userDayTokens: 1000, monthUsd: 0, warnRatio: 0.8 }, () => T0);
    expect(meter.status({ id: 'ana' })).toMatchObject({ blocked: null, warn: null });
    meter.record({ id: 'ana' }, OPUS, { input: 800, output: 0, cacheRead: 0, cacheWrite: 0 });
    expect(meter.status({ id: 'ana' })).toMatchObject({ blocked: null, warn: 'user-day', userDay: { ratio: 0.8 } });
    meter.record({ id: 'ana' }, OPUS, { input: 200, output: 0, cacheRead: 0, cacheWrite: 0 });
    expect(meter.status({ id: 'ana' }).blocked).toBe('user-day');
    expect(meter.status({ id: 'otro' }).blocked).toBeNull();
    expect(new SpendMeter(store, { userDayTokens: 0, monthUsd: 0 }, () => T0).status({ id: 'ana' })).toMatchObject({ blocked: null, warn: null });
    expect(DEFAULT_LIMITS).toEqual({ userDayTokens: 300_000, monthUsd: 50, warnRatio: 0.8 });
  });

  it('survives a restart in SQLite, the pause switch included', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vex-spend-'));
    try {
      const path = join(dir, 'vex.db');
      const first = new SqliteStore(path);
      new SpendMeter(first, {}, () => T0).record({ id: 'ana' }, OPUS, { input: 10, output: 20, cacheRead: 30, cacheWrite: 40 });
      first.setSetting('pause', 'ai');
      first.close();
      const again = new SqliteStore(path);
      expect(again.spendSince('2026-10-26T00:00:00.000Z', 'ana')).toEqual({ tokens: 100, usd: expect.any(Number), calls: 1 });
      expect(again.spendSince('2026-10-27T00:00:00.000Z')).toEqual({ tokens: 0, usd: 0, calls: 0 });
      expect(again.spendByPrincipalSince('2026-10-01T00:00:00.000Z')).toEqual([{ principalId: 'ana', tokens: 100, usd: expect.any(Number), calls: 1 }]);
      expect(again.getSetting('pause')).toBe('ai');
      again.setSetting('pause', null);
      expect(again.getSetting('pause')).toBeNull();
      again.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('caps and the pause switch in Vex Core', () => {
  let app: FastifyInstance | undefined;
  let store: MemoryStore;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function start(extra: Partial<AppOptions> = {}) {
    store = new MemoryStore();
    app = buildApp({ provider: new ScriptedProvider(), platform: new MockPlatform(), store, demoLogin: true, now: () => T0, ...extra });
    await app.ready();
  }
  const login = async (userId: string) => ({ authorization: `Bearer ${((await app!.inject({ method: 'POST', url: '/platform/auth/demo', payload: { userId } })).json() as { token: string }).token}` });
  const chat = async (headers: Record<string, string>, message = 'Hola') => {
    const res = await app!.inject({ method: 'POST', url: '/operator/chat', headers, payload: { message } });
    const events = parseSse(res.body);
    return { status: res.statusCode, events, notices: events.filter((e) => e.type === 'notice').map((e) => (e as { message: string }).message), reply: (events.at(-1) as { reply?: string }).reply };
  };

  it('bills the model to the person, warns at 80 % and sends them to scripted mode at the cap', async () => {
    const model = new Billing(100_000);
    await start({ provider: model, spendLimits: { userDayTokens: 250_000, monthUsd: 0 } });
    const ana = await login('u-ana');
    expect(await chat(ana)).toMatchObject({ status: 200, notices: [], reply: 'ia' });
    expect(await chat(ana)).toMatchObject({ notices: [], reply: 'ia' });
    // 200k of 250k: warned, still the model.
    expect(await chat(ana)).toMatchObject({ notices: ['Aviso: llevas el 80 % de tu uso de IA de hoy.'], reply: 'ia' });
    expect(model.calls).toBe(3);
    // 300k: capped. The scripted planner answers; the model is not asked.
    const capped = await chat(ana);
    expect(capped.notices).toEqual(['Has llegado al tope de uso de IA de hoy: sigo en modo guion (sin modelo) hasta mañana.']);
    expect(capped.reply).not.toBe('ia');
    expect(model.calls).toBe(3);
    // Another person is not affected.
    expect(await chat(await login('u-cesar'))).toMatchObject({ notices: [], reply: 'ia' });
    expect(store.spend.map((r) => r.principalId)).toEqual(['u-ana', 'u-ana', 'u-ana', 'u-cesar']);
  });

  it('caps the whole installation by month', async () => {
    const model = new Billing(100_000); // 0.4 USD per call on Opus input.
    await start({ provider: model, spendLimits: { userDayTokens: 0, monthUsd: 0.5 } });
    const ana = await login('u-ana');
    expect(await chat(ana)).toMatchObject({ notices: [], reply: 'ia' });
    expect(await chat(ana)).toMatchObject({ notices: ['Aviso: la instalación lleva el 80 % de su tope mensual de IA.'], reply: 'ia' });
    const cesar = await login('u-cesar');
    expect((await chat(cesar)).notices).toEqual(['La instalación ha llegado a su tope mensual de IA: sigo en modo guion (sin modelo).']);
    expect(model.calls).toBe(2);
    const report = (await app!.inject({ method: 'GET', url: '/admin/spend', headers: cesar })).json() as { month: { usd: number; calls: number; limit: number }; today: Array<{ principalId: string }>; pause: null };
    expect(report.month).toMatchObject({ calls: 2, limit: 0.5 });
    expect(report.month.usd).toBeCloseTo(0.8, 6);
    expect(report.today.map((t) => t.principalId)).toEqual(['u-ana']);
    expect(report.pause).toBeNull();
    expect((await app!.inject({ method: 'GET', url: '/admin/spend', headers: ana })).statusCode).toBe(403);
  });

  it('a scripted installation is never metered or warned', async () => {
    await start({ spendLimits: { userDayTokens: 1, monthUsd: 0 } });
    const ana = await login('u-ana');
    expect(await chat(ana)).toMatchObject({ status: 200, notices: [] });
    expect(store.spend).toEqual([]);
  });

  it('an administrator pauses the AI (scripted goes on) or all of Vex (503), and resumes', async () => {
    const model = new Billing(10);
    const manifest = parseHostManifest(JSON.stringify({ format: 'vex-host', version: 1, host: { name: 'Demo', domain: 'demo.example' }, features: { quickActions: true }, quickActions: [{ id: 'buscar-laura', label: 'Buscar a Laura', tool: 'buscar', params: { consulta: 'Laura', tipo: 'contactos' } }] }), 'test');
    await start({ provider: model, manifest });
    const ana = await login('u-ana');
    const cesar = await login('u-cesar');
    expect((await app!.inject({ method: 'POST', url: '/admin/pause', headers: ana, payload: { mode: 'ai' } })).statusCode).toBe(403);
    expect((await app!.inject({ method: 'POST', url: '/admin/pause', headers: cesar, payload: { mode: 'ai' } })).json()).toEqual({ pause: 'ai' });
    expect(((await app!.inject({ method: 'GET', url: '/operator/info' })).json() as { pause: string }).pause).toBe('ai');
    const paused = await chat(ana);
    expect(paused.notices).toEqual(['Un administrador ha pausado la IA: sigo en modo guion (sin modelo).']);
    expect(paused.reply).not.toBe('ia');
    expect(model.calls).toBe(0);
    // A tool button asks no model: it still runs.
    expect((await app!.inject({ method: 'POST', url: '/engage/quick-actions/buscar-laura/run', headers: ana, payload: {} })).statusCode).toBe(200);

    expect((await app!.inject({ method: 'POST', url: '/admin/pause', headers: cesar, payload: { mode: 'all' } })).json()).toEqual({ pause: 'all' });
    const stopped = await app!.inject({ method: 'POST', url: '/operator/chat', headers: ana, payload: { message: 'Hola' } });
    expect(stopped.statusCode).toBe(503);
    expect(stopped.json()).toEqual({ error: 'Vex está en pausa por un administrador.' });
    expect((await app!.inject({ method: 'POST', url: '/engage/quick-actions/buscar-laura/run', headers: ana, payload: {} })).statusCode).toBe(503);

    expect((await app!.inject({ method: 'POST', url: '/admin/pause', headers: cesar, payload: { mode: null } })).json()).toEqual({ pause: null });
    expect(await chat(ana)).toMatchObject({ notices: [], reply: 'ia' });
    expect(store.auditEntries.filter((e) => e.tool === 'pausar_vex').map((e) => e.summary)).toEqual(['Pausar la IA (modo guion)', 'Pausar todo Vex', 'Reanudar Vex']);
    expect((await app!.inject({ method: 'POST', url: '/admin/pause', headers: cesar, payload: { mode: 'maybe' } })).statusCode).toBe(400);
  });
});
