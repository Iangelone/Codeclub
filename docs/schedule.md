# Scheduled tasks

Electron maintains a 15-second clock and a persistent queue in
`userData/scheduled-tasks.json`. Each task belongs to a canonical project or to
the global scope. The process allows only one app instance to prevent two clocks
from using the same file.

Daily, weekday, and weekly schedules use an IANA time zone. Times skipped during
a daylight-saving transition are skipped; a repeated hour does not trigger two
runs on the same local date. A custom interval measures elapsed time from task
creation or its schedule change. `Once` stores an ISO timestamp and pauses after
it fires. After Windows resumes or Codeclub restarts, each overdue task runs
once; missed runs are not replayed. An active run is not duplicated or retried
automatically.

Tasks run while Codeclub is open, including when minimized to the tray. They do
not wake Windows and do not run after the app exits completely. Runs are
serialized and limited to 30 minutes and 32 agent steps. Cancellation also
aborts the HTTP transport and native commands started by the task; its terminals
are stopped. A run interrupted by a hard shutdown is recorded as interrupted
on startup; its possible changes are not repeated automatically.

Each run opens an independent, invisible renderer with its own browser and the
existing preload. The assignment is obtained through IPC and tied to its owner
WebContents. This renderer uses AI SDK, the saved provider/model, configured
headers, selected reasoning options, the project's `AGENTS.md` instructions, and
available plugins/MCP servers. Credentials remain in CredentialVault and are
added to the HTTP transport by Electron. They are not stored in task settings.

Each result is saved in a chat scoped to its task. Activity lets users approve
and cancel runs; operations with side effects require approval before execution.
Approval expires after two minutes, and the task fails with an explicit status
if approval is not granted. A task that asks for more information is not marked
complete. Tasks cannot switch projects, start subagents, or recursively manage
other tasks. The history keeps the 20 most recent runs; chats keep complete
results. Notifications can cover every run, errors only, or none.

The chat tools `scheduleTask`, `listScheduledTasks`, and `manageScheduledTask`
create and manage tasks in the current scope. New tasks use the chat's
provider/model. The UI lets users edit them. Existing data is imported from each
registered project and the global scope; old keys are moved to the vault, and
incomplete drafts are retained without plaintext keys.

## Events

| Event | Emitter | Payload | Consumers and cleanup |
| --- | --- | --- | --- |
| `codeclub:scheduled-tasks-changed` (IPC) | TaskScheduler in Electron after each save or transition | None | `ScheduledPanel` reloads the current scope; HomePage invalidates caches and refreshes chats and workspace. `onTasksChanged` returns a dispose function; both effects call it on unmount. |
| `codeclub:global-chat-changed`, `codeclub:project-meta-changed`, `codeclub:workspace-changed` (existing DOM events) | HomePage after receiving the native change | None; requests a refresh of the current view | Existing navigation and panel listeners, cleaned up in their respective `useEffect`. |
| `codeclub:session-command` (existing IPC event) | SessionHub, at the request of Activity or Tasks | owner, runId, chat, action, and optional approvalId | ScheduledTaskRunner validates runId/chat; its `finally` block removes the listener and all approval timers. |

## Verification

`npm run electron:compile`, `node scripts/test-task-scheduler.mjs`,
`node scripts/test-scheduled-tasks.mjs`, `npx tsc --noEmit`,
`npm run next:build`, and `git diff --check`.

Runner tests use the real AI SDK engine with a local simulated endpoint. They
check routing, tools, approval/rejection, cancellation, missing credentials,
HTTP errors, and browser events with a simulated WebView. UI tests check task
creation, execution, pausing, deletion, language changes, and project switching.
They require no real credentials and use no external tokens.

To verify against the live Gateway, run
`node scripts/test-scheduled-tasks-live.mjs` in a terminal after compiling
Electron. The key is read without echo from stdin or through
`AI_GATEWAY_API_KEY`; it is never written to code or reports. The test queries
the current catalog and selects only a language model with tool support and zero
input/output prices. It hard-codes no provider or model IDs; it resolves the
transport from the app catalog. If there are no free candidates, it fails
without using paid models.

This test starts the real Electron process with an isolated temporary profile
and invisible windows. It saves the credential through preload and
CredentialVault, creates a one-time task, and waits for the automatic clock
without manually invoking a run. The model must read a file containing a random
value and return it; the test checks the tool call, saved chat, usage, and single
execution. The process and test-profile files, including the encrypted
credential copy, are removed at the end.
