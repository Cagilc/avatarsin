# Respuesta a Oscar en la PR #2 (`docs/plan-host-agnostico`)

> **Publicada el 2026-10-26** como comentario: https://github.com/Cagilc/avatarsin/pull/2#issuecomment-6412459508 (versión larga, con el estudio ya en `main`).

---

Hola, Oscar:

Gracias por el plan; está muy bien pensado. Nos lo quedamos como base: los interruptores apagados por defecto, el enfoque aditivo, los contratos Zod primero, el criterio de «dos plataformas, cero cambios de código», los tours, anuncios y botones sin modelo, los casos de inyección antes del driver DOM y un PR por workflow. Lo que más nos aporta: el **manifiesto de host**, el **registro de elementos** (`data-vex-id`), los **tours deterministas** y un driver DOM limitado a elementos registrados.

No lo fusiono tal cual, porque había una pieza que no conocías y que acabo de subir a `main` junto con el operador: el **estudio de avatares** (`apps/studio`, `apps/server`, `packages/format`, `packages/runtime`). Diseña el avatar a partir de un logo y publica **paquetes firmados con Ed25519**, que se incrustan con `<vex-avatar>` solo en dominios autorizados. Cada integración recibe un **permiso firmado** (*grant*) que solo puede estrechar capacidades. Con eso, el plan se ejecutó con estos ajustes, y buena parte ya está en `main`:

1. **No duplicar el avatar.** El manifiesto **apunta al avatar publicado** (`avatar { endpoint, publicKey, keyId }`) en vez de copiar `theme` y `personality`. El aspecto y la personalidad salen del paquete firmado. Sin `packages/vex-core` nuevo: `<vex-assistant>` (`packages/assistant`) se construye **sobre** `<vex-avatar>`. Las caras y los visemas del avatar antiguo están portados al formato del estudio.
2. **Una sola regla de permisos.** Lo que Vex puede hacer = conectores aprobados ∩ `policy` del manifiesto ∩ *grant* firmado de la integración. Ninguno amplía a los otros, y cada combinación lleva su prueba.
3. **El manifiesto vive en el servidor** (`VEX_HOST_MANIFEST`, `presets/<nombre>/manifest.json`). La política nunca llega del navegador; al cliente solo baja la parte de presentación (tours, botones, anuncios). El **token de sesión no va en un atributo del DOM**: se obtiene con una función del host.
4. **Los conectores del manifiesto son propuestas.** Entran como «Sin revisar», igual que los importados a mano, y sus descargas pasan por la guardia de salida (la de tu PR #1, cuando entre).
5. **Sin nombres de plataformas.** `presets/demo-negocio/` en lugar de `presets/mnee/`; `host.name` del manifiesto sustituye a `VEX_HOST_NAME`.
6. **Las poses del tour son estados del avatar** (`point`, `celebrate`), no cambios en `assets/vex-2d`. El runtime calcula hacia dónde señalar.
7. **Dónde funciona el operador: instalado en cada cliente.** Un inquilino por instalación, con su manifiesto y su propia clave de IA; nada de servicio central multi-cliente. Vex trae límites de gasto activos por defecto (tope por usuario y día, tope mensual, aviso al 80 %) y parada global. Tu carril de infra se queda en el contenedor instalable y `TokenService.verify` contra el JWT del host. Todo lo que toque tokens, CORS, la exposición de red o los conectores del manifiesto lleva **revisión obligatoria** y su fila en `docs/seguridad.md`.

Estado por workflow: 01 (manifiesto y desacople), 02 (`<vex-assistant>`), 04 (anuncios y botones rápidos) y 03 (tours con poses del estudio) están hechos; del backlog, los límites de gasto, «de sesión real a caso del banco» y las aprobaciones por canal. El 05 (driver DOM) espera a medir con Claude los casos de inyección del banco. El mapa vivo es `docs/plan-maestro.md`; lo que cambió respecto a tu plan está anotado en cada paso.

Sobre `DECISIONES.md`: licencia **Apache-2.0** (ya está `LICENSE` en la raíz; tus aportes entran bajo ella); camino, estructura y reparto quedan como arriba. El reparto de modelos lo decide quien ejecute cada workflow. Detalles del texto, por si lo actualizas: «aditivo: nada se borra ni se renombra» choca con «mover `tools/platform.ts`, `providers/scripted.ts`…», porque mover es renombrar. Si quieres, actualiza los workflows con lo que hay en `main` y la fusionamos como histórico; si no, la cerramos y nos quedamos con el plan maestro.

**Cómo seguimos.** Todo está en `main`. Lo más urgente sigue siendo la PR #1 (tiene conflictos pequeños con el nuevo `main`; te lo detallo allí). Para el carril de infra, abre una issue antes de tocar `apps/api` o `packages/operator`, que están en obras, y partimos de ahí.

Un abrazo,
César
