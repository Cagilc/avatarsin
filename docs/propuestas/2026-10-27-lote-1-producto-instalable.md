# Propuesta · lote 1 · Vex como producto instalable y medible

Estado: **propuesta para César**, solo documento. Nada está decidido. Sigue a `2026-10-26-niveles-y-demos.md` (P1–P4 ya están en `main`). Es genérica: no depende de ninguna plataforma concreta.

## Resumen

P1–P4 funcionan. Lo que separa a Vex de algo que se pueda **instalar en un cliente y enseñar** son cuatro cosas pequeñas y una de método. Ninguna necesita clave de Anthropic, así que caben mientras llega la medición con Claude (paso 4).

## Resultado de nuestras pruebas externas de P1–P4

Probado sobre `main` (`2cc1a6e`), con Vex Core en local, la agenda de muestra y un manifiesto propio fuera del repositorio.

- **P1 identidad (hs256):** 17 de 17 casos como se esperaba. Rechaza caducado, sin `exp`, `nbf` futuro, emisor o audiencia distintos, firma ajena, `alg: none`, algoritmo declarado distinto del del manifiesto, payload manipulado, rol desconocido y sin token. Acepta la tolerancia de reloj y la audiencia en lista. Un rol del host traducido a `admin` revisa conectores y otro recibe 403.
- **P2 filtro:** con una especificación sintética de 700 operaciones, sin filtro da 400 con el motivo; `GET` más exclusiones deja 150 herramientas, ninguna escritura ni de las áreas vetadas, todas desactivadas. El prefijo funciona por segmentos. Filtro vacío, tope superado y regla mal escrita dan 400 con mensaje útil.
- **P3 efecto:** una escritura emite `effect` con `confirmed: true` y los datos leídos de vuelta; una cancelación irreversible pide confirmación, la ejecuta y emite `effect`.
- **P4 presentador:** guion, botón de escena, contador de coste y reinicio con 404 sin gancho y 403 para quien no es administrador.
- **No probado:** reinicio firmado contra un gancho real y JWKS con claves reales (lo haremos nosotros en el lote 1), y nada con el modelo.

**Hallazgo (menor).** Al cancelar en la agenda de muestra, la comprobación sugerida (`missing`) dice «No se pudo comprobar» porque la agenda no borra: devuelve `estado: cancelada`. Es honesto, pero la verificación no puede expresar «el estado vale `cancelada`». Ver L1.3.

## Propuestas

Cada una con su interruptor apagado por defecto, contratos Zod y tests primero, y fila en `docs/seguridad.md` cuando cambie una defensa.

### L1.1 · Contenedor instalable por cliente
**Problema.** La decisión 2 es «se instala en cada cliente», pero no hay forma de instalarlo sin clonar el repositorio.
**Propuesta.** Imagen de Vex Core (y los scripts `assistant.js` y `vex-avatar.js` que ya sirve) con usuario no root, comprobación de salud en `/health`, volumen para el SQLite, variables por entorno o archivo (nunca en la imagen), `compose` de ejemplo, guía de actualización y un script de copia de seguridad en caliente del SQLite con prueba de restauración. Debe arrancar sin clave de Anthropic (modo guion).
**Hecho cuando.** En una máquina limpia, `docker compose up` deja `/health` correcto y el preset de muestra operando; copiar, borrar el volumen y restaurar devuelve el mismo estado; los secretos no aparecen en `docker inspect` ni en los logs.

### L1.2 · Actuar con el token del propio usuario
**Problema.** Hoy un conector usa un secreto fijo del entorno (`none`, `bearer` o `header`). Vex actúa como un usuario de servicio y la API del host no puede aplicar los permisos de cada persona; la regla de los tres permisos estrecha, pero el host no ve quién pide. Esto choca con el principio 2 de `CLAUDE.md` («el operador actúa con el principal del token, nunca con cuenta de servicio») para las acciones que pasan por conectores.
**Propuesta.** Un tipo de autenticación de conector `session` que reenvía el token de sesión **ya verificado** de la persona (el de P1) a la `baseUrl` del conector. Solo con `identity` configurada en el manifiesto.
- Solo al origen exacto de la `baseUrl`; una redirección a otro origen lo quita (la guardia ya quita credenciales; falta el test con este tipo).
- No se guarda, no se registra, no entra en la auditoría ni en el contexto del modelo ni en la vista previa de la tarjeta.
- Token caducado: la herramienta falla con un mensaje claro y no reintenta.
- **Pregunta de diseño.** Una confirmación resuelta por enlace de un canal (aprobaciones por canal) puede llegar con el token ya caducado. Opciones: que falle y se pida de nuevo, o que la aprobación solo valga mientras el token esté vivo. Tu criterio.
**Hecho cuando.** Un host cuya API exige el JWT del usuario funciona solo por manifiesto; los tests cubren cabecera presente, ausente en redirección a otro origen, ausente de auditoría, registros y chat, y token caducado.

### L1.3 · Verificación con valor esperado
**Problema.** `expect` solo admite `exists | missing`. Una cancelación «blanda» (cambia un estado) no se puede comprobar.
**Propuesta.** `expect: { path, equals }` (puntero a la respuesta de la lectura y valor literal o `$input.x`), además de lo actual. El importador puede sugerirlo cuando la respuesta de la escritura trae un campo `estado` o `status` que cambia.
**Hecho cuando.** La agenda de muestra comprueba «cancelada» con «Comprobado», y un valor distinto da «No se pudo comprobar»; sin `equals` nada cambia.

### L1.4 · Paquete de demo guiada
**Problema.** P4 existe, pero montar una demo exige conocer el esquema entero.
**Propuesta.** Un preset de ejemplo completo y comentado con guion de cinco escenas, botones, tour de inicio y `presenter.reset`; un servidor de muestra que implementa el gancho de reinicio **verificando la firma**; y una guía «poner Vex en una web en 30 minutos» (etiqueta, `getToken`, `data-vex-id`, manifiesto, revisión del conector).
**Hecho cuando.** Quien no ha visto el repositorio puede seguir la guía y llegar a una demo con reinicio; el e2e cubre el reinicio firmado de punta a punta (hoy solo se prueba el 404 y el 403).

### L1.5 · Más de una muestra: el banco no puede depender de un solo host
**Problema.** Los bancos miden contra la agenda de muestra y un banco del estudio. Las cifras que salgan valdrán para ese host, no para «cualquier plataforma», que es lo que el producto promete.
**Propuesta.** Al menos **tres hosts de muestra de tipos distintos** en `apps/sample-tools`, cada uno con su OpenAPI, su preset y sus casos en el banco: agenda (existe), catálogo con pedidos y un CRM con tareas y notas. Una categoría del banco que mezcle varios conectores a la vez, y casos hostiles (texto de un registro que «ordena» algo) en cada uno.
**Hecho cuando.** El banco informa el acierto por host y por categoría, y `--min-pass` se fija por categoría.

## Cómo medimos nosotros (sin transferir datos)

Acordado con Oscar: la medición con Claude la ejecutamos nosotros, en nuestro equipo y con una clave de API propia con tope de gasto bajo. **Nada de nuestros sistemas sale hacia este repositorio**: contra los hosts de muestra de este repositorio y contra nuestras APIs de pruebas, y a César solo le devolvemos **cifras agregadas** (acierto por categoría, coste y latencia por tarea, fallos con su caso del banco si es de las muestras públicas). Los casos que nazcan de nuestras APIs se quedan con nosotros.

Eso hace que L1.5 sea más importante: es lo que permite que ambos midamos lo mismo.

## Orden sugerido

L1.1 y L1.2 (convierten Vex en algo instalable y con permisos reales) → L1.5 (necesario para que la medición signifique algo) → L1.3 y L1.4.

## Preguntas para César

1. ¿L1.2 encaja con tu regla de los tres permisos, o prefieres que el reenvío del token sea una propiedad del conector y no del tipo de autenticación?
2. ¿Imagen única o separar el asistente estático del Vex Core?
3. ¿Qué tres hosts de muestra te parecen más representativos para L1.5?
4. ¿Hay alguna preferencia sobre cómo informar el coste real de una pasada del banco?

## Qué no está verificado
- Nadie ha medido el coste de una pasada del banco con Claude.
- No hemos probado Docker en un equipo con las restricciones de Windows que tiene el nuestro; el contenedor se probaría en Linux.
- Que `session` no exista ya con otro nombre: lo deducimos del esquema del manifiesto (`none`, `bearer`, `header`), no de leer todo el código.
