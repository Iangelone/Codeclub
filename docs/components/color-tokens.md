# Color Tokens

All hex values used across the app UI.

## Surface Colors

| Hex | Token | Usage |
|---|---|---|
| `#111111` | `--color-bg` | Base app background. Main surface behind all content. |
| `#101010` | `--color-surface-0` | Deepest surface. |
| `#121212` | `--color-surface-1` | Low surface. Composer background, dropdown background, command menu background. |
| `#161616` | `--color-surface-2` | Raised surface. Sidebar background. |
| `#191919` | `--color-surface-3` | Panel surface. Command search input background. |
| `#1A1A1A` | `--color-surface-4` | Active surface. Command menu background. |
| `#1C1C1C` | `--color-surface-5` | Hover surface. Active project row background. |
| `#1E1E1E` | `--color-surface-6` | Selected surface. |
| `#202020` | `--color-surface-7` | Interactive hover. Tool buttons hover, menu hover, dropdown item hover, user message bubble background, command item hover. |
| `#2B2B2B` | `--color-surface-8` | Subtle border. Send button background. |
| `#2C2C2C` | `--color-surface-9` | Clear border. Sidebar footer border, composer border, command menu border. |
| `#2F2F2F` | `--color-surface-10` | Strongest dark border. Dropdown border, sidebar right border, topbar bottom border, scrollbar track. |

## Text Colors

| Hex | Usage |
|---|---|
| `#dedede` | Body text. |
| `#eeeeee` | Active/hover text. Chat message text, active project row, active chat row, command item text, input text. |
| `#d8d8d8` | Primary UI text. Tool buttons, toolbar icons, menu labels, window controls, panel action buttons, project rows, input text. |
| `#bdbdbd` | Dropdown item text. |
| `#9f9f9f` | Muted labels. Sidebar label, section heading. |
| `#8f8f8f` | Placeholder text. |
| `#cfcfcf` | Project input row text. |
| `rgba(216, 216, 216, 0.82)` | Status text ("Listo cuando tú lo estés.", "Generando..."). |
| `rgba(216, 216, 216, 0.62)` | Chat row text (inactive). |
| `rgba(216, 216, 216, 0.42)` | Provider/model status text. |
| `rgba(216, 216, 216, 0.36)` | Command item type label. |
| `rgba(216, 216, 216, 0.24)` | Provider/model separator `/`. |
| `rgba(238, 238, 238, 0.78)` | Command item text. |
| `#777777` | Credential input placeholder. |

## Interactive Colors

| Hex | Usage |
|---|---|
| `#ffffff` | Hover text in dropdown items, window close button hover text, send button icon. |
| `rgba(255, 255, 255, 0.02)` | Sidebar button hover (panel actions, project rows, chat rows, footer). |
| `rgba(255, 255, 255, 0.05)` | Active chat row background. |
| `rgba(255, 255, 255, 0.1)` | New chat button hover background. |
| `#c42b1c` | Window close button hover background. |
| `rgba(17, 17, 17, 0.48)` | Topbar background (Windows Mica overlay). |
| `rgba(22, 22, 22, 0.48)` | Acrylic panel background. |

## Terminal Colors

| Hex | Usage |
|---|---|
| `#1a1a1a` | Terminal background. |
| `#3A3A3A` | File preview scrollbar base. |
| `#505050` | File preview scrollbar hover. |
| `#2F2F2F` | Terminal scrollbar track. |
| `#444444` | Terminal scrollbar hover. |

## Tool Approval Colors

| Hex | Usage |
|---|---|
| `#86EFAC` | Tool call indicator (green). |
| `#FDE68A` | Approval pending indicator (yellow). |
| `#D8B4FE` | Tool running indicator (purple). |
| `#FCA5A5` | Error indicator (red). |

## Spinner and Interaction Colors

| State | Primary | Glow |
|---|---|---|
| Idle / working | `#F8EAD8` | `#FFF3DF` |
| Successful tool | `#1687FF` | `#67BAFF` |
| Error | `#FF7A45` | `#FFB77A` |

## Business Dashboard Tokens

The Business dashboard uses one semantic source of truth: `src/lib/business-tokens.ts`. Charts, KPI cards, status indicators, progress bars, tables and activity history reference these names instead of repeating hex values.

| Token | Hex | Meaning |
|---|---|---|
| `electricBlue` | `#1687FF` | Primary positive result, revenue and completed work. |
| `softBlue` | `#67BAFF` | Supporting metrics, impact and activity. |
| `warmIvory` | `#F8EAD8` | Neutral highlights and internal activity. |
| `lightCream` | `#FFF3DF` | Accepted/contracted or secondary positive state. |
| `electricOrange` | `#FF7A45` | Attention, risk or negative result. |
| `softPeach` | `#FFB77A` | Softer warning and internal cost state. |

## Syntax Highlighting Palette

Material Theme / Material Palenight colors used by Markdown code blocks and the Files viewer:

| Hex | Syntax role |
|---|---|
| `#C792EA` | Keywords, control flow, language constructs. |
| `#82AAFF` | Functions and function calls. |
| `#C3E88D` | Strings, template values and attributes. |
| `#F78C6C` | Numbers, variables and regular expressions. |
| `#FFCB6B` | Built-ins, types and classes. |
| `#7F8C98` | Comments and quoted documentation. |
| `#89DDFF` | Metadata and symbols. |
| `#151515` | Code block background. |
| `#2B2B2B` | Code block border. |

## Spinner Agent States

| State | Color | Hex |
|---|---|---|
| `idle` | Pastel cycle | `#C7CBFF` → `#7DD3FC` → `#86EFAC` → `#FDE68A` → `#F9A8D4` → `#D8B4FE` |
| `streaming` | Cyan | `#7DD3FC` |
| `tool_call` | Green | `#86EFAC` |
| `approval` | Yellow | `#FDE68A` |
| `running` | Purple | `#D8B4FE` |
| `error` | Red | `#FCA5A5` |
