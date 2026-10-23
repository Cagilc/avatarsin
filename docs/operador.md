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

## Comprobado

- Tests: `pnpm test` (operator 16, api 5).
- Navegador (2026-10-23, modo guion): la petición larga produce cinco pasos, la tarjeta de confirmación aparece en `enviar_correo` con el avatar en "espero tu OK"; al aprobar se envía, la lista de correos/expedientes/tareas se refresca y el avatar celebra. Con Marco Rossi seleccionado, "Envíale el presupuesto por correo a este cliente" usa el contexto sin buscar; al rechazar, el correo no sale y Vex explica que se ha detenido.

## Seguridad que ya está y la que falta

Está: nada se ejecuta fuera de la política; lo irreversible espera confirmación con tiempo límite (5 min → rechazado); el principal viaja en cada acción y la auditoría se filtra por usuario; el system prompt declara que el contenido de las herramientas son datos, no instrucciones. Falta (Hito 3): suite de inyección de prompts con datos adversarios en la plataforma, límites de gasto por sesión, parada de emergencia global.

## Siguiente

- Conectar el backend real (adaptador HTTP + verificación del JWT).
- Hito 2: núcleo del avatar sin React + web component, para embeberlo con una sola etiqueta.
- Claude con clave: probar los diez encargos de la puerta del Hito 1 y medir latencia por paso.
