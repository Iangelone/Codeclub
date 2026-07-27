# Dropdown Menus

Each app menu label (`Archivo`, `Editar`, `Ver`, `Testing`, `Ayuda`) opens a dropdown on hover.

- File: `src/pages/index.astro` (inline in `<style>`)
- Container: `.menu-group`, relative positioned.
- Position: absolute under the menu group.
- Top offset: `34px`.
- Left: `0`.
- Minimum width: `210px`.
- Layout: vertical `flex`, gap `3px`.
- Padding: `8px`.
- Border: `1px solid var(--color-surface-10, #2f2f2f)`.
- Radius: `8px`.
- Background: `rgba(18, 18, 18, 0.96)`.
- Shadow: `0 18px 54px rgba(0, 0, 0, 0.38)`.
- Hidden: `opacity: 0`, `pointer-events: none`, `transform: translateY(-4px)`.
- Open: `opacity: 1`, `pointer-events: auto`, `transform: translateY(0)`.
- Animation: `opacity 120ms ease`, `transform 120ms ease`.
- Layer: `z-index: 20`.
- Trigger: `.menu-group:hover .dropdown-menu, .dropdown-menu:hover`.

## Dropdown Items

Items use `<a>` tags styled as compact rows.

- Min height: `30px`.
- Layout: `flex`, align center, gap `9px`.
- Radius: `7px`.
- Padding: `0 10px`.
- Text color: `#bdbdbd`.
- Font size: `12px`.
- Text decoration: none.
- Hover background: `var(--color-surface-7, #202020)`.
- Hover text color: `#ffffff`.
- Icons: Lucide, size `14`.

Items use `flex: 0 0 auto` on SVG to prevent shrinking.
Disabled items have lower opacity and `pointer-events: none`.

## Menu Content

### Archivo

| Icon | Label | Action |
|---|---|---|
| `FilePlus` | Nuevo archivo | Create new file |
| `FolderOpen` | Abrir carpeta | Open folder dialog |
| `Save` | Guardar | Save current file |
| `Command` | Exportar | Export project |

### Editar

| Icon | Label |
|---|---|
| `Undo2` | Deshacer |
| `ArrowRight` | Rehacer |
| `Scissors` | Cortar |
| `Settings` | Preferencias |

### Ver

| Icon | Label | Action |
|---|---|---|
| `PanelLeft` | Panel lateral | Toggle left sidebar |
| `PanelRight` | Panel derecho | Toggle right sidebar / tab |
| `Terminal` | Terminal | Toggle terminal dock |
| `Globe` | Navegador | Toggle built-in browser |
| `Square` | Pantalla completa | Toggle fullscreen |
| `Eye` | Apariencia | Appearance settings |

### Testing

| Icon | Label | Description |
|---|---|---|
| `MessageSquare` | askUser simple | Single-option askUser prompt |
| `CheckSquare` | askUser múltiple | Multi-option askUser prompt |
| `Users` | Subagente | Sub-agent delegation prompt |
| `ShieldCheck` | Aprobación | Tool approval test prompt |
| `Zap` | Streaming + reasoning | Streaming with reasoning tokens |
| `ListTodo` | Estado TODOs | TODO status inspection prompt |
| `ClipboardList` | Plan activo | Active plan inspection prompt |
| `Briefcase` | Modo negocio | Business mode test prompt |

Testing menu is only visible in development builds. Prompts are sent via `codeclub:testing-action` events.

### Ayuda

| Icon | Label | Action |
|---|---|---|
| `HelpCircle` | Documentación | Open docs |
| `Keyboard` | Atajos | Show keyboard shortcuts |
| `Bug` | Reportar problema | Report issue |
| `PiggyBank` | Donación | Opens `https://ko-fi.com/codeclubide` |
