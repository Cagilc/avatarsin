# Workflows · protocolo de ejecución

Empieza por `DECISIONES.md` (qué elige César) y `README.md` (arranque en 10 minutos). Ideas adicionales priorizadas: `backlog.md`.

Cinco workflows que llevan a Vex de «operador de un negocio concreto» a «asistente que se acopla a cualquier plataforma» (visión y razones: `docs/plan-host-agnostico.md`). Cada fichero `01…05` es un encargo **autocontenido** para un agente: se le pasa ese fichero, `CLAUDE.md` y nada más.

## Reparto

- **Estos 5 workflows los ejecuta el ordenador de César.** Él gasta tokens y cómputo; el diseño va ya pensado para que sea barato.
- **En paralelo, Oscar trabaja lo integral y de infraestructura** (servidor, despliegue, multi-inquilino, conexión de un host real, límite de gasto, parada global). Está **fuera** de estos cinco para no chocar; ver «Carril de infra» al final.
- César sigue siendo dueño de la parte gráfica (rig, poses, estilo del avatar, animaciones). Los workflows solo la **amplían** (poses nuevas, apuntar); no cambian el estilo existente.

## Modelo por fase (para ahorrar créditos)

Dos pasadas por workflow, en este orden:

1. **Refinado con Fable (una sola sesión corta, sin escribir código).** Lee el fichero del workflow y el código que cita, **verifica cada ruta, nombre y afirmación contra el repo**, resuelve las «Decisiones abiertas» y escribe `specs/<NN>-<slug>.md` (≈30 líneas, formato Spec-Lite): decisiones tomadas, contratos Zod exactos, lista de ficheros a crear o tocar, casos de prueba. Si algo contradice el repo, corrige el fichero del workflow en el mismo PR.
2. **Ejecución con Sonnet** siguiendo `specs/<NN>-<slug>.md`, en una rama `wf/<NN>-<slug>`. No rediseña: si el spec no cubre algo, para y pregunta (ver «Parar y preguntar»).
3. **Revisión con Fable del diff, en todos los workflows** (no solo en los de seguridad): contra el spec, los principios de `CLAUDE.md` y los criterios de «Hecho cuando». Es una pasada de solo lectura sobre el diff, no sobre el repo entero; devuelve hallazgos y Sonnet los arregla en el mismo PR.
4. **Los propios planes también los revisa Fable**: este conjunto de documentos (`docs/plan-host-agnostico.md`, `docs/workflows/*`) se revisa con Fable **antes de empezar el 01**, y cada vez que un workflow cambie el plan.

Fable decide y revisa; Sonnet escribe. Si Sonnet duda de un contrato o de una consecuencia de seguridad, vuelve a Fable en vez de decidir solo.

## Reglas comunes (todas obligatorias)

- Leer `CLAUDE.md` primero. Respetar sus principios: riesgo declarado, confirmación en lo irreversible, lo leído es dato, nada importado actúa sin revisión humana.
- Una rama y **un PR por workflow**; nunca push a `main`. Commits en inglés, conventional commits.
- Puertas antes de cada commit: `pnpm typecheck`, `pnpm test`, `pnpm eval -- --provider scripted`; `pnpm e2e` si se toca la demo, el avatar o el web component.
- Entorno de César: nada de binarios nativos ni dependencias que los necesiten (buscar versión wasm o JS). Persistencia con `node:sqlite`.
- Aditivo: nada se borra ni se renombra por limpieza. Cada capacidad nueva lleva su interruptor en `features` del manifiesto, **apagado por defecto**, y con el interruptor apagado el comportamiento es idéntico al actual (se comprueba con un test).
- Contratos primero: esquema Zod y sus tests antes que la implementación.
- Cada amenaza o defensa nueva actualiza la tabla de `docs/seguridad.md` y su test.
- Toda herramienta o acción nueva entra con casos en `apps/api/evals/cases.ts`, al menos uno negativo.
- Nada de datos ni nombres de un host concreto (incluido el de Oscar) en el repo.
- Lo que genere el modelo para otros (tours, anuncios) queda como **borrador** hasta que una persona lo apruebe.

## Parar y preguntar

Parar y devolver una pregunta concreta, sin improvisar, si: hay que cambiar un contrato de `packages/operator` que el spec no menciona; hace falta una dependencia nueva; una puerta falla por algo ajeno al cambio; hay que tocar el estilo del avatar fuera de lo que el workflow permite; o el spec y el código se contradicen.

## Orden y paralelismo

```
01 Desacople + manifiesto ──┬─► 02 SDK de host + web component ──┬─► 03 Tours y onboarding
                            │                                    └─► 05 Driver DOM + inyección
                            └─► 04 Anuncios y botones rápidos
```

- **01 va primero y solo.** Todo depende de su manifiesto.
- Tras 01, **02 y 04 pueden ir en paralelo** (carpetas distintas, ver «Propiedad de rutas» en cada fichero).
- **03 y 05 esperan a 02** (usan el registro de elementos de UI). 03 y 05 pueden ir en paralelo entre sí.

## Carril de infra (Oscar, fuera de los cinco)

Empaquetado en contenedor, manifiesto por inquilino seleccionado por el token, TLS y proxy, parada global, límite de gasto, `TokenService.verify` contra el JWT de un host real, conexión de un host real solo por manifiesto, y la prueba de aceptación «dos hosts, cero cambios de código». Depende de que 01 esté fusionado.

## Costuras entre workflows

- **01 deja marcadores, no contenidos.** En `schema/host.ts`, `tours`, `announcements` y `quickActions` son `z.array(z.unknown()).default([])`. El 03 y el 04 los sustituyen por su propio esquema con **una sola línea cada uno** en `host.ts`, para no chocar al fusionar.
- **04 pinta en la demo React; el web component (02) no lo conoce aún.** Quien fusione **segundo** entre 02 y 04 añade la bandeja de novedades y los botones al web component como último paso de su PR.
- **El enlace de un anuncio a un tour (`cta`) solo funciona si el 03 está fusionado.** Hasta entonces el 04 ignora ese tipo de enlace sin error.
- **03 y 05 comparten el registro de elementos del 02.** Ninguno de los dos cambia su contrato; si lo necesitan, parar y preguntar.

## Informe de cada workflow

Al terminar, el PR incluye: qué cambia, qué puertas pasaron (con cifras), qué quedó fuera, y qué decisiones del spec se apartan del fichero original y por qué.
