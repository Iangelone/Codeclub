# Flows and events
## A normal message

1. The user writes in ChatInterface.
2. The message is added to the active chat.
3. The agent receives the current project and tool catalog.
4. AI SDK streams the response and tool calls.
5. A tool performs local work or requests IPC.
6. The result returns to chat and may open a panel.
7. Usage, results, and errors remain available for auditing.

    prompt -> model -> tool -> Electron -> result -> chat / artifact

## Active project

Home mode has no project path and must continue to work with global data.

| Event | Use |
| --- | --- |
| codeclub:project-switch | Switch projects. |
| codeclub:project-selection-changed | Tell a panel which project it displays. |
| codeclub:active-project | Synchronize the active project. |
| codeclub:project-meta-changed | Refresh metadata and chats. |
| codeclub:open-chat | Open an existing chat. |
| codeclub:open-empty-chat | Create or show an empty chat. |
| codeclub:open-extensions | Show Extensions. |
| codeclub:open-artifacts | Open Artifacts in the right sidebar. |
| codeclub:open-right-panel | Open the browser or another right panel. |

Tasks use codeclub:scheduled-tasks-changed; artifacts use codeclub:artifacts-changed and codeclub:artifact-reference; usage uses codeclub:usage-updated.

## Language and reload

ChatInterface emits codeclub:language-change with language es or en. Components using useAppLanguage update without a reload, and the document lang attribute changes too. The topbar can detect a newer release and perform a full Electron window reload.

## Rule for new events

Define the emitter, payload, consumers, and cleanup before adding an event. Install and remove listeners within the same useEffect.
