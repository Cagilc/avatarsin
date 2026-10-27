# Vex · el operador con avatar y su estudio

Vex es un avatar animado que **ejecuta acciones** en una plataforma de negocio en nombre del usuario que ha iniciado sesión: busca contactos, abre expedientes, crea tareas para un equipo, redacta y envía correos. Encadena los pasos, pide confirmación para lo irreversible y deja registro de todo. El avatar refleja en qué fase está (pensando, trabajando, esperando tu OK, hablando).

Este repositorio une las dos partes, cada una con su historia:

- **El operador** (antes `avataarsin`): el bucle, los conectores, la seguridad y la demo.
- **El estudio de avatares** (antes `vex-avatar-studio`): herramienta privada para diseñar avatares a partir de un logo y publicarlos firmados. Diseño en `docs/diseno.md`.

Es un repositorio local de prueba para ver si la fusión es viable; los dos originales siguen intactos.

El operador contiene el prototipo funcional y los assets del avatar. Hecho hasta ahora: el operador con sus contratos y Vex Core (Hitos 0 y 1 de la hoja de ruta), la puesta a punto (parada, confirmaciones con el contenido real, persistencia, banco de encargos, pruebas en navegador e integración continua), los conectores para aprender herramientas nuevas con aprobación humana, y el endurecimiento de seguridad descrito en `docs/seguridad.md`. Pendiente: conectar el backend real y medir con Claude.

## Estructura

```
apps/
  api/              Vex Core: servicio Fastify con el bucle del agente, el driver de
                    plataforma (6 herramientas), confirmaciones, auditoría y el adaptador
                    de Claude. Incluye una plataforma simulada en memoria.
  operator-demo/    Página que hace de plataforma anfitriona (React + Vite): listas,
                    contexto de pantalla, chat con pasos, tarjeta de confirmación y el
                    avatar dirigido por eventos reales.
  api/evals/        Banco de encargos: casos, ejecutor e informes.
  sample-tools/     Herramientas "de terceros" para probar conectores: una agenda de citas
                    descrita con OpenAPI y un tablón de notas como servidor MCP.
  server/           Estudio: servidor privado (cuentas, historial, subida saneada,
                    asistente, publicación firmada, integraciones por dominio).
  studio/           Estudio: editor (logo, esqueleto, física, materiales, personalidad).
e2e/                Pruebas en navegador real del operador.
e2e-studio/         Pruebas en navegador real del estudio, con una web de otro dominio.
examples/
  asistente.html    Una página sin framework con Vex en dos líneas.
packages/
  assistant/        <vex-assistant>: el panel del operador en una etiqueta (chat, confirmación,
                    Detener, avatar del estudio dirigido por fases) y el registro de elementos.
  format/           Estudio: documento del avatar, operaciones, firma Ed25519 y Vex como muestra.
  runtime/          Estudio: dibujo, esqueleto, muelles, materiales y <vex-avatar>.
  operator/         Contratos (Zod) y el bucle del operador, sin SDK de ningún proveedor.
  connectors/       Conectores: importar OpenAPI o MCP, riesgo sugerido, revisión humana,
                    validación de entradas y ejecución. Cliente MCP propio (stdio y HTTP).
  vex/              El avatar 2D: rig SVG por capas con 8 estados, 5 expresiones,
                    9 visemas y niveles de detalle. Solo depende de React.
presets/
  demo-negocio/     Manifiesto del host de la plataforma de demo (con él corre el banco),
                    con botones rápidos y un anuncio de bienvenida.
  agenda/           Un segundo host sin código propio: la agenda de citas, solo por manifiesto.
assets/
  vex-2d/           Rig fuente (SVG + JSON con pivotes, poses, paleta) y hojas de personaje.
  vex-3d/           Modelo GLB con 8 clips de animación, visor Three.js y exportador.
docs/
  diseno.md                   Estudio de avatares: diseño, seguridad y siguientes fases.
  operador.md                 Cómo funciona el prototipo y cómo conectar un backend real.
  conectores.md               Cómo aprende Vex una herramienta nueva, con aprobación humana.
  seguridad.md                Modelo de amenazas: qué protege a Vex, cómo se comprueba y qué falta.
  vex-agente-viabilidad.md    Informe de viabilidad y hoja de ruta de 5 hitos.
```

## Arrancar

Requisitos: Node 24 y pnpm 10 (`npm i -g pnpm@10`).

```bash
pnpm install
pnpm dev:api     # Vex Core en http://127.0.0.1:8787
pnpm dev:demo    # demo en http://localhost:5174
```

Estudio de avatares (necesita `pnpm build` una vez, para el script `<vex-avatar>`):

```bash
pnpm dev:studio-server   # http://127.0.0.1:8788
pnpm dev:studio          # http://localhost:5180 (entrada de desarrollo solo en este equipo)
```

En local no hace falta configurar nada más: el login de demo y el proxy del modelo se activan solos cuando el servidor escucha en `127.0.0.1`. Para un servidor público, copia `apps/api/.env.example` a `apps/api/.env` y rellena al menos `CORS_ORIGIN` (las páginas que pueden llamar a Vex) y `VEX_TOKEN_SECRET`; `docs/seguridad.md` lista el resto.

Con clave, los topes de uso vienen puestos de serie (300.000 tokens por persona y día, 50 USD por instalación y mes; `VEX_LIMIT_*` en `.env.example`): al tope Vex sigue en modo guion y lo dice, y un administrador puede pausar la IA o todo Vex (`POST /admin/pause`). Sin clave de Anthropic, Vex Core arranca en **modo guion**: un planificador determinista por palabras clave que ejecuta peticiones como "Busca a Laura Pérez, abre expediente de residencia, crea una tarea para extranjería y mándale un correo pidiendo documentación", pero no conversa. Para usar Claude, copia `apps/api/.env.example` a `apps/api/.env` y pon la clave; el modelo por defecto es `claude-opus-5-5`.

Comprobaciones:

```bash
pnpm typecheck
pnpm test                            # contratos, bucle, conectores, API y puerta del banco
pnpm eval -- --provider scripted     # banco de 38 encargos sobre la plataforma y tres hosts de muestra (17 en modo guion)
pnpm eval:studio -- --provider heuristic  # banco del asistente del estudio: 15 peticiones (12 con el geométrico)
pnpm e2e                             # 9 pruebas del operador en navegador real (en Windows usa Edge)
pnpm e2e:studio                      # el estudio en Edge: 4 recorridos, Vex importado con caras y visemas,
                                     # y el avatar publicado operando en la demo y en una página HTML simple
```

**Conectar una herramienta nueva:** arranca un host de muestra (`pnpm dev:citas`, `pnpm dev:catalogo` o `pnpm dev:crm`: agenda, tienda y CRM), abre `http://localhost:5174/#conectores`, pulsa Importar, revisa el riesgo de cada acción, activa lo que quieras y guarda. Desde el chat: `usa citas_listar_huecos {"fecha":"2026-10-27"}`, o en lenguaje natural si hay clave de Claude. Detalle y reglas en `docs/conectores.md`.

Con clave, `pnpm eval -- --provider anthropic` mide a Claude con el mismo banco, y `pnpm eval:studio -- --provider claude` al asistente del estudio. GitHub Actions ejecuta todo lo anterior en cada push; la evaluación con Claude se lanza a mano y usa el secreto `ANTHROPIC_API_KEY`. Detalle en `docs/operador.md`.

**Verlo entero en media hora**: `docs/vex-en-30-minutos.md` monta una web «del cliente» con Vex dentro (preset `demo-guiada`, `pnpm dev:host-demo`): tour, botones, una herramienta conectada y una demo guiada con reinicio firmado.

## Instalar en un cliente

Una imagen (`apps/api/Dockerfile`), un `compose.yaml`, un volumen con el SQLite y los secretos en `apps/api/.env`:

```bash
docker compose up -d
```

Copia en caliente del SQLite con `node scripts/backup.ts`, restauración con `node scripts/restore.ts`, y un trabajo de CI que construye la imagen y la prueba fuera de loopback. Detalle en `docs/instalar.md`.

## Cómo se integra en una plataforma real

0. **Manifiesto:** la plataforma se describe en un `manifest.json` (`presets/`, `VEX_HOST_MANIFEST`): nombre, dominio, claves del contexto de pantalla, conectores propuestos (sin revisar hasta que un administrador los apruebe), política y el avatar publicado por el estudio. Vive en el servidor y solo puede estrechar lo que Vex hace. Detalle en `docs/operador.md`.
1. **Presencia:** dos líneas en la página: `<script type="module" src="https://vex.example/assistant.js">` y `<vex-assistant api="https://vex.example">`. El token lo entrega el host con `el.getToken = async () => …`, nunca en el DOM. El panel dibuja el avatar que el estudio publicó para el host y lo mueve con las fases del operador. Detalle en `docs/operador.md`.
2. **Manos:** implementar `PlatformClient` (`apps/api/src/platform/types.ts`) con llamadas HTTP al backend, pasando el token del usuario, y sustituir `MockPlatform` en `apps/api/src/server.ts`. Las herramientas no cambian.
3. **Identidad:** `TokenService` en `apps/api/src/auth.ts` firma y verifica los tokens de sesión; el punto de cambio es su método `verify`, que debe validar el JWT de la plataforma y convertirlo en el principal. El operador nunca tiene más poder que esa persona.
4. **Contexto:** la página envía con cada mensaje qué hay en pantalla (`contactoId`, `expedienteId`, `pantalla`).

## Principios

- Toda herramienta declara su riesgo (`read` · `write` · `irreversible`). Lo irreversible detiene el bucle hasta que el usuario confirma.
- Nada se ejecuta fuera de la política de permisos; lo no permitido se deniega.
- Cada acción queda en la auditoría con usuario, parámetros, resultado y duración.
- Lo que devuelven las herramientas (correos, notas, páginas) son datos, nunca instrucciones.
- El avatar es una vista: recibe fases y estados, no sabe nada del agente.

## Entorno Windows con Control de aplicaciones

El proyecto evita binarios nativos sin firmar: Vite 6 con `rollup` y `esbuild` en WebAssembly (ver `pnpm-workspace.yaml`) y Node 24 ejecutando TypeScript directamente (imports relativos con extensión `.ts`, sintaxis borrable).

## Licencia

Apache License 2.0 (`LICENSE` y `NOTICE`). Copyright 2026 César Augusto Gil.
