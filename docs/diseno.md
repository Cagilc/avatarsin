# Estudio de avatares Vex · diseño

Herramienta **privada** para crear avatares animados a partir de un logo o una imagen: piezas, esqueleto, animaciones, física, materiales, personalidad y capacidades. Lo que sale del estudio es un **paquete firmado** que cualquier web o SaaS incrusta con `<vex-avatar>`, y que el operador de Vex puede usar con todo lo que sabe hacer.

Estado: fase 1 hecha y probada en local. Sin remoto en GitHub hasta terminar de probarla.

## Principios

1. **Un documento, todo derivado.** El avatar es un documento JSON (`vex-avatar`, `packages/format`). La vista previa, el paquete publicado y el avatar incrustado salen de él.
2. **Solo datos.** El documento no admite scripts, expresiones ni URL. Todos los objetos son estrictos: una clave desconocida se rechaza.
3. **Todo cambio es una operación tipada.** El editor y el asistente usan las mismas 17 operaciones (`ops.ts`), con la misma validación. Se aplican todas o ninguna.
4. **Ajustable sin perder el control.** Cada valor guarda quién lo puso (`provenance`): la persona (fijado), la IA (con su confianza) o nadie (automático). El asistente no toca lo fijado; «×» lo devuelve al asistente.
5. **Un control de estilo**, de dibujo plano a realista, mueve a la vez los valores por defecto de la física y de los materiales (`resolve.ts`). Lo que la persona fija se respeta.

## Capas del documento

| Capa | Qué guarda |
|---|---|
| Fuentes | Archivos subidos (saneados, por su huella SHA-256) y dónde se colocan en el lienzo |
| Piezas | Qué parte de la fuente dibuja cada una (nodos SVG o recorte), caja, pivote, padre, orden, papel (cuerpo, cabeza, antena…) |
| Física | Por pieza: muelle con rigidez, amortiguación, peso, caída por gravedad y giro máximo (0–1) |
| Materiales | Por pieza: acabado (plano, mate, satinado, brillante, metálico), textura, sombra, contorno y tinte |
| Mundo y estilo | Gravedad (fuerza y dirección), realismo, estirar y encoger |
| Animaciones y estados | Clips con pistas de claves por pieza; 10 estados (reposo, hablando, pensando, contento, saludando, atento, error, dormido, señalando, celebrando). Al señalar, el runtime gira el brazo hacia la dirección que le da el host (`aim`) |
| Personalidad | Nombre, tono, formalidad, extensión, emojis, saludo, contexto. Cambia cómo habla, nunca lo que hace |
| Capacidades | Herramientas y riesgo máximo como operador. Solo el propietario las cambia |

## Piezas del sistema

| Paquete | Qué hace |
|---|---|
| `packages/format` | Esquema, operaciones, valores por estilo, animaciones de partida, política SVG compartida, firma Ed25519 y verificación (WebCrypto, igual en Node y navegador) |
| `packages/runtime` | Dibuja y anima: esqueleto por matrices, muelles deterministas a paso fijo, materiales como filtros SVG, reproductor y `<vex-avatar>`. Se compila en un solo script (`dist/vex-avatar.js`) |
| `apps/server` | Servidor privado (Fastify): cuentas, historial, subida saneada, asistente, publicación firmada, claves de integración |
| `apps/studio` | Editor (React): importar, esqueleto y pivotes, física, materiales, estilo, animaciones, personalidad, capacidades, asistente, historial, publicar |
| `e2e` | Pruebas en Edge real, con una página de otro dominio que incrusta el avatar |

## El asistente: resolutivo, pregunta solo lo que falta

1. Con el logo y una frase prepara un **borrador completo**: esqueleto deducido de la forma (las piezas pequeñas cuelgan de las grandes que tocan), papeles, pivotes (base de antenas y orejas, hombro de los brazos), física en lo que sobresale, estilo, material, personalidad y animaciones para los 8 estados.
2. Pregunta **como mucho tres cosas**, y solo si cambian el resultado de forma visible, no se deducen y el valor por defecto probablemente fallaría: el acabado (si la petición no lo dice), cómo se mueven las piezas que cuelgan y el material (solo cuando hay volumen). Cada opción trae sus operaciones, y el editor la previsualiza al pasar el ratón. La recomendada ya está aplicada en el borrador.
3. **Nada se guarda hasta aceptar.** La propuesta caduca si el avatar cambia entretanto.

Dos implementaciones con el mismo contrato (`assistant/types.ts`):

- **Geométrica** (sin clave): reglas sobre las cajas de las piezas y palabras de la petición.
- **Claude** (con `ANTHROPIC_API_KEY`): responde por una herramienta forzada con operaciones tipadas. Si su salida no valida, o intenta tocar capacidades o lo fijado, el servidor usa la geométrica y lo dice.

## Seguridad

| Amenaza | Defensa |
|---|---|
| Que entre cualquiera | Sin registro: cuentas creadas con `pnpm user:add`. Contraseñas con scrypt, intentos limitados y respuesta idéntica si la cuenta no existe. Tokens HMAC con caducidad |
| Llamadas desde otra web con la sesión | La API solo acepta navegadores de `STUDIO_ORIGIN`; las peticiones que cambian algo desde otro origen reciben 403 |
| Archivos maliciosos | Se identifican por su contenido, no por su nombre. SVG reconstruido con lista blanca: fuera scripts, `foreignObject`, eventos, animaciones, referencias externas y CSS peligroso; entidades XML rechazadas; límites de tamaño, elementos y anidamiento. PNG y JPEG se decodifican y se vuelven a codificar (se pierde lo escondido y los metadatos); el tamaño declarado se comprueba antes de decodificar |
| Que el documento ejecute algo | Solo datos validados por esquema; el runtime vuelve a aplicar la política SVG antes de dibujar |
| Que alguien altere un avatar publicado | Paquete firmado con Ed25519 por el servidor; `<vex-avatar>` comprueba la firma y la huella de cada archivo antes de dibujar. Un cambio de un byte lo detiene |
| Que otro sitio use tu avatar | Cada integración es una clave ligada a orígenes exactos (https; http solo en localhost), revocable al momento y con límite de peticiones. Solo sirve los archivos del paquete publicado |
| Que la IA amplíe lo que puede hacer el avatar | El asistente no puede ejecutar `setCapabilities` ni `release`, ni tocar lo fijado. Una integración solo **estrecha** capacidades: `/v1/embed/<clave>/grant` devuelve, firmada, la intersección de herramientas y el riesgo menor |
| Que un editor publique o cambie permisos | Publicar, integraciones, capacidades y auditoría: solo el propietario |
| Archivos abiertos directamente | Se sirven con `Content-Security-Policy: sandbox` y `nosniff` |
| Perder trabajo | Historial completo de versiones con quién (persona o asistente); volver atrás crea una versión nueva; ediciones simultáneas detectadas (409) |

Límite conocido: la clave de integración impide que **otra web** muestre el avatar (el navegador envía el origen), pero un programa que no sea un navegador puede descargar el paquete. Es lo esperable: lo que se muestra en una web es público; lo protegido es que nadie pueda **alterarlo** ni **ampliar** sus capacidades.

## Cómo se usa (local)

```bash
pnpm install
pnpm build          # compila el script <vex-avatar> que sirve el servidor
pnpm dev:server     # http://127.0.0.1:8788
pnpm dev:studio     # http://localhost:5180 (entrada de desarrollo sin contraseña, solo en este equipo)
```

Cuenta real: `pnpm user:add correo@dominio.com "Nombre" owner` (la contraseña sale una vez por pantalla, o se toma de `STUDIO_NEW_PASSWORD`).

Incrustar: «Publicar» → crear integración con el dominio del sitio → copiar el código:

```html
<script type="module" src="https://estudio.tudominio.com/v1/vex-avatar.js"></script>
<vex-avatar endpoint="https://estudio.tudominio.com/v1/embed/vk_…" public-key="…" key-id="…" state="idle"></vex-avatar>
```

El sitio cambia el atributo `state` para que hable, piense o salude, y `aim` (grados en pantalla) para que señale hacia algo; el elemento expone `avatar` (personalidad y capacidades verificadas) y emite `vex-ready` o `vex-error`.

## Verificado (2026-10-25)

- `pnpm typecheck` y `pnpm test`: format 17, runtime 9, server 32.
- `pnpm e2e` en Edge: 4 recorridos (logo → propuesta → preguntas → aceptar con física en vivo; pivote fijado que el asistente respeta; control de estilo; publicar, incrustar en otro dominio, bloquear otro sitio, rechazar paquete y dibujo alterados, revocar).
- Sin probar: el asistente con Claude (no hay clave en este equipo; probado con un cliente simulado).

## Siguientes fases

1. **Imágenes en piezas**: separar un PNG en piezas con PhotoCraft (`select.subject`, `layer.removeBackground`) y vectorizar con VectorCraft (`imageTrace`), en el servidor y aislado.
2. **Malla y deformación**: compilar `puppet` (mesh + ARAP) de EffectCraft a WebAssembly en CI y añadir una capa de malla con pines.
3. **Editor de animación**: línea de tiempo con claves por pieza.
4. **Visemas y caras**: hecho sin cambiar el formato. Vex entra en el estudio («Probar con Vex, el operador») con cada variante de ojos y de boca como pieza y los clips encendiéndolas con pistas de opacidad a saltos; `talk` turna los nueve visemas (`packages/format/src/samples/vex.ts`). Queda para más adelante un editor de caras para avatares nuevos.
5. **Asistente con visión**: enviar una imagen del avatar a Claude para que razone sobre lo que ve.
6. **Puente con el operador**: hecho en el paso 1 del plan maestro. Vex Core lee el *grant* firmado (`apps/api/src/grant.ts`), lo verifica con la clave pública que fija el manifiesto del host y limita las herramientas por integración. El *grant* lleva `expiresAt` (10 minutos) para que una revocación llegue rápido al operador.
7. **Despliegue**: Docker, `STUDIO_SIGNING_KEY` en un gestor de secretos, copias de seguridad del SQLite.

Obligaciones al reutilizar ArtCraft (Apache-2.0): conservar LICENSE y NOTICE, marcar los archivos modificados y no usar la marca ArtCraft.
