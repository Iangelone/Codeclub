# Project Avatar

The project avatar is the reusable Codeclub “little creature” used for project selection. Keep this visual language consistent across the app.

## Shape

- Container: `32px × 32px`, `border-radius: 11px`.
- Face: two small vertical white capsule eyes, one on each side.
- Eyes: `4px × 10px`, positioned at `left: 8px` and `right: 8px`, `top: 7px`.
- There is intentionally no mouth.
- The avatar uses CSS shapes, not a raster image, so it stays sharp at every scale.

## Active state

Use one of the blue electric gradients below. The gradient may vary deterministically by project name, but it must remain in this blue family:

```css
background: linear-gradient(145deg, #8BC7FF 0%, #3D9BFF 44%, #1687FF 100%);
```

Active avatars use:

```css
box-shadow:
  inset 0 1px 2px rgba(255, 255, 255, 0.5),
  0 0 12px rgba(45, 145, 255, 0.42);
```

Eyes are `#ffffff`.

## Inactive state

- Background: `#343434`.
- Eyes: `#666666`.
- Keep the subtle inset highlight, but remove the blue glow.

## Interaction

Only the selected project tracks the mouse. Use one listener on the containing panel and one `ref` for the selected avatar; do not attach independent listeners to every project avatar.

Clamp the eye translation so the eyes never leave the avatar:

```ts
const eyeX = Math.max(-2, Math.min(2, normalizedX * 4));
const eyeY = Math.max(-1.5, Math.min(1.5, normalizedY * 3));
```

When the pointer leaves the panel, reset `--eye-x` and `--eye-y` to `0px`. Clicking outside a project clears selection and returns the avatar to the inactive state.

## Current implementation

- `src/components/ProjectsPanel.tsx`
- `src/styles/global.css`

