# Development and releases
## Requirements

- Windows.
- Node.js 24 and npm 11 recommended.
- Dependencies installed with npm install.

## Commands

| Command | Use |
| --- | --- |
| npm run dev | Next.js and Electron in development. |
| npm run next:dev | Renderer only. |
| npm run electron:dev | Compile Electron and open the app. |
| npm run next:build | Build the renderer. |
| npm run electron:compile | Compile Electron TypeScript. |
| npm run desktop:build | Full desktop build. |
| npm run package:win | Create the Windows NSIS installer in release/. |

## Minimum verification

    npm run next:build
    npm run electron:compile
    git diff --check

Then manually exercise chat, project switching, persistence, right-sidebar resizing, browser selection and references, artifacts, terminals, both languages, updates, reload, and window controls.

## Release workflow

The version lives in package.json and package-lock.json. Build and install locally before changing it for a release.

    npm install
    npm run package:win

The installer appears at `release/Codeclub Setup.exe`. The package script builds Next.js, compiles Electron, and runs electron-builder for Windows x64 with publishing disabled. The build also produces `latest.yml` and the blockmap required by `electron-updater`.

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
