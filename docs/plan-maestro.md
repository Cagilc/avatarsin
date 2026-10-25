# Plan maestro · Vex (contexto compactado y plan revisado)

Documento de traspaso para retomar el trabajo en una conversación nueva. Escrito el 2026-10-25. Solo local: no se ha publicado.

## 1 · Contexto

### Qué es Vex
Un **producto propio** de César Augusto Gil (GitHub `Cagilc`): un avatar animado que actúa como **operador** dentro de cualquier plataforma web que lo integre, con los permisos del usuario conectado. **No es un proyecto para MNEE** (MNEE fue solo el ejemplo inicial). Tiene dos partes:

- **Operador** (Vex Core): bucle del agente, herramientas con riesgo declarado (`read` / `write` / `irreversible`), confirmación con vista previa real, parada, auditoría en SQLite, conectores OpenAPI/MCP con revisión humana, banco de 28 encargos, demo React y seguridad endurecida (`docs/seguridad.md`).
- **Estudio de avatares** (privado: solo César y quien invite): de un logo a un avatar animado (piezas, esqueleto, física de muelles, materiales, estilo plano↔realista, 8 estados, personalidad y capacidades). Un asistente prepara el borrador y pregunta como mucho 3 cosas. Publica **paquetes firmados Ed25519** que se incrustan con `<vex-avatar>` solo en dominios autorizados; cada integración da un **permiso firmado** (*grant*) que solo puede estrechar capacidades. Diseño en `docs/diseno.md`.

### Dónde está cada cosa
| Lugar | Estado |
|---|---|
| `Desktop\avataarsin` | Operador. Remoto `Cagilc/avatarsin` (**público**), `main` en `c4384e1`. Commit local **sin subir** `bbf4f30`: plataforma genérica, nombre por `VEX_HOST_NAME`. |
| `Desktop\vex-avatar-studio` | Estudio. Solo local, sin remoto. |
| `Desktop\vex` | **Repositorio unido** (prueba de viabilidad, local): las dos historias fusionadas (`84fec1f`), 12 paquetes (`@vex/*` operador, `@vexstudio/*` estudio), ramas `operador` y `estudio` = los originales. Verificado: tipos, 148 pruebas, banco 15/15, compilación, e2e 9/9 + 4/4. **Aquí se trabaja.** |
| GitHub `Cagilc/avatarsin` | Dos PR abiertas de **Oscar** (`oscarsao`, colaborador con permiso de escritura). |

### Las PR de Oscar
- **#1 `fix/ssrf-outbound-guard` (826b5e3)**: `guardedFetch` (resuelve DNS, rechaza IP internas, redirecciones a mano, quita credenciales al cambiar de origen). Revisada y probada en otra sesión: **pedir cambios**. Tal cual, 12 de 78 pruebas fallan; queda un **DNS rebinding demostrado** con conexión real (hay que fijar la conexión a la IP comprobada) y faltan pruebas de `HttpMcpClient`. Informe, pruebas y parche propuesto en `C:\Users\Portatil 5\AppData\Local\Claude-Data\claude_pzs8sxrjxfjjc\side-session-notes\local_ef19a82c-8065-4d29-a807-5bf19bbc7f63\` (`informe-aporte-oscar.md`, `outbound.review.test.ts`, `propuesta-arreglos-pr1.patch`).
- **#2 `docs/plan-host-agnostico` (6e856e3)**: plan solo en documentos para hacer Vex agnóstico del host con un **manifiesto** y 5 workflows (01 desacople y manifiesto, 02 SDK y web component, 03 tours, 04 anuncios y botones, 05 driver DOM con defensa de inyección), protocolo Fable revisa / Sonnet escribe, `DECISIONES.md`, `backlog.md` (11 ideas). Oscar se reserva el «carril de infra» (servidor, multi-inquilino, host real). Análisis y mejoras en la sección 3.

### Decisiones ya tomadas por César
- No subir **nada** a GitHub (ni avatarsin ni el estudio ni `vex`) hasta pulir las bases y que el conjunto tenga sentido. Commits locales sí.
- Vex es genérico: ningún nombre de plataforma concreta en el código.
- El estudio es privado; la integración en un SaaS es el destino de los avatares, no del estudio.
- Probar la fusión en `Desktop\vex` sin perder la opción de volver a los dos repositorios.

### Decisiones pendientes de César
1. **Licencia** (antes de aceptar más aportes).
2. **Dónde funciona el operador**: servicio central (multi-cliente), instalado en cada cliente, o mixto.
3. **Qué pega el cliente**: una etiqueta con avatar y chat juntos, o dos piezas.
4. **Quién paga la IA** y con qué límites.
5. **Cómo colaborar con Oscar** sin publicar: por ejemplo, un repositorio privado de `vex` con acceso solo para él.
6. Si se queda la fusión (`Desktop\vex`) o se vuelve a dos repositorios.
7. Proveedor de imágenes para avatares realistas.

## 2 · Entorno y reglas de trabajo
- Windows 11 con Control de aplicaciones: bloquea binarios nativos sin firmar. Vite 6 con rollup/esbuild en wasm, `node:sqlite`, imagen en JS puro. **Python no sirve.** Node 24 (type stripping, imports `.ts`), pnpm 10, TypeScript 7, Zod 4, Vitest 3, Fastify 5, React 19.
- Playwright con el Edge instalado (`channel: 'msedge'`). El panel del navegador de Claude oculto no ejecuta `requestAnimationFrame`: animación y física se comprueban con `pnpm e2e:studio`.
- Antes de cada commit: `pnpm typecheck`, `pnpm test`, `pnpm eval -- --provider scripted`, y `pnpm e2e` / `pnpm e2e:studio` según lo tocado. `salud.js` tras cambios grandes (scripts de `C:\Users\Portatil 5\Desktop\scrips\bin\`, ver el `CLAUDE.md` global).
- Git: commits en inglés (conventional commits) con autor César. La credencial por defecto es de otra cuenta (`cesargil-png`); para GitHub usar `git -c credential.helper= -c "credential.helper=!gh auth git-credential"`. Nunca introducir códigos ni credenciales por el usuario. La clave de Anthropic va en los `.env` (`apps/api/.env`, `apps/server/.env`), nunca en el chat; **hoy no hay clave en el equipo**.
- Nada en GitHub (merge, push, revisión, comentario) sin aprobación expresa de César en la conversación.
- Responder en español; no narrar exploits, solo defensas.

## 3 · El plan de Oscar: qué se mantiene y qué se mejora
Se mantiene: interruptores apagados por defecto, aditivo, contratos Zod primero, criterio «dos plataformas, cero cambios de código», tours/anuncios/botones sin modelo, casos de inyección antes del driver DOM, un PR por workflow.

Mejoras:
1. **No duplicar el estudio.** El manifiesto **apunta al avatar publicado** (endpoint de integración + clave pública); aspecto y personalidad salen del estudio. Nada de `packages/vex-core` nuevo: `<vex-assistant>` se construye sobre `<vex-avatar>` (`packages/runtime`). Caras y visemas del avatar antiguo (`packages/vex`) se portan al formato del estudio como capa nueva.
2. **Una regla de permisos.** Lo que Vex puede hacer = conectores aprobados ∩ política del manifiesto ∩ *grant* firmado de la integración. Ninguno amplía a otro. Test para cada combinación.
3. **El manifiesto vive en el servidor.** La política nunca llega del navegador. Al cliente solo baja la parte de presentación (tours, botones, anuncios), firmada como los paquetes del estudio. El token de sesión no va en un atributo del DOM: se obtiene con una función del host, de corta duración.
4. **Conectores del manifiesto = propuestas.** Entran como «Sin revisar» y sus descargas pasan por la guardia de salida (PR #1 corregida).
5. **Sin nombres de plataformas.** `presets/demo-negocio/` en lugar de `presets/mnee/`; `VEX_HOST_NAME` pasa a `host.name` del manifiesto.
6. **Poses del tour como estados del estudio** (`point`, `celebrate`) y «señalar hacia» calculado por el runtime, en vez de tocar `assets/vex-2d`.
7. El carril de infra de Oscar asume servicio central multi-cliente: **depende de la decisión pendiente 2**.

## 4 · Plan revisado (orden de ejecución)

### Paso 0 · Preparación (decisiones de César + seguridad)
- Presentar a César las decisiones pendientes 1–6 de una en una, con recomendación, y anotar las respuestas en este documento.
- Recomendar proteger `main` en GitHub (PR obligatoria con su aprobación): es un ajuste de su cuenta, lo hace él.
- Redactar (sin publicar) la respuesta a Oscar: PR #1 con los cambios pedidos (rebinding, `HttpMcpClient`, los fallos de la tabla del informe) y PR #2 con las mejoras de la sección 3. César decide si se publica.
- **Hecho cuando:** decisiones anotadas y borradores de respuesta en `docs/borradores/`.

### Paso 1 · Manifiesto y desacople (workflow 01 ampliado), en `Desktop\vex`
- Esquema `packages/operator/src/schema/host.ts` con: `host{name,domain}`, `avatar{endpoint,publicKey,keyId}`, `connectors[]` (propuestas), `policy`, `screenContext`, `features` (todo apagado) y marcadores para tours/anuncios/botones.
- Cargador en `apps/api` (servidor, ruta `VEX_HOST_MANIFEST` o preset), error exacto si no valida; sin manifiesto, comportamiento de hoy.
- `presets/demo-negocio/` con el dominio de ejemplo; `system.ts` neutro; `VEX_HOST_NAME` → `host.name`.
- Regla de los tres permisos con tests; lectura del *grant* firmado del estudio (verificar firma, caducar y revocar).
- Segundo host (agenda de `apps/sample-tools`) solo con manifiesto.
- **Hecho cuando:** banco 15/15 con el preset; agenda funcionando sin tocar `apps/api/src`; tests de la regla de permisos y del *grant* alterado o revocado; `features` apagado = comportamiento idéntico; documentación al día.

### Paso 2 · Asistente incrustable (workflow 02 adaptado)
- `<vex-assistant>`: chat, tarjeta de confirmación y `<vex-avatar>` del estudio, con estados según la fase del operador. Token por función del host.
- Registro de elementos (`data-vex-id`, `vex.register`), campos privados nunca leídos.
- Ejemplo HTML sin React en dos líneas; la demo React convive.
- Portar caras y visemas al formato del estudio.
- **Hecho cuando:** e2e con el avatar diseñado en el estudio operando en la demo y en una página HTML simple; tests del registro y de campos privados.

### Paso 3 · Anuncios y botones rápidos (workflow 04), en paralelo con el 2
- Como lo propone Oscar; botones con herramienta pasan por política y confirmación; borradores de anuncio desde conectores.

### Paso 4 · Medir con Claude
- Requiere que César ponga su clave en los `.env`. Banco del operador con Claude y banco nuevo del asistente del estudio; fijar mínimos con datos.

### Paso 5 · Tours y onboarding (workflow 03) con poses del estudio

### Paso 6 · Driver DOM con defensa de inyección (workflow 05)
- Solo tras el paso 4 (cifras con Claude de los casos hostiles).

### Paso 7 · Siguiente tanda
- Backlog de Oscar en su orden: aprobaciones por canal, de sesión real a caso del banco, analítica de onboarding, «¿cómo hago X?».
- Estudio: generación de avatares con Claude en SVG, imagen a piezas (PhotoCraft/VectorCraft), editor de animación, malla (EffectCraft a wasm).
- Producción según la decisión 2.

### Cuándo están pulidas las bases
Un avatar del estudio opera en la demo con su personalidad y sus permisos; el banco con Claude supera el mínimo; la documentación cuenta lo que hay. Entonces se deciden repositorio y licencia y se publica.
