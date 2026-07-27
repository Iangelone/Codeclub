# CSS Custom Properties

Defined in the `@theme` block of `src/styles/global.css` (Tailwind 4), with additional runtime variables set inline in `src/pages/index.astro`.

## Tailwind Theme Tokens

```css
@theme {
  --color-bg: #111111;
  --color-surface-0: #101010;
  --color-surface-1: #121212;
  --color-surface-2: #161616;
  --color-surface-3: #191919;
  --color-surface-4: #1A1A1A;
  --color-surface-5: #1C1C1C;
  --color-surface-6: #1E1E1E;
  --color-surface-7: #202020;
  --color-surface-8: #2B2B2B;
  --color-surface-9: #2C2C2C;
  --color-surface-10: #2F2F2F;
}
```

## Usage Map

| Variable | Value | Used In |
|---|---|---|
| `--color-bg` | `#111111` | `body::before` background (main surface), `html, body` background, topbar fallback, workspace background. |
| `--color-surface-0` | `#101010` | Deepest surface (reserved). |
| `--color-surface-1` | `#121212` | Composer box background, dropdown background, command menu background. |
| `--color-surface-2` | `#161616` | Sidebar background. |
| `--color-surface-3` | `#191919` | Command search input background. |
| `--color-surface-4` | `#1A1A1A` | Command menu background, active surface. |
| `--color-surface-5` | `#1C1C1C` | Active project row background. |
| `--color-surface-6` | `#1E1E1E` | Selected surface (reserved). |
| `--color-surface-7` | `#202020` | Tool buttons hover, menu hover, dropdown item hover, focus-visible background, user message bubble background. |
| `--color-surface-8` | `#2B2B2B` | Send button background. |
| `--color-surface-9` | `#2C2C2C` | Sidebar footer border, composer border, command menu border. |
| `--color-surface-10` | `#2F2F2F` | Dropdown border, sidebar right border, topbar bottom border, custom scrollbar track. |

## Runtime Panel Variables

Set via JavaScript in `index.astro`:

| Variable | Default | Description |
|---|---|---|
| `--left-panel-width` | `264px` | Left sidebar width (updated on resize). |
| `--right-panel-width` | `35vw` | Right panel width (updated on right panel resize via RightSidebar). |

These variables drive the dynamic grid layout:

```css
body.has-sidebar.has-right-panel {
  grid-template-columns: var(--left-panel-width, 264px) minmax(0, 1fr) var(--right-panel-width, 35vw);
}
```
