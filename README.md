# Codeclub
> A local-first desktop workspace for building software with AI agents.

Codeclub brings chat, projects, terminals, a browser, development tools, and visible work evidence into one focused Windows app. It is designed to make agent-assisted development practical: the agent can help, while the person stays in control.

[![Status](https://img.shields.io/badge/status-beta-3d9bff)](#status) [![Platform](https://img.shields.io/badge/platform-Windows-1687ff)](#requirements)

## In plain terms

Open a project, talk to the agent, and ask it to work on your code. It can inspect files, search text, edit, use the terminal, browse a page, and leave plans or TODOs that remain visible in the workspace.

Codeclub runs locally and stores chats, projects, settings, usage data, and logs in Electron storage. Your working data does not depend on a Codeclub-hosted server.

## What it includes today

### Chat and agent

- Streaming responses powered by AI SDK v7.
- OpenAI-compatible providers and models.
- Dynamic model and provider discovery.
- Tool selection based on each prompt's intent.
- Plans, TODOs, task status, and artifacts.
- Global history and project-scoped chats.
- Text, image, PDF, and DOCX attachments.
- Visual references from the embedded browser.
- Human confirmation for sensitive operations.

### Workspace

| Area | Purpose |
| --- | --- |
| Left sidebar | Home, recent chats, projects, Tasks, Extensions, and the visually disabled Devices area. |
| Main panel | Chat, Extensions, Tasks, and the Devices view prepared for a future QR flow. |
| Right sidebar | Files, Review, Browser, Artifacts, and Terminals. |
| Topbar | Projects, navigation, panels, updates, and window controls. |

Both sidebars can be resized. The main panel keeps a minimum width so the workspace remains usable.

### Side tools

- **Files:** project tree, search, file opening, and previews.
- **Review:** workspace changes and Git status.
- **Browser:** an Electron WebView with URL controls, navigation, reload, and external opening.
- **DOM selection:** select an element, add a comment, and send it to chat as a reference.
- **Artifacts:** agent-created plans and TODOs, filterable and persistent per project.
- **Terminals:** interactive PowerShell terminals backed by xterm and PTY.

### Scheduled tasks

Tasks are stored in the app, and each project can have its own. A task can define a provider, model, API key, prompt, frequency, interval, time, notifications, active or paused status, and manual execution. Saving is explicit.

By default, each run is prepared as a new background chat so scheduled work does not quietly mix with an existing conversation.

### Extensions and language

The Extensions panel shows global items and items filtered to the active project: plugins, skills, and MCP servers.

The interface supports Spanish and English. The selected language is stored locally and applied across navigation, panels, tasks, browser controls, artifacts, extensions, and primary states.

## Agent tools

| Group | Current tools |
| --- | --- |
| Files | listFiles, readFile, searchText, writeFile |
| Terminal | runCommand, terminal |
| Browser | openBrowser, getBrowserState, browserAction |
| PC | computerListWindows, computerGetState, computerScreenshot, computerOcr, computerAction |
| Planning | createPlan, updatePlan, todo, getTaskStatus |
| Auditing | getExecutionLog |
| Plugins / MCP | createSkill, createExtension, deleteExtension, createMcpServer, deleteMcpServer |
| Project | switchProject |
| Collaboration | subagent, swarm, askUser |
| Discovery | searchTools, executeTool, listAvailableTools |

> Tools are not hardcoded into every prompt. The agent receives the available catalog and decides what it needs.

## Quick architecture

    React / Next.js
      page.tsx
        Topbar
        WorkspaceLayout
          ChatPanel -> ChatInterface -> AI SDK -> tools
          ExtensionsPanel
          Right sidebar

    Electron
      preload.cjs -> secure IPC bridge
      main.ts -> filesystem, terminals, WebView, HTTP, Git, and native processes

The renderer never accesses Node.js directly. Internal communication uses codeclub:* DOM events and IPC through src/lib/runtime.ts.

## Requirements

- Windows.
- Node.js 24, or a version compatible with Next.js 16.
- npm 11 recommended.
- An API key from a compatible provider to use the agent.

## Install and run

    npm install
    npm run dev

Renderer only:

    npm run next:dev

## Build and verify

    npm run next:build
    npm run electron:compile
    npm run desktop:build
    npm run package:win

package:win creates the Windows installer in release/. For the full beta workflow, see [Development and releases](docs/desarrollo.md).

## Documentation

- [Documentation index](docs/README.md)
- [About Codeclub](docs/about.md)
- [Architecture](docs/arquitectura.md)
- [Flows and events](docs/flujos.md)
- [Persistence](docs/persistencia.md)
- [Right sidebar](docs/sidebar-derecha.md)
- [Terminal and browser](docs/terminal-y-navegador.md)
- [Accessibility and Computer Use](docs/accesibilidad.md)
- [Development and releases](docs/desarrollo.md)
- [Synapse and Devices](docs/synapse.md)

## Status

Codeclub is in early beta. The app is useful for local development, while mobile QR connectivity, fully automatic task execution, and stable distribution are still evolving.

## Community and support

- Donations: [Ko-fi](https://ko-fi.com/iangeldev)
- Issues and ideas: the project's GitHub repository
- Commercial licensing: codeclubide@gmail.com

## License

Codeclub uses a dual license: free for personal, educational, open-source, and nonprofit use; paid for companies and for-profit use.

Read the full terms in [LICENSE.md](LICENSE.md).
