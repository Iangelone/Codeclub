# Architecture
## The idea in one line

    UI -> application services -> agent engine / native adapters -> Electron -> Windows

## Layers

Codeclub is a local-first modular monolith. The renderer uses Next.js, React, and Tailwind for presentation. Application services configure and execute chat and scheduled runs; the engine uses LangGraph for step orchestration, LangChain for local tool validation/execution, and AI SDK for model transport and streaming. Electron and Node.js own IPC, the filesystem, processes, WebView, and PTYs. See the [agent stack summary](agent.md) for active integrations and limits; graph checkpoints are not configured.

| File | Responsibility |
| --- | --- |
| src/app/page.tsx | Window entry point and general state. |
| src/components/Topbar.tsx | Projects, updates, reload, and window controls. |
| src/components/WorkspaceLayout.tsx | Three columns, resizing, and panels. |
| src/components/ChatInterface.tsx | Composer, references, history presentation, session coordination and execution observers. |
| src/components/ScheduledTaskRunner.tsx | Mounts the isolated browser surface and starts the scheduled service. |
| src/lib/agent/chat-execution.ts | Provider/credential readiness, tool/plugin selection, model execution, evidence and final assistant messages. |
| src/lib/agent/scheduled-execution.ts | Scheduled/orb budgets, approvals, verification, model calls, session publication and persistence. |
| src/lib/agent/model-client.ts | Shared direct, Gemini and Gateway client construction and configured headers. |
| src/lib/agent/model-selection.ts | Credential readiness for provider/model selection, without returning credentials to UI. |
| src/lib/agent/native-model-fetch.ts | Shared native model HTTP, cancellation and transport diagnostics. |
| src/components/ChatMarkdown.tsx | Shared Markdown rendering and code cards. |
| src/components/ChatActivity.tsx | Tool receipts, progress, questions and approval presentation. |
| src/components/ProjectPanelView.tsx | File tree, open tabs, previews and CodeMirror editor, independent of chat orchestration. |
| src/lib/desktop-model-transport.ts | Custom XML formatting and provider error presentation, backed by the shared native HTTP adapter. |
| src/lib/chat-files.ts and chat-artifacts.ts | Attachment/history adapters and structured artifact formatting. |
| src/lib/workspace-changes.ts | Optional before/after workspace evidence. |
| src/components/ExtensionsPanel.tsx | Plugins, skills, and MCP servers. |
| src/lib/engine/ | Execution, tools, plans, TODOs, and auditing. |
| src/lib/projectManager.ts | Projects, metadata, and chats. |
| src/lib/i18n.ts | Public i18next runtime with modular Spanish/English catalogs. |
| src/lib/desktop-bridge.ts | Single typed access point to the preload surface. |
| shared/desktop-contracts.d.ts | Shared task/session/history DTOs and bridge method signatures, without runtime imports. |
| electron/preload.cjs | The limited API exposed to the renderer. |
| electron/main.ts | App lifecycle, windows, service coordination and IPC registration. |
| electron/ipc/register.ts | Sender authorization before request dispatch. |
| electron/ipc/chats.ts, files.ts, settings.ts | Storage handlers owned by their respective native subsystem. |
| electron/project-files.ts | Existing project path resolution, file traversal and text search. |
| electron/plugin-store.ts | Local plugin/skill discovery and storage paths. |
| electron/computer-overlay.ts | Computer-use overlay, context menu, palette updates and Escape/cleanup lifecycle. |

Generated renderer/native output and releases live under ignored `build/`, separately from source. Root configuration files, node_modules and Next.js's internal `.next/` cache retain their tool-required locations; see [the directory map](development.md#repository-layout-and-generated-files).

The file panel is imported directly by WorkspaceLayout rather than through chat. ChatInterface supplies presentation/approval ports to its execution service; the service returns assistant messages and a turn summary. It does not receive React setters, refs or component instances. Visual frame scheduling and current-run checks are provided by the caller. Scheduled execution has no component imports. Native main composes services; storage handlers live outside window lifecycle code.

The system remains a modular monolith, not a strict implementation of Clean Architecture. Some UI coordinators remain large, and legacy message/tool payloads are still open structures. These limits do not justify adding generic repositories, dependency containers or microservices. Keep future behavior in its owning module and strengthen specific contracts as their data shapes evolve.

Local verification after the layer refactor on 2026-10-13: `npm run verify` passed, including architecture/import checks, sender authorization, transport cancellation, catalog routing, graph/tool execution, native commands/plugins, 10,000-message history, chat selection races, i18n and accessibility regressions. Separate scheduled-task, sidebar-layout, debug-mode and real isolated PTY terminal suites passed. ChatInterface now has 2,495 lines and main 928; large UI coordinators remain. No live model provider, real Android device, installer publication or GitHub Actions run was verified in this change.

## Renderer security

React does not import fs, child_process, or native APIs. Operations go through nativeInvoke and the preload bridge; the main process validates arguments before touching the system.

Only `desktop-bridge.ts` reads `window.codeclub`. Optional renderer surfaces use `getDesktopBridge()`; actions requiring Electron use `requireDesktopBridge()`. Task/session DTOs are shared declarations, so renderer modules do not import the native implementation for types. The bridge retains dynamic `invoke` for tools and future integrations; these boundaries do not impose a new tool/provider allowlist.

All native request handlers use the authorized registrar. Main, floating chat and scheduled renderers keep their existing capabilities; the widget also checks that its own WebContents owns its controls. Foreign WebViews/renderers cannot dispatch privileged requests. Native tool handlers retain project/junction checks and task/terminal ownership validation. UI-selected file adapters keep their existing global file access, while audit logs remain restricted to app storage. Authorization changes the calling boundary, not the user's approval preferences or maximum autonomy.

Provider/model selections use a revision guard: an older credential/configuration read must not overwrite a newer selection, close a reopened menu or clear a new draft. Missing-credential errors have a stable identity independent of translated text. Credentials remain in the native vault and are attached by native transport.

## Boundary verification

`npm run check:architecture` checks imports across UI, application/engine, renderer/native and shared declarations. It rejects direct preload access outside its adapter, raw request registrations outside the authorized registrar, UI imports of model/tool execution, application imports of components, and mismatches between preload methods and the bridge contract.

`npm run test:boundaries` verifies foreign-sender rejection before storage handlers, history conflicts, trusted selected-file access, serialized/scoped logs, provider routes, configured headers, cancellation, listener cleanup and no HTTP adapter replay. These checks also run in `test:core`, following the desktop build. Existing chat, scheduler, sidebar, terminal, widget, Android and accessibility suites verify behavior with isolated profiles/providers. They do not certify every live provider or real device.

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
