# Preset `agenda`

Un segundo host sin una línea de código en `apps/api/src`: la agenda de citas de `apps/sample-tools`, descrita solo por su OpenAPI.

- El manifiesto **propone** el conector `citas`. Al arrancar, Vex Core lo importa como «Sin revisar»: ninguna herramienta llega al modelo hasta que un administrador revisa sus riesgos en `#conectores` (o por `POST /connectors/citas/review`).
- La `policy` solo permite conectores (`api:*`) y la guía (`leer_guia`): las herramientas de la plataforma de demo no se ofrecen al modelo.
- La URL del conector es local (`http://127.0.0.1:8790`), así que solo vale con Vex Core escuchando en local, donde la política de salida admite http y direcciones internas. En un servidor público habría que apuntar a una URL https pública.

Probar:

```bash
pnpm dev:citas
```

```bash
VEX_HOST_MANIFEST=agenda pnpm dev:api
```

Luego, con un administrador, revisar `citas` y pedir en el chat `usa citas_listar_huecos {"fecha":"2026-10-27"}`.
