# Project Stack

AI-focused IDE made in Argentina. Open source, simple by design.

## Architecture

```
src/pages/index.astro            → App shell (Astro, CSS Grid layout)
  ├── Topbar.astro               → App menu bar with window controls
  ├── Sidebar.tsx                → Left panel: projects, chats, files
  ├── ChatPanel.astro            → Chat wrapper (hosts ChatInterface)
  ├── RightSidebar.tsx           → Right panel: files, review, browser, artifacts
  └── TerminalDock.tsx           → Floating terminal (multi-tab, draggable)

src/lib/engine/                  → AI execution layer
  ├── types.ts                   → ToolEvent, ToolContext, EngineCallbacks
  ├── tools.ts                   → createTools, development tool router
  ├── run.ts                     → runStream (streamText wrapper)
  ├── memory.ts                  → Persistent agent memory
  └── planning.ts                → Plans, TODOs, agent state

src-tauri/src/lib.rs             → Rust backend (Tauri commands)
```

### Data Flow

```
User message → ChatInterface.tsx
  → resolveToolsWithAI (AI-powered tool selection)
  → runStream({ model, system, messages, tools, callbacks })
    → streamText (AI SDK v7)
    → Tool execution → Tauri invoke → Rust command → Native OS
  → verifyToolExecutionWithAI (AI-powered verification)
  → Record to usage.jsonl + execution.jsonl
  → UI updates via custom events (codeclub:*)
```

### Event System

Components communicate via custom DOM events (`window.dispatchEvent` / `window.addEventListener`) using the `codeclub:` namespace. Backend-to-frontend communication uses Tauri events (`listen` from `@tauri-apps/api/event`).

### Persistence

All data stored locally in OS app config/cache directories (`appConfigDir`, `appCacheDir` via Tauri).

| File | Location | Content |
|---|---|---|
| `settings.json` | appConfigDir | User settings (API keys, preferences) |
| `projects.json` | appConfigDir | Project index (with backup) |
| `meta.json` | appConfigDir / project key | Project metadata, chat list |
| `agent-state.json` | appConfigDir / project key | Plans, TODOs |
| `usage.jsonl` | appConfigDir / project key | Generation usage (tokens, cost, duration) |
| `execution.jsonl` | appConfigDir / project key | Tool execution audit log |
| `persistence-log.jsonl` | appCacheDir | Persistence diagnostics |

## Color Tokens

- UI accent gradient: electric blue palette `#8BC7FF`, `#3D9BFF`, `#1687FF`, with deeper variants `#237BFF`, `#1469E8`, and `#385FEF`. Use this palette for interactive accents, avatars, buttons, glows, and browser cursors.
- Syntax highlighting uses the Material Theme / Material Palenight palette: `#C792EA`, `#82AAFF`, `#C3E88D`, `#F78C6C`, `#FFCB6B`, `#7F8C98`, and `#89DDFF`.
- `#111111` -> base app background.
- `#101010` -> deepest surface.
- `#121212` -> low surface.
- `#161616` -> raised surface.
- `#191919` -> panel surface.
- `#1A1A1A` -> active surface.
- `#1C1C1C` -> hover surface.
- `#1E1E1E` -> selected surface.
- `#202020` -> elevated border surface.
- `#2B2B2B` -> subtle border.
- `#2C2C2C` -> clear border.
- `#2F2F2F` -> strongest dark border.

## Tech Stack

- Rust: https://doc.rust-lang.org/ - Native backend, commands, filesystem, and performance logic.
- Astro 7: https://docs.astro.build/ - UI shell and static frontend structure.
- React 19: https://react.dev/ - Interactive components (chat, sidebar, panels, terminal).
- Tailwind CSS: https://tailwindcss.com/docs - App styling, layout, spacing, and design tokens.
- Node.js: https://nodejs.org/docs - JavaScript runtime.\n- npm: https://docs.npmjs.com - package manager and script runner.
- Tauri 2: https://v2.tauri.app/ - Desktop window, native APIs, packaging, and Rust bridge.
- Models.dev: https://models.dev/models/ - An open-source database of AI models.
- AI SDK v7: https://ai-sdk.dev/docs/introduction - The TypeScript toolkit designed to help developers build AI-powered applications and agents with React, Next.js, Vue, Svelte, Node.js, and more.

## Key Libraries

- **CodeMirror 6** — Code editor with syntax highlighting
- **xterm.js 6** — Terminal emulator
- **Recharts 3** — Business dashboard charts
- **react-markdown + remark-gfm** — Markdown rendering
- **mammoth** — DOCX conversion
- **lucide-react / lucide-astro** — Icons

## Commands

- `npm run dev` -> build Next.js and start the Electron desktop app.
- `npm run next:dev` -> optional renderer-only development server.
- `npm run desktop:build` -> build Next.js and compile Electron.
- `npm install` -> install dependencies.
- `npm run electron:dev` -> start the Electron shell.
- `npm run web:dev` -> start Astro dev server during transition.
- `npm run web:build` -> build the legacy frontend.





<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->


