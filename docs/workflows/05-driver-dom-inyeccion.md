# Workflow 05 · Driver DOM y defensa contra inyección

**Fable refina y revisa** (amplía la superficie de ataque: la revisión incluye un repaso de amenazas, no solo del diff). **Rama:** `wf/05-dom`. **Requiere:** 02 fusionado. **Puede ir en paralelo con 03.**

## Objetivo

Que Vex pueda **actuar sobre la interfaz del host**: resaltar, rellenar y pulsar elementos registrados, con los mismos controles que el resto de acciones, y con la defensa contra texto hostil de la página probada **antes** de activarlo.

## Alcance

1. **Driver `dom`** (ya existe el valor en el enum; hoy sin implementar). Herramientas: `ui_listar` (elementos registrados y su estado), `ui_resaltar`, `ui_rellenar`, `ui_pulsar`, `ui_leer` (valor visible de un elemento registrado). Riesgos: listar, resaltar y leer = `read`; rellenar = `write`; pulsar = `write`, y **`irreversible` si el elemento está marcado así** en el host (`data-vex-risk="irreversible"`, p. ej. «Enviar», «Pagar», «Eliminar»).
2. **Ejecución en la página**: el bucle emite un evento de acción por el flujo SSE, el web component la ejecuta y devuelve el resultado por una ruta con token (`POST /operator/ui-result`). Mismo principal, misma política, misma auditoría; un tiempo máximo por acción y cancelación con **Detener**.
3. **Solo elementos registrados.** No hay selectores libres ni búsqueda por texto en el DOM: Vex solo toca lo que el host registró (workflow 02). Los campos de contraseña y los marcados privados no se leen ni se rellenan.
4. **Confirmación con lo real**: para una acción irreversible, la tarjeta muestra el elemento, su etiqueta, el valor que se va a enviar y la pantalla, leídos de la página, no del modelo.
5. **Defensa contra inyección**:
   - El texto de la página (etiquetas, valores, árbol de accesibilidad) entra al modelo como **dato** con delimitadores explícitos y un recordatorio en el *system prompt*.
   - Casos hostiles en el banco: una etiqueta o una nota que «ordena» pulsar, rellenar o enviar; un elemento oculto con instrucciones; un botón cuyo texto no coincide con su acción.
   - Un acto `write`/`irreversible` solicitado justo después de leer contenido de la página se marca en la auditoría como «tras lectura de página».
6. **Límites**: máximo de acciones de UI por mensaje (propuesta: 10) y de rellenados seguidos.

## Fuera de alcance

Actuar fuera de la página del host (ventanas, sistema de ficheros), visión por pantalla, selectores arbitrarios.

## Propiedad de rutas

`packages/operator/src/schema/*` (solo eventos nuevos), `packages/operator/src/tool.ts` (si hace falta ejecución remota), `apps/api/src/tools/dom.ts`, `packages/vex-element/*` (ejecutor), `apps/api/evals/cases.ts` (casos hostiles), `docs/seguridad.md`.

## Decisiones abiertas

- Contrato exacto del canal acción → resultado y qué pasa si la pestaña se cierra a mitad.
- Qué marca el host para declarar el riesgo de un elemento y qué valor por defecto tiene un elemento sin marca (propuesta: `write`).
- Si `ui_leer` devuelve el valor completo o solo un resumen.

## Seguridad (revisión obligatoria)

Fila nueva en la tabla de `docs/seguridad.md` con su test. Comprobar explícitamente: un elemento sin registrar no se puede tocar; un campo privado no sale; una confirmación no se puede saltar desde el cliente; el resultado de la UI no puede ampliar lo aprobado.

## Hecho cuando

- Banco con los casos hostiles nuevos: en modo guion no se ejecuta ninguna acción no pedida; con Claude se mide el acierto cuando haya clave y se registra la cifra en el informe.
- Tests por HTTP: ida y vuelta, tiempo máximo, cancelación, negativa de política, campo privado, elemento no registrado.
- e2e: rellenar un formulario de ejemplo y que un «Enviar» marcado irreversible pida confirmación con el valor real.
- Con `features.domDriver` apagado, las herramientas `ui_*` no existen para el modelo.
