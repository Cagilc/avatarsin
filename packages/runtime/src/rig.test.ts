import { fixtureDocument } from '@vexstudio/format/fixtures';
import { describe, expect, it } from 'vitest';
import { apply, invert, multiply, rotate, translate } from './math.ts';
import { Rig, topoOrder } from './rig.ts';
import { blend, sampleClip, sampleTrack, type Sample } from './timeline.ts';

describe('matrices', () => {
  it('rotate gira en sentido horario en pantalla y invert deshace', () => {
    const p = apply(rotate(90), 1, 0);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(1);
    const m = multiply(translate(10, 5), rotate(30));
    const back = apply(multiply(invert(m), m), 3, 4);
    expect(back.x).toBeCloseTo(3);
    expect(back.y).toBeCloseTo(4);
  });
});

describe('línea de tiempo', () => {
  const track = { part: 'a', prop: 'y' as const, keys: [{ t: 0, v: 0, ease: 'linear' as const }, { t: 0.5, v: 10, ease: 'step' as const }, { t: 1, v: 20, ease: 'linear' as const }] };

  it('interpola con la curva de la clave de salida', () => {
    expect(sampleTrack(track, 0.25)).toBeCloseTo(5);
    expect(sampleTrack(track, 0.75)).toBe(10);
    expect(sampleTrack(track, 1)).toBe(20);
  });

  it('repite en bucle y funde estados', () => {
    const clip = { id: 'c', name: 'c', duration: 2, loop: true, tracks: [track] };
    expect(sampleClip(clip, 2.5).get('a')!.y).toBeCloseTo(5);
    const a: Sample = new Map([['a', { rotate: 0, x: 0, y: 0, scaleX: 1, scaleY: 1, opacity: 1 }]]);
    const b: Sample = new Map([['a', { rotate: 10, x: 0, y: 0, scaleX: 1, scaleY: 1, opacity: 1 }]]);
    expect(blend(a, b, 0.5).get('a')!.rotate).toBe(5);
  });
});

describe('esqueleto y física', () => {
  it('ordena padres antes que hijas', () => {
    const doc = fixtureDocument();
    doc.parts.reverse();
    expect(topoOrder(doc.parts).map((p) => p.id)).toEqual(['cuerpo', 'cabeza', 'antena']);
  });

  it('las hijas heredan el movimiento del padre', () => {
    const rig = new Rig(fixtureDocument());
    const pose = rig.frame(new Map([['cuerpo', { rotate: 0, x: 0, y: -20, scaleX: 1, scaleY: 1, opacity: 1 }]]), 0, false);
    expect(pose.get('antena')!.world.f).toBeCloseTo(-20);
  });

  it('la antena se queda atrás al acelerar el cuerpo y vuelve a su sitio', () => {
    const doc = fixtureDocument();
    doc.world.gravity.strength = 0;
    const rig = new Rig(doc);
    const at = (x: number): Sample => new Map([['cuerpo', { rotate: 0, x, y: 0, scaleX: 1, scaleY: 1, opacity: 1 }]]);
    rig.frame(at(0), 1 / 60);
    // The body jumps right: the antenna's tip lags, i.e. tilts left (counter-clockwise, negative).
    rig.frame(at(0), 1 / 60);
    rig.frame(at(30), 1 / 60);
    expect(rig.springAngle('antena')).toBeLessThan(-1);
    for (let i = 0; i < 600; i++) rig.frame(at(30), 1 / 60);
    expect(Math.abs(rig.springAngle('antena'))).toBeLessThan(0.05);
  });

  it('un salto en vertical también hace rebotar una antena recta', () => {
    const doc = fixtureDocument();
    doc.world.gravity.strength = 0;
    const rig = new Rig(doc);
    const at = (y: number): Sample => new Map([['cuerpo', { rotate: 0, x: 0, y, scaleX: 1, scaleY: 1, opacity: 1 }]]);
    let peak = 0;
    const path = [0, 0, -10, -25, -35, -38, -35, -25, -10, 0, 0, 0, 0, 0, 0];
    for (const y of path) {
      rig.frame(at(y), 1 / 60);
      peak = Math.max(peak, Math.abs(rig.springAngle('antena')));
    }
    expect(peak).toBeGreaterThan(1);
  });

  it('el estilo de dibujo rebota más que el realista', () => {
    const swing = (realism: number) => {
      const doc = fixtureDocument();
      doc.world.gravity.strength = 0;
      doc.style.realism = realism;
      const rig = new Rig(doc);
      const at = (x: number): Sample => new Map([['cuerpo', { rotate: 0, x, y: 0, scaleX: 1, scaleY: 1, opacity: 1 }]]);
      rig.frame(at(0), 1 / 60);
      rig.frame(at(0), 1 / 60);
      rig.frame(at(30), 1 / 60);
      let crossings = 0;
      let prev = rig.springAngle('antena');
      for (let i = 0; i < 180; i++) {
        rig.frame(at(30), 1 / 60);
        const now = rig.springAngle('antena');
        if (Math.sign(now) !== Math.sign(prev) && Math.abs(now) > 0.05) crossings++;
        prev = now;
      }
      return crossings;
    };
    expect(swing(0)).toBeGreaterThan(swing(1));
  });

  it('es determinista', () => {
    const run = () => {
      const rig = new Rig(fixtureDocument());
      for (let i = 0; i < 120; i++) rig.frame(new Map([['cuerpo', { rotate: Math.sin(i / 10) * 10, x: 0, y: 0, scaleX: 1, scaleY: 1, opacity: 1 }]]), 1 / 60);
      return rig.springAngle('antena');
    };
    expect(run()).toBe(run());
  });
});
