# Instalar Vex Core en un cliente

Vex se instala **en cada cliente** (decisión 2 del plan maestro): una imagen, un contenedor, un fichero SQLite en un volumen, los secretos fuera de la imagen. Esta guía cubre la imagen de Vex Core (el operador y el script `assistant.js` que la página del host carga). El estudio no forma parte de la imagen: los avatares se publican desde el estudio y la instalación los consume por su `endpoint`.

## Requisitos

- Docker (o cualquier runtime OCI) y `docker compose`.
- Un manifiesto del host (`presets/<nombre>/manifest.json` dentro de la imagen, o una ruta montada).
- Las páginas del host que llamarán a Vex Core, para `CORS_ORIGIN`.
- La clave de Anthropic del cliente (decisión 4) si quiere IA; sin ella arranca en modo guion.

## Arrancar

```bash
docker compose up -d
```

`compose.yaml` construye la imagen desde la raíz del repositorio (`apps/api/Dockerfile`), publica el puerto 8787, monta el volumen `vex-data` en `/data` y lee `apps/api/.env` si existe. Variables que se pasan por entorno o por ese fichero:

| Variable | Qué hace |
|---|---|
| `VEX_HOST_MANIFEST` | Preset o ruta del manifiesto. En `compose.yaml` viene `demo-negocio` por defecto. |
| `CORS_ORIGIN` | Orígenes exactos de las páginas del host, separados por comas. Fuera de loopback no hay valor por defecto: sin él ningún navegador puede llamar. |
| `ANTHROPIC_API_KEY`, `VEX_MODEL` | La clave del cliente y el modelo. Sin clave, modo guion. |
| `VEX_TOKEN_SECRET` | Firma los tokens de sesión y los enlaces de aprobación. Sin él caducan al reiniciar. |
| `VEX_PUBLIC_URL` | Cómo se ve Vex Core desde fuera (enlaces de aprobación). |
| `VEX_LIMIT_USER_DAY_TOKENS`, `VEX_LIMIT_MONTH_USD`, `VEX_WARN_RATIO` | Límites de gasto; activos por defecto. |
| Secretos de conectores (`CITAS_TOKEN`…) y `secretEnv` del manifiesto | Solo el nombre va en el manifiesto; el valor, aquí. |

Dentro de la imagen `HOST=0.0.0.0`, así que valen los **valores de producción**: no existe el login de demo (`VEX_DEMO_LOGIN` no lo enciende salvo que se fuerce a `1`, y no conviene), no hay proxy del modelo, y las URL salientes (conectores, *grant*, webhooks, JWKS) tienen que ser https y públicas. El proceso corre como el usuario `node`, no como root. `/health` responde `{"ok":true}` y la imagen trae su propio `HEALTHCHECK`.

Pon un **proxy inverso con TLS** delante (Caddy, nginx, Traefik) y deja el 8787 sin exponer fuera de la máquina.

## Copia de seguridad y restauración

La base de datos es un solo fichero SQLite en `/data/vex.db` (auditoría, conversaciones, conectores revisados, anuncios, gasto). La copia es **en caliente**: `VACUUM INTO` escribe una instantánea coherente sin parar el servidor.

```bash
docker compose exec vex-core node scripts/backup.ts /data/vex.db /data/backups/vex-$(date +%F).db
```

La copia queda en el volumen; cópiala fuera de la máquina con `docker cp` o montando `/data/backups`. Para comprobar una copia:

```bash
docker compose exec vex-core node scripts/restore.ts --check /data/backups/vex-2026-10-27.db
```

Restaurar exige **parar el servidor** (el script se niega si ve páginas pendientes en el WAL):

```bash
docker compose stop vex-core
docker compose run --rm vex-core node scripts/restore.ts /data/backups/vex-2026-10-27.db /data/vex.db
docker compose start vex-core
```

La prueba de que esto funciona está en `apps/api/src/backup.test.ts` (copia con el almacén abierto, la copia lee lo mismo, restauración solo con el servidor parado, rechazo de una copia rota) y en el trabajo `container` de CI, que construye la imagen, la arranca fuera de loopback con el preset de muestra y una clave falsa en un fichero de entorno, comprueba `/health`, `/operator/info` y `/assistant.js`, que el login de demo no existe, que la clave no aparece en los logs, que el proceso no es root, y hace una copia en caliente dentro del contenedor y la verifica.

## Actualizar

```bash
git pull
docker compose build
docker compose up -d
```

El esquema de la base de datos se crea con `create table if not exists`: una versión nueva arranca sobre el fichero anterior. Haz una copia antes de actualizar.

## Qué no entra en la imagen

`.env`, `data/`, `node_modules`, `dist` de la máquina, informes del banco, perfiles de Playwright y el repositorio `.git` (`.dockerignore`). Los secretos pasados por entorno son visibles para quien pueda ejecutar `docker inspect` en la máquina: eso es responsabilidad del despliegue (secretos de Docker o del orquestador si hace falta más).

## Limitaciones conocidas

- No se ha probado en Windows con Control de aplicaciones (en ese equipo no corre Docker); se prueba en CI (Ubuntu) y en Linux.
- Un solo proceso y un solo fichero: es lo que una instalación por cliente necesita. No hay réplica ni alta disponibilidad.
