import { beforeEach, describe, expect, it } from 'vitest';
import { ElementRegistry, isPrivate, isSecretField } from './registry.ts';

/** A field whose value cannot be read without the test noticing. */
function trap(el: HTMLInputElement | HTMLTextAreaElement): void {
  Object.defineProperty(el, 'value', {
    get() {
      throw new Error(`leído el valor de ${el.getAttribute('data-vex-id') ?? el.id}`);
    },
  });
  Object.defineProperty(el, 'textContent', {
    get() {
      throw new Error('leído el texto de un campo privado');
    },
  });
}

describe('the element registry', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <h1 data-vex-id="titulo">Expediente EXP-2026-041</h1>
      <label for="buscador">Buscar cliente</label>
      <input id="buscador" data-vex-id="buscador" value="Laura" />
      <button data-vex-id="guardar" data-vex-risk="write">Guardar cambios</button>
      <a data-vex-id="ayuda" href="/ayuda" aria-label="Centro de ayuda">?</a>
      <select data-vex-id="equipo"><option>ventas</option><option selected>marketing</option></select>
      <input type="checkbox" data-vex-id="urgente" checked />
      <p data-vex-id="notas" class="muted">  Notas   del   cliente  </p>
      <p id="sin-registrar">Nadie me lee</p>
      <form data-vex-private>
        <input data-vex-id="tarjeta" value="4111 1111 1111 1111" />
        <button data-vex-id="pagar">Pagar</button>
      </form>
      <input type="password" data-vex-id="clave" value="s3cr3t" />
      <input type="text" autocomplete="cc-number" data-vex-id="cc" value="4242" />
      <input type="text" autocomplete="one-time-code" data-vex-id="otp" value="123456" />
      <input type="hidden" data-vex-id="csrf" value="token" />
      <div data-vex-id="demasiado-largo">${'x'.repeat(500)}</div>
    `;
  });

  it('describes registered elements: role, label and value, nothing else on the page', () => {
    const snap = new ElementRegistry().snapshot();
    const byId = Object.fromEntries(snap.map((s) => [s.id, s]));
    expect(byId['titulo']).toEqual({ id: 'titulo', role: 'heading', label: 'Expediente EXP-2026-041' });
    expect(byId['buscador']).toEqual({ id: 'buscador', role: 'textbox', label: 'Buscar cliente', value: 'Laura' });
    expect(byId['guardar']).toEqual({ id: 'guardar', role: 'button', label: 'Guardar cambios', risk: 'write' });
    expect(byId['ayuda']).toEqual({ id: 'ayuda', role: 'link', label: 'Centro de ayuda' });
    expect(byId['equipo']).toEqual({ id: 'equipo', role: 'combobox', label: '', value: 'marketing' });
    expect(byId['urgente']).toEqual({ id: 'urgente', role: 'checkbox', label: '', value: 'on' });
    expect(byId['notas']).toEqual({ id: 'notas', role: 'region', label: '', text: 'Notas del cliente' });
    expect(byId['demasiado-largo']?.text).toHaveLength(200);
    expect(snap.some((s) => s.label.includes('Nadie me lee') || s.text?.includes('Nadie me lee'))).toBe(false);
  });

  it('never reads private fields: not their value, not their text, not even their id', () => {
    for (const id of ['tarjeta', 'clave', 'cc', 'otp', 'csrf']) trap(document.querySelector(`[data-vex-id="${id}"]`)!);
    const snap = new ElementRegistry().snapshot();
    const ids = snap.map((s) => s.id);
    for (const id of ['tarjeta', 'pagar', 'clave', 'cc', 'otp', 'csrf']) expect(ids).not.toContain(id);
    expect(JSON.stringify(snap)).not.toMatch(/4111|s3cr3t|4242|123456|token/);
  });

  it('knows which fields are secret by their own nature', () => {
    const password = document.querySelector('[data-vex-id="clave"]')!;
    expect(isSecretField(password)).toBe(true);
    expect(isPrivate(password)).toBe(true);
    expect(isPrivate(document.querySelector('[data-vex-id="pagar"]')!)).toBe(true);
    expect(isPrivate(document.querySelector('[data-vex-id="buscador"]')!)).toBe(false);
  });

  it('accepts elements registered from code, which win over the markup and leave when detached', () => {
    const r = new ElementRegistry();
    const extra = document.createElement('button');
    extra.textContent = 'Enviar presupuesto';
    document.body.appendChild(extra);
    r.register('enviar', extra, { risk: 'irreversible', label: 'Enviar el presupuesto' });
    expect(r.snapshot().find((s) => s.id === 'enviar')).toEqual({ id: 'enviar', role: 'button', label: 'Enviar el presupuesto', risk: 'irreversible' });

    const override = document.createElement('input');
    override.value = 'otro';
    document.body.appendChild(override);
    r.register('buscador', override);
    expect(r.snapshot().find((s) => s.id === 'buscador')?.value).toBe('otro');

    extra.remove();
    expect(r.get('enviar')).toBeUndefined();
    r.unregister('buscador');
    expect(r.snapshot().find((s) => s.id === 'buscador')?.value).toBe('Laura');
    expect(() => r.register('mal id', extra)).toThrow(/no válido/);
  });

  it('refuses to describe a private element registered from code', () => {
    const r = new ElementRegistry();
    const secret = document.createElement('input');
    secret.type = 'password';
    document.body.appendChild(secret);
    trap(secret);
    r.register('secreto', secret);
    expect(r.snapshot().some((s) => s.id === 'secreto')).toBe(false);
  });

  it('caps the snapshot at 200 elements', () => {
    document.body.innerHTML = Array.from({ length: 250 }, (_, i) => `<span data-vex-id="e${i}">${i}</span>`).join('');
    expect(new ElementRegistry().snapshot()).toHaveLength(200);
  });
});
