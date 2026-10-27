import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ScriptedProvider } from '@vex/operator';
import { createHostDemoApp, verifyVexSignature } from '@vex/sample-tools';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import { loadHostManifest } from './host.ts';
import { MockPlatform } from './platform/mock.ts';
import { MemoryStore } from './storage.ts';

// The guided-demo package end to end: the preset loads, and the sample host verifies the signed
// reset exactly as a client's web would (the helper it copies is the one under test).

describe('the guided-demo package', () => {
  const open: FastifyInstance[] = [];
  afterEach(async () => {
    await Promise.all(open.splice(0).map((a) => a.close()));
  });

  it('verifyVexSignature accepts the signature Vex Core produces and nothing else', () => {
    const body = '{"type":"presenter_reset"}';
    const good = `sha256=${createHmac('sha256', 'clave').update(body).digest('hex')}`;
    expect(verifyVexSignature('clave', body, good)).toBe(true);
    expect(verifyVexSignature('otra', body, good)).toBe(false);
    expect(verifyVexSignature('clave', `${body} `, good)).toBe(false);
    expect(verifyVexSignature('clave', body, good.replace('sha256=', 'md5='))).toBe(false);
    expect(verifyVexSignature('clave', body, undefined)).toBe(false);
    expect(verifyVexSignature('clave', body, 'sha256=corta')).toBe(false);
  });

  it('the preset is a complete, valid manifest: tour on first visit, buttons, a five-scene script and the reset hook', () => {
    const m = loadHostManifest('demo-guiada');
    expect(m.features).toMatchObject({ tours: true, announcements: true, quickActions: true, presenter: true });
    expect(m.tours.map((t) => `${t.id}:${t.when}:${t.steps.length}`)).toEqual(['primera-vez:first:3']);
    expect(m.scripts[0]).toMatchObject({ id: 'demo-cliente', scenes: expect.any(Array) });
    expect(m.scripts[0]!.scenes).toHaveLength(5);
    expect(m.scripts[0]!.scenes.filter((s) => s.action).map((s) => s.action)).toEqual(['buscar-laura', 'abrir-expediente']);
    expect(m.presenter?.reset).toEqual({ url: 'http://127.0.0.1:8793/vex/reset', secretEnv: 'DEMO_RESET_SECRET' });
  });

  it('the sample host wipes its board only for a reset Vex Core signed with the shared secret', async () => {
    const host = createHostDemoApp({ vexCore: 'http://127.0.0.1:8787', resetSecret: 'secreto-de-la-demo' });
    open.push(host);
    await host.listen({ port: 0, host: '127.0.0.1' });
    const hostUrl = `http://127.0.0.1:${(host.server.address() as AddressInfo).port}`;
    await host.inject({ method: 'POST', url: '/pizarra', payload: { texto: 'Encargo terminado' } });
    expect(host.estado().pizarra).toEqual(['Encargo terminado']);

    const preset = loadHostManifest('demo-guiada');
    const manifest = { ...preset, presenter: { reset: { url: `${hostUrl}/vex/reset`, secretEnv: 'DEMO_RESET_SECRET' } } };
    const vex = (secret: string) => {
      const app = buildApp({ provider: new ScriptedProvider(), platform: new MockPlatform(), store: new MemoryStore(), manifest, demoLogin: true, connectors: { env: { DEMO_RESET_SECRET: secret }, mcpAllow: [], urlPolicy: { allowHttp: true, allowInternal: true } } });
      open.push(app);
      return app;
    };
    const admin = async (app: FastifyInstance) => ({ authorization: `Bearer ${((await app.inject({ method: 'POST', url: '/platform/auth/demo', payload: { userId: 'u-cesar' } })).json() as { token: string }).token}` });

    const right = vex('secreto-de-la-demo');
    await right.ready();
    const ok = await right.inject({ method: 'POST', url: '/engage/presenter/reset', headers: await admin(right) });
    expect(ok.json()).toEqual({ ok: true, status: 200 });
    expect(host.estado()).toEqual({ pizarra: [], reinicios: 1 });

    // A Vex Core with the wrong secret: the host refuses (401), Vex reports it (502), nothing is wiped.
    await host.inject({ method: 'POST', url: '/pizarra', payload: { texto: 'Otra cosa' } });
    const wrong = vex('otro-secreto');
    await wrong.ready();
    const refused = await wrong.inject({ method: 'POST', url: '/engage/presenter/reset', headers: await admin(wrong) });
    expect(refused.statusCode).toBe(502);
    expect(refused.json()).toMatchObject({ ok: false, status: 401 });
    expect(host.estado()).toEqual({ pizarra: ['Otra cosa'], reinicios: 1 });

    // Not a reset at all: the host does not even look at the signature.
    expect((await host.inject({ method: 'POST', url: '/vex/reset', headers: { 'content-type': 'application/json' }, payload: '{}' })).statusCode).toBe(400);
  });
});
