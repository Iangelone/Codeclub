# Functional review — October 9, 2026

The existing chat, history, agent execution, tool discovery and validation, plugins/MCP, tasks/orbs, persistence, windows/sessions, browser, and terminal flows were reviewed. No product screens, models, or dependencies were added.

## Fixes

| Area | Issue and change |
| --- | --- |
| MCP stdio | Requests could remain pending after server exit. Requests now have deadlines, reject on transport closure, and clean up processes after initialization failures or explicit closure. |
| MCP paths | Prefix comparisons accepted sibling folders and external junctions. Boundaries and real paths are now checked; environment expansion includes plugin variables. |
| Remote MCP | Cleanup is registered before tool discovery so it remains available when discovery fails. |
| Dispatcher | MCP `isError=true` was treated as success. It now returns failure; cancellation rejects without additional effects. |
| Tasks | Replacing a running task object lost the paused state of an orb that failed after editing. Object identity is preserved; starting the scheduler twice does not duplicate its timer. |
| Logs | Each entry read and rewrote the entire log, and concurrent windows could lose entries. Electron serializes appends per file. Large objects retain an explicitly truncated excerpt. |
| History | Non-finite turn-page cursors and limits reached SQLite. They are normalized like ordinary pagination. |
| Engine | Non-finite step or context limits no longer disable budgets. Total tokens use input plus output when the provider omits a total. |
| Chat | Pending images or fonts could hide a conversation indefinitely. Layout stabilization now has a two-second deadline. |
| Projects and settings | Late metadata, plugin, recent-chat, and provider/model loads no longer overwrite newer responses. Failed settings reads no longer block chat initialization forever. |
| Catalog | Both sources load concurrently with a 12-second deadline including body reads, retaining independent fallbacks. |

`codeclub:append-log` is request/response IPC, not a window event: `appendDesktopLog` → preload `appendLog(filePath, content)` → Electron. It accepts only the three existing log names within userData and validates real paths. The queue is removed after the last write. Older bridges temporarily retain the previous mechanism until Electron restarts.

## Models and efficiency

User model selection and the architecture of one AI SDK step per LangGraph node are preserved. Regressions verify that failures after a tool call do not repeat its effects, discovery promotes exact schemas, and compaction preserves current evidence, selectors, and media signals.

The log change removes rewriting proportional to log size for each entry; the native test checks 100 distinct concurrent appends. Concurrent catalog loading removes sequential waits. No percentage improvement in quality, inference latency, or token cost is claimed: no benchmark with real commercial providers was run.

Context budgets remain conservative byte estimates rather than an exact tokenizer. Turn titles still use their existing auxiliary call. No semantic memory, checkpoints, or selection policies were added.

## Verification

- Builds: `next:build`, `electron:compile`, and `tsc --noEmit`.
- Engine: `test:agent-graph`, contracts for 46 tools with 165 rejected inputs, and computer tools with a mocked bridge.
- Persistence: 10,000-message history, scheduler, settings/orbs, sessions, and vault with isolated fixtures.
- UI: real chat with a mock provider, extension panel, sidebar, language, focus, resizing, and persistence.
- Browser: CDP, DOM selection/style editor, extension origins and reconnection, and actions in isolated Chromium.
- System: real PTY terminal, native commands, Git paths, plugin resources, and junctions.
- Added regressions: MCP lifecycle, environment expansion, path boundaries, concurrent appends, tasks edited before failure, non-finite limits, MCP errors, late plugin responses, and chat opening while an image request remains blocked.
- `git diff --check` passed.

These tests cover concrete flows and reproducible failures. They do not certify every provider/MCP combination, power loss, Windows reinstallation, or every edge case. New preload and native handlers require a full Electron restart; reloading React alone does not install them.
