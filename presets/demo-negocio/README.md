# Preset `demo-negocio`

La plataforma de negocio simulada de la demo (contactos, expedientes, tareas y correos), descrita como host de Vex. Es el manifiesto con el que corre el banco de encargos.

- `host.name` es lo que el prompt usa para nombrar la plataforma; `host.domain` es el dominio donde se incrusta (de ejemplo).
- `screenContext` describe al modelo las claves que la página envía con cada mensaje.
- `policy` es la misma de siempre: herramientas de la plataforma y conectores revisados, confirmación en lo irreversible.
- `features` todo apagado: con este preset, Vex se comporta igual que sin manifiesto.

Arrancar con él: `VEX_HOST_MANIFEST=demo-negocio` en `apps/api/.env`. Las herramientas de la plataforma siguen en `apps/api/src/tools/platform.ts` sobre `MockPlatform`.
