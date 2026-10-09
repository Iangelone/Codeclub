# Agent engine: integrations and limits

Integration overview reviewed October 4, 2026; operational guides and browser verification updated October 8, 2026. Based on repository code, installed dependencies, and the linked official sources. This document distinguishes implementation, tests, and pending improvements; it does not certify full compatibility with any framework or standard.

## At a glance

**Codeclub uses LangGraph to coordinate execution, LangChain to validate and run tools, and AI SDK v7 for transport and streaming. It maintains its own Agent Plugins/MCP client. It does not use Deep Agents or have LangSmith configured.** Tool availability does not guarantee that the model will choose well, finish a long task, or verify the result correctly.

| Technology | Current status | Reference |
| --- | --- | --- |
| AI SDK | Integrated: `ToolLoopAgent` with one step per graph node, streaming, tools, cancellation, and token usage. Installed `ai@7.0.16`. | [Engine](../src/lib/engine/run.ts), [official docs](https://ai-sdk.dev/docs/introduction) |
| Gateway and compatible providers | Dynamic catalog and credentials; the user selects the provider/model. | [Catalog and routing](catalog.md), [routing](../src/lib/ai-routing.ts) |
| Agent Plugins | Loads local packages, skills, and MCP servers; partial standards compliance. | [Plugin bridge](../src/lib/agent-plugins.ts), [official checklist](https://agent-plugins.org/client-implementers/conformance) |
| LangChain / LangGraph | Integrated into the shared engine: `langchain@1.5.15`, `@langchain/core@1.2.14`, `@langchain/langgraph@1.4.19`. | [Implementation](../src/lib/engine/run.ts), [LangGraph](https://docs.langchain.com/oss/javascript/langgraph/overview) |
| Deep Agents | Not integrated; used as a reference for context and autonomy. | [Deep Agents](https://docs.langchain.com/oss/javascript/deepagents/overview) |
| LangSmith / AI SDK DevTools | LangSmith is not integrated. DevTools is installed, but tracing is inactive; SDK telemetry is disabled in the engine. | [Local usage](../src/lib/usage.ts), [audit log](../src/lib/execution-log.ts) |

The integration changes execution control and tool validation; its quality should be measured with reproducible tasks. Installing libraries alone does not improve responses.

## Operational guides for agents

For extension maintenance, use [packaging, release, and portability guidance](browser-extension-development.md).

Use runtime tool discovery and its returned schemas as the source of truth; Markdown documentation is not automatically loaded into every model call. Do not invent tools or observations. See [Browser Control contracts and recovery](browser-control.md#for-llm-agents-and-integrators), [tool discovery](tool-discovery.md), [browser context and model-call metrics](browser-context.md), [terminal output](terminal-agent-output.md), and [machine-readable Git paths](git-paths.md).

The October 8 browser audit supersedes the older companion connection notes below: the current unpacked extension passed 22/22 extended checks in the user's Edge profile after reload and visibility recovery. This does not validate the store package or every integration. See [the audit](tool-audit-2026-10-08.md).

## Current execution flow

```text
ChatInterface / ScheduledTaskRunner
  -> catalog + selection + credential store
  -> native tools + plugins/MCP + skill discovery
  -> runStream -> LangGraph prepare -> model -> finish
                   ^                  |
                   +-- when tools -----+
  -> model: one-step ToolLoopAgent -> selected model
  -> tool: LangChain invoke -> preload/IPC -> Electron or MCP
  -> response, history, tokens, and execution evidence
```

React configures and presents execution; Electron performs system operations. Remote MCP servers connect through `@ai-sdk/mcp`; stdio runs in Electron. An external server has its own environment and permissions and must not be assumed to be automatically restricted to the project.

## LangGraph and LangChain: active integration

The shared engine for chat, tasks, and auxiliary calls compiles a `StateGraph` for each run. State includes messages, the step counter, and whether to continue. The `prepare` node checks/compacts context; `model` runs one SDK step and retains messages and tool results; `finish` publishes completion and aggregated usage. Conditional edges repeat `prepare` only when tool calls have results and step budget remains.

The graph does not store provider, credentials, or tool objects in its state; they remain in the call environment. Model, provider, reasoning options, and endpoint continue to resolve from the existing selection; no fixed model is introduced.

`adaptLangChainTools` preserves SDK metadata and adapts each local executor to `langchain.tool`. It converts schemas with `asSchema` and calls `invoke`, which validates input before performing side effects. Original executor arguments and options, including IDs and cancellation, are preserved. Tools without a local executor remain unwrapped. Approval control stays in existing tools, and Electron remains the native bridge.

No checkpointer is configured: graph state exists only during a run. History and the scheduler remain persistent, but closing the app cannot resume a node mid-task. This integration also does not enable LangSmith services, delegation, or semantic memory.

## AI SDK: what we use

The [October 9 tool audit](tool-audit.md) records execution and path corrections, regression tests, and their limits. Intelligent UI has been removed from the chat.

In [run.ts](../src/lib/engine/run.ts), AI SDK controls one model/tool step inside each graph node. `instructions` sets the system instructions, and `fullStream` delivers text, reasoning, and events. The engine uses step, tool, and usage callbacks, along with `AbortSignal`, `smoothStream`, and structured output where appropriate. It keeps global step numbering and publishes usage/completion once per run.

The `prepare` node checks the context budget, and `pruneMessages` removes old reasoning and results. The estimate uses UTF-8 bytes, not an exact tokenizer. Chat requests up to 128 steps, scheduled tasks 32, and auxiliary calls use 8 by default. The model may finish earlier; reaching the limit does not prove the goal is complete. Tool errors also return to the model so it can correct arguments without replaying prior side effects. [Chat history](history.md) explains the recent window, SQLite, excerpts, and historical search.

[tools.ts](../src/lib/engine/tools.ts) defines schemas with `tool`/`jsonSchema`. `searchTools` discovers capabilities and schemas; `executeTool` runs the exact name. Initial selection follows prompt rules: the name `selectToolsWithAI` does not mean an LLM router is active. Dynamic discovery can expose tools beyond that initial selection.

The installed SDK and its guides under `node_modules/ai/docs/` are the reference for changes. During this review, npm reported `7.0.127`: the project remains on v7, but newer versions exist. This audit does not update packages or adopt new APIs.

## Plugins and skills: what works and what remains

In `main.ts`, `listAgentPlugins` discovers `plugin.json`, `skills/<name>/SKILL.md`, and `mcp.json` in global or project storage. When names conflict, the project package takes precedence. Tools can create packages and check that their files were written.

Codeclub also includes Addy Osmani's MIT-licensed [Agent Skills](https://github.com/addyosmani/agent-skills) package as a read-only global plugin. Its skills are discovered through the normal catalog and load linked Markdown resources with their instructions. Selecting a skill from the `/` menu gives the agent its instructions for that session; for substantial coding tasks, it can also find an applicable skill on demand. The bundled version is recorded in `vendor/agent-skills/plugin.json`; the license notice remains in `vendor/agent-skills/LICENSE`.

`searchPlugins` and `searchSkills` return metadata; `loadSkill` loads complete instructions on demand. All skills are not injected into every prompt. The current reader extracts `name` and `description` with regular expressions; it is not a complete YAML parser. Discovery does not expose a general API for reading a skill's supporting files.

The client connects stdio, Streamable HTTP, and legacy SSE, preserves `PLUGIN_DATA`, exposes prefixed tools, and cleans up connections. Other servers can remain available if one fails. This is a working integration, but it is not enough to claim compliance with [Agent Plugins 1.0.0](https://agent-plugins.org/client-implementers/conformance).

Gaps against the checklist:

- The loader does not strictly validate `$schema`, required fields, matching versions, or closed manifest/MCP schemas. `warnings` is returned empty, and several errors are silently skipped.
- Stdio command/cwd checks use string prefixes. Resolved path boundaries, including symlinks, still need validation. Placeholder expansion applies to args/cwd but not `env` values.
- The client has no explicit URL/header validation or cross-origin redirect policy. That policy must be checked before claiming conformance.
- `mcpRequest` has no timeout; process exit does not explicitly reject every pending request. Negotiation and lifecycle failures need dedicated tests.

Transport, placeholder, and isolation rules are covered by [MCP runtime](https://agent-plugins.org/client-implementers/mcp-runtime). These gaps were identified through code review; this review did not run real MCP servers across all three transports.

## Autonomy: evidence and limits

| Capability | Current implementation | Relevant limit |
| --- | --- | --- |
| Plans and TODOs | Tools and state persisted in `agent-state.json`. | The model must use them; they are not a mandatory workflow. |
| Memory | SQLite, bounded excerpts, and conversation search. | No semantic retrieval or learned preference memory. |
| Repository instructions | The scheduled runner reads the root `AGENTS.md` with a size limit. | Normal chat does not automatically load `AGENTS.md`; there is no general hierarchical resolution. |
| Verification | Tool results, snapshots/diffs, and visible logs. `verifyToolExecutionWithAI` exists. | The verifier is not connected to the normal chat flow; final text is not verified success. |
| Retries | Full `runAssistant` replay was removed. The SDK retains transport retries; the graph adds cancellable waits and up to two streaming-limit retries only when the step made no tool calls. | Persistent limits end in an error. There is no exactly-once guarantee for external systems or durable idempotency log. |
| Delegation | Subagent/swarm implementations exist in tools. | Normal chat filters them out; tasks exclude them too. Do not claim general active delegation. |
| Durable execution | History and tasks survive restarts; scheduler state is recovered. | No per-step checkpoints to resume an interrupted loop after its last tool. |
| Observability | Token usage and local tool logs. | No LangSmith traces, active DevTools integration, or comprehensive quality benchmark. |

LangGraph offers additional persistence and durable-execution capabilities that require storage/checkpoint configuration. Deep Agents combines context, filesystem, skills, and delegation but is not integrated. The table reflects what Codeclub currently enables. Sources: [LangGraph](https://docs.langchain.com/oss/javascript/langgraph/overview), [Deep Agents](https://docs.langchain.com/oss/javascript/deepagents/overview).

## What has been verified

Chat tests cover long history, context budgets, streaming with a simulated provider, and persistence. Task tests cover the clock, scopes, queue, cancellation, approvals, and recovery. A live Electron/Gateway test also ran: a model selected from the catalog with zero-priced input/output read a file through a tool and saved the response and usage. The credential was encrypted in a temporary profile, which was then deleted.

On October 4, 2026, a real development cycle also completed in Salieri using a free catalog model: file reads/writes, completed plan, 21 tests, build, terminal server, and nine browser actions covering filtering, local submission, and reset. [Development verification](verification.md) summarizes the evidence and fixes. This validates specific workflows, not every provider, tool, full plugin compatibility, or quality on complex projects. See [AI catalog and transport](catalog.md), [scheduled tasks](schedule.md), and [chat history](history.md).

`npm run test:agent-graph` validates the LangGraph/LangChain integration: multi-step continuation with a side-effecting tool, invalid input rejected before the effect, cancellation, step limits, single completion, aggregated tokens, and transport failure after a tool without replaying its effect. `test-scheduled-tasks.mjs` also exercises the shared runner with a simulated provider. The October 4 development review used this integration with a real credential in an encrypted temporary profile and real chat/browser components. The [development verification report](verification.md) distinguishes a complete cycle from an incomplete attempt.

## Recommended improvements, in order

1. **Complete idempotency:** after removing full-flow replay, classify failures and record durable tool-run IDs.
2. **Share instructions and verification:** load project rules in chat/tasks and require evidence before marking a goal complete.
3. **Close plugin compatibility gaps:** local schemas, resolved path boundaries, env, redirects, timeouts, and MCP tests for each transport.
4. **Measure quality:** build reproducible tasks for reading, changes, tests, browser work, and recovery; measure success, cost, and duration per dynamically selected model.
5. **Extend long-running work when measurements justify it:** per-step checkpoints, better context summaries, and delegation with clear scopes and budgets.

LangGraph and LangChain are installed and connected to the shared engine. These pending improvements are not considered implemented merely because the libraries are installed.

## Maintaining this document

Update it when `engine/run.ts`, `engine/tools.ts`, `ChatInterface`, `ScheduledTaskRunner`, `agent-plugins.ts`, or the native loader/MCP changes. Always distinguish “exists in code,” “available to the agent,” and “tested.” For SDK APIs, read the installed guides; for conformance, check the supported version of the standard without downloading schemas during package loading.

## Orbs: verification and conversations

Each autonomous cycle publishes its own conversation, available from the orb's chat icon, without automatically switching the user's current chat. Text-generating steps appear as separate assistant messages during streaming and are saved individually. The renderer groups them under the turn that initiated them.

The runner limits a cycle to five minutes, 32 model steps, 48 tool calls, and 60,000 tokens shared between execution and review. It allows up to two attempts. Repeated identical actions and unchanged repeated observations stop the cycle. Reads with changing results can continue within budget.

Before completing an orb, an independent model call checks the goal against tool results with evidence IDs. A verified result requires cited successful observations; an accepted action alone does not prove the goal. Snapshots from the embedded browser, CDP, and extension include audio/video state for playback checks. The installed extension must be updated to provide these fields. This review reduces unsupported claims but cannot guarantee that the model judges every goal correctly.

Blocked/unverified results and progress, time, token, or step limits pause the orb. Play resumes it after the dependency is resolved or the goal is changed. Earlier cycles provide context but do not replace new evidence. The runner's temporary browser is destroyed at the end and cannot keep audio playing.

## Per-conversation right panel

State is stored in `codeclub:right-chat-views` using the `[projectPath, chatId]` pair, with a draft scope for new conversations. It includes tabs, selected panel, file, tree, width, and visibility. Creating the chat migrates its draft. Instances remain mounted when switching chats to preserve browsers and terminals; after restart, layouts and URLs are restored, but old terminal process IDs are not. Browser URL and history are stored per instance.

Extended existing events:

| Event | Emitter | Added payload | Consumer |
| --- | --- | --- | --- |
| `codeclub:open-right-panel` | engine/tools | chatId, projectPath | WorkspaceLayout creates/selects a browser in that scope |
| `codeclub:browser-navigate` | engine/tools | chatId, projectPath, url | Selected BrowserPanel in that scope |
| `codeclub:browser-state-request` / `codeclub:browser-action` | engine/tools | chatId, projectPath, requestId, action | Selected BrowserPanel; isolated runner |
| `codeclub:browser-state` / `codeclub:browser-action-result` | BrowserPanel | chatId, requestId, result | Tools accept only the correlated response |
| `codeclub:browser-tab-meta` / `codeclub:terminal-tab-meta` | Relevant panel | instanceId and metadata | WorkspaceLayout updates the instance |
| `codeclub:open-terminal-panel` / `codeclub:terminal-closed` | engine/tools | chatId, projectPath, terminalId | WorkspaceLayout opens in scope or removes by terminalId |
| `codeclub:open-chat` | OrbsPanel | chatId, projectPath, name | WorkspaceLayout opens the latest cycle |

Component listeners are installed and removed in the same `useEffect`. Response waits remove listeners when their requestId arrives or the timeout expires. The chat list also refreshes through `onTasksChanged`; the native subscription is released on unmount.

Initial validation: Next/Electron builds, TypeScript, and diff review. Later functional checks are listed at the end of this section.

Autonomous cycles save the prompt as hidden internal context with `source=orb-trigger`. The view shows the orb's name as the initiator and hides that bubble, including for the first message of inherited scheduled conversations. Later real user messages remain visible. A successful review stays in `verifyOrbOutcome`; it does not add a conversation message.

Desktop settings are now read and updated by key through Electron's SettingsStore. Synchronous writes read the current file and atomically replace `settings.json`; a renderer no longer saves a stale full copy. Credentials remain in the vault. Orb chat creation uses `globalChatUpsert` to merge the record in the native process.

After a mutation, Electron emits `codeclub:settings-changed` with `{ key }`. Preload exposes `onSettingsChanged`; WorkspaceLayout refreshes chats when `codeclub_global_chats` changes and removes the subscription in the same `useEffect` cleanup. Setting values are not included in the event.

On the first startup when `codeclub_orb_chat_index_repaired_v1` is absent, conversations from orb cycles that still have messages in SQLite but are missing from the global index are recovered. Deleted histories are not restored. Restart Electron to install the new handlers and preload; reloading the renderer is insufficient.

Each newly completed turn requests a short summary from the selected provider/model through `generateTurnSummary`, without tools, with a 12-second timeout and no retries. It is saved in the assistant message's `turnSummary` and shown beneath the timestamp. Orb messages retain the agent name beside the summary; the audit remains separate. The call uses native transport and credentials and records usage with `mode=turn-summary`. Summary tokens count toward the orb budget. Summaries are not generated retroactively; older histories and failures retain the local short view. The live Gemini check is described below.

Live manual verification on 2026-10-08: the development app was reloaded and two tool-free turns were sent with `gemini-3.1-flash-lite`. Global chat `global-1791481099973` showed summaries “Basic definition and operation of an API interface” and “Main difference between HTTP and HTTPS protocols.” Both remained after navigating to New chat and reopening from Recents. SQLite confirms `turnSummary` on messages 1 and 3; `usage.jsonl` records `mode=turn-summary` with 167/147 tokens and 785/822 ms. The UI screenshot with both turns was also inspected. Other providers and network failures were not tested in this run.

Automatic chat naming uses the latest available `turnSummary` and never replaces `customName=true`. Saving a turn emits `codeclub:rename-chat` with `{ chatId, projectPath, newName: turnSummary, automatic: true }`, even when the user is viewing another conversation. WorkspaceLayout checks persisted `customName` before renaming. On reopen, the name is synchronized to the latest summary; navigating older pages does not replace it. UI verification: `global-1791481099973` changed from a long answer excerpt to “Main difference between HTTP and HTTPS protocols” in Recents.

Expanded verification on 2026-10-08: `test-chat-history` (10,000 messages), `test-agent-graph`, `test-page-bootstrap`, `test-chat-ui` (streaming, chat races, persistence, generated summary), `test-scheduled-tasks` (SDK, credentials, tools, cancellation, errors, step editing for orbs, save/play/stop, and language), `test-orb-state` (per-key settings across windows, chat registration, vault, and loop guards), `test-native-commands`, and `test-external-browser` passed. Fixtures were updated where they still expected the retired Tasks screen or confused the summary with the answer. `next:build`, `electron:compile`, `tsc --noEmit`, and `git diff --check` completed successfully. Test providers and browsers are isolated fixtures; this does not validate every external combination or a Windows reinstall.

Browser companion verification (2026-10-08): `test-browser-extension` now passes in isolated Chromium: connection, tab discovery, password redaction, DOM inspection, click, and typing. The worker previously tried to read `document` outside the inspected page; media now comes from the page evaluation. This worker correction affects the bundled extension; an existing store installation requires a new published extension version to receive source changes.

Edge Add-ons assigns `bomojefgeconjddklieajpeimnjkkbbb`, while the unpacked key assigns `pomkkenhcjkfjdabdhogladflacafopd`. The loopback bridge allows only those exact extension origins. `test-browser-extension-origins.mjs` verifies both origins, rejects unrelated origins, and checks Edge install/removal destinations. Edge installation opens the published Add-ons listing; removal opens `edge://extensions/?id=bomojefgeconjddklieajpeimnjkkbbb`. Other browsers retain unpacked installation. Connection status requires a successful `listTabs` response, rather than only the initial handshake. Restart the desktop process after bridge changes.

### Current companion verification and release status — October 8, 2026

The original store-package connection attempts were inconclusive. Later direct checks confirmed the user's unpacked companion (`pomkkenhcjkfjdabdhogladflacafopd`), and the extended suite passed 22/22 in that real Edge profile and an isolated profile. This supersedes the earlier live-connection uncertainty for the unpacked copy only. The store package was not updated or certified by those runs.

Bundled 1.0.1 includes alarms/startup/install/toolbar wake-up and duplicate-socket protection. The latest source fixes add visibility checks, multiline hit testing, and increasing reconnect backoff. Reload unpacked source after edits; store users need a published update. Restart the desktop process after native bridge changes. Full contracts and recovery are in [Browser Control](browser-control.md); evidence and intermediate failures are in [the audit](tool-audit-2026-10-08.md).
