# Borrador · respuesta a Oscar en la PR #1 (`fix/ssrf-outbound-guard`)

> Sin publicar. Tipo de revisión propuesto: **Request changes**. César decide si se publica y cuándo.
> Fuente: `informe-aporte-oscar.md` (revisión del 2026-10-25 en un clon aislado) y sus pruebas `outbound.review.test.ts`.

---

Hola, Oscar:

Gracias por la PR. Cierra de verdad dos huecos que teníamos: las redirecciones que acababan en una dirección interna y la API key que viajaba al destino de una redirección. Queremos aceptarla, pero antes hay que cambiar algunas cosas. La hemos probado a fondo en un clon aparte, con servidores HTTP reales en 127.0.0.1 y el `fetch` de Node, no solo con simulaciones.

**Lo que funciona bien**
- `pnpm install --frozen-lockfile`, `typecheck`, `test` (25/16/55), banco 15/15, `build` y **`pnpm e2e` 9/9** (no lo habías ejecutado; ya está hecho).
- Las redirecciones se siguen a mano y se comprueban en cada salto, se quitan las credenciales al cambiar de origen, la `baseUrl` se comprueba al ejecutar y el MCP remoto pasa por la guardia.
- Sin dependencias ni scripts nuevos y sin tocar CI.

**Cambios que pedimos** (en esta PR salvo que se diga otra cosa)

1. **POST/PUT seguido de 301/302/303 falla.** Al pasar a GET, `{ ...init, … }` vuelve a meter `init.body`, y `fetch` lanza `TypeError: Request with GET/HEAD method cannot have body.` Con el `fetch` nativo de `main` ese caso funciona, así que es una regresión (por ejemplo, una API que responde «303 See Other» después de crear algo). Arreglo: `body: body ?? null` en la llamada interna. Necesita una prueba con un servidor real.
2. **Código 500 en vez de 400.** Si la guardia rechaza por DNS, por una redirección o por «demasiadas redirecciones», lanza un `Error` genérico y `fail()` en `app.ts` responde 500. Proponemos una clase `OutboundBlockedError` en `guard.ts`, que `fail()` traduzca a 400, con una prueba que compruebe el código de estado.
3. **DNS rebinding: demostrado con una conexión real.** El nombre se resuelve para comprobarlo y `fetch` lo vuelve a resolver al conectar. Hay una prueba que lo demuestra: el resolvedor de la guardia contesta «pública» y la petición llega a 127.0.0.1. Para cerrarlo hay que fijar la conexión a la IP comprobada con un `Agent` de `undici` y su `connect.lookup` (JS puro, sin binarios) y mantener el SNI y la cabecera `Host` del nombre original. Puede ir en una PR inmediatamente después de esta, siempre que haya una issue abierta y que el criterio de «hecho» sea que esa prueba (`DNS rebinding window`) pase. Mientras tanto, `docs/seguridad.md` debe decir que la comprobación DNS **no frena** a quien controla un DNS.
4. **`isInternalHost` ahora juzga respuestas DNS** que puede controlar un atacante, y deja pasar `fe90::`–`febf::` (de `fe80::/10` solo se mira `fe80`), NAT64 `64:ff9b::/96`, 6to4 `2002::/16` (con la IPv4 embebida), `198.18.0.0/15`, `224.0.0.0/4`, `240.0.0.0/4` y `255.255.255.255`. El hueco no lo has introducido tú, pero con esta PR pesa más. Es mejor invertir la regla, «solo unicast global», con `net.BlockList`. Puede ir aquí o junto con el punto 3.
5. **Pruebas de `HttpMcpClient`.** No había ninguna, y esta PR le cambia el `fetch`. Te pasamos tres como base: handshake, `tools/list`, `tools/call` por SSE y `DELETE` al cerrar con `mcp-session-id`; la importación de un MCP remoto local con la política de desarrollo; y una redirección 307 de `tools/call` a otro origen que no se lleva la sesión.
6. **Pruebas con servidores reales** además de las simuladas, y `pnpm e2e` en la descripción de la PR.
7. Menor: si la entrada es un objeto `Request`, se pierden sus cabeceras y su cuerpo. Hoy nadie lo usa, pero conviene rechazarlo o tratarlo.
8. Opcional: una línea en `docs/conectores.md` sobre redirecciones y credenciales.

**Estado de las pruebas de la revisión** (`apps/api`, 78 casos):

| | Superadas | Fallidas | Qué falla |
|---|---|---|---|
| PR tal cual | 66 | 12 | puntos 1 (×2) y 2, `isInternalHost` (×7), rebinding |
| Con los arreglos 1 y 2 (unas 9 líneas) | 70 | 8 | `isInternalHost` (×7), rebinding |

Te adjunto el fichero de pruebas (`outbound.review.test.ts`, 23 casos) y el parche de los puntos 1 y 2 por si te ahorran tiempo. Úsalos libremente.

Un abrazo,
César

---

## Notas internas (no van en el comentario)
- Adjuntos: `outbound.review.test.ts` y `propuesta-arreglos-pr1.patch`, en la carpeta de notas de la sesión. Revisar antes que no contengan rutas locales del equipo.
- La PR va contra `avatarsin` (`c4384e1`). El trabajo sigue en `Desktop\vex`, así que los arreglos tendrán que pasar también allí (`apps/api/src/guard.ts`). El paso 1 del plan maestro (conectores del manifiesto) depende de esta guardia corregida.
- Licencia (decisión 1): Apache-2.0. `avatarsin` no tiene `LICENSE`: conviene subirla (con aprobación de César) antes de aceptar la PR, para que el aporte entre bajo esa licencia.
- Antes de publicar: proteger `main` en GitHub (PR obligatoria, aprobación de César y CI en verde). Oscar tiene permiso `write`.
