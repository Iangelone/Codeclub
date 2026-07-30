# Chat

The chat panel is the main workspace area. It displays the message history, a composer input, provider/model controls, and inline cards for tool execution.

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
- Renders Markdown via `react-markdown` + `remark-gfm`.

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

### Mode Toggle

Switch between Development and Business/Economy chat modes via a button in the composer row.

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
Accepts file drops from native `tauri://drag-drop` events.
Accepts artifact references and browser references.

#### Send / Stop Button

- Width: `28px`, height: `28px`.
- Layout: `grid`, `place-items: center`.
- Border: none.
- Radius: `7px`.
- Background: `var(--color-surface-8, #2c2c2c)`.
- Color: `#ffffff`.
- Icon: `ArrowUp` during idle, `Square` during streaming.
- During streaming, acts as a stop button that aborts via `AbortController`.

## File Attachments

Files dragged onto the composer area are captured via `tauri://drag-drop` Tauri events or HTML drag-and-drop.

- Supported: text files, images (PNG, JPG, GIF, SVG, WebP), PDFs, DOCX.
- DOCX files are converted to HTML via `mammoth`.
- File content is inlined as message context (120K character limit).
- Attached files are displayed as preview chips above the composer.
- File picker available via button or `/archivo` command.

## Tool Approval UI

When a risky tool (`writeFile`, `runCommand`, `terminal`) needs approval, an `ApprovalCards` component renders inline below the agent message:

- Shows tool name, description, and preview of the operation.
- Two buttons: **Approve** (executes the tool) and **Cancel** (rejects it).
- While pending, the spinner shows `approval` state (yellow).

## Sub-agent Output

When a `subagent` is invoked, a `SubagentCards` component renders inline:

- **Running**: shows agent type and activity spinner.
- **Error**: shows the error message.
- **Success**: shows the sub-agent's findings and completion status.

## AskUser Cards

When the `askUser` tool fires, `AskUserCards` renders inline option cards below the agent message:

- Each option is a clickable button.
- Supports single and multi-select.
- Response is sent back to the agent as structured input.

## Artifact Cards

Structured output (quotes, plans, TODOs) generates inline cards in the chat:

- **TodoCards**: shows TODO items with status indicators.
- **ChangeSummaryCard**: shows additions, deletions, and files changed after tool execution.

## Command Menu

Floating menu triggered by `/proveedor`, `/modelo`, or `/proyecto` commands in the input.

- Position: absolute below the composer.
- Left: `0`, right: `0`.
- Top: `calc(100% + 8px)`.
- Display: `none` by default, `grid` when `.is-open`.
- Gap: `8px`.
- Padding: `9px`.
- Border: none.
- Radius: `12px 12px 8px 8px`.
- Background: `#1A1A1A`.
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

## Custom Provider Configuration

When `Custom` provider is selected, a configuration panel appears:

- **URL**: OpenAI-compatible endpoint URL.
- **Header name**: Authorization header name (default: `Authorization`).
- **Body format**: JSON or XML request body format.
- **API Key**: credential input managed via `credential-menu-input`.

## Braille Spinner

Loading indicator shown during streaming.

- File: `src/components/ChatPanel.astro` (`.braille-spinner`)
- Font family: `ui-monospace, "SFMono-Regular", Consolas, monospace`.
- Line height: `1`.
- Font size: `18px` (via `::before`).
- Opacity: `0.78`.
- State colors:
  - Idle and working: `#F8EAD8` → `#FFF3DF`.
  - Successful tool: `#1687FF` → `#67BAFF`.
  - Error: `#FF7A45` → `#FFB77A`.
- The secondary color in each pair is used in the glow, keeping the state readable without changing the spinner glyph.

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

Agent states change the spinner color (see [spinner.md](spinner.md)).
