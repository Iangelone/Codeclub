# Dropdown Menus

Each app menu label (`Archivo`, `Editar`, `Ver`, `Ayuda`) opens a dropdown on hover.

- File: `src/pages/index.astro`
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

## Menu Content

### Archivo

| Icon | Label |
|---|---|
| `FilePlus` | Nuevo archivo |
| `FolderOpen` | Abrir carpeta |
| `Save` | Guardar |
| `Command` | Exportar |

### Editar

| Icon | Label |
|---|---|
| `Undo2` | Deshacer |
| `ArrowRight` | Rehacer |
| `Scissors` | Cortar |
| `Settings` | Preferencias |

### Ver

| Icon | Label |
|---|---|
| `PanelLeft` | Panel lateral |
| `Terminal` | Terminal |
| `Square` | Pantalla completa |
| `Eye` | Apariencia |

### Ayuda

| Icon | Label |
|---|---|
| `HelpCircle` | Documentación |
| `Keyboard` | Atajos |
| `Bug` | Reportar problema |
| `PiggyBank` | Donación (linked to `https://ko-fi.com/codeclubide`) |
