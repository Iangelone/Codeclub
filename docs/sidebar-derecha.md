# Sidebar derecha

La sidebar derecha es el panel de herramientas del IDE. Se puede abrir, cerrar y redimensionar sin aplastar el chat.

## Paneles

| Pestaña | Qué hace |
| --- | --- |
| **Archivos** | Explora el árbol, busca, abre y previsualiza archivos del proyecto. |
| **Revisar** | Muestra cambios y estado del workspace/Git. |
| **Navegador** | Abre páginas dentro de Electron y permite referenciarlas. |
| **Artifacts** | Muestra planes y TODOs creados por el agente. |
| **Terminales** | Abre terminales interactivas persistentes durante la sesión. |

## Comportamiento

- El panel central mantiene un ancho mínimo.
- El ancho derecho se guarda localmente.
- Browser y Terminales pueden abrir múltiples pestañas.
- Las demás pestañas se reutilizan.
- Las tabs usan el mismo lenguaje visual que el resto de la app.
- Los paneles tienen estados vacíos claros y labels accesibles.

## Archivos

El contenido depende del proyecto activo. En Inicio se muestra un estado vacío; no se intenta leer una ruta inexistente.

## Revisar

Sirve para inspeccionar cambios del workspace. La vista debe diferenciar archivos agregados, modificados, eliminados, renombrados y sin seguimiento.

## Artifacts

Los artifacts se dividen en:

```text
Plan
  -> pasos
  -> progreso
  -> estado

TODO
  -> descripción
  -> estado
```

Se pueden buscar, referenciar al chat y eliminar. Su estado vive por proyecto.

## Reglas visuales

- Fondos oscuros: `#191919` y `#1E1E1E`.
- Bordes suaves, sin tarjetas pesadas.
- Acento eléctrico: `#8BC7FF` / `#3D9BFF`.
- Scrollbars finas y coherentes con la app.
- Motion corto al cambiar de panel o redimensionar.
