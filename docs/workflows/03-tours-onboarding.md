# Workflow 03 · Tours y onboarding con la mascota

**Rama:** `wf/03-tours`. **Requiere:** 02 fusionado. **Puede ir en paralelo con 05.** Es el workflow más cercano a lo gráfico: es donde César aporta más.

## Objetivo

Un wizard visual: la mascota **se mueve y señala** elementos de la interfaz del host, explica, espera a que la persona haga algo y avanza. Encima, una capa opcional de **onboarding con juego** (progreso, hitos, logros). Todo definido por datos en el manifiesto y **sin llamar al modelo**.

## Alcance

1. **Contrato del tour** (Zod, en `packages/operator/src/schema/tour.ts`; sustituye el marcador `tours` de `schema/host.ts` con una línea): pasos con `target` (id de elemento registrado), `say`, `pose`, `advanceOn` (`click` · `input` · `next` · `event:<nombre>` · `timeout`), `skippable`, y `when` (primera visita, rol, pantalla). Valida que cada `target` exista en el registro al arrancar el paso.
2. **Motor determinista** (`packages/tour`): máquina de estados sin dependencias de React ni de modelo; emite eventos que el *director* traduce a mascota y burbuja. Pausa, salir y reanudar.
3. **Mascota que señala**: la mascota se desplaza hasta el borde del rectángulo del elemento y adopta la pose «señalar». Resalta el elemento con un halo que **no captura clics** y no lo tapa. Si el elemento no está a la vista, hace scroll con suavidad; si no existe, salta el paso y lo registra.
4. **Poses nuevas, sin tocar el estilo**: `point` (señalar, 4 direcciones) y `celebrate-small`. Se añaden a `assets/vex-2d/vex-rig.json` y a `POSES` siguiendo la paleta y la geometría existentes; las poses actuales no cambian.
5. **Capa de juego opcional** (`features.tours.gamified`): pasos con puntos, hitos, logros y progreso por persona persistidos en el almacén existente (`node:sqlite`). Nada de datos personales más allá del id de persona.
6. **Borrador asistido (opcional, con modelo)**: comando que propone un tour a partir del OpenAPI y de los elementos registrados y lo guarda como **borrador**; no se publica hasta que una persona lo apruebe en una vista de revisión.
7. **Laboratorio**: ampliar `#estados` con las poses nuevas y un modo de ensayo de tour.

## Fuera de alcance

Actuar sobre la UI (clic, rellenar): eso es el workflow 05. Anuncios: workflow 04.

## Propiedad de rutas

`packages/tour/*`, `packages/operator/src/schema/tour.ts`, `assets/vex-2d/*` (solo añadir poses), `packages/vex-core/*` (solo la lógica de pose y desplazamiento), `apps/operator-demo/src/StatesLab.tsx`.

## Decisiones abiertas

- Cómo se anima el desplazamiento (CSS/WAAPI) respetando `prefers-reduced-motion`: con movimiento reducido, la mascota no viaja, aparece junto al elemento.
- Reglas de logros y puntos: configurables en el manifiesto, sin valores fijos en el código.
- Qué hacer si la pantalla cambia a mitad de tour.

## Accesibilidad (obligatoria)

`prefers-reduced-motion`, navegación completa por teclado, foco gestionado, el texto de cada paso disponible para lectores de pantalla, la mascota nunca bloquea clics.

## Hecho cuando

- Un tour del manifiesto de ejemplo se recorre completo en e2e (con y sin movimiento reducido) con captura por paso, **sin llamar al modelo**.
- Tests del motor: avance, salto de paso con elemento ausente, pausa/reanudación, persistencia del progreso.
- Las poses existentes no cambian (capturas del laboratorio iguales salvo las nuevas).
- Con `features.tours` apagado no aparece nada y el comportamiento es el de antes.
