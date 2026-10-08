# Fluid orb and shared palette

Codeclub's orb is an animated sphere drawn with WebGL. Its pattern—a white area and a blue area separated by an irregular, cloud-like boundary—is generated procedurally in the shader; it is not a texture or raster image. The reusable component is `src/components/ui/fluid-orb.tsx`.

- **`FluidOrb`** draws the orb and retains the visual API: `size`, `color`, `shape`, `animateOnHover`, and `active`. It uses WebGL when available and a CSS gradient fallback if the shader cannot be created or compiled.
- **`OrbPaletteProvider`** (`src/components/OrbPaletteProvider.tsx`) maintains the global color, next palette, and persistence. It wraps the app from `src/app/layout.tsx`; every `useOrbPalette()` consumer must be inside it.
- **`OrbPaletteButton`** (`src/components/ui/OrbPaletteButton.tsx`) presents a clickable orb with an accessible label announcing the next color. Activating it advances the global palette. Clicking does not steal focus from the text field or start dragging the widget.
- **Motion** animates the orb's hue filter, app CSS variables, and the button's scale response. Transitions respect `prefers-reduced-motion`.

The orb used as a selector shows the current palette. Other `FluidOrb` instances inside the provider tree also receive the global filter, even when they are not buttons.

## How the pattern is generated

1. The vertex shader draws a rectangle covering the canvas.
2. The fragment shader creates procedural noise using `hash`, `noise`, and three `fbm` octaves. Two noise fields warp a third (`warp`) while `u_time` slowly moves the pattern.
3. In circular shape, `gradient`, `anchor`, and `shade` keep white at the top and blue at the bottom, with an organic boundary. The factor `(fluid - 0.5) * 0.8` controls how much that boundary undulates. Do not replace these calculations with a flat horizontal split: they define the orb's look.
4. UV coordinates become a disk. Pixels outside the radius are discarded, and `sqrt(1.0 - radiusSquared)` reconstructs surface depth and normal.
5. Diffuse light, specular reflection, and a soft rim add volume without obscuring the pattern. Keep `diffuse`, `specular`, and `rim` subtle.

The `rect` shape retains the rectangular gradient and applies no mask or sphere shading. `color` is received as hex, and `hexToRgb` converts it to RGB for `u_color`.

## Shared palette and UI colors

The nine palettes are defined in `ORB_PALETTES` in this cycle order:

| Index | Name | Orb tone (`orb`) | Accent (`accent`) |
| --- | --- | --- | --- |
| 0 | Blue | `#2D5FD6` | `#3D9BFF` |
| 1 | Red | `#D63D52` | `#F04E65` |
| 2 | Yellow | `#D6A317` | `#E8B930` |
| 3 | Violet | `#7543D6` | `#9C6AFF` |
| 4 | Green | `#21845A` | `#39B77C` |
| 5 | Orange | `#D6752B` | `#F0893A` |
| 6 | Pink | `#D64A9E` | `#F15BB9` |
| 7 | Cyan | `#228FAD` | `#31B4D5` |
| 8 | Lime | `#8CAB20` | `#B4D43A` |

Each entry also has `bright` for light accents, `electric` for electric UI variables, and `hue` for transforming the shader with CSS. `hue-rotate` keeps white white and recolors the pigmented area and fallback. If palettes are added or reordered, update tests/visual references and keep valid indices in the main process.

Current buttons are in:

- **Main input:** `ChatInterface.tsx`.
- **Floating widget:** the collapsed orb and composer button in `FloatingChat.tsx`.
- **Empty workspace state:** `WorkspaceLayout.tsx`.
- **Preview:** `src/app/orb-preview/page.tsx`.

Changing the palette from any of these buttons updates the other orbs, accents, borders, and gradient surfaces together. Relevant styles are in `src/app/globals.css` and `src/components/floating-chat.css`:

- `--nexo-orb-blue`: main tone for the composer, graphite, and some backgrounds.
- `--codeclub-accent` and `--codeclub-accent-bright`: borders, focus states, and accents.
- `--electric-blue` and `--nexo-electric-blue`: electric UI details.
- `--codeclub-chat-glow`: alpha color used by the radial chat and widget glow.

Variables animate in the provider's `motion.div` wrapper. For an interpolable gradient to respond to changes, reference these variables in the component rule rather than calculating the gradient once in `:root`. `@property` registers animated color variables. New themed backgrounds should use the appropriate variable rather than hard-coded blue.

### Orb background gradient

The reference background for the preview and widget is:

```css
radial-gradient(ellipse at 30% 110%, var(--codeclub-chat-glow), transparent 55%),
#111315
```

The glow begins below and slightly left of center (`30% 110%`), fades to transparent at `55%`, and sits over dark `#111315`. `--codeclub-chat-glow` uses the active palette color at alpha `0.2`, so the gradient follows the orb while remaining subtle. The recipe is applied in `src/app/orb-preview/page.tsx`, `src/app/globals.css`, and `src/components/floating-chat.css`. Keep its position, transparency stop, and dark base consistent so the preview and widget match.

## Persistence and events

- The `localStorage` key is `codeclub:orb-palette-index`. It stores an integer from `0` to `8`; missing or invalid values fall back to index `0` (blue).
- The provider applies the initial index on mount and maintains a synchronous reference so rapid clicks are not skipped or lost.
- The renderer event `codeclub:orb-palette-change` is a `CustomEvent` with `detail: { index: number }`. `cyclePalette` persists the value, updates the local UI, and dispatches it.
- The browser `storage` event synchronizes tabs from the same origin.
- Since the widget can live in another Electron window, `window.codeclub.broadcastOrbPalette(index)` sends IPC `codeclub:orb-palette-change` through `electron/preload.cjs`. `electron/main.ts` relays only integer indices from `0–8` to other active windows; each preload receives the index and the provider turns it into a local renderer event.
- DOM, `storage`, and IPC listeners are registered in the provider's same `useEffect` and removed in its cleanup. The preload returns an unsubscribe function to remove its IPC listener.

When changing the range or channel name, update both provider normalization and IPC validation in `electron/main.ts`. Internal events must keep the `codeclub:` prefix and document emitter, payload, consumers, and cleanup here.

## Performance, compatibility, and motion

- The canvas caps DPR at `2`, uses `requestAnimationFrame` and `IntersectionObserver`, and stops drawing when the window/tab is hidden, the canvas leaves the viewport, `active` is false, or reduced motion is enabled.
- `animateOnHover` limits procedural animation to hover. Do not enable continuous animation for decorative orbs outside the viewport.
- If WebGL, the program, or shader fails, `FluidOrb` shows a CSS gradient. Keep this fallback when editing the component.
- The color filter and transitions use Motion. With reduced motion, transitions have zero duration and the button omits hover/tap scaling.
- Buttons must keep translated `aria-label` and `title`, a visible focus indicator, and a click target appropriate for their size.

## Changing the appearance

- **More or fewer clouds:** adjust `(fluid - 0.5) * 0.8` in `shade`; higher values make the boundary more irregular.
- **Speed:** adjust `u_time * 0.22` and the `drift` offset.
- **Volume:** adjust `diffuse` first; keep `specular` and `rim` low.
- **Color or palette:** edit `ORB_PALETTES` and check that the orb, accents, and gradients change together from each location.
- **Color transition:** adjust Motion duration/easing in the provider and `FluidOrb`; keep them coordinated so the sphere and backgrounds feel like one transition.
- **Size and shape:** pass `size` and `shape` to the shared component. Do not duplicate or copy the shader per surface.

## Preview and verification

The local preview URL is **http://127.0.0.1:3001/orb-preview/**. If the server is not running, start it with `npm run next:dev -- --port 3001`; if Next reports a busy port, open `/orb-preview/` on the port it reports. The page includes an interactive `180px` orb and the same radial background gradient described above. Test all nine steps back to blue, persistence after reload, and synchronization in another tab; in Electron, also check synchronization with the widget window.

For shader or palette changes, run the project's usual checks: `npm run next:build`, `npm run electron:compile`, and `git diff --check`. Visually review the pattern, fallback, gradients, and reduced-motion behavior.
