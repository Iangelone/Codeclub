# Development and releases
## Requirements

- Windows.
- Node.js 24 and npm 11 recommended.
- Dependencies installed with npm install.

## Commands

| Command | Use |
| --- | --- |
| npm run dev | Next.js and Electron in development. |
| npm run desktop:debug | Start Next.js and Electron with DevTools and Windows accessibility support. |
| npm run test:debug | Verify the native debug mode in a temporary isolated profile. |
| npm run test:accessibility | Run browser keyboard and modal regressions after building the renderer. |
| npm run next:dev | Renderer only. |
| npm run electron:dev | Compile Electron and open the app. |
| npm run next:build | Build the renderer. |
| npm run electron:compile | Compile Electron TypeScript. |
| npm run desktop:build | Full desktop build. |
| npm run typecheck | Generate Next.js route types, then check renderer and native TypeScript without emitting compiled files. |
| npm run test:core | Catalog, agent, overlay, native commands/plugins, chat history/UI, file editor/previews and accessibility regressions; requires a built renderer and compiled Electron. |
| npm run verify | Typecheck, desktop build and core regressions in sequence. |
| npm run package:win | Create the Windows NSIS installer in build/release/. |

Development uses `.next/`, while production export uses `build/renderer/`. Their outputs remain separate so building does not remove the running development server's cache. Desktop startup waits for an HTTP success response before opening Electron.

## Repository layout and generated files

Keep application code in `src/` and `electron/`, companion code in `browser-extension/` and `android-companion/`, maintenance tools in `scripts/`, and project guidance in `docs/`. Package manifests, Next.js/PostCSS/TypeScript/Vercel configuration, README, license and agent instructions remain at the root so the existing tooling can discover them.

| Generated path | Contents |
| --- | --- |
| `build/renderer/` | Exported desktop renderer and production web assets. |
| `build/electron/` | Compiled native TypeScript; package.json points to its main.js. |
| `build/release/` | Windows installer, unpacked app, updater files and browser-extension upload ZIP. |
| `build/cache/` | TypeScript incremental cache. |
| `build/extension-signing/` | Preserved local CRX/private signing material; ignored and never packaged or committed. |

`build/` is ignored by Git. `.next/` and `node_modules/` remain at the root as tool-owned directories. This installed Next.js version uses `.next/` internally during static-export builds even when `distDir` selects `build/renderer/`; do not patch dependencies or move its active cache just to hide the directory. Next.js also generates route types and next-env.d.ts, so typecheck runs typegen first. The empty contracts directory, obsolete dist/Astro output and old release-test profiles were moved out of the repository to a local temporary backup after permanent deletion was blocked by automatic policy review. Extension signing material remains under build/. Restart a running development app after changing native build paths.

Electron derives the shared `build/` root from `build/electron/main.js`, both in development and inside app.asar. Its preload/helper assets still resolve from the app's `electron/` directory and renderer windows load `build/renderer/index.html`. Keep those paths aligned with the package file list and test launchers.

The web deployment configuration also names `build/renderer` as its output directory; see [Vercel's outputDirectory configuration](https://vercel.com/docs/project-configuration/vercel-json#outputdirectory). Changing this local configuration does not deploy the site.

Local layout verification on 2026-10-13 passed `npm run verify`, the debug/preload test and real PTY terminal UI test. Windows packaging generated `build/release/Codeclub Setup.exe`; inspecting app.asar confirmed the native entry, renderer, preload and icon while excluding local legacy/test/signing directories. `test:packaged-win` then passed startup, native PowerShell, project persistence, language switching, sidebar resizing, focus and browser selection. Its stale browser-comment label was updated to the current UI; production UI behavior was unchanged. The browser-extension ZIP also built at the new release path. These checks did not publish or install a release or deploy Vercel.

## Minimum verification

    npm run next:build
    npm run electron:compile
    git diff --check

Next.js type validation is enabled: production builds fail on TypeScript errors. Use `npm run verify` for the automated baseline. `.github/workflows/verify.yml` runs this baseline on pull requests and branch pushes with Windows/Node.js 24. The release workflow checks types, builds the installer and runs the core regressions before publishing. No real AI credentials are needed for these fixtures; UI tests use installed Microsoft Edge. Passing locally does not confirm a GitHub Actions run until that workflow executes.

`scripts/test-computer-overlay.mjs` tests the actual extracted controller against isolated window/mouse-hook fixtures, including full-display coverage, partial output, context actions, palette refresh, Escape and cleanup. It never starts a real mouse hook or controls the user's desktop. This complements the native-command and UI tests; it does not certify visual behavior on every physical monitor.

Then manually exercise chat, project switching, persistence, right-sidebar resizing, browser selection and references, artifacts, terminals, both languages, updates, reload, and window controls.

## Release workflow

The version lives in package.json and package-lock.json. Build and install locally before changing it for a release.

    npm install
    npm run package:win

The installer appears at `build/release/Codeclub Setup.exe`. The package script builds Next.js, compiles Electron, and runs electron-builder for Windows x64 with publishing disabled. The build also produces `latest.yml` and the blockmap required by `electron-updater`.

After verification, push a `vX.Y.Z` tag. The release workflow builds on windows-latest and publishes the installer, blockmap, `latest.yml`, builder diagnostics, hashes, and source code. Normal users only need the `.exe`; future installers are detected automatically through GitHub Releases and installed when the app restarts.

## Known issues

- preload.cjs must be included in build.files or the installed app cannot use its Electron bridge.
- OneDrive can lock temporary files during local builds; use an output directory outside the project when needed.
- GitHub Actions needs contents: write, already declared in the workflow. Never store tokens in the repository.

> Devices remains disabled; Android QR connectivity has no active runtime. Scheduled tasks run while Codeclub is open; see [scheduled tasks](schedule.md).

## Change style

Use apply_patch, prefer small reversible changes, avoid unnecessary dependencies, and document events and persistence when adding a feature.

## Accessibility conventions

- Every icon-only button has aria-label and title.
- Tabs use role=tab, aria-selected, and aria-controls.
- Menus use role=menu and role=menuitem where appropriate.
- Decorative icons use aria-hidden=true.
- Inputs have a visible label or aria-label.
- Resize handles expose orientation and ARIA values.
- Empty states explain what to do next.
- Visible focus uses the electric accent.

## Stable IDs

Do not change these without updating tools that inspect the DOM:

| ID | Region |
| --- | --- |
| codeclub-left-sidebar | left sidebar |
| codeclub-right-sidebar | right sidebar |
| codeclub-terminal-panel | terminal |
| codeclub-browser-address | browser address bar |

## Checklist

- [ ] Can it be reached with Tab?
- [ ] Is focus visible?
- [ ] Does the screen reader know its name, role, and state?
- [ ] Can Computer Use find it by label, role, or ID?
- [ ] Does the UI explain errors and empty states?
- [ ] Does language switching translate accessible labels too?
- [ ] Does the overlay avoid blocking scrolling or selection?

Avoid clickable divs without keyboard support, unnamed inputs, selectors based only on classes or position, changing text or IDs without reviewing tools, aria-hidden on interactive elements, and animations that make the interface hard to use.
