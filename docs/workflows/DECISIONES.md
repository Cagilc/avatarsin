# Decisiones para César · cómo avanzar

Este PR es una **propuesta**. Nada de lo de abajo está decidido: marca lo que prefieras (editando este fichero en el propio PR o respondiendo en los comentarios) y el plan se ajusta. Donde hay recomendación, es solo eso.

## 1 · Camino general

- [ ] **A · Plan completo (recomendado por Oscar).** Fusionar este PR, revisar el plan con Fable (prompt A del `README.md`) y ejecutar 01 → (02 ∥ 04) → (03 ∥ 05).
- [ ] **B · Solo lo visual primero.** Saltar al 03 (tours y mascota) con un 01 y 02 mínimos. Más vistoso pronto, más riesgo de rehacer el desacople.
- [ ] **C · Solo el 01 por ahora.** Hacer el manifiesto y desacoplar, y decidir el resto después de verlo funcionar.
- [ ] **D · Otro orden o recorte** (describir): ______

## 2 · Estructura

- [ ] Mover el negocio precargado a `presets/mnee/` (se conserva todo; solo cambia de sitio).
- [ ] Dejarlo donde está y añadir el manifiesto al lado, sin mover nada. Menos limpio, menos cambios.
- [ ] El web component **convive** con el componente React de la demo.
- [ ] El web component **sustituye** al componente React.
- [ ] Manifiesto en **JSON**. [ ] Manifiesto en **YAML** (requiere que el importador lo admita).

## 3 · Licencia

- [ ] MIT · [ ] Apache-2.0 · [ ] Propietaria / sin licencia por ahora · [ ] Otra: ______

Sin licencia elegida, las contribuciones externas quedan en el aire. Es lo único que recomendaría resolver antes de aceptar más cambios.

## 4 · Modelos y coste

- [ ] Fable refina y revisa **todo**; Sonnet escribe (propuesta del protocolo).
- [ ] Fable solo en los workflows 01 y 05 (los de contratos y seguridad); el resto, Sonnet con puertas automáticas.
- [ ] Otro reparto: ______

Los tours, anuncios y botones están diseñados para no gastar tokens en su uso diario.

## 5 · Qué se añade del backlog (`backlog.md`)

Marca las que quieras convertir en workflow: [ ] A Aprobaciones por canal · [ ] B «¿Cómo hago X?» · [ ] C Analítica de onboarding · [ ] D Sesión real → caso del banco · [ ] E Plan por lotes · [ ] F Ayuda proactiva · [ ] G Eventos salientes · [ ] H Resumen al abrir · [ ] I Idiomas · [ ] J Voz · [ ] K Búsqueda de herramientas. Ninguna es obligatoria.

## 6 · Reparto

- [ ] Los cinco workflows los ejecuta César; Oscar lleva el carril de infra (servidor, multi-inquilino, un host real) en paralelo.
- [ ] César ejecuta algunos y Oscar otros (indicar cuáles): ______
- [ ] César prefiere que Oscar no toque nada hasta nuevo aviso.

## 7 · Parte gráfica

El plan **no cambia el estilo** del avatar; solo añade poses (señalar, celebrar) y mueve la mascota. Si quieres vetar, ajustar o encargarte tú de esas poses antes del 03, anótalo aquí: ______

## 8 · Lo que no hay que dar por hecho

- Los workflows están escritos, no ejecutados. Las rutas y nombres que citan salen de una lectura del código, no de una búsqueda exhaustiva; por eso el primer paso es que Fable las verifique.
- El banco de encargos no se ha medido con Claude (no había clave); el 05 deja esa cifra como medida a registrar.
- Cualquier workflow puede pararse, reordenarse o descartarse sin afectar a los demás salvo las dependencias del diagrama de `00-protocolo.md`.
