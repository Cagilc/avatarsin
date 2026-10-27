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
- ~~No subir **nada** a GitHub hasta pulir las bases.~~ **Cambiado el 2026-10-26**: César pidió subir `vex` a su GitHub para que Oscar vea el avance y siga trabajando desde allí, y eligió `Cagilc/avatarsin` (público) como destino: `main` de `vex` sustituye al de `avatarsin` por fast-forward, sin reescribir la historia. Con ello el estudio pasa a ser público y Oscar lo ve (sustituye la decisión 5). Sigue vigente: nada más en GitHub (merge, revisiones, comentarios) sin aprobación expresa.
- Vex es genérico: ningún nombre de plataforma concreta en el código.
- El estudio es privado; la integración en un SaaS es el destino de los avatares, no del estudio.
- Probar la fusión en `Desktop\vex` sin perder la opción de volver a los dos repositorios.

### Decisiones de César del 2026-10-25 (paso 0)
1. **Licencia: Apache-2.0, ya.** `LICENSE` y `NOTICE` en la raíz de `vex` (solo local). Los aportes de Oscar entran bajo la misma licencia (cláusula 5 de Apache-2.0). `avatarsin` es público y no tiene licencia: añadirla allí exige un push, que César tiene que aprobar.
2. **El operador se instala en cada cliente** (ni servicio central ni mixto). Cada instalación es de **un solo inquilino**, con su manifiesto. Desaparece el multi-inquilino del carril de infra de Oscar. Quedan en ese carril el contenedor instalable, `TokenService.verify` contra el JWT del host, la parada global y los límites de gasto.
3. **Una sola etiqueta**: `<vex-assistant>` envuelve el chat, la tarjeta de confirmación y el `<vex-avatar>` del estudio. `<vex-avatar>` sigue disponible por separado y el asistente admite un modo sin avatar.
4. **La IA la paga cada cliente con su clave** (en su `.env`). Vex trae límites configurables y activos por defecto: tope de tokens por usuario y día, tope mensual de la instalación, parada global y aviso al 80 %. Si se agota el tope o no hay clave, pasa a modo guion y lo dice. El asistente del estudio lo paga César.
5. **Oscar sigue en `avatarsin`** (público). ~~No se le da acceso al estudio ni a `vex` por ahora.~~ Desde el 2026-10-26 `avatarsin` recibe el `main` de `vex`, estudio incluido; la respuesta a la PR #2 puede ser ya la versión larga.
6. **Se queda la fusión**: `Desktop\vex` es el repositorio de trabajo. `avatarsin` se añade como remoto de solo lectura y lo que César acepte allí se fusiona en `vex` (las rutas del operador coinciden). Al publicar, `vex` puede sustituir a `avatarsin` sin reescribir la historia. Riesgo: choques si Oscar toca los ficheros que cambia el paso 1 (`apps/api`, `packages/operator`). Conviene avisarle de qué zonas están en obras.

### Decisiones pendientes de César
7. Proveedor de imágenes para avatares realistas.
8. Proteger `main` en `Cagilc/avatarsin`: PR obligatoria con su aprobación y CI en verde. Es un ajuste de su cuenta y lo hace él. **Urgente ahora**: con `vex` subido y sin protección, Oscar (escritura) puede empujar directamente a `main`.
9. ~~Publicar las respuestas a Oscar.~~ **Hecho el 2026-10-26**: revisión «Request changes» en la PR #1 (con la rama `review/pr1-pruebas`) y comentario largo en la PR #2; textos finales en `docs/borradores/`.

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
7. El carril de infra de Oscar asumía un servicio central multi-cliente. **Decisión 2: se instala en cada cliente**, así que el carril se reduce a contenedor instalable, `TokenService.verify`, parada global y límites de gasto (decisión 4).

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
- **Hecho el 2026-10-25** en la rama local `wf/01-manifiesto`. Puertas: tipado OK, 179 pruebas (operator 39, api 66, connectors 16, format 17, runtime 9, server 32), banco 15/15 con `presets/demo-negocio`, e2e 9/9 en Edge, `salud.js` sin errores. Decisiones tomadas al hacerlo:
  - `leer_guia` (documentación de los conectores) queda fuera del *grant* pero no de la política: la política del preset `agenda` la permite por nombre.
  - El *grant* del estudio lleva `expiresAt` (10 min); Vex Core reutiliza cualquier respuesta un minuto, conserva un *grant* válido si el estudio no responde y se queda **sin herramientas** ante firma, clave, dominio o revocación malos.
  - `opts.policy` de `buildApp` (pruebas) manda sobre `manifest.policy`; `server.ts` no la pasa, así que en ejecución manda el manifiesto.
  - `VEX_HOST_NAME` desaparece; `VEX_HOST_MANIFEST` (preset o ruta) lo sustituye. Sin manifiesto, nombre genérico y ninguna propuesta.
  - Lo que la política deniega no se ofrece al modelo (antes se ofrecía y se denegaba al llamar). Con la política por defecto no cambia nada.
  - `apps/api` depende ahora de `@vexstudio/format` (solo `canonicalJson`, `fromBase64Url`, `importPublicKey`) y carga la librería DOM de TypeScript por los tipos WebCrypto, como `apps/server`.

### Paso 2 · Asistente incrustable (workflow 02 adaptado)
- `<vex-assistant>`: chat, tarjeta de confirmación y `<vex-avatar>` del estudio, con estados según la fase del operador. Token por función del host.
- Registro de elementos (`data-vex-id`, `vex.register`), campos privados nunca leídos.
- Ejemplo HTML sin React en dos líneas; la demo React convive.
- Portar caras y visemas al formato del estudio.
- **Hecho cuando:** e2e con el avatar diseñado en el estudio operando en la demo y en una página HTML simple; tests del registro y de campos privados.
- **Hecho el 2026-10-25** en la rama local `wf/02-asistente`. Puertas: tipado OK, 197 pruebas (operator 39, format 22, runtime 9, connectors 16, server 32, api 68, assistant 11), banco 15/15, e2e del operador 9/9, e2e del estudio 7/7 (4 de antes, Vex importado con caras y visemas, el avatar publicado en la demo y en la página simple). Decisiones tomadas al hacerlo:
  - `packages/assistant` (`@vex/assistant`) es un paquete sin framework que compila a `dist/vex-assistant.js` e incluye el `<vex-avatar>` del runtime; **Vex Core lo sirve** en `GET /assistant.js`. Shadow DOM abierto, para que los e2e del operador sigan usando sus selectores.
  - El avatar llega al panel por `GET /operator/info` → `host.avatar` (valores públicos del manifiesto); sin avatar o con `avatar="off"`, panel sin avatar. El director mapea fases a los 8 estados del estudio (sin visemas en el panel: los pone el clip `talk` del avatar).
  - Token por la propiedad `getToken`; `demo-user` solo para el login de demo local. `context`, `principal` y `suggestions` son propiedades; `vex-turn` avisa al host para refrescar.
  - La personalidad publicada entra en el prompt: Vex Core descarga y verifica el paquete junto al *grant*; un paquete alterado deja la personalidad del servidor.
  - El registro de elementos (`data-vex-id`, `register`) existe y está probado, pero **nadie consume aún la instantánea**: la usarán los tours (paso 5) y el driver DOM (paso 6).
  - Vex entra en el estudio sin cambiar el formato: caras y visemas como piezas con pistas de opacidad a saltos. `packages/vex` (React) queda solo para `#estados`; quitarlo es tarea aparte.
  - El e2e del avatar en la demo arranca su propio Vex Core (`e2e-studio/tests/asistente.spec.ts`) con un manifiesto escrito al vuelo, porque el `vk_` de la integración se crea en la prueba.

### Paso 3 · Anuncios y botones rápidos (workflow 04), en paralelo con el 2
- Como lo propone Oscar; botones con herramienta pasan por política y confirmación; borradores de anuncio desde conectores.
- **Hecho el 2026-10-25** en la rama local `wf/03-anuncios`. Puertas: tipado OK, 210 pruebas (operator 44, format 22, runtime 9, connectors 16, server 32, api 76, assistant 11), banco 15/15, e2e del operador 9/9, e2e del estudio 7/7 (43 s), `salud.js` limpio. Decisiones tomadas al hacerlo:
  - Contratos en `packages/operator/src/schema/engage.ts`; el manifiesto los recibe en lugar de los marcadores (`tours` sigue reservado). Un `cta` de anuncio solo puede apuntar a un botón que exista.
  - Un botón con herramienta corre por el bucle con `DirectProvider` (una `tool_use` con id predecible `direct_<herramienta>`): validación, política, confirmación con vista previa, auditoría e historial de la sesión; la lista de botones solo ofrece herramientas que el bucle ejecutaría y un botón denegado responde 403 con línea `denied`. Máximo 6 botones.
  - La presentación baja por rutas autenticadas de Vex Core (`/engage/*`), filtradas por el rol del token; no se firma: el canal ya es el de la sesión. Si algún día se cachea fuera de Vex Core, firmar entonces.
  - Los borradores de conectores y el estado «visto» viven en el almacén (SQLite); los anuncios del manifiesto se editan en el manifiesto. Un borrador solo nace cuando una revisión activa herramientas que no estaban activas.
  - Las novedades para todos entran en el prompt como aviso del administrador; el modo guion no las contesta (queda para el paso 4, con Claude).
  - `presets/demo-negocio` enciende anuncios y botones (tres botones, un anuncio); las herramientas y la política siguen idénticas a sin manifiesto, y hay un test que lo comprueba también con todo apagado.

### Paso 4 · Medir con Claude
- Requiere que César ponga su clave en los `.env`. Banco del operador con Claude y banco nuevo del asistente del estudio; fijar mínimos con datos.
- **Preparado el 2026-10-26** en la rama local `wf/04-banco-estudio`: el banco del asistente del estudio (`apps/server/evals/`: `fixtures.ts`, `cases.ts`, `harness.ts`, `run.ts`, `evals.test.ts`; `pnpm eval:studio -- --provider heuristic|claude`). 15 casos en seis categorías (esqueleto, petición, preguntas, respeto, animación, lenguaje); el geométrico pasa sus 12 y los 3 de lenguaje natural quedan para Claude. Decisiones tomadas al hacerlo:
  - Cada propuesta se aplica de verdad al documento con `applyOps(…, 'ai')`, y también cada opción de cada pregunta: una propuesta que no aplica suspende, igual que en el servidor.
  - Las comprobaciones miran el documento resultante (padres, papeles, física efectiva, realismo, acabado, gravedad, estados con clip, nombre, tono), no el texto de las operaciones; lo fijado se vigila por `pathsOf(op)` contra la procedencia `user`.
  - Lo que hace el geométrico marca la expectativa cuando es razonable: con volumen (o con un PNG, o con realismo fijado alto) el material se ve, así que se pregunta; con todo dicho en la frase, nada.
  - Queda para cuando haya clave: `pnpm eval:studio -- --provider claude` y `pnpm eval -- --provider anthropic`, y fijar `--min-pass` con datos. CI ya tiene el banco geométrico en `pnpm test`.

### Paso 5 · Tours y onboarding (workflow 03) con poses del estudio
- **Hecho el 2026-10-25** en la rama local `wf/05-tours` (antes que el paso 4, que espera la clave). Puertas: tipado OK, 218 pruebas (operator 44, format 22, runtime 12, connectors 16, server 32, api 77, assistant 15), banco 15/15, e2e del operador 9/9, e2e del estudio 8/8 (45 s), `salud.js` limpio. Decisiones tomadas al hacerlo:
  - `point` y `celebrate` son estados del **formato** (10 en total), con animación de partida, etiqueta en el editor y clip en la muestra de Vex. Nada en `assets/vex-2d`.
  - «Señalar hacia» lo calcula el runtime: atributo `aim` (grados en pantalla) en `<vex-avatar>`; `packages/runtime/src/aim.ts` gira el brazo del lado del objetivo hasta esa dirección, encima del clip. Probado con un rig de dos brazos.
  - Contrato del tour en el manifiesto (`schema/tour.ts`): pasos con `target` opcional, `say`, `pose`, `advanceOn` (`next`/`click`/`input`), `when` (`manual`/`first`). Rutas `GET /engage/tours` y `POST /engage/tours/:id/done`; lo completado se guarda por persona.
  - Motor determinista en `packages/assistant/src/tour.ts` (no en un paquete aparte): un `target` ausente se salta y se anota; saltar no completa. La puesta en escena vive en `<vex-assistant>`: halo sin clics, burbuja accesible, mascota que viaja (sin viaje con `prefers-reduced-motion`), `Escape` sale, celebración al terminar.
  - Fuera de este paso: logros y puntos, borradores de tour con IA (tras el paso 4) y el laboratorio `#estados` del avatar antiguo (sigue con sus 8 poses).

### Paso 6 · Driver DOM con defensa de inyección (workflow 05)
- Solo tras el paso 4 (cifras con Claude de los casos hostiles).

### Paso 7 · Siguiente tanda
- Backlog de Oscar en su orden: aprobaciones por canal, de sesión real a caso del banco, analítica de onboarding, «¿cómo hago X?».
- Estudio: generación de avatares con Claude en SVG, imagen a piezas (PhotoCraft/VectorCraft), editor de animación, malla (EffectCraft a wasm).
- Producción según la decisión 2: contenedor que instala cada cliente, con su clave y sus límites (decisión 4).
- **Hecho el 2026-10-26** (adelantado mientras llega la clave), rama local `wf/07-limites`: **límites de gasto y pausa global** (decisión 4). Puertas: tipado OK, 225 pruebas (operator 44, format 22, runtime 12, connectors 16, server 32, api 84, assistant 15), banco 15/15, e2e 9/9 y 8/8, `salud.js` limpio. Decisiones tomadas al hacerlo:
  - Medición por respuesta del modelo (tokens y coste estimado con `pricing.ts`, compartido con el banco), cargada a la persona y a la instalación; en SQLite. Botones con herramienta y modo guion no se miden.
  - Topes encendidos por defecto: 300.000 tokens por persona y día UTC, 50 USD por instalación y mes UTC; aviso al 80 %; `0` quita un tope. Al tope o en pausa, la petición corre en modo guion y el flujo lo dice con el evento nuevo `notice` (aditivo en el contrato de eventos; el panel lo enseña).
  - Pausa de administrador persistente (`settings`): `ai` (modo guion) o `all` (503 en chat y botones); auditada.
- **Hecho el 2026-10-26**, rama local `wf/07-casos`: **de sesión real a caso del banco** (backlog D de Oscar). Puertas: tipado OK, 230 pruebas (api 89, operator 44, format 22, runtime 12, connectors 16, server 32, assistant 15), banco 15/15, e2e 9/9 y 8/8, `salud.js` limpio. Decisiones:
  - El caso sale de un turno del historial (petición y contexto de pantalla) y de la auditoría de sus acciones (llamadas en orden, rechazadas o denegadas, correos confirmados con destinatario, expedientes, tareas, citas, principal); nunca del texto de la respuesta.
  - Los casos exportados viven en `apps/api/evals/cases.local.json` (JSON validado, sin `setup`) y el banco los carga con los de `cases.ts`; llegan como `scripted: 'skip'` con una nota que pide revisarlos. Anonimización básica opcional: correos y teléfonos sustituidos por alias coherentes.
  - 👍/👎 con motivo por respuesta en el panel (`POST /operator/feedback`, solo sobre la propia sesión); `GET /admin/sessions` lista conversaciones con votos y motivos para elegir qué exportar; `pnpm eval:export -- --list | --session <id>`.
- **Hecho el 2026-10-26**, rama local `wf/07-aprobaciones`: **aprobaciones por canal** (backlog A de Oscar). Puertas: tipado OK, 237 pruebas (api 95, operator 45, format 22, runtime 12, connectors 16, server 32, assistant 15), banco 15/15, e2e 9/9 y 8/8, `salud.js` limpio. Decisiones:
  - El manifiesto declara `approvals.channels` (webhook firmado con el secreto que nombra `secretEnv`, o registro del servidor) y el interruptor `features.channelApprovals`. No hay canal de correo propio: el webhook es el canal genérico y el host lo convierte en lo que use; delegar = mandar el enlace a otra persona.
  - El enlace lleva un token HMAC ligado a una confirmación (sesión, acción, principal), caduca con ella y vale una vez; la página la sirve Vex Core (mismo origen, formulario sin scripts) y enseña la vista previa real. `VEX_PUBLIC_URL` y `VEX_CONFIRM_TIMEOUT_MS` nuevos; Fastify con `maxParamLength` 512 para el token.
  - Un canal que falla no bloquea la tarjeta; cada envío va a la auditoría; el panel recibe un `notice`.
  - Paso 7 sin clave: completo (límites, casos desde sesión, aprobaciones por canal). Queda lo que necesita Claude o herramientas externas: analítica de onboarding, «¿cómo hago X?», generación de avatares y piezas desde imagen.

### Paso 8 · Propuestas de Oscar (PR #3, revisadas el 2026-10-27)

**Qué subió Oscar** (26–27 de octubre): la PR #3 `docs/propuesta-niveles-demos`, un solo documento (`docs/propuestas/2026-10-26-niveles-y-demos.md`, 85 líneas) con niveles de capacidad 0–3 y seis propuestas P1–P6; un comentario en esa PR; y en la PR #1 un comentario que es un correo mal dirigido (instrucciones para su propio agente: «procesa, integra todas las ramas y publica…»), que **no va para nosotros**. Lo relevante de su comentario en la #3: **no va a mandar código** (prueba por fuera y devuelve resultados), da la PR #2 por superada y pregunta si preferimos integrar la #1 nosotros desde `review/pr1-pruebas`. CI de `main` está en verde (`f1ebe3b`).

**Revisión contra el código** (lo que hay que corregir de su documento antes de ejecutarlo):
- **Niveles**: válidos como mapa, pero **no se añade un eje nuevo de permisos**. Se corresponden con interruptores que ya existen: nivel 0 siempre; nivel 1 = conectores aprobados ∩ `policy` ∩ *grant* (`permittedTools`); nivel 2 = `features.domDriver` (apagado) más `maxRisk` del *grant*; nivel 3 fuera del asistente. Solo documentación.
- **P1 identidad**: coincide con el pendiente «`TokenService.verify` contra el JWT del host» (`apps/api/src/auth.ts` hoy firma HMAC propios; la demo de login ya está apagada fuera de local). Correcciones: el `principal.id` que salga de los *claims* alimenta sesiones, auditoría y límites de gasto, así que el mapa de *claims* es parte del contrato y lleva test; la descarga del JWKS pasa por la guardia de salida y se cachea; el token sigue llegando por `getToken` del host, nunca por el DOM. Identidad ≠ herramientas: las acciones de la plataforma siguen viniendo de conectores (OAuth por usuario sigue pendiente).
- **P2 filtro al importar**: real. `MAX_SPEC_BYTES` = 2 MB en `apps/api/src/connectors.ts`; no hay `include`/`exclude` ni tope de herramientas ni en la petición de importación ni en `connectors[]` del manifiesto. Correcciones: filtro **declarativo y guardado en el borrador** (se reaplica al reimportar), primero lista blanca por prefijo de ruta, etiqueta y método, luego exclusiones; tope por conector con error claro; subir el límite de tamaño con lectura acotada. La búsqueda bajo demanda queda como segundo paso.
- **P3 ver el efecto**: encaja con `preview` (lo que *va* a pasar) y con `aim`/`point` (ya existen). Correcciones: la verificación se declara en la herramienta del borrador (`verify: { tool, params }` con punteros a la respuesta), corre como lectura por política y auditoría, y **su fallo no convierte la acción en fallida** («no se pudo comprobar»). Evento `effect` en `events.ts` y evento DOM `vex-effect` desde `<vex-assistant>`.
- **P4 modo presentador**: es una extensión de los tours (`tourStepSchema` ya tiene `say`, `pose`, `target`, `advanceOn`) con un paso que puede lanzar un botón rápido (`DirectProvider`) y un contador que lee `spend.ts`. Correcciones: vive en `packages/assistant` (misma etiqueta, atributo `presenter` + atajos de teclado), no en un paquete ni una ventana aparte; el gancho `reset` es una llamada saliente firmada como los webhooks de aprobación, solo para principal administrador y pasando por la guardia.
- **P5 escaneo de una web**: necesita Claude (tours, preguntas frecuentes) y cifras de inyección; la descarga pasa por la guardia; el resultado es un borrador validado por `hostManifestSchema` que una persona aprueba. Después del paso 6.
- **P6**: de acuerdo; sin código. **Dirección de producto**: decisión de César, fuera del plan técnico.
- **Respuestas a sus preguntas**: (1) niveles sí, como mapa de interruptores existentes; (2) orden abajo; (3) `packages/assistant`; (4) sí: `pnpm eval -- --provider anthropic --min-pass`, `pnpm eval:studio -- --provider claude`, y en CI el `workflow_dispatch` `claude_eval` con el secreto; (5) un PNG entra como **una sola pieza** (`importLogo.ts`): para tener esqueleto hay que aportar SVG; imagen a piezas es la decisión 7.

**Plan a ejecutar** (orden; cada paso en su rama `wf/…`, contratos y tests primero, puertas en verde, fila en `docs/seguridad.md` si cambia una defensa):
- **8.1 Guardia de salida (cierra la PR #1)** — sin clave. Como Oscar no mandará código, se integra su rama sobre `main` conservando su commit (él como coautor) y se completan los ocho puntos de la revisión: cuerpo en la redirección, `OutboundBlockedError` → 400, «solo unicast global» con `net.BlockList`, fijar la conexión a la IP comprobada (`undici` `Agent` + `connect.lookup`, SNI y `Host` originales) con la prueba `DNS rebinding window` en verde, pruebas de `HttpMcpClient`, rechazo de `Request` como entrada, nota en `docs/conectores.md`. Es el hueco de seguridad abierto y está especificado al detalle.
  - **Hecho el 2026-10-27**, rama local `wf/08-guardia`: fusión de la rama de Oscar (su commit `826b5e3` conservado) más los ocho puntos. Puertas: tipado OK, 298 pruebas (api 140, operator 45, format 22, runtime 12, connectors 16, server 48, assistant 15), banco 15/15, banco del estudio 12/12, e2e 9/9 y 8/8, `salud.js` limpio. Decisiones:
    - `isInternalHost` invierte la regla: **solo unicast global** pasa (`net.BlockList` con privadas, enlace local, CGNAT, documentación, benchmark, multicast, reservadas, y los rangos IPv6 que embeben IPv4: mapeadas, NAT64, 6to4, Teredo). Punto fino: `BlockList` juzga las mapeadas (`::ffff:a.b.c.d`) por las reglas IPv4 por sí solo; listar `::ffff:0:0/96` bloqueaba **todo** IPv4. `localhost.`, `[::1]` y las zonas (`%eth0`) se normalizan antes de mirar.
    - La conexión se fija a las direcciones comprobadas con `undici` (`Agent` + `connect.lookup`, dependencia nueva de `apps/api`, JS puro): el `lookup` solo conoce lo que la guardia resolvió; en política estricta un nombre sin comprobar se rechaza, en desarrollo responde el sistema. Prueba con un nombre `.invalid` que solo la guardia resuelve: la petición no llega al servidor local y el sistema no se consulta.
    - `OutboundBlockedError` → 400 en `fail()`; `body: body ?? null` al pasar a GET; un `Request` como entrada se rechaza con `TypeError`.
    - `guardedFetch` también envuelve el *grant* del estudio y los webhooks de aprobación, no solo los conectores.
    - Las 23 pruebas de la revisión viven en `apps/api/src/outbound.test.ts` (servidores HTTP reales); `review/pr1-pruebas` en GitHub queda obsoleta. La PR #1 de Oscar se cierra cuando `wf/08-guardia` llegue a `main` (César).
- **8.2 P2 filtro de operaciones al importar** — sin clave. Desbloquea cualquier API real.
  - **Hecho el 2026-10-27**, rama local `wf/08-filtro`. Puertas: tipado OK, 307 pruebas (api 143, operator 46, format 22, runtime 12, connectors 21, server 48, assistant 15), banco 15/15, banco del estudio 12/12, demo compilada, e2e 9/9 y 8/8, `salud.js` limpio. Decisiones:
    - Contrato en `packages/connectors/src/filter.ts`: reglas `GET`, `/ruta` (prefijo **por segmentos**: `/citas` vale para `/citas/{id}`, no para `/citasx`), `GET /ruta` y `tag:x`; `include` se queda (vacío = todas), `exclude` quita, `maxTools` 200 por defecto y 500 como mucho. Una regla mal escrita no pasa el esquema.
    - El filtro **se guarda en el conector** (`manifest.filter`) y el refresco lo vuelve a aplicar; la revisión puede cambiarlo y el siguiente «Actualizar» lo aplica (sin borrar el conector ni perder lo aprobado). `source.operations` guarda cuántas tenía la especificación.
    - Un filtro que no deja nada, o que deja más de `maxTools`, es un 400 que dice cómo acotar. Entra por la petición de importación, por `connectors[].filter` del manifiesto (solo fuente `openapi`, con `refine`) y por el formulario de la demo (una regla por línea, «-» excluye).
    - Especificación hasta **20 MB** con lectura acotada por trozos: se corta al pasar el tope aunque el servidor no anuncie (o mienta en) `content-length`; timeout de descarga a 30 s.
    - Queda para después: búsqueda de herramientas bajo demanda cuando aun filtrado haya muchas; OpenAPI en YAML.
- **8.3 P1 identidad JWT/OIDC por manifiesto** — sin clave. `identity { jwks | secretEnv, issuer, audience, claims }`; test por cada rechazo.
  - **Hecho el 2026-10-27**, rama local `wf/08-identidad`. Puertas: tipado OK, 315 pruebas (api 150, operator 47, format 22, runtime 12, connectors 21, server 48, assistant 15), banco 15/15, banco del estudio 12/12, e2e 9/9 y 8/8, `salud.js` limpio. Decisiones:
    - `identity` en el manifiesto (`hostIdentitySchema`): `hs256` con `secretEnv` (nunca el secreto) o `jwks` con `url` y `algorithms` (RS256, ES256); `issuer` y `audience` obligatorios; `claims { id: sub, name, role, roles, defaultRole }`; `leewaySeconds` 60.
    - Verificador `apps/api/src/identity.ts` con `node:crypto`: el algoritmo lo fija el manifiesto (nada de `alg: none` ni confusión HS256/RS256), `exp` obligatorio, `nbf`, `iss`, `aud` (cadena o lista). JWKS por la guardia de salida, caché 10 min, recarga ante `kid` desconocido como mucho una vez por minuto, y una caída del JWKS no tira las claves en caché. Verificaciones concurrentes comparten una descarga (hubo una carrera: la primera marcaba «cargado» antes de terminar).
    - `principalOf` prueba primero los tokens propios y después el JWT del host; el motivo del rechazo va al log, el cliente recibe 401 genérico. `/operator/info` enseña `host.identity` solo cuando está configurada. Sin cambios en `<vex-assistant>`: `getToken` ya entrega lo que el host tenga.
    - Tests con claves RSA y EC reales generadas al vuelo (`identity.test.ts`): aceptación, cada rechazo con su motivo, mapa de papeles, caché y recarga, y de punta a punta en Vex Core (admin por papel traducido, 403, 401, auditoría con la identidad del host, login de demo intacto).
    - Queda: OAuth por usuario para los conectores (identidad ≠ herramientas) y el `PlatformClient` real.
- **Paso 4** en cuanto haya clave (se intercala donde toque): medir los dos bancos y fijar mínimos.
- **8.4 P3 ver el efecto** — sin clave para el mecanismo; casos en el banco en modo guion.
- **8.5 P4 modo presentador** — sin clave; e2e de un guion de cinco escenas.
- **Paso 6 driver DOM** — solo con cifras de inyección (paso 4).
- **8.6 P5 escaneo** — después del paso 6, con Claude.
- Pendiente de César en GitHub: responder a la PR #3 (con esta revisión), cerrar la #2, proteger `main`.

### Cuándo están pulidas las bases
Un avatar del estudio opera en la demo con su personalidad y sus permisos; el banco con Claude supera el mínimo; la documentación cuenta lo que hay. Entonces se deciden repositorio y licencia y se publica.
