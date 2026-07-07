# Chat

The chat panel is the main workspace area. It displays the message history, a composer input, and provider/model controls.

## Chat Panel

- File: `src/components/ChatPanel.astro` (`.chat-panel`)
- Position: `relative`.
- Layout: `grid`, `place-items: center`.
- Min height: `100%`.
- Overflow: `hidden`.
- Wraps the React `ChatInterface` component via `client:load`.

## Chat Interface Container

- File: `src/components/ChatInterface.tsx` (`.chat-interface-container`)
- Width: `min(600px, calc(100% - 64px))`.
- Layout: `grid`, gap `10px`.

## Messages Area

Scrollable message list between user and assistant.

- Max height: `60vh`.
- Overflow-y: `auto`.
- Layout: `flex`, column, gap `1rem`.
- Padding bottom: `1rem`.

### User Message Bubble

- Align self: `flex-end`.
- Background: `var(--color-surface-7, #2c2c2c)`.
- Padding: `8px 12px`.
- Radius: `8px`.
- Color: `#eee`.
- Max width: `80%`.

### Assistant Message Bubble

- Align self: `flex-start`.
- Background: `transparent`.
- Padding: `8px 12px`.
- Radius: `8px`.
- Color: `#eee`.
- Max width: `80%`.

## Chat Composer

The input area container, positioned relatively to host the command menu.

- File: `src/components/ChatInterface.tsx` (`.chat-composer`)
- Position: `relative`.
- Layout: `grid`, gap `10px`.

### Composer Status

Status text shown above the input box.

- Layout: `flex`, align center, justify center, gap `8px`.
- Text: "Listo cuando tú lo estés." when idle, "Generando..." when streaming.
- Font size: `16px`.
- Color: `rgba(216, 216, 216, 0.82)`.
- Contains the braille spinner indicator.

### Provider/Model Status

Shows current selection below the status text.

- Layout: `flex`, align center, justify center, gap `8px`.
- Font size: `12px`.
- Color: `rgba(216, 216, 216, 0.42)`.
- Separator `/` color: `rgba(216, 216, 216, 0.24)`.

Format: `{provider label} / {model label}`.

### Composer Box

The form container with input and send button.

- Min height: `40px`.
- Layout: `grid`, columns `1fr 28px`, align center.
- Gap: `4px`.
- Padding: `5px`.
- Border: `1px solid var(--color-surface-9, #2f2f2f)`.
- Radius: `8px`.
- Background: `#121212`.
- Shadow: `0 18px 52px rgba(0, 0, 0, 0.26)`.

#### Text Input

- Appearance: none.
- Border: none, outline: none.
- Background: transparent.
- Color: `#eeeeee`.
- Font size: `12px`.
- Padding: `0 7px`.
- Placeholder: "Preguntá, pedí código o describí una tarea".

Triggers command menu when typing `/proveedor` or `/modelo`.

#### Send Button

- Width: `28px`, height: `28px`.
- Layout: `grid`, `place-items: center`.
- Border: none.
- Radius: `7px`.
- Background: `var(--color-surface-8, #2c2c2c)`.
- Color: `#ffffff`.
- Disabled cursor: `not-allowed` when streaming.
- Icon: `ArrowUp`, size `15`, stroke `2`.

## Command Menu

Floating menu triggered by `/proveedor` or `/modelo` commands in the input.

- Position: absolute below the composer.
- Left: `0`, right: `0`.
- Top: `calc(100% + 8px)`.
- Display: `none` by default, `grid` when `.is-open`.
- Gap: `8px`.
- Padding: `9px`.
- Border: `1px solid var(--color-surface-9, #2f2f2f)`.
- Radius: `8px`.
- Background: `#121212`.
- Shadow: `0 20px 58px rgba(0, 0, 0, 0.34)`.
- Z-index: `10`.

### Command Search Input

- Height: `30px`.
- Padding: `0 8px`.
- Radius: `7px`.
- Background: `var(--color-surface-3, #1c1c1c)`.
- Font size: `12px`.
- Color: `#eeeeee`.
- Border: none, outline: none.
- Placeholder: "Buscar proveedor" or "Buscar modelo del proveedor activo".
- `Escape` closes the menu.

### Command List

Scrollable list of filtered providers/models.

- Layout: `grid`, gap `4px`.
- Max height: `120px`.
- Overflow: auto.
- Scrollbar: none.
- Mask image: `linear-gradient(to bottom, black 85%, transparent 100%)`.

#### Command Item

- Min height: `32px`.
- Layout: `flex`, align center, `space-between`, gap `12px`.
- Border: none.
- Radius: `7px`.
- Background: transparent.
- Color: `rgba(238, 238, 238, 0.78)`.
- Font size: `12px`.
- Padding: `0 9px`.
- Hover: background `var(--color-surface-7, #2c2c2c)`, color `#ffffff`.
- Small label: `proveedor` or `modelo`, color `rgba(216, 216, 216, 0.36)`, font size `11px`.

## Braille Spinner

Loading indicator shown during streaming.

- File: `src/components/ChatPanel.astro` (`.braille-spinner`)
- Font family: `ui-monospace, "SFMono-Regular", Consolas, monospace`.
- Line height: `1`.
- Font size: `18px` (via `::before`).
- Opacity: `0.78`.
- Color: `#c7cbff`.
- Text shadow:
  - `0 0 10px rgba(123, 130, 255, 0.42)`
  - `0 0 18px rgba(255, 117, 181, 0.18)`

Animation cycles through braille characters every `880ms`:

| % | Character |
|---|---|
| 0% | `⠋` |
| 12.5% | `⠙` |
| 25% | `⠹` |
| 37.5% | `⠸` |
| 50% | `⠼` |
| 62.5% | `⠴` |
| 75% | `⠦` |
| 87.5% | `⠧` |
