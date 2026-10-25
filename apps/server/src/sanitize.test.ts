import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { sanitizeUpload, sniff } from './sanitize.ts';

const svg = (body: string, attrs = 'viewBox="0 0 100 100"') => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ${attrs}>${body}</svg>`);
const clean = (input: Buffer) => {
  const r = sanitizeUpload(input);
  if (!r.ok) throw new Error(r.reason);
  return r.bytes.toString('utf8');
};

describe('saneado de SVG', () => {
  it('quita scripts, contenido extranjero, eventos y animaciones', () => {
    const out = clean(svg('<script>alert(1)</script><foreignObject><div/></foreignObject><rect width="10" height="10" onclick="x()" onload="y()"/><animate attributeName="x"/><set to="1"/>'));
    expect(out).not.toMatch(/script|foreignObject|onclick|onload|animate|<set/i);
    expect(out).toContain('<rect');
  });

  it('quita referencias externas y javascript:, conserva las internas', () => {
    const out = clean(svg('<defs><linearGradient id="g"/></defs><use href="https://evil.example/x.svg#a"/><use xlink:href="javascript:alert(1)"/><use href="#g"/><rect fill="url(#g)" style="fill:url(https://evil.example/a);stroke:red"/><image href="https://evil.example/p.png"/>'));
    expect(out).not.toMatch(/evil|javascript/);
    expect(out).toContain('href="#g"');
    expect(out).toContain('fill="url(#g)"');
    expect(out).toContain('stroke:red');
  });

  it('pasa las clases de <style> a estilos en línea y quita el <style>', () => {
    const out = clean(svg('<style>.a{fill:#ff0000} .b,.c{stroke:#00f;behavior:url(x.htc)} @import url(evil.css); svg{fill:blue}</style><path class="a" d="M0 0h10"/><path class="c" d="M0 0h10" style="fill:#000"/>'));
    expect(out).not.toContain('<style');
    expect(out).toContain('fill:#ff0000');
    expect(out).toMatch(/stroke:#00f;fill:#000/);
    expect(out).not.toMatch(/behavior|import/);
  });

  it('rechaza entidades y fija un sistema de coordenadas', () => {
    expect(sanitizeUpload(Buffer.from('<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "xxxxxxxx">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>')).ok).toBe(false);
    const out = clean(svg('<rect width="1" height="1"/>', 'width="64" height="32"'));
    expect(out).toContain('viewBox="0 0 64 32"');
    expect(sanitizeUpload(svg('<rect/>', '')).ok).toBe(false);
  });

  it('rechaza lo que no es SVG, PNG ni JPEG', () => {
    expect(sanitizeUpload(Buffer.from('<html><script>1</script></html>')).ok).toBe(false);
    expect(sanitizeUpload(Buffer.from('GIF89a....')).ok).toBe(false);
    expect(sniff(Buffer.from('%PDF-1.7'))).toBeNull();
  });
});

describe('saneado de imágenes', () => {
  function png(width: number, height: number, extra = Buffer.alloc(0)) {
    const p = new PNG({ width, height });
    p.data.fill(200);
    return Buffer.concat([PNG.sync.write(p), extra]);
  }

  it('vuelve a codificar el PNG sin lo que lleve añadido', () => {
    const input = png(4, 3, Buffer.from('<script>datos escondidos</script>'));
    const r = sanitizeUpload(input);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.type).toBe('image/png');
    expect([r.width, r.height]).toEqual([4, 3]);
    expect(r.bytes.includes(Buffer.from('script'))).toBe(false);
  });

  it('rechaza imágenes que declaran un tamaño enorme', () => {
    const input = png(2, 2);
    input.writeUInt32BE(50_000, 16);
    expect(sanitizeUpload(input).ok).toBe(false);
  });
});
