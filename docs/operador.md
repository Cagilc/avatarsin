# Vex operador · prototipo (Hitos 0 y 1, tramos 1 y 2)

Vex como **operador** de una plataforma de negocio: recibe una petición en lenguaje natural, encadena acciones reales (buscar, abrir expediente, crear tarea, redactar y enviar correo) con los permisos del usuario que ha iniciado sesión, pide confirmación para lo irreversible y deja registro de todo. El avatar refleja en qué fase está. Contexto y decisión de arquitectura en `docs/vex-agente-viabilidad.md`.

## Qué hay

| Paquete | Qué es |
|---|---|
| `packages/operator` (`@vex/operator`) | **Hito 0.** Contratos con Zod (acciones y riesgo, política de permisos, eventos del operador, auditoría, tema y personalidad), la interfaz de proveedor de modelo y el **bucle del agente** (`runOperator`). Sin dependencias de vendedor. Incluye `ScriptedProvider`, un planificador determinista por palabras clave para demos y tests sin clave. 25 tests. |
| `apps/api` (`@vex/api`) | **Hito 1.** Vex Core: servicio Fastify con el bucle, el driver de plataforma (seis herramientas), tokens firmados, confirmaciones con vista previa, parada, auditoría y conversaciones en SQLite, el registro de conectores y el adaptador de Claude (SDK oficial, streaming, caché del system prompt). Trae una **plataforma simulada** en memoria (`src/platform/mock.ts`) con contactos, expedientes, tareas y correos. 49 tests por HTTP, con la puerta del banco de encargos y los de seguridad. |
| `packages/assistant` (`@vex/assistant`) | **Paso 2.** `<vex-assistant>`: el panel del operador en una etiqueta sin framework (chat, pasos, tarjeta de confirmación, Detener, el `<vex-avatar>` del estudio dirigido por fases), el cliente SSE de Vex Core y el registro de elementos de la página. Compilado a `dist/vex-assistant.js`, que Vex Core sirve. |
| `apps/operator-demo` | Página que hace de plataforma anfitriona: listas de contactos/expedientes/tareas/correos, selección como contexto de pantalla y `<vex-assistant>` con el token y el contexto puestos por propiedades. `#estados` conserva el laboratorio del avatar antiguo (`@vex/avatar`). |

## Arrancar

```bash
pnpm install
pnpm dev:api     # Vex Core en http://127.0.0.1:8787
pnpm dev:demo    # demo en http://localhost:5174
```

Sin `ANTHROPIC_API_KEY`, Vex Core arranca en **modo guion**: entiende peticiones como "Busca a Laura Pérez, abre expediente de residencia, crea una tarea para extranjería y mándale un correo pidiendo documentación" y las ejecuta paso a paso, pero no conversa. Para usar Claude: copia `apps/api/.env.example` a `apps/api/.env` y pon la clave. El modelo por defecto es `claude-opus-5-5` (`VEX_MODEL`).

## Cómo funciona una petición

1. La página manda `POST /operator/chat` con el mensaje, el `sessionId` (si ya hay conversación) y el **contexto de pantalla** (`{ pantalla, contactoId, expedienteId }`, las claves que declara el manifiesto del host). El token va en `Authorization: Bearer`.
2. Vex Core responde con un flujo **SSE** de eventos (`packages/operator/src/schema/events.ts`): `phase`, `text` (streaming), `tool_call`, `tool_result`, `effect` (lo que una escritura dejó, leído de vuelta), `confirm`, `notice`, `done`, `error`, `cancelled`.
3. El bucle (`runOperator`) pide al modelo qué hacer; por cada herramienta pedida: valida los parámetros con su esquema, consulta la **política** (`decide`: permitir / confirmar / denegar), si toca confirmación emite `confirm` y **se queda parado** hasta que llega `POST /operator/confirm`, ejecuta, registra en la auditoría y devuelve el resultado al modelo. Repite hasta que el modelo responde en texto o se agotan los pasos (8).
4. El avatar: el *director* del host (`apps/operator-demo/src/director.ts`) traduce fases a estados del rig (`thinking`, `working`, `listening` mientras espera el OK, `talking` con visemas al llegar la respuesta, `success` si todo salió bien).

## Contratos (Hito 0)

- **Acción** (`schema/action.ts`): `tool`, `driver` (`platform` · `api` · `mcp` · `studio` · `dom` · `files` · `windows`), `risk` (`read` · `write` · `irreversible`), `params` validados, `summary` en una frase humana.
- **Política** (`schema/policy.ts`): `allow` / `deny` por nombre de herramienta, comodín de driver (`platform:*`) o `*`; `confirm` lista los niveles de riesgo que paran el bucle. Por defecto: todo el driver de plataforma, confirmar lo irreversible. `deny` gana a `allow`; lo no permitido se deniega.
- **Principal** (`schema/action.ts`): quién es el usuario; el operador nunca tiene más poder que él. Dos tokens valen: el que firma el propio servidor (`TokenService` en `apps/api/src/auth.ts`, HMAC con caducidad; el login de demo emite estos) y, con `identity` en el manifiesto, el **JWT del host** verificado por `apps/api/src/identity.ts` (sección del manifiesto más abajo).
- **Auditoría** (`schema/audit.ts`): una línea por acción con usuario, parámetros, lo confirmado, resultado y duración. Se guarda en SQLite (`apps/api/data/vex.db`, ignorado por git) y se consulta por usuario en `GET /operator/audit`.
- **Tema y personalidad** (`schema/theme.ts`): los 9 colores del rig y el comportamiento (nombre, tono, saludo, duración del habla). La personalidad entra en el system prompt; el tema está listo para aplicarse como variables CSS.
- **Manifiesto del host y *grant*** (`schema/host.ts`): lo que la plataforma declara (nombre, dominio, contexto de pantalla, conectores propuestos, política, avatar, interruptores) y lo que el estudio firma para una integración (herramientas, riesgo máximo, orígenes, caducidad), con la regla `permittedTools` = aprobado ∩ política ∩ *grant*. Sección propia más abajo.

## Herramientas del driver de plataforma

| Herramienta | Riesgo | Qué hace |
|---|---|---|
| `buscar` | lectura | contactos y expedientes por nombre, email, etiqueta o referencia |
| `leer_expediente` | lectura | expediente con contacto y tareas |
| `crear_expediente` | escritura | abre expediente para un contacto existente |
| `crear_tarea` | escritura | tarea asignada a un equipo (extranjeria, marketing, administracion, ventas) |
| `redactar_correo` | escritura | borrador; no envía |
| `enviar_correo` | **irreversible** | envía un borrador; pide confirmación |

Para conectar la plataforma real: implementar `PlatformClient` (`apps/api/src/platform/types.ts`) con llamadas HTTP a vuestro backend, pasando el token del usuario; sustituir `MockPlatform` en `server.ts`. Las herramientas no cambian.

## El manifiesto del host (paso 1 del plan maestro)

Lo que una plataforma declara sobre sí misma para que Vex la opere, en un JSON validado por `packages/operator/src/schema/host.ts`. **Vive en el servidor** (`VEX_HOST_MANIFEST`: un nombre de preset de `presets/<nombre>/manifest.json` o una ruta); nunca llega del navegador. Sin manifiesto, Vex Core se comporta exactamente como antes.

| Campo | Qué hace |
|---|---|
| `host.name`, `host.domain` | Cómo nombra el prompt a la plataforma («el operador de Demo Negocio») y el dominio donde se incrusta. |
| `screenContext` | Las claves que la página envía con cada mensaje, descritas para el modelo. El prompt ya no nombra ningún dominio de negocio: lo pone el manifiesto. |
| `connectors[]` | **Propuestas**: al arrancar entran en el registro como «Sin revisar», igual que una importación a mano. Nada llega al modelo hasta que un administrador las revisa; un id que ya existía se deja como lo dejó la persona; una fuente inalcanzable o que la política de salida rechaza se anota en `/operator/info` y el servidor arranca igual. Una fuente `openapi` admite `filter { include, exclude, maxTools }` para decir qué operaciones entran (reglas `GET`, `/ruta`, `GET /ruta`, `tag:x`; ver `docs/conectores.md`). |
| `policy` | La política de permisos del host. Lo que la política deniega ni siquiera se ofrece al modelo. |
| `avatar` | El avatar publicado por el estudio para esta integración: `endpoint`, `publicKey` y `keyId`. Con él, Vex Core pide el *grant* firmado y lo aplica (abajo). |
| `identity` | Cómo se verifican los **JWT del propio host**, para que una persona entre en Vex con la identidad que el host ya le dio. `kind: hs256` con `secretEnv` (el nombre de la variable, nunca el secreto) o `kind: jwks` con la `url` de sus claves públicas (RS256 y ES256; se descarga por la guardia de salida, se cachea 10 min y se vuelve a pedir una vez ante un `kid` desconocido, no más de una vez por minuto). `issuer` y `audience` se comprueban siempre, `exp` es obligatorio (`leewaySeconds` de margen, 60). `claims` dice de dónde salen `id` (`sub`), `name` y `role`, y `roles` traduce los papeles del host a los de Vex (`admin` revisa conectores); un papel sin traducción se rechaza, y sin claim de papel vale `defaultRole` si lo hay. El `id` resultante es el que usan sesiones, auditoría y límites de gasto. El host entrega el JWT con `getToken`; los tokens propios de Vex Core siguen valiendo. Sin `identity`, solo estos. |
| `features` | Interruptores de los pasos siguientes (tours, anuncios, botones rápidos, driver DOM). Todos apagados; con todo apagado, las herramientas y la política son idénticas a las de un servidor sin manifiesto (hay un test que lo compara). |
| `announcements`, `quickActions` | Novedades y accesos rápidos (paso 3, sección propia más abajo). |
| `tours` | Recorridos guiados por la página con la mascota (paso 5, sección propia más abajo). |
| `scripts`, `presenter` | Guiones de demo para un presentador y el gancho de reinicio del host, solo con `features.presenter` (sección propia más abajo). |

Un manifiesto que no valida para el arranque con el fichero, el campo y el motivo (`VEX_HOST_MANIFEST: …/manifest.json: manifiesto del host no válido. host.name: …`).

**La regla de los tres permisos.** Lo que Vex puede ejecutar = herramientas aprobadas por una persona ∩ política del manifiesto ∩ *grant* firmado de la integración (`permittedTools`). Cada capa solo quita; ninguna añade lo que otra dejó fuera. La política sigue decidiendo, llamada a llamada, si lo que queda pide confirmación. `leer_guia` es la documentación de los conectores, no una acción del host: la política puede negarla, el *grant* no la lista.

**El *grant* del estudio** (`apps/api/src/grant.ts`). Vex Core lo descarga de `<endpoint>/grant` (la URL pasa por la misma política de salida que cualquier importación), comprueba por este orden la forma del sobre, el `keyId`, la firma Ed25519 sobre los bytes recibidos, el contenido, que uno de sus orígenes esté en `host.domain` y que no haya caducado. Caduca a los 10 minutos de emitirse y se vuelve a pedir; una respuesta (válida o no) se reutiliza un minuto, así que una integración revocada deja de operar en un minuto como mucho y un estudio caído no recibe una petición por mensaje. Si el estudio no responde, se conserva el último *grant* válido hasta su caducidad; cualquier otro fallo (firma, clave, dominio, revocación) deja a Vex **sin herramientas**, no con las de antes. Estado visible en `GET /operator/info` (`grant.status`: `none`, `ok`, `invalid`, `expired`, `foreign`, `unavailable`).

**Presets.** `presets/demo-negocio/` es la plataforma de la demo (con él corre el banco de encargos). `presets/agenda/` es un **segundo host sin una línea de código propia**: propone la agenda de `apps/sample-tools` y su política solo permite conectores y la guía; tras la revisión, Vex opera la agenda y no ve las herramientas de la plataforma de demo. Pruebas de todo esto en `apps/api/src/host.test.ts` y `packages/operator/src/host.test.ts`.

## El asistente incrustable `<vex-assistant>` (paso 2 del plan maestro)

Todo el panel del operador en una etiqueta, sin framework (`packages/assistant`, `@vex/assistant`): el chat, los pasos de cada encargo, la tarjeta de confirmación con lo que va a salir de verdad, **Detener**, y el `<vex-avatar>` que el estudio publicó para este host, dirigido por las fases del operador. Vex Core sirve el script compilado en `GET /assistant.js` (`pnpm build`), así que una página lo integra con dos líneas:

```html
<script type="module" src="https://vex.example/assistant.js"></script>
<vex-assistant api="https://vex.example"></vex-assistant>
```

- **El token nunca va en el DOM.** El host lo entrega con una función: `el.getToken = async () => tokenParaVex()`. Con `identity` en el manifiesto, ese token puede ser el **JWT que el host ya emite** para su sesión (mismo emisor y audiencia que declara el manifiesto): no hace falta ningún intercambio. En un Vex Core local, el atributo `demo-user="u-cesar"` entra como usuario de demo (esa ruta no existe en un servidor público).
- **Propiedades**: `context` (lo que el usuario tiene abierto; viaja con cada mensaje y se ve en el pie), `principal` (quién actúa, para la cabecera), `suggestions`, `registry`. **Eventos**: `vex-ready`, `vex-phase`, `vex-state`, `vex-turn` (un encargo terminó: el host refresca sus listas), `vex-effect` (una escritura comprobada: `detail { id, tool, readTool, confirmed, summary, details, target }`, para refrescar justo lo que cambió), `vex-notice`, `vex-avatar`, `vex-error`. **Métodos**: `send`, `stop`, `reset`, `refresh`.
- **El avatar** sale de `GET /operator/info` → `host.avatar` (el `endpoint`, la clave pública y el `keyId` del manifiesto, valores públicos como en el fragmento del estudio). Sin avatar en el manifiesto, o con `avatar="off"`, el panel funciona sin él. El **director** (`director.ts`) traduce fases a los estados del estudio: pensando y trabajando → `think`, escuchando y esperando el OK → `attention`, respuesta → `talk` durante `talkMs`, todo bien → `happy` un momento, error → `error`, y `wave` al cargar.
- **La personalidad publicada llega al prompt.** Con un *grant* válido, Vex Core descarga también el paquete firmado, lo verifica con la misma clave y convierte su personalidad (nombre, tono, formalidad, extensión, emojis, idioma, saludo, descripción) en la del prompt (`apps/api/src/personality.ts`). Un paquete alterado no cambia nada: se queda la personalidad del servidor.
- **Registro de elementos** (`registry.ts`). Vex solo sabe de los elementos que el host le presenta: `data-vex-id="…"` en el marcado (con `data-vex-risk` opcional) o `registry.register(id, el, { risk, label })` desde código. `registry.snapshot()` describe cada uno (rol, etiqueta, valor o texto; 200 como máximo). **Los campos privados nunca se leen**: lo marcado con `data-vex-private`, lo que cuelga de ello y los campos que son secretos por su propio tipo (contraseñas, `hidden`, archivos, `autocomplete` de tarjetas y códigos de un solo uso) quedan fuera del todo, id incluido; la prueba lo demuestra con campos que lanzan si alguien lee su valor. Hoy nadie consume la instantánea: es la base de los tours y del driver DOM de los pasos siguientes.
- La **demo React** usa la misma etiqueta (`apps/operator-demo`): las listas y la selección del contexto siguen en React; el panel es `<vex-assistant>` con el token, el contexto y las sugerencias puestos por propiedades. El e2e del operador (`pnpm e2e`) pasa sin tocar sus selectores. Una página sin nada de framework está en `examples/asistente.html`.
- **Comprobado en navegador** (`pnpm e2e:studio`, `tests/asistente.spec.ts`): se diseña y publica un avatar en el estudio, se crea su integración, la prueba escribe un manifiesto que la nombra y arranca un Vex Core con él; el avatar se dibuja en la demo con el nombre publicado, cambia de estado al esperar el OK y al terminar, y una página HTML simple lo usa con dos líneas y deja fuera un campo de contraseña del registro.

## Anuncios y botones rápidos (paso 3 del plan maestro)

Lo que un host enseña a sus usuarios **sin modelo**: novedades y accesos rápidos. Vienen del manifiesto (`announcements`, `quickActions`; esquemas en `packages/operator/src/schema/engage.ts`), se filtran por el **rol del token** y por fechas (`since`, `until`), y solo se sirven con `features.announcements` / `features.quickActions` encendidos: apagados, las rutas devuelven vacío y el panel no enseña nada.

| Ruta | Quién | Qué |
|---|---|---|
| `GET /engage/announcements` | usuario | Los anuncios de su rol y del momento, con `seen` |
| `POST /engage/announcements/:id/seen` | usuario | «Entendido»: no vuelve a salir para esa persona |
| `GET /engage/quick-actions` | usuario | Sus botones (máximo 6); un botón con herramienta solo si el bucle podría ejecutarla (política y *grant*) |
| `POST /engage/quick-actions/:id/run` | usuario | Un botón de **prompt** es un mensaje al chat; un botón con **herramienta** corre por el mismo bucle que una llamada del modelo (`DirectProvider`): validación, política, confirmación con la vista previa real, auditoría e historial. Devuelve el mismo SSE que `/operator/chat`. Herramienta denegada: 403 y una línea `denied` en la auditoría |
| `GET /engage/drafts` · `POST /engage/announcements/:id/publish` · `DELETE /engage/announcements/:id` | admin | Borradores de anuncio y su publicación |

**Borradores desde conectores.** Cuando una revisión activa herramientas nuevas (o las reactiva tras un cambio de contrato), Vex Core guarda un **borrador** de anuncio (`source: connector`) con los nombres y descripciones aprobados; queda en la auditoría como `borrador_anuncio`. Nadie lo ve hasta que un administrador lo publica, con el título y el texto que quiera. Los anuncios del manifiesto se editan en el manifiesto; los publicados desde borradores viven en el almacén (SQLite) junto al estado «visto» por persona.

**El modelo también las conoce.** Las novedades para todos (sin `roles`) entran en el system prompt como avisos del administrador, nunca como órdenes, para que Vex responda a «¿qué hay de nuevo?».

**En el panel.** `<vex-assistant>` pide anuncios y botones al conectar: los no vistos salen en una bandeja al principio de la conversación (texto plano, construido como nodos de texto: nunca HTML), con su acción (`cta`: un botón rápido o un enlace https) y «Entendido»; los botones van en una fila sobre el cuadro de texto. Un botón de prompt es `send(prompt)`; uno de herramienta, `runQuickAction(id)`. `presets/demo-negocio` trae tres botones y un anuncio de bienvenida. Pruebas: `apps/api/src/engage.test.ts` (por HTTP: rol, visto una vez, botón por el bucle con confirmación real, botón denegado, borradores) y el e2e de la página simple.

## Aprobaciones por canal (backlog A)

Lo irreversible sigue pidiendo confirmación con la vista previa real, pero la tarjeta ya no vive solo en la página. Con `features.channelApprovals` y `approvals.channels` en el manifiesto, cuando una petición se queda esperando el OK, Vex Core manda la tarjeta por cada canal:

- `{"kind":"webhook","url":"https://…","secretEnv":"VEX_HOOK_SECRET"}`: un `POST` JSON (`type: approval_requested`, sesión, acción, principal, herramienta, riesgo, resumen, `details` de la vista previa, parámetros, `approveUrl`, `expiresAt`) con cabeceras `x-vex-event` y, si hay secreto, `x-vex-signature: sha256=<HMAC del cuerpo>`. El host lo convierte en correo, mensaje o lo que use, y decide **a quién** se lo manda: así se delega una aprobación. La URL pasa la política de salida.
- `{"kind":"log"}`: la línea con el enlace en el registro del servidor (para probar en local).

El enlace (`VEX_PUBLIC_URL/approve/<token>`) abre una página del propio Vex Core con la tarjeta y dos botones; el token es un HMAC ligado a esa confirmación, caduca con ella (`VEX_CONFIRM_TIMEOUT_MS`, 5 min por defecto: súbelo si las aprobaciones viajan) y vale una sola vez. Resolverlo desde el enlace o desde la página es lo mismo: el bucle sigue o se detiene y el flujo SSE lo cuenta. El panel recibe un `notice` («Te he avisado por webhook…»). Cada envío queda en la auditoría (`avisar_aprobacion`, con error si el canal falló); un canal caído nunca bloquea la tarjeta. Pruebas: `apps/api/src/approvals.test.ts`.

## Límites de gasto y pausa (decisión 4 del plan maestro)

Cada cliente paga la IA con su clave, y Vex trae los frenos puestos de serie (`apps/api/src/spend.ts`):

- **Medición.** Cada respuesta del modelo se carga a la persona que la pidió (tokens: entrada, salida y caché) y a la instalación (coste estimado con la tabla de precios de `pricing.ts`, la misma que usa el banco). Se guarda en SQLite (`spend`) y sobrevive al reinicio. Los botones con herramienta no consultan el modelo y no se miden; una instalación en modo guion tampoco.
- **Topes, encendidos por defecto**: 300.000 tokens por persona y día (UTC) y 50 USD por instalación y mes (UTC). `VEX_LIMIT_USER_DAY_TOKENS`, `VEX_LIMIT_MONTH_USD` y `VEX_WARN_RATIO` (0,8) los ajustan; `0` quita un tope.
- **Al 80 %**, la respuesta lleva un aviso; **al tope**, la petición se ejecuta en modo guion y el flujo lo dice. Los dos llegan como evento `notice` del SSE, antes de la respuesta; `<vex-assistant>` lo enseña como una línea de aviso en el turno.
- **Pausa** para administradores: `POST /admin/pause {"mode":"ai"}` deja a Vex en modo guion; `"all"` responde 503 a chat y botones; `null` reanuda. Persiste en el almacén (`settings`) y queda en la auditoría (`pausar_vex`). `GET /admin/spend` da el mes (coste, llamadas, tope), el día por persona y los topes; `GET /operator/info` expone `pause` y `limits`.

Pruebas: `apps/api/src/spend.test.ts` (sumas por día y mes UTC, aviso y bloqueo, persistencia SQLite, el modelo no se consulta al tope, pausa `ai`/`all`/reanudar, auditoría).

## Tours con la mascota (paso 5 del plan maestro)

Un recorrido guiado por la página, **sin modelo**: la mascota sale del panel, se coloca junto a un elemento registrado, lo señala y explica; la persona avanza, o el paso avanza solo cuando pulsa o escribe en el elemento. Se declara en el manifiesto (`tours`, esquema en `packages/operator/src/schema/tour.ts`) y solo se sirve con `features.tours`.

- **Contrato**: `id`, `title`, `roles?`, `when` (`manual`: se ofrece en la bandeja; `first`: arranca solo la primera vez, hasta completarlo) y `steps[]` con `target` (id de elemento del registro, opcional: sin él habla desde el panel), `say` (texto plano), `pose` (`point` por defecto; también `talk`, `happy`, `wave`, `attention`, `celebrate`) y `advanceOn` (`next`, `click`, `input`).
- **Rutas**: `GET /engage/tours` (los de su rol, con `done`) y `POST /engage/tours/:id/done`. Lo completado se guarda por persona en el almacén.
- **Motor** (`packages/assistant/src/tour.ts`): máquina determinista sin DOM; un paso cuyo `target` no está en la página se salta y se anota (`skipped`), así el tour nunca se queda atascado. Saltar no cuenta como completar.
- **Puesta en escena** (`element.ts`): halo alrededor del elemento que **no captura clics**, burbuja con el texto (`role="dialog"`, `aria-live`), contador, «Siguiente/Terminar» y «Saltar»; `Escape` sale; el elemento se desplaza a la vista. La mascota viaja (transición CSS; con `prefers-reduced-motion` aparece sin viajar) y adopta la pose del paso; al terminar vuelve al panel y celebra.
- **«Señalar hacia» lo calcula el runtime**: el panel pasa al `<vex-avatar>` el atributo `aim` (grados en pantalla: 0 derecha, 90 abajo) y el runtime gira el brazo del lado correspondiente hasta esa dirección, encima de lo que haga el clip (`packages/runtime/src/aim.ts`). Ningún clip sabe dónde está el objetivo.
- **Estados nuevos del formato**: `point` y `celebrate` (ya son 10). El estudio les da animación de partida y el editor los lista; Vex los trae con su brazo derecho extendido y el salto de celebración.
- Fuera de este paso, anotado en el plan: logros y puntos, borradores de tour con IA (tras medir con Claude), y «pantalla cambia a mitad de tour» (hoy, el paso cuyo elemento desaparece se salta al llegar a él).

**Vex en el formato del estudio.** El avatar dibujado a mano (`assets/vex-2d`) entra ahora en el estudio con «Probar con Vex, el operador»: `apps/studio/scripts/vex-sample.ts` aplana el rig anidado en 37 grupos (`public/samples/vex.svg`) y `packages/format/src/samples/vex.ts` les pone el esqueleto, los pivotes, las poses como clips de los 8 estados y las **caras y visemas**: cada variante de ojos y de boca es una pieza, y los clips las encienden con pistas de opacidad a saltos; `talk` turna los nueve visemas. No hizo falta cambiar el formato. `packages/vex` (React) sigue solo para el laboratorio `#estados`.

## Modo presentador y guiones de demo (paso 8.5 del plan maestro)

Una demo en directo con IA libre es frágil; un **guion** la hace repetible. En el manifiesto, `scripts[]`: escenas con `say`, `pose`, `target` (elemento registrado al que señalar) y, opcionalmente, `action` (el id de un botón rápido) y `notes` (para el presentador). Solo con `features.presenter`; por rol como los tours. Nada avanza solo y no hay modelo salvo que la acción de una escena sea un botón de *prompt*.

- **`<vex-assistant presenter>`**: con el atributo, el panel pide los guiones (`GET /engage/scripts`) y expone `startScript(id)` y `scripts`. Un guion se dibuja sobre el mismo escenario que un tour (burbuja para el público, mascota que señala) más una **barra del presentador** abajo: guion y escena, las notas (nunca en la burbuja), botones y el **coste** del modelo tal como lo cuenta `spend.ts` (`GET /engage/presenter/spend`: tokens de la persona hoy y USD de la instalación este mes, con sus topes).
- **Teclas**: `→` siguiente, `←` anterior (vuelve a la escena anterior que esté en la página), `Enter` lanza la acción de la escena por el mismo bucle que el botón (política, confirmación, auditoría), `Esc` sale. Las escenas cuyo `target` no está en la página se saltan, como en los tours. Un guion no deja rastro en el servidor: se ensaya las veces que haga falta.
- **Reiniciar la demo**: `presenter.reset { url, secretEnv }` en el manifiesto. `POST /engage/presenter/reset` (solo `admin`, botón «Reiniciar demo» de la barra) manda al host un `POST` JSON `{ type: presenter_reset, host, principal, at }` por la guardia de salida, con `x-vex-event` y `x-vex-signature` (HMAC con el secreto que nombra `secretEnv`; sin él en el entorno, 500 antes que llamar sin firma). El host decide qué es «reiniciar». Queda en la auditoría como `reiniciar_demo`.
- **Eventos** `vex-script`: `start`, `step` (con `index` y `target`), `action`, `reset`, `done` o `left`.
- **Paquete de demo**: el preset `presets/demo-guiada` (tour de primera visita, tres botones, un guion de cinco escenas y el gancho de reinicio) y la web de muestra `apps/sample-tools/src/host-demo.ts` (`pnpm dev:host-demo`, puerto 8793), que registra elementos, refresca su lista de expedientes con `vex-effect` y **verifica la firma** del reinicio con `verifyVexSignature` (la función que un host copia). Guía paso a paso: `docs/vex-en-30-minutos.md`.

## Probar el avatar a mano

La demo tiene un **laboratorio del avatar** en `http://localhost:5174/#estados` (enlace en la cabecera): la secuencia completa de una petición reproducida en bucle (saluda → escucha → piensa → trabaja → espera tu OK → envía → habla → celebra), los 8 estados, las 5 expresiones, los 9 visemas y un control de tamaño para ver el nivel de detalle (cuerpo, busto, cabeza). Sirve para revisar el rig sin pasar por el operador y para comparar capturas tras cambiar el SVG.

## Tramo 1 · puesta a punto (2026-10-24)

**Detener.** `runOperator` acepta un `AbortSignal` y se para en el siguiente punto seguro: la llamada al modelo (aunque el proveedor ignore la señal), una confirmación pendiente o entre herramientas. Cada `tool_use` que no llegó a ejecutarse se cierra con un `tool_result` de error, así que la conversación sigue siendo válida para el siguiente mensaje. Emite `phase: idle` y el evento `cancelled`; la auditoría marca esas acciones como `cancelled`. Vex Core expone `POST /operator/stop {sessionId}` y además para el bucle si la página se cierra a mitad. La demo cambia Enviar por **Detener** mientras trabaja.

**La confirmación enseña lo real.** Una herramienta puede declarar `preview(input, ctx)`: una lectura del sistema de origen que se muestra en la tarjeta y queda en la auditoría (`details`). `enviar_correo` la usa para enseñar destinatario, asunto y cuerpo del borrador **tal como está guardado**, no lo que el modelo dice que contiene. Si la vista previa no se puede leer (borrador inexistente o de otro usuario), no se pregunta nada y la acción falla.

**Ver el efecto de una acción.** La tarjeta enseña lo que *va* a pasar; `verify` enseña lo que *pasó*. Una herramienta de escritura declara una **lectura** que confirma su efecto: `{ tool, params(input, output), confirms?(lectura), target? }`. Tras ejecutar con éxito, el bucle corre esa lectura **como cualquier otra** (política: tiene que estar permitida sin confirmación; validación de parámetros; línea propia en la auditoría con `actionId` `<id>:verify`) y emite `effect { id, tool, readTool, confirmed, summary, details?, target? }`. Al modelo se le pasa `[Comprobación de <herramienta>] …` como texto tras los resultados de las herramientas (el resultado de la escritura sigue siendo el dato tal cual), para que su respuesta pueda decir «comprobado». Una lectura que falla, que la política no permite o que no coincide **nunca convierte la acción en fallida**: solo dice «No se pudo comprobar» con el motivo. En la plataforma de muestra, `crear_expediente` se comprueba con `leer_expediente`; en los conectores, el importador sugiere la lectura por la forma de las rutas (`docs/conectores.md`). `<vex-assistant>` pinta la comprobación en el paso, emite el evento DOM `vex-effect` (el host refresca lo que cambió) y, si `target` es un elemento registrado (`data-vex-id`), el avatar lo señala un instante con un halo.

**Límites.** Máximo 25 acciones por mensaje (`maxToolCalls`; las sobrantes se deniegan) y 20 mensajes por usuario y minuto (`VEX_RATE_LIMIT`, responde 429). El proxy del modelo para Vex Studio (`POST /provider/complete`) gasta la clave sin token de usuario, así que solo se activa si el servidor escucha en local (`HOST=127.0.0.1`) o con `VEX_PROVIDER_PROXY=1`.

**Persistencia.** `OperatorStore` guarda la auditoría y las conversaciones. Por defecto, SQLite en `apps/api/data/vex.db` con el módulo `node:sqlite` de Node 24 (sin binario nativo, así que funciona con la directiva de Control de aplicaciones); `VEX_DB=memory` para no guardar nada. Al reiniciar, las conversaciones siguen donde estaban y nadie puede continuar la de otro usuario (403). Las confirmaciones pendientes no se guardan: tras un reinicio cuentan como rechazadas. El historial se recorta a 40 mensajes cortando solo antes de un mensaje de texto del usuario, para no separar nunca una llamada de su resultado.

**Modo guion más prudente.** Si no encuentra a la persona, se detiene sin abrir expedientes ni redactar correos; si se pide un correo sin destinatario, pregunta a quién. El banco de encargos destapó los dos fallos: antes enviaba a una dirección inventada.

## Banco de encargos

`apps/api/evals/cases.ts`: 24 peticiones reales con el resultado que deben dejar en la plataforma simulada (llamadas en orden, acciones prohibidas, correos y destinatarios exactos, expedientes y tareas nuevos, fragmentos de la respuesta, tope de acciones, usuario en la auditoría). Categorías: flujo, contexto, búsqueda, negativo (no debe hacer nada), **inyección** (notas, nombres y etiquetas que intentan dar órdenes al agente), permisos y lenguaje natural.

```bash
pnpm eval -- --provider scripted     # gratis: puerta de regresión (17 casos, los otros 21 son solo para Claude)
pnpm eval -- --provider anthropic    # mide a Claude de verdad: cuesta dinero, necesita la clave
pnpm eval -- --only flujo-laura-completo,negativo-sin-destinatario
pnpm eval -- --provider anthropic --min-pass inyeccion=1,flujo=0.9,*=0.8   # un mínimo por categoría, * para el resto
```

Cada ejecución deja un JSON y `apps/api/evals/reports/latest-<proveedor>.md` con acierto por categoría **y por sistema de registro** (`plataforma`, `citas`, `catalogo`, `crm`, `mixto`: tres hosts de muestra de tipos distintos, `docs/conectores.md`), latencia p50 y máxima, acciones por encargo y coste estimado. `--min-pass` juzga cada categoría contra su mínimo (`0.8` para todas, o `categoria=valor` con `*` para el resto) y sale con 1 si alguna queda por debajo. El modo guion pasa los 17 que entiende; **con Claude no se ha ejecutado todavía** porque no hay clave en este equipo. Los casos de inyección, de lenguaje natural, de conectores con texto libre y mixtos solo dicen algo con Claude.

**De una sesión real a un caso del banco.** Cada respuesta lleva 👍/👎 en el panel; el 👎 pide un motivo (opcional) y todo va a `POST /operator/feedback`, que solo guarda lo de la propia sesión. Un administrador lista las conversaciones con sus votos (`GET /admin/sessions`) y exporta un turno como borrador de caso (`GET /admin/sessions/:id/case?turn=n&anonymize=1`, `apps/api/src/cases.ts`): la petición y su contexto de pantalla salen del historial; de la auditoría salen las llamadas que funcionaron (en orden), las rechazadas o denegadas (`forbidden`), los correos y sus destinatarios tal como se confirmaron, los expedientes y tareas creados, las citas del conector y el usuario. Con `anonymize`, los correos y teléfonos se sustituyen por alias, los mismos en la petición y en las expectativas. Desde la terminal:

```bash
pnpm eval:export -- --list
```

```bash
pnpm eval:export -- --session <id> --turn 1 --anonymize
```

El caso se añade a `apps/api/evals/cases.local.json`, que el banco carga junto a los de `cases.ts`. Llega marcado `scripted: 'skip'` (el planificador por palabras clave no entiende texto libre) y con una nota que pide revisar las expectativas antes de darlo por bueno; los que pasen la revisión pueden moverse a `cases.ts`.

## Pruebas en navegador real

`e2e/` con Playwright: 9 pruebas que abren la demo y comprueban el flujo de cinco pasos con la tarjeta del correo real, el rechazo, **Detener**, el contexto de pantalla, la pregunta cuando falta destinatario el laboratorio del avatar (8 estados, 5 caras, 9 bocas, nivel de detalle por tamaño) y la conexión de una herramienta nueva de principio a fin (importar, revisar riesgos, usarla con confirmación). Adjuntan capturas del avatar en cada fase.

```bash
pnpm e2e
```

En local usan el **Edge instalado** (binario firmado: la directiva no lo bloquea) y reutilizan los servidores si ya están arrancados; en CI, el Chromium de Playwright y servidores nuevos con `VEX_DB=memory`. Las dos formas pasan en este equipo.

## Integración continua

`.github/workflows/ci.yml`, en cada push a `main` y en cada pull request: typecheck, tests, banco de encargos en modo guion y las pruebas de navegador; sube el informe de Playwright como artefacto. A mano (Actions › CI › Run workflow, casilla "claude_eval") ejecuta además el banco con Claude usando el secreto `ANTHROPIC_API_KEY` del repositorio y falla por debajo del acierto mínimo (0,8 por defecto).

## Comprobado

- Tests: `pnpm test` (operator 39, connectors 16, api 66 con la puerta del banco, los de seguridad y los del manifiesto), `pnpm eval` 15/15 en modo guion con el preset `demo-negocio` (13 casos reservados para Claude), `pnpm e2e` 9/9 en Edge, `pnpm build` de la demo en producción.
- Navegador (2026-10-24): la tarjeta muestra para, asunto y cuerpo reales; Detener deja el paso de envío como "detenido", no sale ningún correo y vuelve el botón Enviar.

## Seguridad que ya está y la que falta

Modelo de amenazas, defensas y lo que falta antes de producción: `docs/seguridad.md`. En resumen: tokens firmados y con caducidad, login de demo solo en local, navegadores solo desde las páginas listadas, rutas de administración por rol, servidores MCP locales solo por línea de comando exacta, URL de importación solo https y públicas, política que no amplía lo aprobado, validación por esquema, topes de rondas, acciones y mensajes, parada, sesiones y auditoría por usuario, y el contenido de las herramientas tratado como dato. Falta: autenticación real de la plataforma, TLS, medir la inyección con Claude, límite de gasto y parada global.

## Siguiente

- Ejecutar el banco con Claude y fijar el acierto mínimo con datos.
- Conectar el backend real (adaptador HTTP de `PlatformClient` + verificación del JWT).
- Tramo 2 hecho: conectores desde OpenAPI y MCP con el riesgo aprobado por una persona. Ver `docs/conectores.md`.
