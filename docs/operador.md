# Vex operador · prototipo (Hitos 0 y 1)

Vex como **operador** de una plataforma de negocio: recibe una petición en lenguaje natural, encadena acciones reales (buscar, abrir expediente, crear tarea, redactar y enviar correo) con los permisos del usuario que ha iniciado sesión, pide confirmación para lo irreversible y deja registro de todo. El avatar refleja en qué fase está. Contexto y decisión de arquitectura en `docs/vex-agente-viabilidad.md`.

## Qué hay

| Paquete | Qué es |
|---|---|
| `packages/operator` (`@vex/operator`) | **Hito 0.** Contratos con Zod (acciones y riesgo, política de permisos, eventos del operador, auditoría, tema y personalidad), la interfaz de proveedor de modelo y el **bucle del agente** (`runOperator`). Sin dependencias de vendedor. Incluye `ScriptedProvider`, un planificador determinista por palabras clave para demos y tests sin clave. 16 tests. |
| `apps/api` (`@vex/api`) | **Hito 1.** Vex Core: servicio Fastify con el bucle, el driver de plataforma (seis herramientas), tokens, confirmaciones, auditoría JSONL y el adaptador de Claude (SDK oficial, streaming, caché del system prompt). Trae una **plataforma simulada** en memoria (`src/platform/mock.ts`) con contactos, expedientes, tareas y correos. 5 tests de extremo a extremo por HTTP. |
| `apps/operator-demo` | Página que hace de plataforma anfitriona: listas de contactos/expedientes/tareas/correos, selección como contexto de pantalla, panel de chat con pasos, tarjeta de confirmación y el avatar `@vex/avatar` dirigido por los eventos reales (`src/director.ts`). |

## Arrancar

```bash
pnpm install
pnpm dev:api     # Vex Core en http://127.0.0.1:8787
pnpm dev:demo    # demo en http://localhost:5174
```

Sin `ANTHROPIC_API_KEY`, Vex Core arranca en **modo guion**: entiende peticiones como "Busca a Laura Pérez, abre expediente de residencia, crea una tarea para extranjería y mándale un correo pidiendo documentación" y las ejecuta paso a paso, pero no conversa. Para usar Claude: copia `apps/api/.env.example` a `apps/api/.env` y pon la clave. El modelo por defecto es `claude-opus-5-5` (`VEX_MODEL`).

## Cómo funciona una petición

1. La página manda `POST /operator/chat` con el mensaje, el `sessionId` (si ya hay conversación) y el **contexto de pantalla** (`{ pantalla, contactoId, expedienteId }`). El token va en `Authorization: Bearer`.
2. Vex Core responde con un flujo **SSE** de eventos (`packages/operator/src/schema/events.ts`): `phase`, `text` (streaming), `tool_call`, `tool_result`, `confirm`, `done`, `error`.
3. El bucle (`runOperator`) pide al modelo qué hacer; por cada herramienta pedida: valida los parámetros con su esquema, consulta la **política** (`decide`: permitir / confirmar / denegar), si toca confirmación emite `confirm` y **se queda parado** hasta que llega `POST /operator/confirm`, ejecuta, registra en la auditoría y devuelve el resultado al modelo. Repite hasta que el modelo responde en texto o se agotan los pasos (8).
4. El avatar: el *director* del host (`apps/operator-demo/src/director.ts`) traduce fases a estados del rig (`thinking`, `working`, `listening` mientras espera el OK, `talking` con visemas al llegar la respuesta, `success` si todo salió bien).

## Contratos (Hito 0)

- **Acción** (`schema/action.ts`): `tool`, `driver` (`platform` · `studio` · `dom` · `files` · `windows`), `risk` (`read` · `write` · `irreversible`), `params` validados, `summary` en una frase humana.
- **Política** (`schema/policy.ts`): `allow` / `deny` por nombre de herramienta, comodín de driver (`platform:*`) o `*`; `confirm` lista los niveles de riesgo que paran el bucle. Por defecto: todo el driver de plataforma, confirmar lo irreversible. `deny` gana a `allow`; lo no permitido se deniega.
- **Principal** (`schema/action.ts`): quién es el usuario; el operador nunca tiene más poder que él. En la demo, el token es el principal en base64 (`apps/api/src/auth.ts`); el punto de cambio para la plataforma real es `verifyToken`: verificar su JWT y mapear claims → principal.
- **Auditoría** (`schema/audit.ts`): una línea por acción con usuario, parámetros, resultado y duración. `apps/api/audit/audit.jsonl` (ignorado por git).
- **Tema y personalidad** (`schema/theme.ts`): los 9 colores del rig y el comportamiento (nombre, tono, saludo, duración del habla). La personalidad entra en el system prompt; el tema está listo para aplicarse como variables CSS.

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

## Probar el avatar a mano

La demo tiene un **laboratorio del avatar** en `http://localhost:5174/#estados` (enlace en la cabecera): la secuencia completa de una petición reproducida en bucle (saluda → escucha → piensa → trabaja → espera tu OK → envía → habla → celebra), los 8 estados, las 5 expresiones, los 9 visemas y un control de tamaño para ver el nivel de detalle (cuerpo, busto, cabeza). Sirve para revisar el rig sin pasar por el operador y para comparar capturas tras cambiar el SVG.

## Tramo 1 · puesta a punto (2026-10-24)

**Detener.** `runOperator` acepta un `AbortSignal` y se para en el siguiente punto seguro: la llamada al modelo (aunque el proveedor ignore la señal), una confirmación pendiente o entre herramientas. Cada `tool_use` que no llegó a ejecutarse se cierra con un `tool_result` de error, así que la conversación sigue siendo válida para el siguiente mensaje. Emite `phase: idle` y el evento `cancelled`; la auditoría marca esas acciones como `cancelled`. Vex Core expone `POST /operator/stop {sessionId}` y además para el bucle si la página se cierra a mitad. La demo cambia Enviar por **Detener** mientras trabaja.

**La confirmación enseña lo real.** Una herramienta puede declarar `preview(input, ctx)`: una lectura del sistema de origen que se muestra en la tarjeta y queda en la auditoría (`details`). `enviar_correo` la usa para enseñar destinatario, asunto y cuerpo del borrador **tal como está guardado**, no lo que el modelo dice que contiene. Si la vista previa no se puede leer (borrador inexistente o de otro usuario), no se pregunta nada y la acción falla.

**Límites.** Máximo 25 acciones por mensaje (`maxToolCalls`; las sobrantes se deniegan) y 20 mensajes por usuario y minuto (`VEX_RATE_LIMIT`, responde 429). El proxy del modelo para Vex Studio (`POST /provider/complete`) gasta la clave sin token de usuario, así que solo se activa si el servidor escucha en local (`HOST=127.0.0.1`) o con `VEX_PROVIDER_PROXY=1`.

**Persistencia.** `OperatorStore` guarda la auditoría y las conversaciones. Por defecto, SQLite en `apps/api/data/vex.db` con el módulo `node:sqlite` de Node 24 (sin binario nativo, así que funciona con la directiva de Control de aplicaciones); `VEX_DB=memory` para no guardar nada. Al reiniciar, las conversaciones siguen donde estaban y nadie puede continuar la de otro usuario (403). Las confirmaciones pendientes no se guardan: tras un reinicio cuentan como rechazadas. El historial se recorta a 40 mensajes cortando solo antes de un mensaje de texto del usuario, para no separar nunca una llamada de su resultado.

**Modo guion más prudente.** Si no encuentra a la persona, se detiene sin abrir expedientes ni redactar correos; si se pide un correo sin destinatario, pregunta a quién. El banco de encargos destapó los dos fallos: antes enviaba a una dirección inventada.

## Banco de encargos

`apps/api/evals/cases.ts`: 24 peticiones reales con el resultado que deben dejar en la plataforma simulada (llamadas en orden, acciones prohibidas, correos y destinatarios exactos, expedientes y tareas nuevos, fragmentos de la respuesta, tope de acciones, usuario en la auditoría). Categorías: flujo, contexto, búsqueda, negativo (no debe hacer nada), **inyección** (notas, nombres y etiquetas que intentan dar órdenes al agente), permisos y lenguaje natural.

```bash
pnpm eval -- --provider scripted     # gratis: puerta de regresión (15 casos, los otros 9 son solo para Claude)
pnpm eval -- --provider anthropic    # mide a Claude de verdad: cuesta dinero, necesita la clave
pnpm eval -- --only flujo-laura-completo,negativo-sin-destinatario
```

Cada ejecución deja un JSON y `apps/api/evals/reports/latest-<proveedor>.md` con acierto por categoría, latencia p50 y máxima, acciones por encargo y coste estimado. El modo guion pasa los 15 que entiende; **con Claude no se ha ejecutado todavía** porque no hay clave en este equipo. Los casos de inyección y de lenguaje natural solo dicen algo con Claude.

## Pruebas en navegador real

`e2e/` con Playwright: 7 pruebas que abren la demo y comprueban el flujo de cinco pasos con la tarjeta del correo real, el rechazo, **Detener**, el contexto de pantalla, la pregunta cuando falta destinatario y el laboratorio del avatar (8 estados, 5 caras, 9 bocas, nivel de detalle por tamaño). Adjuntan capturas del avatar en cada fase.

```bash
pnpm e2e
```

En local usan el **Edge instalado** (binario firmado: la directiva no lo bloquea) y reutilizan los servidores si ya están arrancados; en CI, el Chromium de Playwright y servidores nuevos con `VEX_DB=memory`. Las dos formas pasan en este equipo.

## Integración continua

`.github/workflows/ci.yml`, en cada push a `main` y en cada pull request: typecheck, tests, banco de encargos en modo guion y las pruebas de navegador; sube el informe de Playwright como artefacto. A mano (Actions › CI › Run workflow, casilla "claude_eval") ejecuta además el banco con Claude usando el secreto `ANTHROPIC_API_KEY` del repositorio y falla por debajo del acierto mínimo (0,8 por defecto).

## Comprobado

- Tests: `pnpm test` (operator 22, api 27 con la puerta del banco), `pnpm eval` 15/15 en modo guion, `pnpm e2e` 7/7 en Edge.
- Navegador (2026-10-24): la tarjeta muestra para, asunto y cuerpo reales; Detener deja el paso de envío como "detenido", no sale ningún correo y vuelve el botón Enviar.

## Seguridad que ya está y la que falta

Está: nada se ejecuta fuera de la política; lo irreversible espera confirmación con el contenido real y tiempo límite (5 min, luego rechazado); parada a petición y al cerrar la página; topes de acciones y de mensajes; el principal viaja en cada acción y la auditoría persistente se filtra por usuario; el system prompt declara que el contenido de las herramientas son datos, no instrucciones; casos de inyección en el banco. Falta: medir esos casos con Claude, límite de gasto en euros por usuario, y una parada global para administradores.

## Siguiente

- Ejecutar el banco con Claude y fijar el acierto mínimo con datos.
- Conectar el backend real (adaptador HTTP de `PlatformClient` + verificación del JWT).
- Tramo 2: conectores desde OpenAPI y MCP, con el riesgo aprobado por una persona.
