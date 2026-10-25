# Borrador · respuesta a Oscar en la PR #2 (`docs/plan-host-agnostico`)

> Sin publicar. Tipo de revisión propuesto: **Comment** (es un plan para conversar, no para fusionar tal cual). César decide si se publica y cuándo.
> Fuente: sección 3 de `docs/plan-maestro.md` y la sección 7 de `informe-aporte-oscar.md`.
> **Usar la versión corta del final.** César decidió (decisión 5) que Oscar siga en `avatarsin` sin acceso al estudio. La versión larga habla del estudio y se guarda para cuando se le enseñe.

---

Hola, Oscar:

Gracias por el plan; está muy bien pensado. Nos lo quedamos como base: los interruptores apagados por defecto, el enfoque aditivo, los contratos Zod primero, el criterio de «dos plataformas, cero cambios de código», los tours, anuncios y botones sin modelo, los casos de inyección antes del driver DOM y un PR por workflow. Lo que más nos aporta: el **manifiesto de host**, el **registro de elementos** (`data-vex-id`), los **tours deterministas** y un driver DOM limitado a elementos registrados.

No lo fusionaríamos tal cual, porque hay una pieza que no conocías: tengo un **estudio de avatares** propio (todavía privado y sin publicar). Diseña el avatar a partir de un logo y publica **paquetes firmados con Ed25519**, que se incrustan con `<vex-avatar>` solo en dominios autorizados. Cada integración recibe un **permiso firmado** (*grant*) que solo puede estrechar capacidades. Parte del WF02 ya está hecho ahí, y por eso proponemos estos ajustes:

1. **No duplicar el avatar.** El manifiesto **apunta al avatar publicado** (`avatar { endpoint, publicKey, keyId }`) en vez de copiar `theme` y `personality`. El aspecto y la personalidad salen del paquete firmado. Sin `packages/vex-core` nuevo: `<vex-assistant>` se construye **sobre** `<vex-avatar>` (`packages/runtime`). Las caras y los visemas del avatar antiguo (`packages/vex`) se portan al formato del estudio como una capa nueva.
2. **Una sola regla de permisos.** Lo que Vex puede hacer = conectores aprobados ∩ `policy` del manifiesto ∩ *grant* firmado de la integración. Ninguno amplía a los otros, y cada combinación lleva su prueba.
3. **El manifiesto vive en el servidor.** La política nunca llega del navegador. Al cliente solo baja la parte de presentación (tours, botones, anuncios), firmada como los paquetes. El **token de sesión no va en un atributo del DOM**, porque cualquier script de la página lo leería: se obtiene con una función del host y dura poco.
4. **Los conectores del manifiesto son propuestas.** Entran como «Sin revisar», igual que los importados a mano, y sus descargas pasan por la guardia de salida (la de la PR #1, ya corregida). Que sea un criterio de «hecho» del WF01, con su prueba.
5. **Sin nombres de plataformas.** Vex ya es genérico: `presets/demo-negocio/` en lugar de `presets/mnee/`. `VEX_HOST_NAME` pasa a ser `host.name` del manifiesto, y el manifiesto manda.
6. **Las poses del tour son estados del avatar** (`point`, `celebrate`), no cambios en `assets/vex-2d`. El runtime calcula hacia dónde señalar. Esto supone un cambio de contrato en el formato del avatar.
7. **El carril de infra** (servicio central multi-cliente, `TokenService.verify` con un JWT real, `HOST=0.0.0.0`) depende de una decisión que aún no he tomado: dónde funciona el operador (central, en cada cliente o mixto). Todo lo que toque tokens, CORS, la exposición de red o los conectores del manifiesto lleva **revisión obligatoria** y su fila en `docs/seguridad.md`.

Detalles del texto:
- «Aditivo: nada se borra ni se renombra» choca con «mover `tools/platform.ts`, `providers/scripted.ts`…», porque mover es renombrar. Habría que decidir cuál de las dos cosas vale.
- El reparto de trabajo y de gasto y la licencia son decisiones mías. Mejor dejarlos como **preguntas abiertas** que en `docs/` como si estuvieran decididos.

**Cómo seguimos.** Estoy rehaciendo el WF01 (manifiesto y desacople) con estos ajustes en un repositorio que une el operador y el estudio, y por ahora todo se queda en local. En cuanto decida cómo compartirlo contigo, te aviso para que el carril de infra parta de ahí. Mientras tanto, si te apetece, la PR #1 es lo más urgente.

Un abrazo,
César

---

## Versión corta (si aún no se quiere mencionar el estudio)

Hola, Oscar: gracias por el plan; nos lo quedamos como base (interruptores apagados, aditivo, Zod primero, «dos plataformas, cero cambios», tours sin modelo, inyección antes del driver DOM). Antes de fusionar:
1. Sin nombres de plataforma: `presets/demo-negocio/`, no `presets/mnee/`.
2. `host.name` del manifiesto sustituye a `VEX_HOST_NAME`; dilo en el plan.
3. La política del manifiesto se queda en el servidor; el token no va en un atributo del DOM.
4. Los conectores del manifiesto entran «Sin revisar» y pasan por la guardia de salida de la PR #1.
5. Resolver la contradicción «aditivo» / «mover».
6. Reparto de trabajo, gasto y licencia como preguntas abiertas, no en `docs/`.
7. Revisión obligatoria en el carril de infra para tokens, CORS, `HOST=0.0.0.0` y conectores del manifiesto.
8. He decidido que el operador **se instala en cada cliente**: un inquilino por instalación, con su manifiesto y su propia clave de IA. Nada de servicio central multi-cliente. Tu carril de infra se queda en el contenedor instalable, `TokenService.verify` contra el JWT del host, la parada global y los límites de gasto (tope por usuario y día, tope mensual y aviso al 80 %).
9. Licencia: **Apache-2.0**. La añadiré al repositorio en breve; tus aportes entran bajo esa licencia.

Estoy rehaciendo el WF01 (manifiesto y desacople) por mi lado, así que de momento evita cambios grandes en `apps/api` y `packages/operator`. Hay una parte del WF02 (el avatar incrustable) que estoy replanteando por mi lado; te cuento cuando lo tenga. Un abrazo, César.
