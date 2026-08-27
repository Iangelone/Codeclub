# Architecture
## The idea in one line

    Next.js renders -> React coordinates -> Electron executes -> Windows responds

## Layers

The renderer uses Next.js, React, and Tailwind. It owns the interface and asks the AI SDK for agent work. Electron and Node.js own IPC, the filesystem, processes, WebView, and PTYs.

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
