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

> Android QR connectivity and automatic task execution remain future work until their backend/runtime is complete.

## Change style

Use apply_patch, prefer small reversible changes, avoid unnecessary dependencies, and document events and persistence when adding a feature.
