# Components

## Topbar

The topbar is the only visible app chrome for the empty shell.

- Height: `36px`.
- Layout: `grid`, columns `auto 1fr 138px`.
- Left area: app tools and menu buttons.
- Center area: empty drag region with `data-tauri-drag-region`.
- Right area: native-style window controls.
- Background: `rgba(17, 17, 17, 0.48)`.
- Bottom border: `1px solid rgba(47, 47, 47, 1)`.
- Text/icon color: `#d8d8d8`.
- Hover color: `#202020`.
- User selection: disabled.

Windows uses the same topbar color over the native Tauri window effect. Linux and macOS keep a plain dark fallback.

## Empty Main Panel

The main panel is intentionally empty.

- Body background: transparent at the page level.
- Main surface: `body::before`.
- Main surface inset: `36px 0 0`, leaving the topbar above it.
- Main surface color: `#111111`.
- The empty panel should stay visually quiet until real IDE content exists.

## Topbar Tools

Left tools use Lucide icons.

- Sidebar icon: `PanelLeft`, size `15`, stroke `1.8`.
- Back icon: `ArrowLeft`, size `15`, stroke `1.8`.
- Forward icon: `ArrowRight`, size `15`, stroke `1.8`.
- Button size: `30px` wide, `28px` high.
- Button radius: `6px`.
- Button background: transparent.
- Button hover: `#202020`.
- Button icon color: `#d8d8d8`.

## App Menus

Menu labels live beside the topbar tools.

- Labels: `Archivo`, `Editar`, `Ver`, `Ayuda`.
- Button height: `28px`.
- Horizontal padding: `9px`.
- Font size: `12px`.
- Border: none.
- Radius: `6px`.
- Text color: `#d8d8d8`.
- Hover background: `#202020`.

## Dropdown Menus

Each app menu opens its own dropdown on hover.

- Position: absolute under the menu group.
- Top offset: `34px`.
- Minimum width: `210px`.
- Layout: vertical flex.
- Gap: `3px`.
- Padding: `8px`.
- Border: `1px solid #2f2f2f`.
- Radius: `8px`.
- Background: `rgba(18, 18, 18, 0.96)`.
- Shadow: `0 18px 54px rgba(0, 0, 0, 0.38)`.
- Hidden state: `opacity: 0`, `pointer-events: none`, `translateY(-4px)`.
- Open state: `opacity: 1`, `pointer-events: auto`, `translateY(0)`.
- Animation: `opacity 120ms ease`, `transform 120ms ease`.
- Layer: `z-index: 20`.

## Dropdown Items

Dropdown rows are compact and icon-first.

- Height: minimum `30px`.
- Layout: horizontal flex.
- Alignment: center.
- Gap: `9px`.
- Radius: `7px`.
- Padding: `0 10px`.
- Text color: `#bdbdbd`.
- Font size: `12px`.
- Hover background: `#202020`.
- Hover text/icon color: `#ffffff`.
- Icons: Lucide, size `14`.

## Menu Content

Archivo:

- `FilePlus` -> Nuevo archivo.
- `FolderOpen` -> Abrir carpeta.
- `Save` -> Guardar.
- `Command` -> Exportar.

Editar:

- `Undo2` -> Deshacer.
- `ArrowRight` -> Rehacer.
- `Scissors` -> Cortar.
- `Settings` -> Preferencias.

Ver:

- `PanelLeft` -> Panel lateral.
- `Terminal` -> Terminal.
- `Square` -> Pantalla completa.
- `Eye` -> Apariencia.

Ayuda:

- `HelpCircle` -> Documentación.
- `Keyboard` -> Atajos.
- `Bug` -> Reportar problema.
- `PiggyBank` -> Donación, linked to `https://ko-fi.com/codeclubide`.

## Window Controls

Right-side window controls use Lucide icons.

- Container width: `138px`.
- Layout: `grid`, three columns of `46px`.
- Button size: `46px` wide, `36px` high.
- Button alignment: centered with CSS grid.
- Button background: transparent.
- Button color: `#d8d8d8`.
- SVG display: block.
- Hover background: `#202020`.
- Close hover background: `#c42b1c`.
- Close hover color: `#ffffff`.

Icons:

- Minimize: `Minus`, size `14`, stroke `1.8`.
- Maximize: `Square`, size `12`, stroke `1.8`.
- Close: `X`, size `14`, stroke `1.8`.

## Color Tokens

- `#111111` -> base app background.
- `#101010` -> deepest surface.
- `#121212` -> low surface.
- `#161616` -> raised surface.
- `#191919` -> panel surface.
- `#1A1A1A` -> active surface.
- `#1C1C1C` -> hover surface.
- `#1E1E1E` -> selected surface.
- `#202020` -> interactive hover.
- `#2B2B2B` -> subtle border.
- `#2C2C2C` -> clear border.
- `#2F2F2F` -> strongest dark border.
