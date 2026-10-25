# vex-avatar-studio — estudio de avatares Vex

Proyecto personal de César Augusto Gil. Idioma de trabajo: español (código y comentarios en inglés, UI en español). Evolución del avatar de `Desktop/avataarsin`; **solo local, sin remoto**: no subir a GitHub hasta que el usuario lo pida.

Diseño completo en `docs/diseno.md`.

## Principios que no se negocian
1. El documento del avatar solo contiene datos (objetos Zod estrictos). Nada de scripts, expresiones ni URL.
2. Todo cambio es una operación de `packages/format/src/ops.ts`, venga del editor o del asistente. Operación nueva = esquema + `pathsOf` + `mutate` + test.
3. El asistente nunca toca lo que fijó una persona (`provenance.by === 'user'`) ni ejecuta `setCapabilities` o `release`. Sus propuestas no se guardan hasta que una persona acepta.
4. Toda subida pasa por `apps/server/src/sanitize.ts`. La política SVG vive en `packages/format/src/svgPolicy.ts` y la aplican el servidor y el runtime.
5. Lo publicado va firmado (Ed25519) y `<vex-avatar>` verifica firma y huellas antes de dibujar. Una integración solo puede estrechar capacidades.
6. Publicar, integraciones, capacidades y auditoría: solo el propietario.

## Stack y entorno
- Node 24 con *type stripping* (imports con `.ts`, `erasableSyntaxOnly`), pnpm 10, TypeScript 7, Zod 4, Vitest 3, Fastify 5, React 19 + Vite 6.
- Este equipo bloquea binarios nativos sin firmar: Vite 6 con `overrides` a `@rollup/wasm-node` y `esbuild-wasm`; `node:sqlite` para la base de datos; dependencias de imagen en JS puro (`pngjs`, `jpeg-js`, `@xmldom/xmldom`).
- Playwright con el Edge instalado (`channel: 'msedge'`). El panel del navegador de Claude oculto no ejecuta `requestAnimationFrame`: para comprobar animación o física, usar `pnpm e2e`.
- Puertos: servidor 8788, estudio 5180; e2e usa 8798, 5190, 5191 y 5192.

## Convenciones
- Antes de cada commit: `pnpm typecheck`, `pnpm test` y, si se toca el estudio o el runtime, `pnpm e2e`.
- Commits en inglés, conventional commits.
- Al añadir una amenaza o defensa, actualizar la tabla de `docs/diseno.md` y su test.
