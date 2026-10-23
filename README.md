# avataarsin · Vex, el operador con avatar

Vex es un avatar animado que **ejecuta acciones** en una plataforma de negocio en nombre del usuario que ha iniciado sesión: busca contactos, abre expedientes, crea tareas para un equipo, redacta y envía correos. Encadena los pasos, pide confirmación para lo irreversible y deja registro de todo. El avatar refleja en qué fase está (pensando, trabajando, esperando tu OK, hablando).

Este repositorio contiene el prototipo funcional (Hitos 0 y 1 de la hoja de ruta) y los assets del avatar.

## Estructura

```
apps/
  api/              Vex Core: servicio Fastify con el bucle del agente, el driver de
                    plataforma (6 herramientas), confirmaciones, auditoría y el adaptador
                    de Claude. Incluye una plataforma simulada en memoria.
  operator-demo/    Página que hace de plataforma anfitriona (React + Vite): listas,
                    contexto de pantalla, chat con pasos, tarjeta de confirmación y el
                    avatar dirigido por eventos reales.
packages/
  operator/         Contratos (Zod) y el bucle del operador, sin SDK de ningún proveedor.
  vex/              El avatar 2D: rig SVG por capas con 8 estados, 5 expresiones,
                    9 visemas y niveles de detalle. Solo depende de React.
assets/
  vex-2d/           Rig fuente (SVG + JSON con pivotes, poses, paleta) y hojas de personaje.
  vex-3d/           Modelo GLB con 8 clips de animación, visor Three.js y exportador.
docs/
  operador.md                 Cómo funciona el prototipo y cómo conectar un backend real.
  vex-agente-viabilidad.md    Informe de viabilidad y hoja de ruta de 5 hitos.
```

## Arrancar

Requisitos: Node 24 y pnpm 10 (`npm i -g pnpm@10`).

```bash
pnpm install
pnpm dev:api     # Vex Core en http://127.0.0.1:8787
pnpm dev:demo    # demo en http://localhost:5174
```

Sin clave de Anthropic, Vex Core arranca en **modo guion**: un planificador determinista por palabras clave que ejecuta peticiones como "Busca a Laura Pérez, abre expediente de residencia, crea una tarea para extranjería y mándale un correo pidiendo documentación", pero no conversa. Para usar Claude, copia `apps/api/.env.example` a `apps/api/.env` y pon la clave; el modelo por defecto es `claude-opus-5-5`.

Comprobaciones:

```bash
pnpm test        # operator 16 · api 5
pnpm typecheck
```

## Cómo se integra en una plataforma real

1. **Presencia:** la página monta el avatar y el panel de chat (hoy, el componente React de `apps/operator-demo`; el objetivo del Hito 2 es un web component de una sola etiqueta).
2. **Manos:** implementar `PlatformClient` (`apps/api/src/platform/types.ts`) con llamadas HTTP al backend, pasando el token del usuario, y sustituir `MockPlatform` en `apps/api/src/server.ts`. Las herramientas no cambian.
3. **Identidad:** `verifyToken` en `apps/api/src/auth.ts` verifica el JWT de la plataforma y lo convierte en el principal. El operador nunca tiene más poder que esa persona.
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

Código y assets de Vex: propiedad de César Augusto Gil. Pendiente de elegir licencia antes de publicar.
