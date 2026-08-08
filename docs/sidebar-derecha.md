# Sidebar derecha

Documento de trabajo para rediseñar y retrabajar la sidebar derecha de Codeclub.

## Objetivo

Construir una sidebar derecha de escritorio, minimalista y redimensionable, integrada con el layout actual de Next.js + Electron. Debe empujar el panel central sin romper el chat ni la navegación.

## Pestañas

### Archivos

- Árbol del proyecto activo.
- Búsqueda y apertura de archivos.
- Vista previa para texto, código, imágenes y PDF.
- Edición únicamente cuando corresponda.

### Revisar

- Cambios del workspace.
- Estado de git.
- Archivos modificados, agregados y eliminados.
- Resumen de la última ejecución de tools.

### Navegador

- Navegador embebido dentro de Electron.
- URL, navegación y recarga.
- Referencias seleccionadas para enviarlas al chat.
- Estado vacío y errores claros.

### Artifacts

- Planes, TODOs, cotizaciones y resultados generados por la IA.
- Filtros por tipo.
- Persistencia por proyecto.
- Apertura desde una respuesta del chat.

### Terminales

- Terminales persistentes por pestaña.
- Crear, cambiar nombre, enfocar y cerrar.
- Estado del proceso y salida visible.
- Persistencia solo durante la sesión de la app.

## Reglas visuales

- Mismo color base que el contenido central actual.
- Sin base acrílica propia.
- Paneles internos con #191919 cuando corresponda.
- Bordes mínimos y divisor eléctrico azul suave al centro.
- Sin tarjetas pesadas ni sombras fuertes.
- Iconos Lucide consistentes con la topbar.
- Motion sutil al cambiar de pestaña, abrir contenido y redimensionar.

## Comportamiento

- Cerrada por defecto.
- Se activa desde el botón de panel derecho de la topbar.
- Ancho definido por el usuario con mínimo y máximo sanos.
- La pestaña activa usa el mismo estado visual que los controles existentes.
- Un solo contenido visible por vez.
- El panel central se adapta dinámicamente al ancho disponible.

## Integración

- React controla el estado visual.
- Electron/Node maneja archivos, navegador, terminal y persistencia nativa.
- El chat abre Artifacts mediante eventos codeclub:.
- La selección de proyecto determina el contenido de Archivos, Revisar y Artifacts.

## Orden de implementación

1. Shell de la sidebar y selector de pestañas.
2. Archivos.
3. Revisar.
4. Artifacts.
5. Terminales.
6. Navegador.
7. Accesibilidad, motion y verificación con Computer Use.
