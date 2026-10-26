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

### Decisiones de César del 2026-10-25 (paso 0)
1. **Licencia: Apache-2.0, ya.** `LICENSE` y `NOTICE` en la raíz de `vex` (solo local). Los aportes de Oscar entran bajo la misma licencia (cláusula 5 de Apache-2.0). `avatarsin` es público y no tiene licencia: añadirla allí exige un push, que César tiene que aprobar.
2. **El operador se instala en cada cliente** (ni servicio central ni mixto). Cada instalación es de **un solo inquilino**, con su manifiesto. Desaparece el multi-inquilino del carril de infra de Oscar. Quedan en ese carril el contenedor instalable, `TokenService.verify` contra el JWT del host, la parada global y los límites de gasto.
3. **Una sola etiqueta**: `<vex-assistant>` envuelve el chat, la tarjeta de confirmación y el `<vex-avatar>` del estudio. `<vex-avatar>` sigue disponible por separado y el asistente admite un modo sin avatar.
4. **La IA la paga cada cliente con su clave** (en su `.env`). Vex trae límites configurables y activos por defecto: tope de tokens por usuario y día, tope mensual de la instalación, parada global y aviso al 80 %. Si se agota el tope o no hay clave, pasa a modo guion y lo dice. El asistente del estudio lo paga César.
5. **Oscar sigue en `avatarsin`** (público). No se le da acceso al estudio ni a `vex` por ahora. A la PR #2 se responde con la **versión corta** del borrador, la que no menciona el estudio.
6. **Se queda la fusión**: `Desktop\vex` es el repositorio de trabajo. `avatarsin` se añade como remoto de solo lectura y lo que César acepte allí se fusiona en `vex` (las rutas del operador coinciden). Al publicar, `vex` puede sustituir a `avatarsin` sin reescribir la historia. Riesgo: choques si Oscar toca los ficheros que cambia el paso 1 (`apps/api`, `packages/operator`). Conviene avisarle de qué zonas están en obras.

### Decisiones pendientes de César
7. Proveedor de imágenes para avatares realistas.
8. Proteger `main` en `Cagilc/avatarsin`: PR obligatoria con su aprobación y CI en verde. Es un ajuste de su cuenta y lo hace él; recomendado antes de publicar las respuestas a Oscar.
9. Publicar las respuestas a Oscar (`docs/borradores/`).

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

### Cuándo están pulidas las bases
Un avatar del estudio opera en la demo con su personalidad y sus permisos; el banco con Claude supera el mínimo; la documentación cuenta lo que hay. Entonces se deciden repositorio y licencia y se publica.
