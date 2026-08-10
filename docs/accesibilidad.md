# Accesibilidad y Computer Use

## Convenciones actuales

- Usar `aria-label` en controles solo-icono.
- Usar `title` como ayuda visual, sin depender de él como único nombre accesible.
- Mantener `role`, `aria-selected`, `aria-controls` y `aria-expanded` en tabs y menús.
- Los iconos decorativos llevan `aria-hidden="true"`.
- Los separadores redimensionables exponen orientación y valores ARIA.
- Los paneles importantes tienen landmarks (`main`, `section`, `nav`) y labels.

## Mejoras seguras aplicadas o recomendadas

1. Mantener IDs estables para regiones observables: `codeclub-left-sidebar`, `codeclub-right-sidebar`, `codeclub-terminal-panel` y `codeclub-browser-address`.
2. Preferir estados vacíos con texto real, no solo iconos.
3. Asegurar foco visible en tabs, botones de toolbar, inputs y controles del navegador.
4. No ocultar controles interactivos con `aria-hidden`; ocultar solo decoración.
5. En Computer Use, conservar nombres estables, `aria-label` semánticos y selectores por `id` cuando una tool necesite interactuar.
6. No cambiar textos visibles o IDs sin actualizar las tools que inspeccionan el DOM.

## Checklist de revisión

- ¿Se puede llegar al control con Tab?
- ¿El foco visible indica dónde se está?
- ¿Un lector de pantalla conoce nombre, rol y estado?
- ¿Computer Use puede encontrar el control por label, role o selector estable?
- ¿Los cambios de estado se anuncian sin inundar `aria-live`?
- ¿El estado vacío explica la siguiente acción?

## Riesgos a evitar

- Selectores basados en clases utilitarias o posición del DOM.
- `div` clickeables sin teclado ni rol.
- Inputs sin label.
- Cambiar un evento `codeclub:*` sin actualizar sus consumidores.
- Crear overlays transparentes que roben el foco o bloqueen scroll y selección.
