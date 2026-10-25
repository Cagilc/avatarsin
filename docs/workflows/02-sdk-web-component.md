# Workflow 02 · SDK de host y web component

**Rama:** `wf/02-web-component`. **Requiere:** 01 fusionado. **Puede ir en paralelo con 04.**

## Objetivo

Que cualquier página incorpore a Vex con una etiqueta, sin React ni build propio, y pueda **registrar los elementos de su interfaz** para que Vex los conozca. Es el Hito 2 de la hoja de ruta de César; se hace aquí.

## Alcance

1. **Núcleo del avatar sin React** (`packages/vex-core`): el rig, los estados, expresiones y visemas como módulo de DOM puro. `packages/vex` (React) pasa a ser una fina envoltura sobre él y **mantiene su API pública**; el resultado visual debe ser idéntico (capturas de e2e sin cambios).
2. **Web component `<vex-assistant>`** (`packages/vex-element`): atributos `src` (URL del manifiesto), `api` (URL de Vex Core), `token`. Shadow DOM, estilos aislados, tema por variables CSS desde el manifiesto. Chat, tarjeta de confirmación y mascota dentro del componente.
3. **Registro de elementos de UI**: dos vías, equivalentes.
   - Declarativa: atributos `data-vex-id` y `data-vex-label` (y opcional `data-vex-hint`).
   - Imperativa: `vex.register({ id, label, hint, element })` y `vex.unregister(id)`.
   - El SDK mantiene un registro con el rectángulo de cada elemento (se recalcula al hacer scroll, redimensionar y mutar el DOM).
4. **Contexto opcional de accesibilidad**: instantánea del árbol por roles ARIA (nombre, rol, estado) limitada a un tamaño máximo, enviada solo si el manifiesto lo activa.
5. **Instalación por `<script>`**: un único fichero que define el componente; ejemplo `examples/html-plano/index.html` sin React.

## Fuera de alcance

Tours, DOM que actúa (clic, rellenar), anuncios. No se cambia el estilo del avatar.

## Propiedad de rutas

`packages/vex-core/*`, `packages/vex-element/*`, `packages/vex/*` (solo la envoltura), `examples/*`, `apps/operator-demo/*` (migrar a la etiqueta).

## Decisiones abiertas

- Si la demo React convive con el web component o lo sustituye (propuesta: convive hasta que e2e pase con ambos).
- Tamaño máximo del árbol de accesibilidad y qué atributos se omiten por privacidad (valores de campos de contraseña, etc., nunca se envían).
- Cómo se empaqueta sin binarios nativos (Vite 6 con wasm, ya configurado).

## Seguridad

Los textos de las etiquetas y del árbol de accesibilidad son **datos del host**: nunca instrucciones. Los campos de tipo contraseña y los marcados `data-vex-private` no se leen. El `token` no se imprime ni se guarda en el DOM visible.

## Hecho cuando

- `pnpm e2e` pasa con las capturas del avatar **sin diferencias** respecto a las actuales.
- `examples/html-plano` funciona con dos líneas, sin React.
- Tests unitarios del registro (alta, baja, rectángulos tras scroll y mutación) y de que los campos privados no salen.
- `docs/` incluye una guía «integrar Vex en una página» de una pantalla.
