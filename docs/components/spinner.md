# Spinner

The composer braille spinner uses a pastel palette that auto-cycles when idle and changes to a fixed color based on agent state.

## Idle Palette (auto-cycle)

- `#C7CBFF` — lavender base.
- `#7DD3FC` — cyan.
- `#86EFAC` — green.
- `#FDE68A` — yellow.
- `#F9A8D4` — pink.
- `#D8B4FE` — violet.

Transitions every `10s` with `ease-in-out`.

## Agent States

| State | Color | Description |
|---|---|---|
| `idle` | Cycling pastel | No active generation. Auto-transitions through the palette. |
| `streaming` | `#7DD3FC` | Model is generating text. |
| `tool_call` | `#86EFAC` | Agent is executing a tool. |
| `approval` | `#FDE68A` | Awaiting human approval for a risky tool. |
| `running` | `#D8B4FE` | Tool is running (e.g., terminal, sub-agent). |
| `error` | `#FCA5A5` | An error occurred during generation. |

The spinner does not use a glow shadow for state colors — only the base idle palette has glow. State colors are flat and rely on the braille glyph animation.

## Animation

Braille glyph cycle every `880ms`:

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

Font: `ui-monospace, "SFMono-Regular", Consolas, monospace`, line-height: `1`, font-size: `18px`, opacity: `0.78`.

## Source

- `AnimatedBraille` component in `src/components/ChatInterface.tsx`.
- Styled in `src/components/ChatPanel.astro` (`.braille-spinner`).
