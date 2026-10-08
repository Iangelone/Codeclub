# Architecture
## The idea in one line

    Next.js renders -> React coordinates -> Electron executes -> Windows responds

## Layers

The renderer uses Next.js, React, and Tailwind. Its shared engine uses LangGraph for step orchestration, LangChain for local tool validation/execution, and AI SDK for model transport and streaming. Electron and Node.js own IPC, the filesystem, processes, WebView, and PTYs. See the [agent stack summary](agent.md) for active integrations, verification and limits; graph checkpoints are not configured.

| File | Responsibility |
| --- | --- |
| src/app/page.tsx | Window entry point and general state. |
| src/components/Topbar.tsx | Projects, updates, reload, and window controls. |
| src/components/WorkspaceLayout.tsx | Three columns, resizing, and panels. |
| src/components/ChatInterface.tsx | Input, messages, streaming, references, and tools. |
| src/components/ExtensionsPanel.tsx | Plugins, skills, and MCP servers. |
| src/lib/engine/ | Execution, tools, plans, TODOs, and auditing. |
| src/lib/projectManager.ts | Projects, metadata, and chats. |
| src/lib/i18n.ts | Spanish/English catalog and language switching. |
| electron/preload.cjs | The limited API exposed to the renderer. |
| electron/main.ts | Native operations and Electron lifecycle. |

## Renderer security

React does not import fs, child_process, or native APIs. Operations go through nativeInvoke and the preload bridge; the main process validates arguments before touching the system.

## Extensibility

The agent discovers tools, skills, and MCP servers from the available catalog instead of receiving a fixed list in every prompt. Tool descriptions explain when an integration is useful; the model decides the flow.

## Right sidebar

The right sidebar is the IDE's tool shelf. It can open, close, and resize without squeezing the chat out of the workspace.

| Tab | What it does |
| --- | --- |
| Files | Browse, search, open, and preview project files. |
| Review | Show workspace and Git changes. |
| Browser | Open pages inside Electron and reference them. |
| Terminals | Open interactive terminals that persist during the session. |

The main panel keeps a minimum width. Sidebar width is stored locally. Browser and Terminals can have multiple tabs; other tabs are reused. Panels should have clear empty states and accessible labels.

Plans and TODOs are managed by the AI tools and remain project-scoped. They have no dedicated sidebar panel, and creating or updating them does not open a sidebar tab.
