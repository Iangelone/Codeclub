# Persistence and configuration
## What is stored

| Scope | Data |
| --- | --- |
| Global | Preferences, language, Home chats, plugins, and global settings. |
| Project | Chats, metadata, tasks, plans, TODOs, artifacts, and project configuration. |
| Session | PTYs, open terminals, WebView state, and live selection state. |

## Modules

- src/lib/persistence.ts: renderer settings and lightweight values.
- src/lib/projectManager.ts: project index, metadata, and chats.
- src/lib/usage.ts: tokens, cost, provider, model, and duration.
- src/lib/execution-log.ts: execution and tool history.
- src/lib/engine/planning.ts: plans, TODOs, and statuses.
- src/lib/agent-plugins.ts: plugins, skills, and MCP.
- localStorage: language, sidebar sizes, active project, and UI preferences.

A project chat must not appear in Home. Each record keeps projectPath when applicable.

## Practical rules

- Use absolute paths and validate that they stay inside the expected project.
- Never store API keys in messages, logs, or visible artifacts.
- Emit an event after writing data so the UI can refresh.
- Keep useful empty states when no project is active.
- Prevent tasks and artifacts from one project leaking into another.
- Clean up session processes when terminals or panels unmount.

> Persistence is local; deleting Electron's data directory removes the app's stored information.
