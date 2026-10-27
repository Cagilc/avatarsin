# Vex en una web en 30 minutos

Para quien no ha visto el repositorio: al final hay una web «del cliente» con Vex dentro, un tour de bienvenida, botones, una herramienta conectada y una demo guiada con reinicio firmado. Todo con la plataforma simulada que trae Vex Core; sin clave de Anthropic funciona en modo guion (planificador por palabras clave), con clave habla.

Lo que vas a montar ya existe como muestra: el preset `presets/demo-guiada/manifest.json` y la web `apps/sample-tools/src/host-demo.ts`. Cada paso dice qué fichero mirar para copiar.

## 0 · Requisitos (2 min)

Node 24 y pnpm 10. En la raíz del repositorio:

```bash
pnpm install
```

```bash
pnpm build
```

(`build` compila `<vex-avatar>` y `<vex-assistant>`, el script que la web del cliente carga.)

## 1 · Arrancar Vex Core con un manifiesto (5 min)

Vex Core lee **un manifiesto** que describe la plataforma: nombre, qué contexto de pantalla manda la página, botones, tours, guiones y el gancho de reinicio. Arranca con el de la demo y un secreto compartido para el reinicio:

```bash
cd apps/api && VEX_HOST_MANIFEST=demo-guiada DEMO_RESET_SECRET=cambia-este-secreto-en-los-dos-lados CORS_ORIGIN=http://127.0.0.1:8793 node src/server.ts
```

Comprueba `http://127.0.0.1:8787/operator/info`: `host.name` dice «Demo Negocio» y `host.features` tiene `tours`, `announcements`, `quickActions` y `presenter` encendidos. En local el login de demo está activo (`demo-user` en la etiqueta); en un servidor público no existe y el host entrega su propio token (paso 3).

## 2 · La web del cliente: dos líneas (5 min)

Arranca la web de muestra en otra terminal (la misma clave que arriba):

```bash
DEMO_RESET_SECRET=cambia-este-secreto-en-los-dos-lados pnpm dev:host-demo
```

Abre `http://127.0.0.1:8793/`. Lo que esa página añadió a una web normal son dos líneas (`host-demo.ts`):

```html
<script type="module" src="http://127.0.0.1:8787/assistant.js"></script>
<vex-assistant api="http://127.0.0.1:8787" demo-user="u-cesar" presenter></vex-assistant>
```

El tour `primera-vez` arranca solo la primera vez (`when: "first"`), el anuncio de bienvenida aparece en la bandeja y los tres botones rápidos debajo del chat. Pide «Busca a Laura Pérez».

## 3 · El token y el contexto de pantalla (5 min)

En producción el token **nunca va en el DOM**: el host lo entrega con una función, y con `identity` en el manifiesto puede ser el JWT que ya emite para su sesión.

```js
const el = document.getElementById('vex');
el.getToken = async () => tokenDeMiSesion();     // sustituye a demo-user
el.context = { pantalla: 'contacto', contactoId: 'c-002', contactoEmail: 'marco.rossi@ejemplo.it' };
```

`context` viaja con cada mensaje y el manifiesto lo describe para el modelo (`screenContext`): «mándale un correo» sabe a quién sin preguntar. Cambia `el.context` cuando el usuario cambie de pantalla.

## 4 · Registrar elementos: lo que Vex puede señalar (3 min)

Vex solo conoce los elementos que la página **registra** con `data-vex-id`; nunca lee un campo marcado `data-vex-private` ni contraseñas.

```html
<h1 data-vex-id="titulo">Demo Negocio</h1>
<section data-vex-id="expedientes">…</section>
<input type="password" data-vex-private>
```

Los tours y los guiones señalan esos ids; si un elemento no está en la página, el paso se salta solo. Cuando Vex abre un expediente, la página recibe `vex-effect` con lo que comprobó y refresca justo esa lista (mira el `addEventListener('vex-effect', …)` de la muestra).

## 5 · El manifiesto: botones, tour y guion (5 min)

Abre `presets/demo-guiada/manifest.json` y cambia algo: un botón nuevo, un paso del tour, una escena. Las piezas:

- `quickActions`: un botón con `prompt` manda un mensaje al chat; uno con `tool` + `params` corre por el mismo bucle que el modelo (política, confirmación, auditoría).
- `tours`: pasos con `target`, `say`, `pose`; `when: "first"` arranca solo la primera vez.
- `scripts`: escenas como pasos de tour, más `action` (el id de un botón, se lanza con Enter) y `notes` (solo para el presentador).
- `features`: todo está apagado por defecto; enciende solo lo que uses.

Un manifiesto que no valida impide arrancar, con el campo y el motivo. Reinicia Vex Core para que lo lea.

## 6 · Conectar una herramienta que Vex no conocía (5 min)

Arranca la tienda de muestra:

```bash
pnpm dev:catalogo
```

Y en el chat, como administrador, importa su OpenAPI y revisa las acciones (o desde `http://localhost:5174/#conectores` con la demo React):

```bash
curl -X POST http://127.0.0.1:8787/connectors/import/openapi -H "authorization: Bearer <token-admin>" -H "content-type: application/json" -d "{\"id\":\"tienda\",\"url\":\"http://127.0.0.1:8791/openapi.json\",\"filter\":{\"include\":[\"GET\",\"POST /pedidos\"]}}"
```

Nada se activa solo: cada acción llega «Sin revisar» con un riesgo sugerido y su motivo; un administrador aprueba y activa. Con `filter` decides qué operaciones entran. Para que la API del host vea quién actúa, `auth: { kind: "session" }` reenvía el JWT de la persona. Detalle en `docs/conectores.md`.

## 7 · Presentar (3 min)

Con el atributo `presenter`, el panel expone los guiones del manifiesto. En la consola del navegador:

```js
document.getElementById('vex').startScript('demo-cliente');
```

Teclas: `→` siguiente, `←` anterior, `Enter` lanza la acción de la escena, `Esc` sale. La barra de abajo enseña la escena, tus notas (el público no las ve en la burbuja) y el coste del modelo. El botón **Reiniciar demo** (solo administradores) manda un `POST` firmado a `presenter.reset.url`; la web de muestra lo verifica con `verifyVexSignature` (copia esa función: es todo el contrato) y vacía su pizarra. Un secreto distinto en un lado da 401 y Vex lo dice.

## Qué has montado

Una web con Vex dentro que sabe quién es el usuario, qué tiene abierto y qué puede señalar; un tour y botones sin modelo; una herramienta de terceros aprendida de su OpenAPI, aprobada acción por acción; y una demo repetible con reinicio firmado. Para instalarlo en un cliente de verdad: `docs/instalar.md` (contenedor, secretos, copias). Para lo que Vex no hará nunca sin un OK: `docs/seguridad.md`.
