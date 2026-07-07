# CSS Custom Properties

Defined in the `:root` block of `src/pages/index.astro`.

```css
:root {
  --color-bg: #111111;
  --color-surface-0: #101010;
  --color-surface-1: #121212;
  --color-surface-2: #161616;
  --color-surface-3: #191919;
  --color-surface-4: #1a1a1a;
  --color-surface-5: #1c1c1c;
  --color-surface-6: #1e1e1e;
  --color-surface-7: #202020;
  --color-surface-8: #2b2b2b;
  --color-surface-9: #2c2c2c;
  --color-surface-10: #2f2f2f;
}
```

## Usage Map

| Variable | Value | Used In |
|---|---|---|
| `--color-bg` | `#111111` | `body::before` background (main surface), topbar fallback. |
| `--color-surface-0` | `#101010` | Unused in current components. Reserved token. |
| `--color-surface-1` | `#121212` | Composer box background, dropdown background, command menu background. |
| `--color-surface-2` | `#161616` | Sidebar background. |
| `--color-surface-3` | `#191919` | Command search input background. |
| `--color-surface-4` | `#1a1a1a` | Unused in current components. Reserved token. |
| `--color-surface-5` | `#1c1c1c` | Active project row background. |
| `--color-surface-6` | `#1e1e1e` | Unused in current components. Reserved token. |
| `--color-surface-7` | `#202020` | Tool buttons hover, menu hover, dropdown item hover, focus-visible background, user message bubble background. |
| `--color-surface-8` | `#2b2b2b` | Send button background. |
| `--color-surface-9` | `#2c2c2c` | Sidebar footer border, composer border, command menu border, composer box border fallback. |
| `--color-surface-10` | `#2f2f2f` | Dropdown border, sidebar right border, topbar bottom border. |

Note: `--color-surface-0`, `--color-surface-4`, and `--color-surface-6` are defined but not currently referenced in any component style. They exist as reserved tokens for future use.
