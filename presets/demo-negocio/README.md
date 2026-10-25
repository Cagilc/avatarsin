# Preset `demo-negocio`

La plataforma de negocio simulada de la demo (contactos, expedientes, tareas y correos), descrita como host de Vex. Es el manifiesto con el que corre el banco de encargos.

- `host.name` es lo que el prompt usa para nombrar la plataforma; `host.domain` es el dominio donde se incrusta (de ejemplo).
- `screenContext` describe al modelo las claves que la página envía con cada mensaje.
- `policy` es la misma de siempre: herramientas de la plataforma y conectores revisados, confirmación en lo irreversible.
- `features`: anuncios y botones rápidos encendidos (tres botones y un anuncio de bienvenida); tours y driver DOM apagados. Las herramientas y la política son las mismas que sin manifiesto: los interruptores solo añaden presentación.

Arrancar con él: `VEX_HOST_MANIFEST=demo-negocio` en `apps/api/.env`. Las herramientas de la plataforma siguen en `apps/api/src/tools/platform.ts` sobre `MockPlatform`.
