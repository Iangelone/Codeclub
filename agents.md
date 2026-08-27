# Guide for agents and collaborators

This file explains how to work in Codeclub without breaking its architecture or visual identity.

## What Codeclub is

Codeclub is a local-first Windows desktop app for AI-assisted development. The renderer displays the interface; Electron performs native operations.

> Simple rule: React decides what to show, and Electron decides how to touch the system.

## Stack

| Area | Technology |
| --- | --- |
| UI | Next.js 16.3, React 19, TypeScript |
| Styling | Tailwind CSS 4 and project tokens |
| Desktop | Electron 43, Node.js, TypeScript |
| AI | AI SDK v7 and OpenAI-compatible providers |
| Terminal | @xterm/xterm, @xterm/addon-fit, node-pty |
| Editor | CodeMirror 6 |
| Data | Local filesystem, Electron storage, and localStorage for lightweight settings |

## Repository map

| Area | Main files |
| --- | --- |
| App shell | src/app/page.tsx, src/app/layout.tsx, src/app/globals.css |
| Layout | src/components/Topbar.tsx, SubTopbar.tsx, WorkspaceLayout.tsx |
| Workspace | src/components/WorkspaceManager.tsx, ChatPanel.tsx, ChatInterface.tsx |
| Extensions | src/components/ExtensionsPanel.tsx |
| Engine | src/lib/engine/ |
| Projects | src/lib/projectManager.ts |
| Runtime | src/lib/runtime.ts and electron/preload.cjs |
| Native process | electron/main.ts |

## Request flow

    user -> ChatInterface -> AI SDK / agent -> selected tool
         -> event or IPC -> Electron / Windows -> result and audit
         -> chat, artifact, or side panel

The renderer never uses Node.js directly. Native work goes through nativeInvoke and the preload bridge.

## Current product surface

- Global chats and project-specific chats.
- Left sidebar with Home, Tasks, Extensions, and visually disabled Devices.
- Resizable right sidebar with Files, Review, Browser, Artifacts, and Terminals.
- Project-scoped scheduled tasks with provider, model, prompt, frequency, and manual execution.
- Browser WebView with DOM selection, numbered comments, and chat references.
- Interactive PowerShell terminals backed by PTY.
- Global or project-filtered plugins, skills, and MCP servers.
- Spanish and English through src/lib/i18n.ts.
- Update indicator and full app reload from the topbar.

## UI conventions

- Keep surfaces #111111, #161616, #191919, and #1E1E1E.
- Keep borders #202020, #2B2B2B, and #2C2C2C.
- Keep accents #8BC7FF, #3D9BFF, and #1687FF.
- Prefer compact, gray, minimal controls.
- Use Motion only for subtle transitions and resizing.
- Preserve the minimum width of the central panel.
- Every icon-only control needs aria-label and title.
- Do not add a native dropdown where a shared visual selector already exists.

## Language and events

Use the shared catalog in src/lib/i18n.ts and useAppLanguage() for shared UI. New internal events must start with codeclub:. Document their emitter, detail payload, consumers, and listener cleanup. Install and remove listeners in the same useEffect.

## Persistence and safety

- Never save API keys in messages, logs, or artifacts.
- Validate paths and prevent access outside the active project.
- Keep global data separate from project data.
- Refresh UI after native mutations through events.
- Do not use destructive commands without confirming the exact target.

## Commands

    npm install
    npm run dev
    npm run next:dev
    npm run next:build
    npm run electron:compile
    npm run electron:dev
    npm run desktop:build
    npm run package:win

## Releases and verification

package:win creates the Windows installer in release/. Releases start from a vX.Y.Z tag and are published by .github/workflows/release.yml. Never commit release artifacts or credentials. If the version changes, update package.json and package-lock.json together.

Before delivery, run next:build, electron:compile, and git diff --check. Also test language switching, project changes and persistence, sidebar resizing, tools, browser selection, terminal behavior, focus, labels, and empty states.

## Next.js rule

Before changing Next.js APIs or conventions, consult the installed guides in node_modules/next/dist/docs/. This version may differ from familiar Next.js behavior.
