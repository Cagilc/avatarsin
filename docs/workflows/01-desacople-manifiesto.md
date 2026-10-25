# Workflow 01 · Desacople y manifiesto de host

**Revisión obligatoria con Fable** (cambia contratos del núcleo). **Rama:** `wf/01-manifiesto`. **Bloquea a los demás.**

## Objetivo

Sacar del núcleo todo lo que sea del negocio precargado y hacer que un host se describa con un **manifiesto declarativo**, de modo que otro host funcione sin tocar código. Sin cambiar el comportamiento actual por defecto.

## Alcance

1. **Esquema del manifiesto** en `packages/operator/src/schema/host.ts` (Zod) + tests. Campos mínimos: `version`, `host{name,domain}`, `personality`, `theme`, `connectors[]`, `policy`, `screenContext` (JSON Schema), `features{tours,announcements,quickActions,domDriver}` (todo `false`), y marcadores reservados `quickActions`, `tours`, `announcements` (solo tipados aquí; los implementan 03 y 04). Esbozo en `docs/plan-host-agnostico.md`.
2. **Cargador** en `apps/api`: lee el manifiesto de una ruta (`VEX_HOST_MANIFEST`) o de un preset por nombre; error claro y exacto si es inválido; sin manifiesto, usa el preset actual (comportamiento de hoy).
3. **Preset `presets/mnee/`**: mover allí, sin borrar nada, `tools/platform.ts`, `platform/mock.ts`, `platform/types.ts`, el modo guion del dominio (`providers/scripted.ts`), el contexto `{contactoId, expedienteId}` y sus casos de evals. El núcleo conserva solo la orden directa `usa <herramienta> {json}`.
4. **`system.ts` neutro**: el prompt base no menciona contactos, expedientes ni correos; el dominio y los ejemplos entran desde `host.domain` y el preset.
5. **Contexto de pantalla** con el esquema declarado en el manifiesto, validado al llegar.
6. **Segundo host de prueba**: la agenda de `apps/sample-tools` descrita solo con un manifiesto (`presets/citas/manifest.json`), sin tocar `apps/api/src` ni `packages/*` para que funcione.

## Fuera de alcance

Web component, tours, anuncios, DOM, servidor y multi-inquilino. No se toca `packages/vex` ni `assets/`.

## Propiedad de rutas

`packages/operator/src/schema/*`, `apps/api/src/*`, `presets/*`, `apps/api/evals/*`.

## Decisiones abiertas (resolver en el refinado)

- JSON o YAML para el manifiesto (propuesta: JSON ahora; YAML cuando el importador lo admita).
- Qué parte del manifiesto se puede cambiar en caliente y cuál exige reinicio.
- Cómo se nombran y versionan los presets.

## Hecho cuando

- `pnpm eval -- --provider scripted` sigue en 15/15 con el preset mnee.
- `pnpm test` verde, con tests nuevos del esquema, del cargador y del manifiesto inválido.
- El host de la agenda funciona **solo con manifiesto**: un test de api lo demuestra y `git diff` de ese PR no toca `apps/api/src` para añadirlo.
- Con `features` apagado, un test confirma comportamiento idéntico al anterior.
- `docs/operador.md` y el README explican el manifiesto y el preset.
