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
| src/components/ChatMarkdown.tsx | Shared Markdown rendering and code cards. |
| src/components/ChatActivity.tsx | Tool receipts, progress, questions and approval presentation. |
| src/components/ProjectPanelView.tsx | File tree, open tabs, previews and CodeMirror editor, independent of chat orchestration. |
| src/lib/desktop-model-transport.ts | Native model fetch, custom XML formatting and provider error presentation. |
| src/lib/chat-files.ts and chat-artifacts.ts | Attachment/history adapters and structured artifact formatting. |
| src/lib/workspace-changes.ts | Optional before/after workspace evidence. |
| src/components/ExtensionsPanel.tsx | Plugins, skills, and MCP servers. |
| src/lib/engine/ | Execution, tools, plans, TODOs, and auditing. |
| src/lib/projectManager.ts | Projects, metadata, and chats. |
| src/lib/i18n.ts | Spanish/English catalog and language switching. |
| electron/preload.cjs | The limited API exposed to the renderer. |
| electron/main.ts | App lifecycle, windows, service coordination and IPC registration. |
| electron/project-files.ts | Existing project path resolution, file traversal and text search. |
| electron/plugin-store.ts | Local plugin/skill discovery and storage paths. |
| electron/computer-overlay.ts | Computer-use overlay, context menu, palette updates and Escape/cleanup lifecycle. |

Generated renderer/native output and releases live under ignored `build/`, separately from source. Root configuration files, node_modules and Next.js's internal `.next/` cache retain their tool-required locations; see [the directory map](development.md#repository-layout-and-generated-files).

These modules were extracted from ChatInterface and main without changing native permissions, tool names or autonomy. The file panel is imported directly by WorkspaceLayout rather than through the chat component. ChatInterface still coordinates the composer and chat run; main still coordinates native services. Smaller files do not by themselves establish a fully decoupled architecture.

Local verification on 2026-10-13: `npm run verify` passed, including catalog routing, graph/tool execution, overlay lifecycle, native commands/plugins, 10,000-message history, streaming/persistence and editor/Markdown/accessibility regressions. `test-terminal-ui.mjs` passed with a real isolated PTY; `test-sidebar-layout.mjs` passed resizing, scope/persistence, navigation and language checks. The stale chat-color assertion was updated to the existing #2B2B2B surface; production styling was not changed. No real model provider, installer publication or GitHub Actions run was performed. ChatInterface decreased from 3,910 to 2,915 lines and main from 1,357 to 959; the remaining coordinators can be separated further as their behaviors are changed.

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
