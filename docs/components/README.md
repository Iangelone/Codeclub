# Codeclub — Component Documentation

Open-source project. AI-powered desktop IDE, made in Argentina.

## Stack

- **Rust** — native backend, commands, filesystem, HTTP fetch, browser, WhatsApp.
- **Astro 7** — UI shell and static frontend structure.
- **React 19** — interactive components (chat, sidebar, panels, terminal).
- **Tailwind CSS 4** — utility-first styling with custom `@theme` tokens.
- **Bun** — JS runtime, package manager, scripts.
- **Tauri 2** — desktop window, native APIs, Rust bridge.

## Components

| Component | File | Description |
|---|---|---|
| [Topbar](topbar.md) | `src/components/Topbar.astro` | App menu bar, window controls, tools |
| [Sidebar](sidebar.md) | `src/components/Sidebar.tsx` | Left panel: projects, chats, file tree, settings |
| [Chat](chat.md) | `src/components/ChatPanel.astro`, `ChatInterface.tsx` | Main chat workspace, composer, command menu |
| [Dropdown](dropdown.md) | `src/pages/index.astro` | App menu dropdowns |
| RightSidebar | `src/components/RightSidebar.tsx` | Right panel: files, review, browser, artifacts, WhatsApp |
| TerminalDock | `src/components/TerminalDock.tsx` | Floating multi-tab terminal (PowerShell, CMD, Git Bash, WSL2) |
| WorkspaceManager | `src/components/WorkspaceManager.tsx` | Workspace orchestrator (project/chat/business mode) |

## Layout Shell

| File | Description |
|---|---|
| `src/pages/index.astro` | CSS Grid layout: topbar + left sidebar + workspace + right sidebar |
| `src/styles/global.css` | Tailwind `@theme` tokens, global classes, scrollbar styles, animations |

## Design Tokens

| Token | File |
|---|---|
| [Colors](color-tokens.md) | Complete palette with hex and usage |
| [Typography](typography.md) | Font stack, sizes, weights |
| [Layout](layout.md) | Body grid, multi-panel system, spacing |
| [Shadows](shadows.md) | Box shadows for every element |
| [CSS Custom Properties](css-custom-properties.md) | CSS variables mapped to usage |
| [Spinner](spinner.md) | Braille spinner palette and states |
| [Project Avatar](project-avatar.md) | Blue creature avatar, active/inactive states, and mouse tracking |
