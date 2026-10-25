# Workflow 04 · Anuncios, novedades y botones rápidos

**Rama:** `wf/04-engage`. **Requiere:** 01 fusionado. **Puede ir en paralelo con 02.** Pinta en la demo React; si el 02 ya está fusionado, añade también la bandeja y los botones al web component (ver «Costuras» en `00-protocolo.md`).

## Objetivo

Que Vex pueda **anunciar novedades** (incluidas herramientas nuevas), **responder** sobre ellas y ofrecer **botones de acceso rápido** opcionales. Todo por datos del manifiesto; sin modelo para lo determinista.

## Alcance

1. **Contratos** (Zod, `packages/operator/src/schema/engage.ts`):
   - `announcement`: `id`, `since`, `until?`, `roles?`, `title`, `body`, `cta?` (abrir tour, botón rápido o enlace), `source` (`manual` · `connector`).
   - `quickAction`: `id`, `label`, `icon?`, `roles?`, y **una** de `prompt` (texto al chat) o `tool` + `params` (herramienta directa).
2. **Estado «visto»** por persona en el almacén existente: un anuncio se muestra una vez, se puede descartar y reabrir desde un historial.
3. **Endpoints** en Vex Core (con token y control de origen como el resto): listar anuncios aplicables a la persona, marcar visto, listar botones. El rol sale del token.
4. **Botones rápidos**: una herramienta directa pasa por **la misma política y confirmación** que si la pidiera el modelo (con `preview` real si es irreversible). Límite máximo de botones configurable (propuesta: 6) para no saturar.
5. **Novedades desde conectores**: cuando una persona aprueba una herramienta nueva o un cambio de contrato en un conector, se genera un **borrador** de anuncio (`source: connector`) con el nombre y la descripción aprobados. No se publica sin aprobación humana.
6. **Responder**: la guía que ya existe (`leer_guia`) se extiende para que el modelo pueda explicar una novedad; con modo guion, responde con el texto del anuncio.
7. **Vistas** en la demo y en la revisión de conectores: bandeja de novedades, botones, y pantalla de revisión de borradores.

## Fuera de alcance

Tours (03), driver DOM (05). Notificaciones fuera de la página (correo, push).

## Propiedad de rutas

`packages/operator/src/schema/engage.ts`, `apps/api/src/engage.ts` y sus rutas en `app.ts`, `apps/operator-demo/src/` (componentes nuevos), `docs/conectores.md`.

## Decisiones abiertas

- Cómo se escribe el manifiesto vs. cómo se guardan los anuncios creados desde la interfaz (propuesta: el manifiesto trae los de partida; los de conectores van al almacén).
- Orden y prioridad cuando hay varios anuncios.
- Caducidad por defecto.

## Seguridad

Un botón con herramienta nunca se salta la política ni la confirmación. El texto de un anuncio se trata como contenido del administrador: se escapa al pintarlo (sin HTML libre). El rol sale del token, nunca del cliente. Casos negativos en el banco: botón de una herramienta denegada, anuncio de otro rol.

## Hecho cuando

- Tests por HTTP: visto una sola vez, filtrado por rol, botón con herramienta irreversible que pide confirmación con la vista previa real, botón denegado por la política.
- Un cambio de contrato aprobado en un conector genera su borrador, que no es visible hasta aprobarlo.
- Con `features.announcements` y `features.quickActions` apagados no aparece nada y las rutas devuelven vacío.
- El banco incluye los casos negativos nuevos y el modo guion sigue en verde.
