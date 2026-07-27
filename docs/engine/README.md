# Engine

The engine is the AI execution layer, separated from the React UI. Lives in `src/lib/engine/`.

## Files

| File | Purpose |
|---|---|
| `types.ts` | Shared types: `ToolEvent`, `ToolContext`, `EngineCallbacks` |
| `tools.ts` | `createTools(ctx)` — development tools, `createBusinessTools(ctx)` — business tools, tool router AI |
| `run.ts` | `runStream(params)` — AI SDK `streamText` loop, returns assistant content |
| `memory.ts` | `saveMemory`, `loadMemory`, `searchMemory`, `deleteMemory`, `deleteMemoriesByTag` |
| `planning.ts` | `readAgentState`, `writeAgentState` — plans, TODOs persisted in `agent-state.json` |

## Architecture

```
ChatInterface.tsx (orchestrator)
  ├── resolveToolsWithAI → AI-powered tool selection (router model)
  ├── createTools({ projectPath, recordToolEvent, setAgentState, requestToolApproval })
  │     └── Returns tools filtered by mode (development / business)
  └── runStream({ model, system, messages, tools, callbacks })
        └── streamText (AI SDK v7)
              ├── stepCountIs(6) — multi-step tool loops
              ├── stepCountIs(7) — for structured output
              ├── Timeouts: total 90s, step 25s, chunk 15s, tool 30s
              └── Tauri-backed HTTP fetch (reqwest) for error surfacing
```

## Tool Router AI

Before each generation, `resolveToolsWithAI` uses a lightweight AI router model with structured output to select which tools the agent needs based on user intent. This avoids overwhelming the agent with all available tools at once.

```typescript
resolveToolsWithAI(prompt: string, mode: 'development' | 'business')
// Returns: { toolNames: string[] }
```

The tool catalog maps tool names to descriptions for both modes (`TOOL_ROUTER_CATALOG`). Heuristic-based fallback (`selectToolsForPrompt`) handles cases where the router model is unavailable.

## Tool Verification AI

After each tool execution, `verifyToolExecutionWithAI` checks whether the executed tool actually accomplished its goal. If verification fails, the agent can retry the tool or try an alternative approach.

```typescript
verifyToolExecutionWithAI(toolName: string, goal: string, result: string)
// Returns: { verified: boolean, reason: string, nextAction: string }
```

## Development Mode Tools

| Tool | Backend | Approval | Limits |
|---|---|---|---|
| `listFiles` | `codeclub_list_files` | No | maxFiles 400–1200 |
| `readFile` | `codeclub_read_file` | No | — |
| `searchText` | `codeclub_search_text` | No | maxMatches 80–200 |
| `writeFile` | `codeclub_write_file` | Yes | contentPreview 800 chars |
| `runCommand` | `codeclub_run_command` | Yes | Commands: bun, npm, pnpm, node, git, cargo, python, rg |
| `terminal` | `codeclub_terminal_*` | Yes | Persistent background terminal processes |
| `openBrowser` | `codeclub_browser_*` | No | Opens URL in built-in browser panel |
| `subagent` | `runStream` + `createSubagentTools` | No | Read-only specialist agents: developer, explorer, frontend, backend, QA, security, documentation |
| `getExecutionLog` | `readExecutionLog` | No | Last 100 entries from `execution.jsonl` |
| `askUser` | Structured request | No | Renders option cards below agent message |
| `createPlan` | `agent-state.json` | No | Creates a persistent plan |
| `updatePlan` | `agent-state.json` | No | Updates plan or step |
| `todo` | `agent-state.json` | No | CRUD for persistent TODOs |
| `getTaskStatus` | `agent-state.json` | No | Reads current plan and TODOs |
| `remember` | `saveMemory` | No | Saves per-project memory entry |
| `recall` | `searchMemory` | No | Searches by key or tag |
| `forget` | `deleteMemory` | No | Deletes by exact key |

## Business / Economy Mode Tools

Business mode extends development tools with business-specific capabilities:

| Tool | Backend | Description |
|---|---|---|
| `getBusinessWorkspace` | `readBusinessWorkspace` | Reads business data: quotes, invoices, milestones, payments |
| `updateBusinessWorkspace` | `writeBusinessWorkspace` | Creates/updates business entries |
| `createQuote` | `writeBusinessWorkspace` | Creates a formal quote with items and pricing |
| `createBudget` | `writeBusinessWorkspace` | Creates a project budget |
| `createExecutionPlan` | `writeBusinessWorkspace` | Creates execution plan with milestones |
| `getAIUsageMetrics` | `summarizeGenerationUsage` | Aggregates token usage, cost, and duration |
| `getWhatsAppBusinessContext` | `whatsappContextStore` | Reads WhatsApp chats for business analysis |
| `delegateBusinessSpecialist` | `runStream` + `businessSpecialistTools` | Delegates to read-only business sub-agent |

Business tools also include file inspection tools (`listFiles`, `readFile`, `searchText`) scoped to indexed projects.

## Each tool receives `ToolContext`

- `projectPath`: active workspace
- `recordToolEvent`: callback to log tool events to the execution log
- `setAgentState`: updates agent activity indicator
- `requestToolApproval`: pauses and asks for human approval before executing
- `provider` / `modelId`: (optional) for tools that spawn sub-agents

## Project artifacts

`createPlan`, `updatePlan`, `todo` and `getTaskStatus` persist the active project state in `agent-state.json`. The right sidebar exposes this state through the `Artifacts` tab, showing the active plan, plan steps and TODO statuses. Structured output from the business mode also generates quotes, budgets, and execution plans.

When a planning tool changes state, the UI emits `codeclub:artifacts-changed` so all Artifacts views refresh immediately. It is project-scoped; a chat without a project uses the system-root fallback.

## Execution Audit Log

Every tool execution is recorded in `execution.jsonl` (per-project or global) via `appendExecutionLog`. Each record has: `id`, `at`, `projectPath`, `chatId`, `tool`, `input`, `output`. The agent can query this log via `getExecutionLog` for audit and debugging.

## Usage and diagnosis

Every generation records local JSONL usage in `usage.jsonl`: provider, model, project, chat, mode, input/output/total/reasoning tokens, duration, cost per million, and status. Project usage is kept in the project data directory; global usage is kept in the application config directory. `BusinessPanel` aggregates these records into generations, tokens, estimated model cost and activity charts. No Gateway or cloud telemetry is required.

This data supports diagnosis of an application's build process and AI operating cost. It does not yet calculate a selling price or prove customer value automatically; those are product/business layers built on top of the evidence.

## Engine Callbacks

`runStream` accepts `EngineCallbacks`:

- `onTextDelta(content)` — each text chunk from the stream
- `onReasoningDelta(content)` — reasoning tokens (Anthropic-style extended thinking)
- `onToolCall()` — when the agent initiates a tool
- `onToolResult()` — when a tool returns
- `onUsage(usage)` — tokens, model, and duration of the generation
- `onStructuredOutput()` — when structured output is received (quotes, plans, etc.)
- `onAbort()` — when the stream is aborted
- `onEnd()` — when the stream ends successfully
- `onStepEnd()` — when a multi-step loop step ends
- `onToolExecutionStart()` — when tool execution begins
- `onToolExecutionEnd()` — when tool execution finishes
- `onError(error)` — optional, throws if not provided

## Memory

The `remember`, `recall`, `forget` tools persist in the OS config directory under `memory/`.
Each entry: `{ key, content, tags[], created_at, updated_at }`.
When a chat is deleted, memories tagged with `{kind}:{itemId}` are cleaned up automatically.

## Testing surface

The topbar `Testing` menu sends reproducible prompts for `askUser`, subagents, approvals, streaming/reasoning, TODO states, plan mode, and business mode. It exists to inspect real chat states without manually repeating a conversation.
