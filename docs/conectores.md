# Conectores · cómo aprende Vex una herramienta nueva (tramo 2)

Un conector convierte una herramienta que Vex no conocía en acciones que puede usar, **sin escribir código**: se importa su descripción (OpenAPI o un servidor MCP), Vex propone el riesgo de cada acción con su motivo, y **una persona** decide qué se activa y con qué riesgo. Nada se activa solo. Desde ese momento las acciones aprobadas pasan por el mismo bucle que las de la plataforma: validación, política, confirmación con vista previa real, parada y auditoría.

## El recorrido

1. **Importar** (`#conectores` en la demo, o `POST /connectors/import/openapi` y `/connectors/import/mcp`). Solo administradores.
   - **OpenAPI 3.x en JSON**: una herramienta por operación. Entrada = parámetros de ruta y consulta más `body`, con los `$ref` resueltos. Las cabeceras de autenticación no se exponen al modelo.
   - **MCP**: servidor local por stdio (un comando) o remoto por HTTP. Una herramienta por cada una del servidor, con su JSON Schema.
   - **Filtro de operaciones** (`filter`, solo OpenAPI): una API real trae cientos de operaciones y revisarlas todas no tiene sentido. `include` se queda con las que cumplen alguna regla (vacío = todas) y `exclude` quita las que cumplen alguna; `maxTools` (200 por defecto, 500 como mucho) corta con un error que dice cómo acotar. Reglas: `GET` (método), `/citas` (prefijo de ruta por segmentos: vale `/citas/{id}`, no `/citasx`), `GET /citas` (ambos) o `tag:agenda` (etiqueta). El filtro se guarda con el conector y se vuelve a aplicar al actualizar; desde la revisión se puede cambiar y el siguiente «Actualizar» lo aplica. `source.operations` dice cuántas tenía la especificación. En la demo, una regla por línea y «-» delante para excluir. La especificación puede pesar hasta 20 MB; la lectura se corta ahí.
   - Resultado: un **borrador**. Todas las herramientas desactivadas y "Sin revisar"; el modelo no ve ninguna.
   - **Propuestas del manifiesto del host** (`connectors[]` en `presets/<host>/manifest.json`, ver `docs/operador.md`): al arrancar, Vex Core las importa como el mismo borrador, con el principal `manifiesto` en la auditoría. Un id que ya existe se respeta tal como lo dejó la persona; una fuente inalcanzable o rechazada por la política de salida se anota en `GET /operator/info` (`host.proposals`) y el servidor arranca igual.
2. **Riesgo sugerido**, con su motivo a la vista:

   | Origen | Lectura | Escritura | Irreversible |
   |---|---|---|---|
   | OpenAPI | `GET` | `POST`, `PUT`, `PATCH` | `DELETE`, o escritura cuyo nombre, ruta o resumen suena a enviar, cobrar, publicar, invitar, aprobar o borrar |
   | MCP | `readOnlyHint` | `destructiveHint: false` | lo demás, incluida la falta de anotaciones; o escritura con `openWorldHint` o palabras de envío |

   Las anotaciones MCP son pistas del servidor, no garantías: por eso el valor por defecto es el pesimista, como dice la especificación.
3. **Revisión humana** (`POST /connectors/:id/review`). Para cada acción: riesgo aprobado, activada o no y, opcionalmente, cómo **comprobar su efecto** (`verify { tool, params, expect, target }`: una lectura del mismo conector con parámetros `$.id` de la respuesta, `$input.id` de la entrada o literales; `expect: exists`, `missing` tras un borrado real, o `{ path, equals }` cuando lo que cambia es un campo: una cancelación «blanda» se comprueba con `{ path: 'estado', equals: 'cancelada' }`; `equals` admite literal, `$input.x` o `$.x`, compara primitivos por valor y nunca da por bueno un objeto). El importador la sugiere cuando la forma de las rutas lo deja claro (`POST /citas` → `GET /citas/{id}` con `$.id`; `DELETE /citas/{id}` → el mismo `GET` esperando 404); `verify: null` la quita. No forma parte del contrato: cambiarla no vuelve la acción a «Sin revisar». Reglas:
   - Solo se puede activar lo revisado. La revisión guarda quién y cuándo.
   - **Bajar** un riesgo por debajo del sugerido exige escribir el motivo, que queda guardado.
   - Se puede escribir una **guía** para el modelo (para qué sirve, flujos típicos, trampas), de 4.000 caracteres como máximo.
   - Importar, revisar, actualizar y borrar quedan en la misma auditoría que las acciones de Vex.
   - Activar herramientas nuevas deja un **borrador de anuncio** (`GET /engage/drafts`, solo administradores) con sus nombres y descripciones; nadie lo ve hasta publicarlo. Detalle en `docs/operador.md`.
4. **Uso.** En el siguiente mensaje Vex ve las herramientas aprobadas, con el prefijo del conector (`citas_crear_cita`). El system prompt lista los conectores y le pide llamar a `leer_guia` antes de usar uno por primera vez: la guía entra en el contexto **solo cuando la petición la necesita**. Lo irreversible pide confirmación y la tarjeta enseña lo que va a salir: la petición HTTP exacta (método, URL y datos) o la llamada MCP (herramienta y argumentos).
5. **Actualizar** (`POST /connectors/:id/refresh`) vuelve a leer la especificación o el servidor. Las acciones que no cambiaron conservan su revisión; las que cambiaron de contrato (entrada, ruta o descripción) **vuelven a "Sin revisar" y se desactivan**, porque lo aprobado ya no es lo que se ejecutaría. Las nuevas llegan desactivadas.

## Seguridad

- **Secretos**: el manifiesto solo guarda el *nombre* de la variable de entorno (`CITAS_TOKEN`). El valor vive en el entorno de Vex Core, nunca en la base de datos, el navegador ni la conversación.
- **MCP local = ejecutar código** en el servidor: solo arranca una **línea de comando completa** (comando y argumentos) que esté en `VEX_MCP_ALLOW`. Un intérprete listado con otros argumentos se rechaza. Sin la variable no arranca ninguno, tampoco en local.
- **Importar desde una URL** (OpenAPI o MCP remoto): solo https y nunca hacia esta máquina ni redes privadas; en un servidor local se relaja para las herramientas de muestra. Vale igual para las URL que propone el manifiesto del host y para el endpoint del *grant* del estudio.
- **Toda petición saliente pasa por la misma guardia** (`guardedFetch`): importar, llamar a una API importada, MCP remoto, el *grant* y los webhooks de aprobación. El nombre se resuelve y la conexión se fija a las direcciones comprobadas; las **redirecciones** se siguen a mano (3 saltos como mucho) y cada salto se comprueba igual; si un salto **cambia de origen, las credenciales no viajan** (solo `accept` y `content-type`). Una petición rechazada responde 400 con el motivo.
- **El manifiesto no amplía nada.** Sus conectores son propuestas sin revisar; su política y el *grant* firmado de la integración solo pueden quitar herramientas a lo aprobado (regla de los tres permisos, `docs/operador.md`).
- Importar, revisar y borrar exigen un token firmado con rol `admin`, y solo desde las páginas listadas en `CORS_ORIGIN`. Modelo de amenazas completo en `docs/seguridad.md`.
- Un conector no puede generar herramientas con el nombre de una de la plataforma (`crear` + `tarea` daría `crear_tarea`): se rechaza.
- Las entradas se validan contra el JSON Schema de cada herramienta antes de llamar al servicio. El validador es un subconjunto propio (tipos, obligatorios, enumerados, rangos, longitudes, patrones, formatos de fecha y email, `anyOf`/`oneOf`/`allOf`, `nullable`); lo desconocido se ignora.
- Las respuestas se recortan a 8.000 caracteres y las imágenes se resumen como `[imagen …]` antes de llegar al modelo.

## Probarlo sin clave de Anthropic

El modo guion no puede adivinar cuándo usar una herramienta que no conoce, así que acepta una **orden directa** que pasa por la misma validación, política, confirmación y auditoría:

```text
usa citas_listar_huecos {"fecha":"2026-10-27"}
usa citas_enviar_recordatorio {"id":"CITA-101","body":{"canal":"sms"}}
usa leer_guia {"conector":"citas"}
```

Con Claude no hace falta: se pide en lenguaje natural ("dale una cita a Marco el martes a las 12 y mándale un SMS").

## Herramientas de muestra (`apps/sample-tools`)

- **Agenda de citas**: una API de terceros descrita solo por su OpenAPI (`pnpm dev:citas`, `http://127.0.0.1:8790/openapi.json`). Seis operaciones: huecos, citas, reservar, detalle, cancelar y recordatorio. Admite token opcional (`CITAS_TOKEN`).
- **Tablón de notas**: un servidor MCP por stdio (`node apps/sample-tools/src/notas-mcp.ts`) con cuatro herramientas anotadas. Para conectarlo desde la demo, pon esa línea completa en `VEX_MCP_ALLOW` de `apps/api/.env`.

## Comprobado con una herramienta real: VectorCraft

El CLI de VectorCraft instalado en este equipo trae un servidor MCP (`vectorcraft-cli.exe mcp --headless`) con 32 herramientas anotadas. A través de Vex Core, sin escribir código para él:

1. Importado con la línea exacta en `VEX_MCP_ALLOW`: el ejecutable, `mcp --headless` y las carpetas confinadas (`--automation-read-root`/`--automation-write-root`). Riesgos sugeridos: `inspect_document` lectura; `draw_shape` y `export` irreversibles, porque el servidor los declara destructivos.
2. Revisión: `draw_shape` y `add_text` aprobados como **escritura**, con el motivo "Edita el documento en memoria; se deshace con undo". `export` sigue irreversible porque escribe un archivo. El resto, apagado.
3. Vex dibujó un rectángulo y un texto sin preguntar y pidió confirmación para exportar. Tras aprobarla, el PNG quedó en la carpeta confinada.

Es un test que se ejecuta en este equipo y se omite donde VectorCraft no está instalado, como en CI.

## Encargos del banco con conectores

Cuatro casos de la categoría `conector` (`apps/api/evals/cases.ts`) montan una agenda de citas nueva, la importan y la aprueban como lo haría un administrador, con guía incluida, y miden a Claude:

- reservar en la primera hora libre leyendo antes la guía y los huecos;
- reservar y enviar un recordatorio por SMS;
- que un recordatorio rechazado no salga;
- consultar sin reservar nada.

Solo dicen algo con Claude (`pnpm eval -- --provider anthropic`). Hay tests que comprueban que el banco puntúa bien esos casos: aprueba a quien hace lo correcto y suspende, con motivos, a quien reserva una hora que no estaba libre.

## Límites conocidos

- OpenAPI solo en JSON: no se lee YAML. OpenAPI 2 (Swagger) no se admite.
- Autenticación: ninguna, bearer o cabecera con secreto del entorno. OAuth por usuario no está.
- Con muchos conectores el número de herramientas crece. El siguiente paso es la búsqueda de herramientas bajo demanda en lugar de enviarlas todas.
- Los servidores MCP remotos (HTTP) están implementados, pero solo se han probado los locales.
