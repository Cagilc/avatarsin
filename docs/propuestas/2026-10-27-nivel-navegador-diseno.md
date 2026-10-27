# Propuesta · nivel navegador · diseño para planificar

Estado: **propuesta de diseño para César**, solo documento y sin código. Nada está decidido. Desarrolla el «nivel 2 · Pantalla» de `2026-10-26-niveles-y-demos.md` y lo que el plan maestro llama driver DOM (paso 6). Es genérica; no nombra ninguna plataforma.

## La idea

Hoy Vex vive **dentro de la página del host** y solo ve lo que esa página registra. La idea es que pueda, además, **actuar en el navegador de una persona sobre la sesión que ya tiene iniciada**, como hace un asistente de navegador: leer la pestaña activa, buscar algo en una web, rellenar un formulario, copiar datos hacia otra herramienta. Para empezar, solo Chrome, en el equipo de la persona.

Ejemplos genéricos: buscar una empresa o un contacto en un directorio profesional y traer sus datos a una herramienta; rellenar una solicitud con datos ya guardados; repetir una tarea que la persona hace a menudo.

## Tres formas, de menos a más alcance

| | Qué es | Sesión de la persona | Alcance | Coste de construcción |
|---|---|---|---|---|
| **A · Driver DOM del host** | `<vex-assistant>` pulsa y rellena elementos que la **propia página** registró con `data-vex-id` | La de esa página | Una web | Bajo; ya es el paso 6 |
| **B · Extensión de Chrome** | Extensión que lee y actúa sobre pestañas de sitios permitidos, comunicada con Vex Core | La del perfil de Chrome de la persona | Cualquier sitio permitido | Medio |
| **C · Chrome controlado por el programa** | Un Chrome con perfil propio que Vex abre y dirige | Solo la que se inicie en ese perfil | Cualquier sitio | Medio; más simple y más seguro, menos cómodo |

Recomendamos **A → B**, y dejar C como opción para tareas sin sesión. Un navegador incrustado en una aplicación de escritorio no hereda las cookies de nadie, así que no resuelve lo que se busca.

**A verificar antes de planificar B y C** (no lo hemos comprobado): qué permite hoy Chrome con el puerto de depuración remota sobre el perfil por defecto (nuestra sospecha es que está restringido), cómo comunicar una extensión de Manifest V3 con un proceso local (mensajería nativa o websocket a `127.0.0.1`) y qué exige la Chrome Web Store.

## Principios (heredados de `CLAUDE.md`)

1. **Cada acción declara `risk`** y pasa por política, confirmación con vista previa real y auditoría, igual que una herramienta. Lo irreversible (enviar, publicar, pagar, borrar) siempre pide confirmación.
2. **Actúa con la persona, nunca como cuenta de servicio**: el navegador ya es de ella.
3. **Lo que la página devuelve son datos, no instrucciones.** Es el riesgo principal (ver más abajo).
4. **Todo apagado por defecto** y solo se estrecha con la regla de los tres permisos (aprobado ∩ política ∩ *grant*).
5. **La extensión no guarda claves ni decide.** Ejecuta lo que Vex Core le ordena y lo que la política permite; el modelo y los secretos viven en Vex Core.

## Modelo de amenazas (borrador)

| Amenaza | Defensa propuesta |
|---|---|
| Una página con texto escondido que «ordena» algo al modelo (inyección) | El contenido de la página entra como dato delimitado; el banco de inyección **primero** (paso 4), con casos de páginas hostiles; ninguna acción de riesgo sin confirmación de la persona |
| Que Vex actúe en un sitio que no debía | Lista de sitios permitidos, vacía por defecto, por exactitud de origen; fuera de la lista la extensión no lee ni escribe |
| Exfiltrar datos de una pestaña a otra | Vex solo mueve datos entre sitios si la receta lo declara; cada traspaso queda en la auditoría; los campos privados (contraseñas, tarjetas, `data-vex-private`) nunca se leen |
| Una extensión comprometida o suplantada | Mensajes firmados de Vex Core con caducidad y un solo uso; la extensión solo habla con el origen configurado; permisos mínimos del manifiesto de la extensión |
| Cuenta bloqueada o sancionada por el sitio | Límites de ritmo por sitio, sin ejecución masiva, y una nota clara en la documentación: muchas plataformas prohíben la automatización en sus términos. Es decisión y responsabilidad de quien instala |
| Pérdida de control | Botón de parada que corta la acción en curso, límite de gasto y de pasos por tarea, y un modo «solo observar» |

## Recetas guardadas (acciones preconfiguradas)

Una **receta** es una secuencia repetible, con parámetros, que se ejecuta **sin modelo** (como un guion o un botón). Es la forma de «guardar, copiar y tener acciones preconfiguradas».

- Formato en el manifiesto o en un almacén propio: `id`, `title`, `site` (origen permitido), `params` (esquema Zod), `steps`.
- Pasos tipados: `open`, `read` (selector → variable), `fill`, `click`, `wait`, `assert` (comprobar el efecto, como P3), `ask` (pedir un dato a la persona). Cada paso lleva su `risk`; el de la receta es el máximo de sus pasos.
- **Seleccionar elementos:** primero los registrados (`data-vex-id`); en sitios que no son del host, selectores guardados con una huella del elemento para detectar que la página cambió y **parar en vez de adivinar**.
- **Grabar:** la persona hace la tarea una vez con el grabador; Vex propone la receta como **borrador sin revisar** (como un conector importado), con parámetros sugeridos. Una persona la revisa, ajusta riesgos y la activa. Nada se activa solo.
- **Copiar y compartir:** exportar e importar recetas como datos firmados; una importada llega sin revisar.
- **«Entrenar»** significa grabar, parametrizar y revisar; no entrenar un modelo.

## Fases y criterio de «hecho»

| Fase | Qué | Hecho cuando |
|---|---|---|
| **N0** | Este diseño más los casos de inyección en el banco (páginas hostiles de muestra, sin plataformas reales) | Banco medido con Claude y mínimos fijados (depende del paso 4) |
| **N1** | Driver DOM del host (A): pulsar y rellenar elementos registrados | e2e que rellena un formulario del host con confirmación; los casos hostiles no hacen acciones de riesgo sin confirmar |
| **N2** | Extensión de Chrome de **solo lectura** (B) sobre sitios permitidos de muestra | Lee la pestaña activa y devuelve texto estructurado a Vex Core; fuera de la lista no lee; mensajes firmados verificados; parada |
| **N3** | Escritura con confirmación: rellenar y pulsar | Cualquier envío pide tarjeta con lo que va a pasar; auditoría con el sitio y los campos |
| **N4** | Recetas: ejecutar, grabar, revisar, exportar | Una receta grabada se repite sin modelo en una página de muestra; si la página cambia, para y lo dice |

## Cómo lo probamos nosotros

Fuera del repositorio, sobre **páginas de muestra** propias (formularios, listados y una página hostil con instrucciones escondidas) y, más adelante, sobre nuestras propias herramientas de pruebas. No automatizaremos redes sociales ni directorios de terceros como parte de estas pruebas. A César le devolvemos cifras agregadas y huecos, no datos nuestros.

## Preguntas para César

1. ¿Te parece bien A → B, dejando C para después?
2. ¿Dónde vive la extensión: en un paquete nuevo (`packages/extension`) o fuera del repositorio hasta que haya cifras?
3. ¿Mensajería nativa o websocket local para hablar con Vex Core?
4. ¿Las recetas pertenecen al manifiesto del host o a un almacén por persona? Nuestra inclinación: ambas, con las del host como propuestas sin revisar.
5. ¿Qué mínimo del banco de inyección exigirías antes de N3?

## Qué no está verificado
- Las restricciones actuales de Chrome sobre depuración remota y los requisitos de la tienda de extensiones.
- Cuánto cuesta en tokens una tarea de navegador con Claude; no hay cifras.
- Que ningún sitio concreto permita este uso: depende de sus términos.
