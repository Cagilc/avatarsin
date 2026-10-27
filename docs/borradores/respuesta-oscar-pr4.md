# Borrador · respuesta a Oscar en la PR #4 (`docs/propuesta-lote-1`)

> **Sin publicar.** Tipo: comentario (la PR queda abierta como documento de propuestas, como la #3). César decide si se publica y cuándo. Fuente: `docs/plan-maestro.md`, paso 9.

---

Hola, Oscar:

Gracias por la prueba externa y por el lote: las cinco propuestas van al plan maestro como **paso 9**, con este orden y estas correcciones tras revisarlas contra el código.

**Correcciones**
- **L1.3** (valor esperado): de acuerdo, es pequeña y cierra tu hallazgo; va la primera. `expect: { path, equals }` con `equals` literal o `$input.x`, y el importador lo sugiere cuando la respuesta de la escritura trae `estado`/`status`.
- **L1.2** (token de la persona): encaja como **tipo de autenticación** (`auth.kind: 'session'`), no como propiedad del conector: la autenticación ya es un discriminante y la revisión la edita. Lo que falta de verdad no es el esquema sino que **el token no llega al runtime** (`ToolContext` solo lleva `sessionId`, `principal`, `context` y `signal`): añadiré `credential`, que Vex Core rellena **solo cuando el token aceptado fue un JWT del host** (`identity`), nunca con los suyos ni los de demo. La guardia ya quita todo salvo `accept` y `content-type` al cambiar de origen; falta el test con este tipo. La vista previa no enseña cabeceras y la auditoría guarda parámetros, no cabeceras. Tu pregunta de diseño: una aprobación por canal que llega con el token caducado **falla con mensaje claro y no reintenta**; el token no se guarda en ningún sitio, así que no hay otra opción honesta.
- **L1.1** (contenedor): no hay `Dockerfile`; `pnpm start` corre `node src/server.ts` sin compilar, así que la imagen es Node 24 + `pnpm install` + `pnpm build` de `runtime` y `assistant` (Vex Core sirve `assistant.js` desde `packages/assistant/dist`). En este equipo no puedo ejecutar Docker: lo construirá CI (ubuntu, `docker build` + arranque + `/health`) y te pediré que lo valides en Linux con `compose up`, copia y restauración. **Imagen única**: el asistente estático ya lo sirve Vex Core y separarlo añadiría un origen más a CORS sin ganancia.
- **L1.4** (paquete de demo): lo del e2e está desfasado: `e2e-studio/tests/asistente.spec.ts` ya comprueba el reinicio **firmado** de punta a punta (HMAC verificada en el servidor de prueba y 403 para quien no es administrador). Lo que sí falta y haré: un preset completo (`presets/demo-guiada`), un servidor de muestra en `apps/sample-tools` que verifique la firma del reinicio, y la guía «Vex en una web en 30 minutos».
- **L1.5** (tres hosts): es la propuesta que más vale y la más grande. Hoy hay la agenda y el MCP de notas, y el banco agrupa por categoría, no por host. Haré catálogo con pedidos y CRM con tareas y notas, cada uno con OpenAPI, preset y casos; una categoría «mixto» con varios conectores; casos hostiles en cada host; informe por host y `--min-pass` por categoría. Es lo que hace comparables tu medición y la nuestra.

**Tus preguntas del lote 1**: (1) tipo de autenticación, no propiedad; (2) imagen única; (3) agenda, catálogo con pedidos y CRM con tareas y notas: cubren lectura, escritura reversible e irreversible, y lo que más piden los hosts que tenemos en la cabeza; (4) el banco ya imprime USD por caso y total en `evals/reports/latest-<proveedor>.md`; se informa así, por categoría y por host cuando esté L1.5.

**Nivel navegador**: es nuestro paso 6 con el diseño desarrollado; nos lo quedamos. (1) A → B, C después, sí. (2) La extensión **fuera del repositorio** hasta tener cifras de inyección. (3) Websocket a `127.0.0.1` con mensajes firmados y caducidad: la mensajería nativa exige instalar un host por sistema operativo y complica el despliegue por cliente. (4) Recetas en el manifiesto como **propuestas sin revisar**, como un conector importado; un almacén por persona más adelante. (5) El mínimo antes de N3 no es un porcentaje de acierto: es **cero acciones de riesgo sin confirmar en los casos hostiles** del banco, medido en el paso 4; el acierto de los flujos se fija aparte.

**Tu medición**: bienvenida. La pasada con nuestra clave sigue siendo la que fija los mínimos (misma clave y modelo que pagará el cliente); con tus cifras agregadas contrastamos.

**Orden**: 9.1 L1.3 → 9.2 L1.2 → 9.3 L1.1 → 9.4 L1.5 → 9.5 L1.4, intercalando el paso 4 en cuanto haya clave; el driver DOM (N1) solo con esas cifras. La PR queda abierta como documento de propuestas; si la actualizas con lo que vaya entrando en `main`, la fusiono en `docs/propuestas/`.

Un abrazo,
César
