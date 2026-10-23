# Vex como asistente operativo transversal · Informe de viabilidad técnica

Fecha: 2026-10-23. Alcance: diagnóstico sobre el monorepo Vex Studio (editor vectorial + avatar), del que este repositorio extrae el avatar y el operador; las referencias a `apps/web`, `packages/dsl` y `workers/export` apuntan a ese monorepo. Sin código. Objetivo evaluado: convertir el avatar Vex en un asistente que **ejecute acciones** en herramientas web, páginas y Windows, con personalización alta.

> Nota sobre "Fable": los assets del avatar (rig SVG 2D, modelo GLB 3D, paquete `@vex/avatar`) se han producido en estas sesiones de trabajo; el informe los trata como *nuestros* assets. Si "Fable" se refiere a una herramienta externa de motion (exportación Lottie), aplica la rama Lottie de la sección 2.

---

## 1 · Lo que hay montado (inspección local)

| Pieza | Estado real | Relevancia para el agente |
|---|---|---|
| `apps/web` (React 19, Vite 6, Fabric 7, Zustand) | Editor funcional: lienzo sobre el DSL, selección, deshacer/rehacer con **transacciones**, herramientas, zoom. | Ya existe el patrón "la IA propone → Aceptar/Descartar en un paso". Es exactamente el patrón que necesita un agente operativo. |
| `packages/dsl` (Zod 4) | Esquema del documento + compilador SVG + helpers inmutables, 42 tests. | Contrato tipado con la IA. Modelo a copiar para el *esquema de acciones* del agente. |
| `packages/vex` (`@vex/avatar`) | Rig SVG por capas, **datos puros** (`POSES`, `STATE_FACES`, `TIMING`, `LOD`, `PALETTE`), 8 estados, 5 expresiones, 9 visemas, LOD, `prefers-reduced-motion`. Solo depende de React. | Es casi un "runtime" ya. Le falta: núcleo sin React, bus de eventos, tema/skin en caliente. |
| `assets/vex-2d` (`vex-rig.svg/.json`) | Rig fuente agnóstico (15 pivotes, paleta de 9 colores). | Fuente de verdad del muñeco; sirve para cualquier runtime. |
| `assets/vex-3d` (`vex.glb`, `vex3d.js`) | GLB con 8 clips; modelo procedural Three.js 0.160 con materiales/texturas sustituibles. | Para momentos "hero" o escritorio; **no** para un overlay permanente (coste GPU). |
| `apps/web/src/hooks/useVexState.ts` | Deriva el estado del avatar del estado del asistente (greeting → idle → listening → thinking/working/creative → talking → success). | El único "cerebro" actual. Está acoplado al store del editor: habría que extraer el contrato. |
| Asistente (`useGenerationSimulation`, `mockProposal`) | **Simulado**: pasos con temporizador y un cambio fijo. No hay llamada a Claude ni *tool calling*. | El agente real no existe todavía. Es lo primero. |
| `workers/export` | Node 24 + VectorCraft CLI (0.14.0) + PdfCraft; regresión visual. | Demuestra el patrón "orquestar binarios firmados desde Node", que es el que vale en este equipo. |
| `apps/api` | **No existe** (está en CLAUDE.md como convención). | Imprescindible: la clave de Anthropic no puede vivir en el navegador. |

**Restricción dominante del entorno (hallazgo crítico).** La directiva de Control de aplicaciones de Windows de este equipo bloquea binarios nativos sin firmar: addons `.node`, `.exe` de npm, DLL de Python. Para un agente que controle Windows esto descarta, *en esta máquina*: `robotjs`/`nut.js` (addons nativos), cualquier `.exe` compilado localmente (Tauri, Rust, Go), `pyautogui`/`pywinauto`, y probablemente el `electron.exe` de desarrollo (por verificar si viene firmado). Lo que **sí** corre: Node 24 (firmado), PowerShell 5.1, los ensamblados .NET incluidos en Windows (`UIAutomationClient`, `System.Windows.Forms`), WebView2 (incluido en Windows 11), instaladores MSI firmados (VectorCraft, PdfCraft). No hay toolchain de Rust.

Conclusión de la inspección: el proyecto tiene las **primitivas correctas** (documento tipado, transacciones, avatar data-driven) pero el agente es una maqueta y no hay capa servidor. El control de Windows choca con la política de firmas antes que con la técnica.

---

## 2 · Stack visual: pipeline y personalización

### 2.1 Comparativa de técnicas de render para un avatar "siempre visible"

| Técnica | Coste en reposo | Dinámica (visemas, mirada, estados) | Personalización en caliente | Veredicto |
|---|---|---|---|---|
| **SVG + CSS/SMIL** (lo actual) | Muy bajo: transformaciones en el compositor, sin bucle `requestAnimationFrame`; pausable con `animate=false`. | Total: cada pieza es un nodo con id y pivote. | Excelente: paleta por variables CSS, piezas intercambiables por id. | **Canónico.** |
| Lottie (bodymovin) | Medio: `lottie-web` repinta por fotograma (SVG o canvas) aunque no pase nada. | Pobre: los clips van horneados; mezclar visemas/estados exige muchos clips o `lottie-web` + marcadores. | Limitada (solo lo que se dejó como propiedad editable). | Solo para clips cerrados (p. ej. saludo) si vienen de una herramienta externa. |
| Canvas 2D | Bajo-medio: hay que escribir el bucle y pararlo. | Total, pero todo a mano. | Buena. | Sin ventaja sobre SVG a este tamaño. |
| WebGL / Three.js (GLB) | Alto: contexto GPU, bucle continuo, ventanas transparentes caras para el DWM de Windows. | Total (8 clips + mezcla). | Buena (materiales/texturas ya parametrizados en `vex3d.js`). | Momentos puntuales y vista 3D; **no** como overlay permanente. |
| Rive | Bajo (runtime wasm, máquina de estados nativa). | Muy buena: diseñado para esto. | Buena (inputs). | Alternativa seria si se rehiciera el rig; hoy no compensa rehacer. |

**Pipeline recomendado.** Mantener el rig SVG como fuente de verdad y convertir `@vex/avatar` en un **"Vex Runtime"** de tres capas:

1. **Núcleo sin framework** (TypeScript puro): máquina de estados + temporizadores (`TIMING`) + cola de visemas + mezcla de expresión. Entrada: eventos `{ state, expression?, viseme?, say?, gaze?, dock? }`. Salida: un "frame" declarativo (ángulos por articulación, cara, boca). Sin DOM.
2. **Adaptadores de render**: React (el actual), *web component* `<vex-avatar>` (para extensiones, páginas ajenas y el host de escritorio) y, opcional, Three.js (mismo contrato → `setPose/setMouth` de `vex3d.js`).
3. **Comportamiento**: lo que hoy es `useVexState` pasa a ser un "director" que traduce eventos del **agente** (planificando, ejecutando paso 3 de 7, esperando confirmación, error) a estados del runtime. Cada host escribe su director, no su avatar.

**Presupuesto de rendimiento** (para no disparar CPU/GPU): un único bucle de animación por host; pausar SMIL/CSS con `document.hidden` y cuando el avatar no está en pantalla (`IntersectionObserver`); LOD `head` cuando esté acoplado a 48 px; sin filtros SVG (`blur`, sombras); `contain: strict` y `will-change: transform` solo en las articulaciones; objetivo medible: < 2 % de CPU en reposo y 0 fotogramas repintados cuando no cambia nada. En escritorio: una sola ventana WebView2 transparente *always-on-top*, nada de WebGL en el overlay.

### 2.2 Personalización modular en tiempo real

Cuatro niveles, todos como **datos validados con Zod** (mismo principio que el DSL del documento):

| Nivel | Qué cambia | Mecanismo | Coste |
|---|---|---|---|
| Tema | Los 9 colores de `PALETTE` (casco, visor, llama, acento…), brillo, fondo. | Variables CSS en el nodo raíz; cambio instantáneo sin re-render. | Trivial (ya casi está). |
| Skin / piezas | Antenas, aletas, visor, "ropa", pegatinas. | Sistema de *slots*: cada parte del rig es un `<symbol>` referenciado por id; una skin es un mapa `slot → fragmento SVG`. | Medio: hay que convertir el rig actual a slots. |
| Personalidad | Tiempos (`TIMING`), frecuencia de bucles, expresión por defecto, gestos preferidos, voz (TTS) y tono de los textos. | Un `VexPersonality` JSON que lee el director. | Bajo. |
| 3D | Materiales y texturas (`shellTextures` → `map/roughnessMap`). | Mismo tema aplicado a materiales. | Bajo si solo es color; medio con texturas. |

Regla: **el agente nunca toca el SVG**; publica eventos. El tema/skin/personalidad se cargan por usuario y por herramienta anfitriona, y cambian en caliente porque son estado, no código. Lottie rompería este modelo (todo horneado), por eso no es la fuente de verdad.

---

## 3 · Viabilidad del control transversal (Web + Windows + Apps)

### 3.1 Respuesta honesta

**Sí es viable unificar la *interfaz* de control; no es viable (ni deseable) unificar el *mecanismo*.** Hay cuatro actuadores distintos y ningún truco los iguala:

| Actuador | Fidelidad | Latencia por acción | Permisos | Dónde falla |
|---|---|---|---|---|
| **API / MCP** (SaaS con API: GoHighLevel, Monday, Canva, Shopify, VectorCraft…) | Máxima: operaciones semánticas, idempotentes. | 100–800 ms | OAuth/token, claros. | Solo cubre lo que la API expone. |
| **DOM** (extensión o WebView controlado) | Alta: selectores por árbol de accesibilidad, lectura de estado real. | 10–50 ms | Por sitio (allowlist). | Canvas/WebGL, iframes de otro origen, anti-bot. |
| **UI Automation de Windows** (árbol de accesibilidad) | Media: buena en Win32/WPF/WinUI/Office; floja en Electron sin a11y, juegos, apps dibujadas a mano. | 50–300 ms | Nivel de usuario; nada si la app corre elevada. | Apps sin a11y, diálogos UAC, pantalla de bloqueo. |
| **Visión** (captura + coordenadas, estilo *Computer Use*) | Universal pero frágil. | 2–6 s (ida y vuelta al modelo) + tokens de imagen. | Pantalla completa = todo. | Precisión, coste, velocidad; inútil para flujos largos. |

La arquitectura que evita la "pesadilla" es: **un planificador** (Claude con *tool use*), **un esquema de acciones** único (Zod: `driver`, `action`, `target`, `params`, `risk`), **varios drivers** y un **enrutador** que elige siempre el de mayor fidelidad disponible: API/MCP > DOM > UIA > visión. La visión es la red de seguridad, nunca la vía principal.

**Permisos sin pesadilla** = modelo de capacidades: por defecto el agente no puede nada; el usuario concede ámbitos ("este sitio", "esta app", "leer pero no escribir"); las acciones con `risk: irreversible` (enviar, pagar, borrar, cerrar sesión) piden confirmación en la burbuja de Vex; registro de auditoría de cada acción; botón/atajo global de **parada de emergencia**. El avatar aporta aquí valor real: sus estados (`working`, `listening`, una expresión de "espero tu OK") son la interfaz de confianza.

**Latencia sin pesadilla** = el modelo planifica *lotes* (varios pasos deterministas por llamada), los drivers los ejecutan en local sin volver al modelo salvo error, y el avatar cubre honestamente la espera (estado `thinking`/`working` con progreso "paso 3 de 7"). Con un paso-por-llamada cada acción cuesta 2–4 s y la experiencia muere.

**Seguridad que no se puede esquivar:** todo lo que el agente *lee* (páginas, ventanas, correos) es dato, no instrucción. La inyección de prompts desde contenido es el riesgo número uno de cualquier agente web y debe tener suite de pruebas propia desde el primer prototipo.

### 3.2 Rutas arquitectónicas comparadas

| Ruta | Cubre | A favor | En contra | En este equipo |
|---|---|---|---|---|
| **A · Extensión de navegador (MV3)** | Web. Con *native messaging* puede hablar con un proceso local. | Distribución sencilla; DOM y árbol a11y a mano; el avatar se inyecta en *shadow DOM* o vive en el *side panel*; sin firma de binarios. | No sale del navegador; ciclo de vida del *service worker*; políticas de la tienda. | **Viable hoy, sin fricción.** El host de native messaging puede ser un `.bat` que lanza Node. |
| **B · Contenedor de escritorio** (Electron / Tauri v2) | Web + Windows + overlay del avatar. | Mejor UX unificada: ventana transparente *always-on-top*, navegador embebido controlable (CDP/Playwright), sidecar para UIA. | Empaquetado y **firma**; Electron ~150 MB; Tauri exige Rust. | **Tauri: no** (sin Rust, y el `.exe` resultante estaría sin firmar). Electron: dev build por verificar; distribución exige certificado. |
| **C · Computer Use / Claude in Chrome** | Todo lo visible. | Universal; cero integración por app; ya existe (API de Anthropic, extensión Claude in Chrome). | Lento, caro en tokens, impreciso; sigue necesitando un ejecutor local (capturas + clics), que vuelve al problema de la firma. | **Como driver de último recurso**, no como núcleo. |
| **D · MCP como bus** (no excluyente) | Apps con servidor MCP (VectorCraft ya trae 32 tools; PdfCraft; conectores SaaS). | Operaciones semánticas, tipadas, auditables; es la ruta más barata y fiable para "apps". | Solo apps que lo expongan. | **Viable hoy.** |

**Decisión recomendada:** híbrido **A + D primero, B después**. El agente y el runtime del avatar se construyen una vez (TypeScript, sin binarios) y se montan en tres hosts: Vex Studio, la extensión, y más tarde el host de escritorio. Windows queda detrás de una **puerta explícita de firma**: o certificado de firma de código (EV, ~300–500 €/año) o excepción en la directiva para el ejecutable del host. Sin esa decisión, el control de Windows solo puede hacerse con **PowerShell + .NET UIAutomation lanzados desde Node** (todo firmado por Microsoft), que es suficiente para un prototipo pero no para un producto.

---

## 4 · MVP y hoja de ruta

### 4.1 Entorno frontera para el primer prototipo (Fase 1 del agente)

**El navegador, en dos pasos: primero dentro de Vex Studio, después en 2–3 webs permitidas mediante extensión.**

Por qué ahí y no en Windows: (1) no hay fricción de permisos ni de firmas; (2) el editor ya tiene las piezas caras: documento tipado, transacciones Aceptar/Descartar, deshacer, avatar con estados; (3) se validan las partes difíciles del problema general (bucle del agente, esquema de acciones, enrutador, UX de confirmación, cobertura de latencia, resistencia a inyección) con observabilidad total; (4) todo lo construido se reutiliza tal cual en los hosts siguientes. Validar primero en Windows sería validar la fontanería de permisos antes que el producto.

### 4.2 Hitos técnicos (cada uno con puerta de salida)

**Hito 0 · Contratos (sin UI).**
- Esquema Zod de **acciones** (`driver`, `action`, `target`, `params`, `risk`, `undo?`) y de **resultados**.
- Contrato de **eventos del avatar** (`state`, `expression`, `viseme`, `say`, `progress`) y esquema de **tema / skin / personalidad**.
- **Política de permisos** (ámbitos, niveles de riesgo, confirmaciones) y formato del registro de auditoría.
- Puerta: los esquemas tienen tests y `docs/` explica cada campo; nada se programa hasta que esto esté firmado.

**Hito 1 · Agente real dentro de Vex Studio.**
- `apps/api` (Node + Fastify) con el SDK de Anthropic, *tool use* y *prompt caching*; la clave nunca en el navegador.
- Herramientas del módulo 3 de CLAUDE.md: `get_canvas`, `apply_ops` (JSON Patch sobre el DSL, validado), `render_preview`, `lint_design`; cada propuesta entra en la **transacción** ya existente.
- `useVexState` deja de leer temporizadores simulados y pasa a leer eventos del agente.
- Puerta: 10 encargos del banco de evaluación resueltos de extremo a extremo; p50 < 4 s por paso; cero operaciones inválidas aplicadas; el avatar refleja estados reales.

**Hito 2 · Vex Runtime desacoplado.**
- Núcleo sin React + adaptadores React y *web component*; bus de eventos; tema/skin/personalidad en caliente; rig a *slots*.
- Presupuesto de rendimiento medido (CPU en reposo, repintados, pausa en segundo plano).
- Puerta: el mismo avatar corre en una página HTML plana y en Studio con comportamiento idéntico; cambio de tema en vivo; < 2 % CPU en reposo.

**Hito 3 · Driver web (extensión MV3) y driver MCP.**
- Extensión con *side panel* (avatar + burbuja), *content script* con driver DOM basado en el árbol de accesibilidad (observar → actuar → verificar), allowlist de sitios, confirmación de acciones irreversibles, registro.
- Cliente MCP en `apps/api` para las apps que lo expongan (empezando por VectorCraft, que ya está).
- Enrutador de drivers (MCP > DOM) y planificación por lotes.
- Puerta: 3 flujos reales en sitios permitidos (p. ej. publicar un post en una herramienta de marketing, rellenar un formulario, exportar un fichero) completados con confirmación; suite de inyección (páginas con texto que "ordena" al agente) superada; parada de emergencia funcional.

**Hito 4 · Windows (tras la puerta de firma).**
- Decisión: certificado de firma o excepción de directiva. Mientras tanto, prototipo con **sidecar PowerShell/.NET UIAutomation** lanzado desde Node (sin addons nativos) y captura de pantalla como driver de visión de respaldo.
- Host de escritorio (Electron o WebView2) con ventana transparente *always-on-top* para el avatar y el mismo *side panel*.
- Puerta: abrir una app, rellenar un formulario y leer el resultado vía UIA; el driver de visión solo se activa cuando UIA no ve el control; atajo global de parada probado.

**Hito 5 · Unificación y producto.**
- Un solo panel de permisos para los cuatro drivers; personalización persistida por usuario y por herramienta; telemetría de éxito/fallo por driver.
- Puerta: el mismo encargo ("prepara este post y publícalo") atraviesa Studio → web → Windows sin que el usuario cambie de interfaz.

### 4.3 Lo que no haría
- Lottie o vídeo como fuente de verdad del avatar (mata la personalización y la sincronía con el agente).
- Tauri en este equipo (sin Rust, sin firma).
- Visión como driver principal (lento, caro, impreciso).
- Control de Windows antes de resolver la firma: se acabaría construyendo sobre excepciones manuales que no sobreviven a un segundo equipo.
- Un agente que ejecute un paso por llamada al modelo: la latencia acumulada hace inservible la experiencia.

### 4.4 Riesgos principales

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| Inyección de prompts desde páginas/ventanas | Alta | Contenido observado = dato; suite de pruebas desde el Hito 3; confirmación para todo lo irreversible. |
| Firma de binarios bloquea el host de escritorio | Alta en este equipo | Puerta explícita en Hito 4; prototipo con componentes firmados por Microsoft. |
| Coste por tokens (visión, contexto de páginas) | Media | Árbol de accesibilidad en vez de capturas; *prompt caching*; lotes. |
| Apps sin accesibilidad (Electron, canvas) | Media | Driver de visión como respaldo; priorizar API/MCP. |
| Rehacer el avatar al cambiar de técnica | Baja si se mantiene el rig SVG | Núcleo data-driven; Three.js y web component como adaptadores. |

---

## 5 · Resumen ejecutivo

1. El repositorio tiene las primitivas adecuadas (documento tipado, transacciones, avatar data-driven) y le falta lo esencial del agente: una capa servidor con *tool calling* real. El asistente actual es simulado.
2. El avatar debe seguir siendo un rig SVG data-driven, convertido en un runtime de tres capas (núcleo sin framework, adaptadores, director). Es la opción más barata en CPU y la única que permite personalización en caliente.
3. Unificar el control es viable a nivel de **interfaz** (un esquema de acciones, un planificador, un enrutador), no de mecanismo. Cuatro drivers con fidelidad decreciente: API/MCP, DOM, UI Automation, visión.
4. La frontera del primer prototipo es el **navegador**: primero Vex Studio, luego extensión sobre sitios permitidos. Windows se pospone a una puerta de firma de código, porque en este equipo la política de Control de aplicaciones bloquea cualquier binario sin firmar.
5. Cinco hitos con puerta; nada de código hasta cerrar los contratos del Hito 0.
