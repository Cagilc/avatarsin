# Empezar ya · guía de arranque

Para retomar el trabajo sin leer todo: 10 minutos.

## Orden

1. **Revisa los planes con Fable** (este PR): `docs/plan-host-agnostico.md`, `docs/workflows/00-protocolo.md` y los cinco workflows. Pásale el prompt A de abajo. Corrige lo que no cuadre con el repo y fusiona el PR.
2. **Empieza por el workflow 01** (bloquea a los demás). Prompts B y C.
3. Tras el 01, lanza **02 y 04 en paralelo**; tras el 02, **03 y 05**.
4. Las ideas del `backlog.md` no se ejecutan hasta que Oscar las priorice.

## Prompts (copiar y pegar)

**A · Revisión del plan (Fable, solo lectura).**
> Lee `CLAUDE.md`, `docs/plan-host-agnostico.md` y `docs/workflows/*.md`. Compáralos con el código real del repo. Dime: rutas, nombres o afirmaciones que no se corresponden; contradicciones entre workflows; dependencias o costuras que falten; riesgos de seguridad no cubiertos; y qué cambiarías para que Sonnet pueda ejecutarlos sin improvisar. No edites código. Si hay correcciones al plan, propónlas como diff de los `.md`.

**B · Refinado de un workflow (Fable, una sesión, sin código).**
> Lee `CLAUDE.md` y `docs/workflows/NN-….md` (y `00-protocolo.md`). Verifica cada ruta y nombre que cita contra el repo. Resuelve las «Decisiones abiertas» eligiendo una opción y justificándola en una línea. Escribe `specs/NN-slug.md` (Spec-Lite, ≈30 líneas): decisiones, contratos Zod exactos, ficheros a crear o tocar, casos de prueba. Si el workflow contradice el repo, corrige el `.md`. No implementes nada.

**C · Ejecución (Sonnet).**
> Lee `CLAUDE.md` y `specs/NN-slug.md`. Crea la rama `wf/NN-slug` desde `main` y ejecuta el spec respetando las reglas comunes de `docs/workflows/00-protocolo.md`. Contratos y tests primero. Antes de cada commit: `pnpm typecheck`, `pnpm test`, `pnpm eval -- --provider scripted` (y `pnpm e2e` si tocas demo, avatar o web component). Si el spec no cubre algo, para y pregúntame. Termina con el informe descrito en el protocolo.

**D · Revisión del diff (Fable, solo lectura).**
> Revisa el diff de la rama `wf/NN-slug` contra `specs/NN-slug.md`, los principios de `CLAUDE.md` y los «Hecho cuando» de `docs/workflows/NN-….md`. Busca bugs, huecos de seguridad (especialmente texto no confiable y confirmaciones), cambios de comportamiento con el interruptor apagado y tests que no prueben lo que dicen. Devuelve hallazgos ordenados por gravedad con fichero y línea.

## Antes de empezar: cuatro decisiones de César

Están en «Preguntas abiertas para César» de `docs/plan-host-agnostico.md`. Las dos que bloquean son la **licencia** (elegir una antes de aceptar más contribuciones) y mover el preset actual a `presets/mnee/`. Las demás se pueden resolver en el refinado del workflow 01.
