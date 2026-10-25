import { describe, expect, it } from 'vitest';
import { fixtureDocument, fixturePart, FIXTURE_HASH } from './fixtures.ts';
import { applyOps } from './ops.ts';
import { defaultTargets, presetOps } from './presets.ts';
import { effectiveMaterial, effectivePhysics } from './resolve.ts';
import { STATES } from './schema.ts';
import { canonicalJson, exportPublicKey, generateSigningKeys, importPublicKey, keyIdOf, sha256Hex, signPackage, verifyAsset, verifyPackage } from './sign.ts';
import { parseDocument } from './validate.ts';

describe('documento', () => {
  it('acepta el avatar de ejemplo', () => {
    expect(parseDocument(fixtureDocument()).ok).toBe(true);
  });

  it('rechaza claves desconocidas: el documento solo lleva datos', () => {
    const doc = { ...fixtureDocument(), script: 'alert(1)' };
    expect(parseDocument(doc).ok).toBe(false);
    const part = { ...fixtureDocument().parts[0], onclick: 'x' };
    expect(parseDocument({ ...fixtureDocument(), parts: [part] }).ok).toBe(false);
  });

  it('rechaza referencias rotas y ciclos', () => {
    const broken = fixtureDocument();
    broken.parts[0]!.parent = 'antena';
    const r = parseDocument(broken);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => i.message.includes('ciclo'))).toBe(true);

    const orphan = fixtureDocument();
    orphan.parts[1]!.parent = 'nadie';
    expect(parseDocument(orphan).ok).toBe(false);
  });

  it('rechaza números fuera de límites y textos con caracteres de control', () => {
    const doc = fixtureDocument();
    doc.style.realism = 4;
    expect(parseDocument(doc).ok).toBe(false);
    const clean = fixtureDocument();
    clean.name = 'Mas\u0000cota';
    const r = parseDocument(clean);
    expect(r.ok && r.doc.name).toBe('Mascota');
  });
});

describe('operaciones', () => {
  it('aplica todo o nada', () => {
    const doc = fixtureDocument();
    const r = applyOps(doc, [{ op: 'updatePart', id: 'cabeza', patch: { pivot: { x: 1, y: 2 } } }, { op: 'removePart', id: 'nadie' }], 'user');
    expect(r.ok).toBe(false);
    expect(doc.parts[1]!.pivot).toEqual({ x: 256, y: 225 });
  });

  it('el asistente no cambia lo que fijó una persona', () => {
    const fixed = applyOps(fixtureDocument(), [{ op: 'updatePart', id: 'cabeza', patch: { pivot: { x: 10, y: 10 } } }], 'user');
    expect(fixed.ok).toBe(true);
    if (!fixed.ok) return;
    const ai = applyOps(fixed.doc, [{ op: 'updatePart', id: 'cabeza', patch: { pivot: { x: 20, y: 20 } } }], 'ai');
    expect(ai.ok).toBe(false);
    // …until the person lets it decide again.
    const released = applyOps(fixed.doc, [{ op: 'release', paths: ['part:cabeza:pivot'] }], 'user');
    expect(released.ok).toBe(true);
    if (!released.ok) return;
    expect(applyOps(released.doc, [{ op: 'updatePart', id: 'cabeza', patch: { pivot: { x: 20, y: 20 } } }], 'ai', { confidence: 0.7 }).ok).toBe(true);
  });

  it('las piezas importadas sin fijar las puede ajustar el asistente', () => {
    const imported = applyOps(fixtureDocument(), [{ op: 'addPart', part: fixturePart('ala', { nodes: [[3]] }) }], 'user', { lock: false });
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(applyOps(imported.doc, [{ op: 'updatePart', id: 'ala', patch: { parent: 'cuerpo' } }], 'ai').ok).toBe(true);
  });

  it('el asistente no puede tocar capacidades', () => {
    const r = applyOps(fixtureDocument(), [{ op: 'setCapabilities', capabilities: { tools: ['enviar_correo'], maxRisk: 'irreversible' } }], 'ai');
    expect(r.ok).toBe(false);
  });

  it('quitar una pieza recoloca a sus hijas y limpia sus pistas', () => {
    const withClips = applyOps(fixtureDocument(), presetOps(fixtureDocument(), STATES), 'ai');
    expect(withClips.ok).toBe(true);
    if (!withClips.ok) return;
    const r = applyOps(withClips.doc, [{ op: 'removePart', id: 'cabeza' }], 'user');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.parts.find((p) => p.id === 'antena')!.parent).toBe('cuerpo');
    expect(r.doc.clips.every((c) => c.tracks.every((t) => t.part !== 'cabeza'))).toBe(true);
  });

  it('rechaza operaciones inventadas', () => {
    expect(applyOps(fixtureDocument(), [{ op: 'runScript', code: 'x' }], 'ai').ok).toBe(false);
  });
});

describe('estilo y animaciones de partida', () => {
  it('el control de realismo mueve los valores por defecto, y lo fijado se respeta', () => {
    const cartoon = fixtureDocument();
    cartoon.style.realism = 0;
    const real = fixtureDocument();
    real.style.realism = 1;
    const antena = (d: typeof cartoon) => d.parts[2]!;
    expect(effectivePhysics(antena(cartoon), cartoon).damping).toBeLessThan(effectivePhysics(antena(real), real).damping);
    expect(effectiveMaterial(antena(cartoon), cartoon).finish).toBe('flat');
    expect(effectiveMaterial(antena(real), real).shadow).toBeGreaterThan(0);
    antena(real).physics = { enabled: true, damping: 0.05 };
    expect(effectivePhysics(antena(real), real).damping).toBe(0.05);
  });

  it('crea una animación válida para cada estado', () => {
    const doc = fixtureDocument();
    expect(defaultTargets(doc)).toEqual({ root: 'cuerpo', head: 'cabeza' });
    const r = applyOps(doc, presetOps(doc, STATES), 'ai');
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.doc.states).sort()).toEqual([...STATES].sort());
  });
});

describe('paquetes firmados', () => {
  async function published() {
    const keys = await generateSigningKeys();
    const raw = await exportPublicKey(keys.publicKey);
    const pkg = await signPackage(
      { format: 'vex-avatar-package', packageVersion: 1, avatarId: 'mascota', revision: 1, publishedAt: '2026-10-25T00:00:00.000Z', document: fixtureDocument(), assets: [{ hash: FIXTURE_HASH, type: 'image/svg+xml', size: 10 }] },
      keys.privateKey,
      raw,
    );
    return { pkg, publicKey: await importPublicKey(raw), keyId: await keyIdOf(raw) };
  }

  it('canonicalJson ordena claves', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
  });

  it('verifica un paquete intacto', async () => {
    const { pkg, publicKey, keyId } = await published();
    const r = await verifyPackage(JSON.parse(JSON.stringify(pkg)), publicKey, keyId);
    expect(r.ok).toBe(true);
  });

  it('rechaza un paquete modificado', async () => {
    const { pkg, publicKey, keyId } = await published();
    const tampered = structuredClone(pkg) as typeof pkg & { document: ReturnType<typeof fixtureDocument> };
    tampered.document.capabilities.maxRisk = 'irreversible';
    const r = await verifyPackage(tampered, publicKey, keyId);
    expect(r.ok).toBe(false);
  });

  it('rechaza un paquete firmado con otra clave', async () => {
    const { pkg } = await published();
    const other = await generateSigningKeys();
    const raw = await exportPublicKey(other.publicKey);
    expect((await verifyPackage(pkg, await importPublicKey(raw), await keyIdOf(raw))).ok).toBe(false);
  });

  it('comprueba la huella de cada recurso', async () => {
    const bytes = new TextEncoder().encode('<svg></svg>');
    const hash = await sha256Hex(bytes);
    expect(await verifyAsset(bytes, { hash, type: 'image/svg+xml', size: bytes.length })).toBe(true);
    expect(await verifyAsset(new TextEncoder().encode('<svg/>  </svg>'), { hash, type: 'image/svg+xml', size: bytes.length })).toBe(false);
  });
});
