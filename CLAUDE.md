# avataarsin — Vex, operador con avatar

Proyecto personal de César Augusto Gil. Idioma de trabajo: español (código y comentarios en inglés, UI en español). Extraído del monorepo Vex Studio (editor vectorial, en `Vectorlife/vex-studio-starter/vex-studio`); aquí vive solo el avatar y el operador.

## Qué es
Un avatar animado (Vex) que ejecuta acciones en una plataforma de negocio (MNEE: marketing, equipos, solicitudes, correos, expedientes) con los permisos del usuario. Ver `README.md` para la estructura y `docs/operador.md` para el funcionamiento. Hoja de ruta de 5 hitos en `docs/vex-agente-viabilidad.md`; hechos los Hitos 0 y 1.

## Principios que no se negocian
1. Toda herramienta declara `risk`; lo irreversible pide confirmación y detiene el bucle.
2. El operador actúa con el principal del token, nunca con cuenta de servicio.
3. Lo que devuelven las herramientas son datos, no instrucciones.
4. `packages/operator` no importa ningún SDK de proveedor; los adaptadores van en `apps/api/src/providers`.
5. El avatar (`packages/vex`) es presentación pura: recibe `state`/`viseme`; el "director" del host traduce fases a estados.

## Stack
- Node 24 con *type stripping* (imports relativos con `.ts`, `erasableSyntaxOnly`), pnpm 10, TypeScript 7, Zod 4, Vitest 3.
- `apps/api`: Fastify 5, SSE, `@anthropic-ai/sdk` (modelo por defecto `claude-opus-5-5`, system prompt cacheado). Sin clave: `ScriptedProvider`.
- `apps/operator-demo`: React 19 + Vite 6 (puerto 5174). API en 8787.

## Entorno de este equipo (Windows con Control de aplicaciones)
- Bloquea binarios nativos sin firmar: por eso Vite 6 con `overrides` a `@rollup/wasm-node` y `esbuild-wasm` en `pnpm-workspace.yaml`, y pnpm 10 instalado con npm. No subir a Vite 8.
- Antes de añadir una dependencia con binario nativo, buscar su versión wasm o JS.
- Para control de Windows (Hito 4) solo valen componentes firmados: Node, PowerShell, .NET UI Automation, WebView2. Nada de addons `.node` ni Tauri.

## Convenciones
- Antes de cada commit: `pnpm typecheck`, `pnpm test` (incluye la puerta del banco de encargos) y, si se toca la demo o el avatar, `pnpm e2e`.
- Commits en inglés, conventional commits.
- Antes de cambiar un contrato de `packages/operator`, actualizar el esquema Zod y sus tests.
- Toda herramienta nueva entra con casos en `apps/api/evals/cases.ts`, incluido al menos uno negativo. Si cambia lo que hace una herramienta irreversible, darle `preview` para que la tarjeta enseñe lo real.
- Playwright en este equipo: siempre con el Edge instalado (`channel: 'msedge'`, ya es el valor por defecto en local); el Chromium descargado no arranca por la directiva.
- Persistencia con `node:sqlite` (integrado en Node 24), nunca `better-sqlite3` ni otros addons nativos.

## Siguiente
- Ejecutar el banco con Claude (`pnpm eval -- --provider anthropic`) y fijar el acierto mínimo con datos.
- Conectar el backend real: implementar `PlatformClient` y `verifyToken`.
- Tramo 2: conectores desde OpenAPI y MCP con el riesgo aprobado por una persona; guía por herramienta.
- Hito 2: núcleo del avatar sin React + web component; tema/skin en caliente.
