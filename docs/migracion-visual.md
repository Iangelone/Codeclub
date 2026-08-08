# Migración visual: paridad obligatoria

## Prioridad

La migración a Next.js + Electron debe conservar la apariencia actual de Codeclub. La tecnología cambia; la experiencia visual no.

No se acepta una reconstrucción aproximada. Cada pantalla debe compararse contra la versión actual y mantener:

- Geometría y proporciones.
- Jerarquía visual.
- Colores y superficies.
- Tipografía, tamaños y pesos.
- Espaciado, bordes y radios.
- Iconos y estados interactivos.
- Animaciones, transiciones y feedback.
- Comportamiento al redimensionar la ventana.

## Fuente de verdad visual

Antes de migrar cada pantalla se debe capturar la versión actual en estados representativos:

1. App sin proyecto seleccionado.
2. Proyecto activo con archivos visibles.
3. Chat vacío.
4. Chat con streaming y tool call.
5. Sidebar derecho abierto y cerrado.
6. Terminal con salida.
7. Browser cargado.
8. Review con diff.
9. Artifacts con contenido.
10. Estados de carga, error y vacío.

Las capturas deben conservar viewport, escala del sistema, tema y densidad de pantalla.

## Inventario de superficies

La interfaz debe mantener estas superficies principales:

- Fondo base oscuro.
- Topbar.
- Sidebar izquierdo.
- Panel central de chat.
- Sidebar derecho redimensionable.
- Dock de terminal.
- Paneles flotantes y overlays.
- Editor y previews.
- Estados de selección, hover, focus, disabled y error.

## Tokens visuales

Conservar los tokens definidos por el producto:

- Fondo base: `#111111`.
- Superficies: `#101010`, `#121212`, `#161616`, `#191919`, `#1A1A1A`.
- Hover/selección: `#1C1C1C`, `#1E1E1E`, `#202020`.
- Bordes: `#2B2B2B`, `#2C2C2C`, `#2F2F2F`.
- Acento: `#8BC7FF`, `#3D9BFF`, `#1687FF`, `#237BFF`, `#1469E8`, `#385FEF`.
- Sintaxis: Material Theme / Material Palenight.

No introducir una paleta nueva durante la migración.

## Reglas de implementación

- Reutilizar los componentes React existentes cuando sea posible.
- Mantener nombres y responsabilidades visuales de los componentes.
- Separar lógica nativa de presentación mediante IPC.
- No modificar el layout para adaptarlo a Electron sin evidencia visual.
- Mantener CSS Grid, flexiones, anchos, alturas y overflow actuales.
- Mantener el comportamiento de paneles redimensionables.
- Mantener el orden de capas y z-index.
- Mantener accesibilidad visible: focus rings, labels y estados disabled.
- Usar los mismos iconos y tamaños; no reemplazarlos por equivalentes aproximados.
- Evitar estilos inline nuevos salvo valores calculados por estado.

## Next.js y Electron

Next.js renderiza la interfaz y Electron aloja el renderer. El proceso main no debe decidir estilos ni estructura visual.

El renderer debe recibir únicamente estado y acciones tipadas:

- Estado de ventana.
- Estado de proyecto.
- Estado de chat.
- Estado de terminal.
- Estado de browser.
- Estado de artifacts.
- Eventos de herramientas.

Los cambios de Electron no deben alterar los componentes visuales.

## Validación visual

Cada pantalla migrada requiere:

1. Captura de referencia del prototipo anterior.
2. Captura equivalente de Next.js/Electron.
3. Comparación lado a lado.
4. Comparación superpuesta con transparencia.
5. Revisión manual de viewport completo.
6. Revisión de estados hover, focus, loading, error y vacío.
7. Registro de diferencias y corrección antes de continuar.

## Criterios de aceptación

Una pantalla está migrada cuando:

- Mantiene la misma estructura y proporciones.
- No hay desplazamientos visibles de paneles.
- Los textos no cambian de tamaño ni se cortan.
- Los botones e iconos conservan posición y escala.
- Los scrollbars y overflow funcionan igual.
- Las transiciones no generan saltos.
- La ventana se comporta igual al redimensionar.
- La comparación visual no muestra regresiones relevantes.

## Orden recomendado

1. App shell y layout general.
2. Topbar y controles de ventana.
3. Sidebar izquierdo.
4. Chat y streaming.
5. Sidebar derecho.
6. Terminal dock.
7. Browser y overlays.
8. Artifacts y review.
9. Estados de error, carga y vacío.
10. Pulido final y empaquetado Windows.

## Regla de bloqueo

Si una decisión técnica mejora la arquitectura pero altera visualmente la experiencia, se pausa la migración de esa pantalla y se corrige la paridad antes de avanzar.
