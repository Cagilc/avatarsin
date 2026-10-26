# Propuesta · niveles de capacidad y demos guiadas

Estado: **propuesta para César**, solo documento. Nada está decidido. Complementa `docs/plan-maestro.md`; no lo sustituye. Todo lo de abajo es genérico: sirve a cualquier host y no nombra plataformas concretas.

## Resumen

Dos ideas que salieron de usar Vex sobre una API real y de preparar una demo:

1. Ordenar lo que Vex puede hacer en **niveles de capacidad** que se encienden por separado y se estrechan con el mismo mecanismo de siempre (aprobado ∩ política ∩ *grant* firmado).
2. Un **modo presentador**: una demo guiada por una persona, con guion, que no depende del modelo, para enseñar Vex a un cliente y, más adelante, acompañar su incorporación.

Y seis propuestas concretas, ordenadas por valor, cada una con su interruptor apagado por defecto.

## Niveles de capacidad

| Nivel | Qué hace | Estado hoy |
|---|---|---|
| 0 · Guiar | Lee lo que la web registra, explica, hace tours, anuncia y responde. No ejecuta nada. | Tours, anuncios, botones y registro de elementos existen. No hay lectura automática de una web. |
| 1 · API / MCP | Ejecuta acciones por los conectores aprobados, con confirmación y auditoría. | Hecho. Falta **ver el efecto** y la **identidad real**. |
| 2 · Pantalla | Resalta, rellena y pulsa elementos registrados. | Sin hacer (paso 6 del plan maestro, tras medir inyección). |
| 3 · Desarrollo | Smoke tests y comprobaciones con acceso al código. | Fuera del asistente embebido (ver P6). |

Un nivel es un permiso, no un producto aparte: cada uno se activa en `features` y se puede estrechar en el *grant*.

## Propuestas

### P1 · Identidad genérica (JWT/OIDC)
**Problema.** El login es de demo; sin identidad real Vex no puede actuar como una persona de un host. Es el bloqueo común de cualquier uso real.
**Propuesta.** Un adaptador de `TokenService.verify` configurable por manifiesto: URL de claves públicas (JWKS) o secreto compartido, emisor y audiencia esperados, y el mapa de *claims* a principal (id, nombre, rol). Sin código por host.
**Hecho cuando.** Un host con JWT de terceros inicia sesión solo con manifiesto; token caducado, firma errónea, emisor o audiencia distintos se rechazan, cada caso con su test; fila nueva en `docs/seguridad.md`.
**Interruptor.** Sin `identity` en el manifiesto, el comportamiento es el actual.

### P2 · Filtro de operaciones al importar
**Problema.** Una API real puede tener cientos de operaciones (en la prueba, unas 700, de ellas unas 320 GET) y el importador las convierte todas en herramientas; además el límite de 2 MB de la especificación se queda corto.
**Propuesta.** `include` / `exclude` por ruta, etiqueta y método en la petición de importación y en el conector del manifiesto, con un máximo de herramientas por conector. Búsqueda de herramientas bajo demanda (ya figura como pendiente) como segundo paso.
**Hecho cuando.** Importar solo `GET` bajo un prefijo funciona, lo excluido nunca llega al borrador y hay test de ambas cosas.

### P3 · Ver el efecto de una acción
**Problema.** La tarjeta enseña lo que *va* a pasar; nada confirma que *pasó*, y la persona no lo ve en pantalla.
**Propuesta.**
- Una herramienta de escritura puede declarar una **verificación**: una lectura (otra herramienta de lectura con parámetros derivados de la respuesta) que confirma el efecto.
- Evento nuevo `effect` en el flujo con el resultado de la verificación.
- El host recibe `vex-effect` para refrescar su pantalla, y la mascota señala el elemento afectado si está registrado.
**Hecho cuando.** Una escritura con verificación muestra «comprobado» o «no se pudo comprobar», la verificación pasa por política y auditoría como cualquier lectura, y sin verificación declarada nada cambia.

### P4 · Modo presentador y guiones de demo
**Problema.** Una demo en directo con IA libre es frágil; y quien presenta necesita controlar el ritmo.
**Propuesta.**
- Un **guion** en el manifiesto: escenas con texto, pose, objetivo a señalar y, opcionalmente, una acción directa o un botón rápido. Es una extensión de los tours, sin modelo.
- Un **panel de presentador** (ventana aparte o atajos): escena siguiente y anterior, pasar a modo libre, parada, contador de coste del modelo.
- Un gancho `reset` configurable (URL del host, firmada) para devolver los datos de demo a su estado inicial entre ensayos.
**Hecho cuando.** Un guion de cinco escenas se recorre en e2e sin modelo, el reinicio solo se acepta desde el panel con rol de administrador, y el coste mostrado coincide con el de `spend.ts`.

### P5 · Aprender una web: escaneo que propone un manifiesto (nivel 0)
**Problema.** Instalar Vex en una web sencilla exige escribir a mano tours, botones y preguntas frecuentes.
**Propuesta.** Un comando que lee una página (estructura, textos, datos estructurados) y deja un **borrador** de manifiesto: tipo de web, tours posibles, botones y preguntas frecuentes. Nada se publica sin que una persona lo apruebe. Los tipos (agenda, tienda, CRM) serían paquetes de partida, como `presets/agenda`.
**No promete** entender cualquier web ni actuar sola: es incorporación asistida.
**Hecho cuando.** Sobre dos páginas de muestra de tipos distintos produce borradores válidos contra el esquema, con casos de inyección (texto de la página que «ordena» algo) en el banco.

### P6 · Modo desarrollador, separado
**Propuesta (solo límite, sin código ahora).** El nivel 3 no entra en el asistente embebido: habla con usuarios finales y tiene otra identidad y otra confianza. Si se hace, será otro paquete que solo se active desde local o CI con un principal de desarrollo, nunca desde una página pública, y con la misma gobernanza (riesgo, aprobación, auditoría).

## Orden sugerido
P1 y P2 desbloquean cualquier uso real y son independientes. Después P3 y P4 (lo que más se ve en una demo). P5 cuando haya cifras de inyección. P6 queda como límite.

## Cómo proponemos trabajar
- Respetamos la petición de abrir una **issue por propuesta** antes de tocar `apps/api` o `packages/operator`. Si te parece bien, las abrimos nosotros a partir de este texto.
- Un PR por propuesta, con contratos Zod y tests primero, y fila en `docs/seguridad.md` cuando cambie una defensa.
- Si prefieres no recibir PRs en esas zonas mientras están en obras, dinos cuáles tomarías tú y cuáles hacemos nosotros (P2 y P3 son pequeñas y bien acotadas).
- Fable para refinar cada propuesta y revisar cada diff, como en el plan anterior.

## Dirección de producto (para conversar, no es una decisión)
La combinación diferencial parece ser **copiloto gobernado + mascota de la marca + instalación por cliente**. El encaje más claro: software de gestión para servicios regulados (despachos, gestorías, clínicas), donde aprobar y auditar es un argumento de venta, y agencias que entregan un asistente con la mascota de la marca del cliente. Un objetivo de 90 días podría ser **dos socios de diseño en uso controlado, con identidad real y medido con Claude**. Es una hipótesis a contrastar con la competencia, que no hemos investigado.

## Preguntas para César
1. ¿Te encajan los niveles y su orden? ¿Falta o sobra alguno?
2. ¿Cuáles de P1–P6 tomas tú y cuáles hacemos nosotros?
3. ¿El modo presentador (P4) debe vivir en `packages/assistant` o en un paquete aparte?
4. ¿Hay ya una forma preferida de medir con Claude para fijar los mínimos de los bancos?
5. ¿El estudio puede generar un avatar desde un logo PNG, o conviene aportar un SVG?

## Qué no está verificado
- No se han ejecutado los bancos con Claude ni medido el coste real por tarea.
- La cifra de operaciones de la API real sale de contar rutas en el código, no de su `openapi.json`.
- No se ha investigado la competencia.
