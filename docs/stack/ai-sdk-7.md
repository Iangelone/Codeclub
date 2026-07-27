# AI SDK 7

AI SDK 7 is the TypeScript toolkit for building AI applications, features, frameworks, and agents across model providers.

## Main Surfaces

- AI SDK Core: unified APIs such as `generateText` and `streamText` for text generation, structured outputs, tools, and agents.
- AI SDK UI: framework-agnostic hooks and UI primitives for chat and generative interfaces.
- AI SDK Harnesses: experimental APIs for running complete agent runtimes through `HarnessAgent`.

## Agent Features

AI SDK 7 adds deeper production support for agents:

- Reasoning control through a standard `reasoning` option.
- Typed tool context for passing scoped values such as API keys to specific tools.
- Runtime context for state shared across agent steps.
- Provider file uploads through `uploadFile`.
- Provider skill uploads through `uploadSkill`.
- MCP Apps for rendering sandboxed app UIs next to agent output.
- Terminal UI through `@ai-sdk/tui`.

## Running Agents

AI SDK 7 includes runtime features for longer and safer agent work:

- Tool approvals, including human-in-the-loop approval.
- Durable and resumable execution through `WorkflowAgent`.
- Timeout controls for total runs, steps, chunks, and tools.
- Sandbox support for command execution, file access, and generated code.

## Harnesses

Harnesses are for complete agent runtimes, not direct model calls. Examples include Codex, Claude Code, Deep Agents, OpenCode, and Pi.

`HarnessAgent` exposes those runtimes through one AI SDK-compatible surface. A harness can own workspace access, tools, permissions, native session state, compaction, sandbox behavior, and runtime-specific configuration.

Harness output is compatible with AI SDK stream and response primitives, so it can feed surfaces such as `useChat` or `toUIMessageStream`.

Harness packages are experimental and may change between releases.

## Observability

AI SDK 7 improves agent observability with:

- Global telemetry registration.
- OpenTelemetry integrations.
- Node.js tracing channel support.
- Lifecycle callbacks.
- Per-step performance statistics.

## Beyond Text

AI SDK 7 also adds experimental provider-agnostic realtime support and experimental video generation.

## Codeclub Notes

Codeclub uses AI SDK 7 packages:

- `ai`
- `@ai-sdk/react`
- `@ai-sdk/openai-compatible`
- `@ai-sdk/devtools`
- `@ai-sdk/tui`

### DevTools

`@ai-sdk/devtools` installed with telemetry registered from `ChatInterface.tsx`.
Run `npx @ai-sdk/devtools` and open `http://localhost:4983` to inspect live AI SDK calls.

### Engine

The custom engine lives in `src/lib/engine/` — see [../engine/](../engine/).

### Models

The model/provider catalog is in `src/lib/ai-catalog.ts` — see [../models/](../models/).

### Current Chat Usage

An IDE agent built on AI SDK Core:

- `streamText` streams assistant text and tool events (wrapped in `runStream`).
- `tool` and `jsonSchema` define workspace tools (in `tools.ts`).
- `stepCountIs(6)` enables multi-step tool loops for development mode.
- `stepCountIs(7)` enables multi-step tool loops for structured output mode (quotes, plans, budgets).
- `Output.object` with JSON Schema auto-detects structured output artifacts (quotes, plans, TODOs).
- Tool execution is backed by Tauri commands.
- Provider HTTP requests use a Tauri-backed fetch so desktop builds can surface status and response bodies instead of opaque WebView fetch errors.
- Risky tools require explicit UI approval before running.
- The composer spinner uses agent states: `idle`, `streaming`, `tool_call`, `approval`, `running`, and `error`.
- The send button becomes a stop button during generation and aborts the active stream through `AbortController`.
- Runtime errors are written back into the composer input with method, URL, request body, status, response headers, and response body for debugging.

### Tool Router & Verification

- **Tool Router**: Uses a lightweight AI model with structured output to select relevant tools based on user intent before each generation (`resolveToolsWithAI`). Fallback: heuristic keyword matching (`selectToolsForPrompt`).
- **Tool Verification**: After tool execution, a verification AI checks whether the tool accomplished its goal (`verifyToolExecutionWithAI`). Enables retry loops.
- Both use `Output.object` with `jsonSchema` for structured output schemas.

### Agent Timeouts

Configured in `run.ts`:
- Total generation: 60s race timeout + 90s stream timeout.
- Step: 25s.
- Chunk: 15s.
- Tool: 30s.

### Multi-step Tool Loops

`stepCountIs(6)` is the default for chat conversations. For structured output generation (business mode creating quotes/budgets/plans), `stepCountIs(7)` is used to accommodate the extra structured output step.

Harnesses and WorkflowAgent are not implemented yet.

### Recommended Direction

- Treat all AI SDK 7 surfaces as relevant because Codeclub is an IDE, not only a chat app.
- Keep `streamText` as the primary agent stream while the UI matures.
- Use AI SDK UI for chat rendering, streams, and future generative interfaces.
- Use Harnesses for workspace-aware coding agents with session state, permissions, file edits, sandboxed tools, and native coding-agent behavior.
- Use WorkflowAgent for durable tasks that can pause, resume, survive restarts, or wait for approvals.
- Use sandbox support for safe command execution, file access, and generated code.
- Use MCP Apps when tools need their own review, configuration, or interaction UI inside the IDE.
- Use telemetry, tracing, lifecycle callbacks, and performance stats for debugging agent behavior in production.
- Use TUI for fast local testing of agents before wiring full IDE surfaces.
