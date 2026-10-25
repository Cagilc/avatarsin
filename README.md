# Vex · estudio de avatares

Estudio **privado** para crear avatares animados a partir de un logo: piezas, esqueleto, física, materiales, personalidad y capacidades, con un asistente que prepara el borrador y solo pregunta lo que falta. Publica paquetes **firmados** que cualquier web incrusta con `<vex-avatar>`, solo en los dominios autorizados.

Es la evolución del avatar de [avatarsin](https://github.com/Cagilc/avatarsin). Por ahora vive solo en local.

```
packages/format    documento del avatar, operaciones, firma
packages/runtime   dibujo, esqueleto, muelles, materiales, <vex-avatar>
apps/server        servidor privado (cuentas, historial, asistente, publicación, integraciones)
apps/studio        editor
e2e                pruebas en navegador real
docs/diseno.md     diseño, seguridad y siguientes fases
```

## Arrancar

```bash
pnpm install
pnpm build
pnpm dev:server
pnpm dev:studio
```

Abre http://localhost:5180 y entra en modo desarrollo (solo funciona en este equipo). «Probar con la mascota de ejemplo» importa un logo de prueba.

Requisitos: Node 24 y pnpm 10. En equipos con Control de aplicaciones de Windows, Vite usa las versiones WebAssembly de Rollup y esbuild (ya configurado).

## Comprobar

```bash
pnpm typecheck
pnpm test
pnpm e2e
```

Todo lo demás (seguridad, el asistente, cómo incrustar, fases siguientes) está en [docs/diseno.md](docs/diseno.md).
