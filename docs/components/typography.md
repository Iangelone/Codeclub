# Typography

## Font Family

Primary: `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`

Monospace: `ui-monospace, "SFMono-Regular", Consolas, monospace`

## Font Sizes

### Core Scale

| Size | Usage |
|---|---|
| `28px` | Note and table titles. Business dashboard section titles. |
| `16px` | Initial chat status: "Listo cuando tú lo estés." / "Generando..." |
| `14px` | Chat message bubbles. Business dashboard metric values. |
| `12px` | Normal UI text: sidebar, topbar, buttons, menus, inputs, command items, provider/model status, table cells. |

### Small Exceptions

| Size | Usage |
|---|---|
| `13px` | Empty workspace hint: "Selecciona un chat, nota o tabla". |
| `11px` | Command item type label: `proveedor` / `modelo`. |

### Specialized

| Size | Usage |
|---|---|
| `14px` | xterm.js terminal text (default terminal font size). |
| `12px` | CodeMirror editor text (One Dark theme). |
| `12px` | File tree entries. |
| `12px` | Business chart axis labels. |

## Font Weights

| Weight | Usage |
|---|---|
| `600` | Note and table titles. Business dashboard section headers. |
| `400` | Body text, sidebar labels, section headings, all normal UI text. |
| `300` | Some chart labels (Recharts defaults). |

## Line Height

| Value | Usage |
|---|---|
| `1` | Braille spinner. |
| `1.7` | Note editor body. |
| `1.5` | Chat messages, Markdown content. |
| Default | All other text. |

## Terminal Typography

Terminal uses `xterm.js` defaults:
- Font family: `Courier New, Courier, monospace` (or system monospace).
- Font size: `14px`.
- Bold text rendered as bright color variant.
