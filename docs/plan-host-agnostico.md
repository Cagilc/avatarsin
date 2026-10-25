# Plan · Vex agnóstico de host (propuesta)

Estado: **propuesta para revisión de César**. Solo documento; no cambia código. Pensado para que se pueda mejorar y ejecutar por hitos, cada uno en su PR.

## Objetivo

Que Vex sirva para **cualquier plataforma** sin tocar el núcleo: que lea una API (OpenAPI) o un servidor MCP, sepa qué puede hacer, se integre en la interfaz de ese host y lo guíe (tours, onboarding, anuncios, botones rápidos), todo configurado por datos y no por código. El negocio que hoy viene precargado (contactos, expedientes, correos) pasa a ser **un preset de ejemplo**, no el núcleo.

Reglas de partida:

- **Aditivo.** No se cambia el estilo ni se retira nada de lo hecho. Lo precargado se mueve a `presets/`, no se borra.
- **Cada capacidad con interruptor y apagada por defecto.**
- **Mantener los principios de `CLAUDE.md`:** riesgo declarado, confirmación en lo irreversible, lo leído es dato, nada importado actúa sin revisión humana.
- **Criterio de aceptación global:** dos hosts distintos funcionan con **cero cambios de código** entre ellos (el preset actual y la agenda de `sample-tools`, más cualquier plataforma externa). Si hay que tocar el núcleo para el segundo, el diseño está mal.
- Ningún nombre ni dato de un host concreto entra en el repo; el manifiesto de cada host vive en el host.

## Dónde está hoy el acoplamiento al negocio precargado

| Pieza | Acoplamiento | Destino |
|---|---|---|
| `apps/api/src/tools/platform.ts`, `platform/mock.ts`, `platform/types.ts` | 6 herramientas del dominio (buscar, expediente, tarea, correo) | `presets/mnee/` como preset opcional |
| `apps/api/src/system.ts` | Prompt con ejemplos del dominio (`buscar → expediente → tarea → correo`, `contactoId`, `expedienteId`) | Prompt base neutro + `domain` del manifiesto |
| `packages/operator/src/providers/scripted.ts` | Planificador por palabras clave del dominio | Pasa al preset; el núcleo conserva solo la orden directa `usa <herramienta> {json}` |
| Contexto de pantalla `{pantalla, contactoId, expedienteId}` | Esquema fijo | Esquema libre declarado en el manifiesto |
| `apps/operator-demo` (listas, chat) | Demo del dominio | Se queda como demo del preset; el SDK de host (Hito 1) es lo reutilizable |
| `apps/api/evals/cases.ts` | Casi todos los casos son del dominio | Casos del preset aparte; casos genéricos (inyección, permisos, negativos) en el núcleo |

(Inventario hecho leyendo el código; el Hito 0 empieza por confirmarlo con una búsqueda exhaustiva.)

## Manifiesto de host

Un fichero JSON o YAML, validado con Zod en `packages/operator` (`schema/host.ts`), que configura todo sin código. Esbozo:

```jsonc
{
  "version": 1,
  "host": { "name": "…", "domain": "descripción corta del negocio para el prompt" },
  "personality": { "name": "Vex", "tone": "…", "locale": "es" },
  "theme": { /* los 9 colores del rig, ya existentes */ },
  "connectors": [ { "id": "…", "openapi": "https://…/openapi.json", "auth": { "kind": "header", "name": "X-API-Key", "env": "HOST_API_KEY" } } ],
  "policy": { "allow": [], "deny": [], "confirm": ["irreversible"] },
  "screenContext": { /* JSON Schema del contexto que envía el host */ },
  "quickActions": [ { "id": "…", "label": "…", "prompt": "…", "tool": null, "roles": [] } ],
  "tours": [ { "id": "…", "when": { "firstVisit": true }, "steps": [ { "target": "ui:…", "say": "…", "pose": "point", "advanceOn": "click" } ] } ],
  "announcements": [ { "id": "…", "since": "2026-11-01", "roles": [], "title": "…", "body": "…" } ],
  "features": { "tours": false, "announcements": false, "quickActions": false, "domDriver": false }
}
```

Reglas: el manifiesto no puede ampliar lo que la revisión humana de conectores aprobó; los secretos solo por nombre de variable de entorno; un manifiesto inválido se rechaza al arrancar con el error exacto.

## Cómo se ejecuta

Los hitos se han convertido en **cinco workflows** autocontenidos en `docs/workflows/` (protocolo, reparto de trabajo, modelo por fase y orden en `00-protocolo.md`). Correspondencia: hito 0 → workflow 01, hito 1 → 02, hito 2 → 03, hito 3 → 04, hito 4 → 05. El hito 5 (servidor y multi-inquilino) queda fuera: es el carril de infra de Oscar.

## Hitos

Cada hito: un PR, `pnpm typecheck` + `pnpm test` + banco en verde (y `pnpm e2e` si se toca demo o avatar), `docs/seguridad.md` actualizado si cambia una amenaza o defensa.

### Hito 0 · Desacoplar y manifiesto
- Esquema del manifiesto (`packages/operator/src/schema/host.ts`) con tests.
- Mover lo del dominio a `presets/mnee/` y cargar el preset desde el manifiesto; el arranque actual sigue funcionando sin configuración (preset por defecto = comportamiento de hoy).
- `system.ts` con prompt base neutro; el dominio y los ejemplos vienen del manifiesto.
- Contexto de pantalla con esquema declarado por el host.
- **Hecho cuando:** el banco en modo guion sigue dando 15/15 con el preset, y arranca un segundo host (agenda de `sample-tools`) solo con manifiesto, sin tocar `apps/api/src` ni `packages/*`.

### Hito 1 · SDK de host y web component
- Núcleo del avatar sin React + `<vex-assistant>` (es el Hito 2 de la hoja de ruta de César; se hace aquí, no se duplica).
- Registro de elementos de UI: atributos `data-vex-id` / `data-vex-label` y una API `vex.register({ id, label, rect })`; instantánea del árbol de accesibilidad (roles ARIA) como contexto opcional.
- Instalación por una etiqueta `<script>` y un atributo `src` del manifiesto.
- **Hecho cuando:** la demo del preset se monta con el web component y un host HTML sin React lo carga con dos líneas.

### Hito 2 · Tours y onboarding con la mascota
- Motor determinista de tours (sin modelo): pasos con objetivo, texto, pose y condición de avance; el *director* mueve la mascota hacia el rectángulo del elemento y señala.
- Capa de juego opcional: progreso por usuario, hitos y logros, persistidos en el almacén ya existente.
- Opcional y con revisión humana: generar un borrador de tour con el modelo a partir del OpenAPI y de la UI registrada. Nada se publica sin aprobación.
- Accesibilidad: `prefers-reduced-motion`, foco y teclado; la mascota nunca captura clics ni tapa el elemento señalado.
- **Hecho cuando:** un tour del manifiesto se recorre completo en e2e, con capturas por paso y sin llamar al modelo.

### Hito 3 · Anuncios y botones rápidos
- Feed de anuncios versionado, por rol, con estado «visto» por usuario.
- Propuesta automática de anuncio cuando un conector añade o cambia una herramienta aprobada (borrador a revisar).
- Botones rápidos opcionales: prompt o herramienta directa con parámetros; la directa pasa por la política y la confirmación como cualquier otra.
- **Hecho cuando:** un botón con herramienta irreversible pide confirmación con la vista previa real, y un anuncio aparece una sola vez por usuario.

### Hito 4 · Driver `dom`
- Acciones resaltar, rellenar y clic sobre elementos registrados (ya existe el driver `dom` en el enum, sin implementar).
- Se ejecutan en la página: viaje de ida y vuelta por el flujo de eventos; mismo principal; clic en «enviar» o equivalente cuenta como `write` y pide confirmación.
- El texto de la página es **dato no confiable** (vía nueva de inyección): casos hostiles en el banco antes de activarlo.
- **Hecho cuando:** pasa un caso de inyección con una página que «ordena» una acción y no se ejecuta nada.

### Hito 5 · Servidor y multi-inquilino
- Imagen de contenedor; un manifiesto por inquilino seleccionado por el token; `HOST=0.0.0.0` solo tras proxy con TLS.
- Parada global de administrador y límite de gasto por usuario y día (pendientes ya listados en `docs/seguridad.md`).
- Opcional más adelante: exponer Vex como servidor MCP.

## Riesgos y reglas nuevas

- Lo que se lee de una página o de un resultado de herramienta es dato, nunca instrucción (cada fuente nueva entra con casos de inyección).
- Contenido generado por el modelo (tours, anuncios) se revisa antes de publicarse.
- Los tours, anuncios y botones deben funcionar **sin clave de modelo**: son baratos y deterministas.
- El modelo por defecto es caro; el manifiesto debe permitir fijar otro por host.
- Cada capacidad nueva con su interruptor en `features`, apagado por defecto.

## Cuándo probar con un host real

- **Ya (Hito actual):** importar el OpenAPI de un host real con una credencial de **solo lectura** en local, revisar los riesgos y comprobar qué descripciones faltan. No aporta valor de producto todavía, pero da los requisitos reales del manifiesto.
- **Tras el Hito 0:** un host real se conecta solo con manifiesto. Es la prueba de que el desacoplamiento es de verdad.
- **Tras el Hito 1:** el asistente aparece dentro del host real.
- **Tras el Hito 2:** el onboarding guiado, que es lo que se busca ver.
- Producción real de cualquier host: no antes de la autenticación real y de los pendientes de `docs/seguridad.md`.

## Preguntas abiertas para César

1. **Licencia.** Elegir una (MIT o Apache-2.0) antes de aceptar más contribuciones.
2. ¿Hay objeción a mover el preset actual a `presets/mnee/`? Se conserva todo, solo cambia de sitio.
3. ¿El web component sustituye al componente React de la demo o conviven?
4. ¿Prefiere manifiesto en JSON o en YAML? (YAML ya figura como pendiente para OpenAPI.)
5. ¿Orden de hitos adecuado, o prefiere tours antes que el desacoplamiento completo?
