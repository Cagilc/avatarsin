# Seguridad de Vex · modelo de amenazas y defensas

Vex ejecuta acciones con consecuencias reales en nombre de una persona. Este documento dice qué puede intentar un atacante, qué hay hoy para impedirlo, qué comprobación lo demuestra y qué falta. Se revisa en cada tramo.

## Principios

1. **Vex nunca tiene más poder que la persona.** Cada acción lleva su principal, que sale de un token firmado por el servidor. No hay cuenta de servicio.
2. **Lo que Vex lee son datos, no órdenes.** Correos, notas, nombres, páginas y resultados de herramientas pueden contener texto hostil; el bucle no obedece a nada que no venga del usuario por el chat.
3. **Lo irreversible lo decide una persona viendo lo real.** La tarjeta de confirmación enseña lo que saldrá tal como está guardado, no lo que el modelo dice.
4. **Nada importado actúa sin revisión humana**, y arrancar un proceso en el servidor exige permiso explícito del administrador del servidor.
5. **Los secretos no viajan.** El servidor los lee del entorno por nombre; no están en la base de datos, el navegador, la conversación ni los registros.
6. **Un solo cálculo de permisos.** Lo que Vex puede ejecutar = herramientas aprobadas por una persona ∩ política del host ∩ *grant* firmado de la integración. Cada capa solo quita; nada que llegue del host o del navegador añade una herramienta.

## Amenazas y defensas

| Amenaza | Defensa | Dónde | Comprobado por |
|---|---|---|---|
| Una página ajena abierta en el navegador del usuario habla con Vex Core | Solo los orígenes listados en `CORS_ORIGIN` reciben cabeceras CORS; cualquier otro origen recibe 403 en peticiones que cambian estado. El flujo de eventos (respuesta cruda) solo lleva la cabecera para el origen permitido. Sin lista, los navegadores no entran. | `apps/api/src/guard.ts`, `app.ts` | `security.test.ts` |
| Tokens inventados o manipulados (cambiar el rol, prolongar la caducidad) | Tokens `v1.<carga>.<firma>` con HMAC-SHA256 y secreto del servidor (32+ bytes, `VEX_TOKEN_SECRET`); caducan; comparación en tiempo constante. Sin secreto configurado, uno aleatorio que muere con el proceso. | `auth.ts` | `security.test.ts` |
| Entrar como usuario de demo sin contraseña | El login de demo solo existe en un servidor local (`VEX_DEMO_LOGIN`); en producción no se registra la ruta. El servidor avisa si se fuerza fuera de local. | `server.ts`, `app.ts` | `security.test.ts` |
| Un usuario sin permisos conecta herramientas o cambia riesgos | Rutas `/connectors` solo para el rol `admin`; cada cambio queda en la auditoría con quién y cuándo. | `app.ts` | `connectors.test.ts`, e2e |
| Hacer que el servidor arranque un proceso cualquiera | Un servidor MCP local solo arranca si su **línea de comando completa** (comando y argumentos) está en `VEX_MCP_ALLOW`. Un intérprete listado con otros argumentos se rechaza. Sin lista, ninguno; tampoco en local. | `connectors.ts` | `connectors.test.ts` |
| Usar al servidor para alcanzar su propia red (importar "desde" direcciones internas) | Las URL de importación y de MCP remoto, las que propone el manifiesto del host y el endpoint del *grant* deben ser https y no apuntar a esta máquina ni a redes privadas o de enlace local. En un servidor local se relaja para las herramientas de muestra. | `guard.ts` | `security.test.ts`, `host.test.ts` |
| Que el manifiesto del host amplíe lo que Vex puede hacer (un conector que actúa sin revisión, una política que añade herramientas) | El manifiesto vive en el servidor y nunca llega del navegador. Sus conectores entran como «Sin revisar»; su política y el *grant* solo estrechan (`permittedTools`: aprobado ∩ política ∩ *grant*, con un test por combinación). Un manifiesto que no valida impide arrancar. | `packages/operator/src/schema/host.ts`, `apps/api/src/host.ts`, `app.ts` | `packages/operator/src/host.test.ts`, `apps/api/src/host.test.ts` |
| Que un botón rápido o un anuncio se salte lo que el chat no puede (ejecutar sin política ni confirmación, inyectar HTML, ver lo de otro rol) | Un botón con herramienta corre por el mismo bucle que una llamada del modelo (validación, política, confirmación con vista previa real, auditoría); la lista solo ofrece herramientas que el bucle ejecutaría y una denegada responde 403 con línea `denied`. El rol sale del token, nunca del cliente. El texto de los anuncios es texto plano del administrador, pintado como nodos de texto y declarado en el prompt como aviso, no como orden; los enlaces solo https. Todo apagado por defecto (`features`). | `apps/api/src/engage.ts`, `app.ts`, `packages/operator/src/providers/direct.ts`, `packages/assistant/src/element.ts` | `apps/api/src/engage.test.ts` |
| Que un tour actúe sobre la página o lea lo que no debe | Un tour solo señala y explica: no pulsa ni rellena nada (eso es el driver DOM, paso 6, con su defensa de inyección), y solo conoce los elementos registrados (`data-vex-id`), nunca los privados. El halo y la mascota no capturan clics. El texto de cada paso es texto plano del administrador. Apagado por defecto (`features.tours`). | `packages/assistant/src/tour.ts`, `element.ts` | `packages/assistant/src/tour.test.ts`, e2e `asistente.spec.ts` |
| Que una integración del estudio opere con un permiso alterado, de otra clave, de otro sitio, caducado o revocado | El *grant* se verifica contra la clave pública fijada en el manifiesto (Ed25519 sobre los bytes recibidos), debe nombrar un origen del dominio del host y caduca a los 10 minutos; se vuelve a pedir y una revocación (404) deja a Vex sin herramientas en un minuto como mucho. Cualquier fallo de verificación = ninguna herramienta, nunca las de antes. | `apps/api/src/grant.ts`, `apps/server/src/app.ts` (`/v1/embed/:key/grant`) | `apps/api/src/host.test.ts` |
| Ejecutar una acción que el administrador no aprobó | Solo las herramientas revisadas y activadas llegan al modelo; la política del bucle no puede ampliar lo aprobado. Un cambio de contrato al actualizar devuelve la herramienta a "Sin revisar". Bajar un riesgo exige motivo escrito. | `packages/connectors/src/review.ts` | `connectors.test.ts` |
| Que una herramienta reciba datos que su esquema no admite | Cada entrada se valida contra el JSON Schema de la herramienta antes de llamar al servicio; los parámetros de ruta se codifican. | `jsonSchema.ts`, `runtime.ts` | `connectors.test.ts` |
| Texto hostil dentro de los datos (una nota que "ordena" enviar algo) | El system prompt lo declara dato; el banco de encargos tiene casos de inyección con notas, nombres y etiquetas hostiles que deben no producir acciones. Lo irreversible pide confirmación con el contenido real. | `system.ts`, `evals/cases.ts` | banco (con Claude) |
| Un bucle que no para o se dispara en coste | Tope de 8 rondas y 25 acciones por mensaje; 20 mensajes por usuario y minuto; parada a petición y al cerrar la página; límite de 2 MB por especificación y de 8.000 caracteres por resultado. | `runner.ts`, `app.ts` | `runner.test.ts`, `app.test.ts` |
| Leer conversaciones o auditoría de otro usuario | Sesiones ligadas al principal (403 si otro intenta continuarla); auditoría filtrada por usuario. | `sessions.ts`, `app.ts` | `app.test.ts` |
| Que la clave del modelo salga del servidor | Solo el servidor habla con Anthropic. El proxy para Vex Studio no exige token, así que solo se activa en local (`VEX_PROVIDER_PROXY`). | `app.ts`, `server.ts` | `app.test.ts` |

## Lo que no está y debe estar antes de producción

- **Autenticación real.** Sustituir el login de demo por la verificación del JWT de la plataforma en `TokenService.verify` (o un adaptador equivalente). El resto no cambia.
- **TLS y proxy inverso** delante de Vex Core; `HOST=0.0.0.0` solo detrás de él.
- **Secretos fuera de `.env`** en producción (gestor de secretos o variables del despliegue), y rotación de `VEX_TOKEN_SECRET`.
- **Medir la inyección con Claude.** Los casos del banco existen; el acierto real no se ha medido porque no hay clave en este equipo.
- **Límite de gasto** en dinero por usuario y por día, además del de mensajes.
- **Parada global** para administradores: apagar todos los conectores o todo Vex con un interruptor.
- **Registro de auditoría inmutable** (hoy es una tabla SQLite con permisos del proceso) y alertas sobre denegaciones repetidas.
- **Revisión externa.** Este documento lo escribió quien escribió el código; una prueba de intrusión independiente antes de abrirlo a usuarios reales.

## Reglas para quien amplíe Vex

- Toda ruta nueva que cambie estado exige token y pasa por el control de origen (ya lo hace el *hook* global).
- Toda herramienta nueva declara `risk` y, si es irreversible, `preview` con lo real.
- Toda fuente de datos nueva (páginas, archivos, ventanas) entra como dato: añadir casos de inyección al banco antes de activarla.
- Nunca ampliar `VEX_MCP_ALLOW` con un intérprete sin sus argumentos fijos.
