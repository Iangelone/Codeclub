# Diagnóstico de la interfaz de chat

Revisión estática del 8 de octubre de 2026. No se modificó la implementación del chat ni se reprodujo el comportamiento en la app. Los cambios observados en código están confirmados; su contribución exacta al rebote necesita verificación visual.

## 1. Saltos al cambiar de chat: principal sospechoso, medición y scroll

En `src/components/ChatInterface.tsx:695` el historial usa virtualización con altura estimada de **240 px por turno**, medición real del elemento, anclaje al final y seguimiento de nuevos elementos. Los turnos se posicionan de forma absoluta mediante `translateY` (línea 3055). Cuando llega la medida real de un turno, pueden cambiar la altura total y las posiciones de los demás.

Además hay dos mecanismos explícitos de posicionamiento:

- En las líneas 851–904, cambiar de chat inicia un bucle de `requestAnimationFrame` que llama a `scrollToEnd` hasta que detecta estabilidad. Espera cuatro frames estables; en generación basta uno.
- En las líneas 1255–1258, los cambios de mensajes, streaming y aprobaciones vuelven a llevar al final si el seguimiento está habilitado.

La transición intenta ocultar los ajustes con un fade. En la línea 682 se oculta el historial y en la 860 se revela. **Esa transición solo anima opacidad: no tiene un resorte de posición.** El salto descrito encaja más con correcciones de altura/scroll que con un efecto de rebote deliberado. No está demostrado todavía cuál de estos mecanismos lo desencadena.

El contenedor también tiene un espaciador flexible antes del historial (línea 3036): los historiales cortos quedan abajo y, al crecer, cambia el espacio libre. Es otro punto a observar junto con las medidas del virtualizador.

## 2. Durante y después de generar: cambia la composición

El componente Markdown y sus clases principales son compartidos (líneas 3074–3081). No encontré allí dos temas visuales distintos para streaming y completado. Sí hay diferencias de contenido y estructura:

- La cabecera muestra un contador de procesamiento y luego lo retira (3058).
- El resumen usa la solicitud mientras está activo; al finalizar puede usar la respuesta o un resumen generado por el modelo (`getTurnOverview`, 169; finalización, 2448).
- El indicador “Pensando” aparece y desaparece condicionalmente (3083). Al llegar el primer texto también cambia la clave del contenedor Markdown y se ejecuta su entrada por opacidad (3076–3079).
- `TurnActivity` depende del progreso, herramientas y archivos modificados (3520). Puede aparecer o desaparecer y recibe los cambios de archivos al completar el turno. Su resumen prioriza `progress` incluso después de finalizar: puede conservar una descripción de trabajo activo.
- La respuesta se divide en varios mensajes según límites del agente (`assistantBubbles`, 2094). Cada fragmento agrega su propio contenedor; la actividad y los metadatos se concentran en el último. Esto ocurre también durante streaming, no exclusivamente al terminar.

Estos cambios hacen que el turno varíe de altura y jerarquía visual, aunque el estilo base del texto sea el mismo. El Markdown incompleto durante streaming también puede reorganizarse al cerrarse listas, tablas o bloques de código; no se reprodujo un caso concreto.

## 3. Sensación de estar apretado

Hay evidencia directa de densidad alta:

- Turno: gap de **8 px**, con **8 px** de padding inferior en el último y **24 px** en los anteriores (3055).
- Contenedor de mensaje: gap de **4 px** (3067).
- Timeline: sangría izquierda de **52 px**, que resta espacio horizontal (`src/styles/chat-timeline.css:3`).
- Actividad: filas de **27 px**, separación de **1 px**, texto de 12 px y detalles de 10–11 px, además de sangrías anidadas (mismo archivo).
- Cabecera: hora de 10 px y resumen de 11 px, ambos junto al contenido del turno.

El Markdown sí tiene párrafos separados por 16 px y line-height 1.6. Por eso aumentar solo el interlineado no resolvería el problema: la mayor compresión está en la estructura y actividad alrededor del texto.

## Corrección recomendada, en orden

1. Reproducir cambios entre un chat corto, uno largo y uno generando. Registrar medidas y scroll para identificar qué ajuste sigue ocurriendo después de revelar el historial.
2. Coordinar el posicionamiento para que una sola ruta decida cuándo seguir al final y cuándo mostrar el chat. Mantener la virtualización hasta tener evidencia de que deba cambiarse.
3. Mantener una estructura estable del turno entre generación y finalización: mismo lugar para estado, respuesta, actividad y acciones. Actualizar el estado sin reconstruir innecesariamente la presentación.
4. Separar mejor cabecera, solicitud, respuesta y actividad; revisar la sangría en paneles estrechos y mantener consistencia en el espaciado del último turno.
5. Verificar streaming con herramientas, texto largo, tablas, imágenes, desplazamiento manual, reapertura de historial y cambio rápido de chat.

La separación reciente del CSS conservó las reglas compiladas y su orden. Esta revisión no encontró un cambio de estilos introducido por esa separación que explique los síntomas.
