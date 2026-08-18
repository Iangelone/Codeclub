# Accesibilidad y Computer Use

## Regla de oro

Si una persona no puede entender o alcanzar un control, tampoco debería poder depender de él un agente.

## Convenciones

- Todo botón solo-icono tiene `aria-label` y `title`.
- Tabs usan `role="tab"`, `aria-selected` y `aria-controls`.
- Menús usan `role="menu"` y `role="menuitem"` cuando corresponde.
- Iconos decorativos llevan `aria-hidden="true"`.
- Inputs tienen label visible o `aria-label`.
- Separadores de resize exponen orientación y valores ARIA.
- Estados vacíos explican qué hacer después.
- El foco visible usa el acento eléctrico.

## IDs estables

No cambiar sin actualizar las tools que inspeccionan el DOM:

| ID | Región |
| --- | --- |
| `codeclub-left-sidebar` | sidebar izquierda |
| `codeclub-right-sidebar` | sidebar derecha |
| `codeclub-terminal-panel` | terminal |
| `codeclub-browser-address` | dirección del navegador |

## Checklist

- [ ] ¿Se puede llegar con Tab?
- [ ] ¿El foco se ve?
- [ ] ¿El lector conoce nombre, rol y estado?
- [ ] ¿Computer Use encuentra el control por label, role o id?
- [ ] ¿La UI explica errores y estados vacíos?
- [ ] ¿El cambio de idioma traduce también labels accesibles?
- [ ] ¿El overlay no bloquea scroll ni selección?

## Evitar

- `div` clickeables sin teclado.
- Inputs sin nombre.
- Selectores basados solo en clases Tailwind o posición.
- Cambiar textos o IDs sin revisar tools.
- `aria-hidden` en elementos interactivos.
- Animaciones que impidan leer o usar la interfaz.
