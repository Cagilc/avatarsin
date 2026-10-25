# Backlog · ideas adicionales (no ejecutar hasta que se priorice)

Capacidades genéricas, útiles para cualquier host, que amplían los cinco workflows. Cada una sería un workflow más (`06…`) con el mismo protocolo (Fable refina y revisa, Sonnet escribe). Ordenadas por valor estimado; la prioridad final la fija Oscar.

| # | Idea | Qué aporta | Necesita | Modelo en uso |
|---|---|---|---|---|
| A | **Aprobaciones por canal y delegadas** | La confirmación de lo irreversible deja de ser solo una tarjeta en la página: puede enviarse a otro canal (mensajería, correo) o a otra persona con permiso, y se resuelve desde allí. | 01 | no |
| B | **«¿Cómo hago X?» → lanza el tour** | La persona pregunta en lenguaje natural y Vex arranca el tour correspondiente (coincidencia por descripción; con modelo solo como respaldo). | 03 | opcional |
| C | **Analítica de uso y de onboarding** | Eventos (tour iniciado/abandonado/completado, herramienta usada, confirmación rechazada, coste por persona) hacia un destino configurable. Dice dónde se atasca la gente. | 01, 03 | no |
| D | **De sesión real a caso del banco** | Un fallo en la auditoría se convierte con un comando en un caso de `evals/cases.ts` (datos anonimizados); más un 👍/👎 con motivo por respuesta. | 01 | no |
| E | **Plan por lotes** | Para peticiones de varios pasos, Vex enseña el plan completo y se aprueba una vez (lo irreversible sigue mostrando lo real). | 01 | sí |
| F | **Ayuda proactiva por reglas** | Disparadores declarativos (pantalla vacía, tiempo sin actividad, error repetido) que ofrecen un tour o un botón. Sin modelo. | 03, 04 | no |
| G | **Eventos salientes** | Vex emite eventos (acción ejecutada, rechazada, tour completado) por webhook firmado, para que el host los conecte a su propia automatización. | 01 | no |
| H | **Resumen al abrir** | Un resumen por rol de lo que cambió desde la última visita, con herramientas de solo lectura. | 01 | sí |
| I | **Idiomas** | Tours, anuncios y botones por idioma en el manifiesto, con respaldo al idioma por defecto. | 03, 04 | no |
| J | **Voz** | Entrada y salida de voz; los visemas del rig ya existen. | 02 | sí (voz) |
| K | **Búsqueda de herramientas bajo demanda** | Cuando hay muchas herramientas, el modelo las descubre en lugar de recibirlas todas (ya figura como pendiente en `CLAUDE.md`). | 01 | sí |

## Mi recomendación de orden

1. **A · aprobaciones por canal.** Es lo que más cambia el uso real: aprobar acciones desde donde ya se está, sin abrir la página.
2. **D · de sesión real a caso del banco.** Hace que cada fallo mejore el sistema y mide la inyección con datos reales.
3. **C · analítica de onboarding.** Sin ella no se sabe si los tours funcionan.
4. **B · «¿cómo hago X?».** Une chat y tours con poco coste.
5. Después E, F, G; H, I, J y K según la necesidad.

## Reglas para añadir ideas

- Toda idea debe funcionar para **cualquier host** y configurarse en el manifiesto; si solo sirve a una plataforma, no entra aquí.
- Cada una declara su interruptor en `features`, apagado por defecto.
- Cada una indica si necesita modelo y qué pasa sin clave.
