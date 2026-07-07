# Engine

The engine is the AI execution layer, separated from the React UI. Lives in `src/lib/engine/`.

## Files

| File | Purpose |
|---|---|
| `types.ts` | Shared types: `ToolEvent`, `ToolContext`, `EngineCallbacks` |
| `tools.ts` | `createTools(ctx)` — 5 workspace tools (listFiles, readFile, searchText, writeFile, runCommand) |
| `run.ts` | `runStream(params)` — AI SDK 7 `streamText` loop, returns assistant content |

## Architecture

```
ChatInterface.tsx (orchestrator)
  ├── createTools({ projectPath, recordToolEvent, setAgentState, requestToolApproval })
  └── runStream({ model, system, messages, tools, callbacks })
        └── streamText (AI SDK 7) — multi-step, max 6 steps, timeouts
```

## Tools

| Tool | Backend | Approval | Limits |
|---|---|---|---|
| `listFiles` | `codeclub_list_files` | No | maxFiles 400–1200 |
| `readFile` | `codeclub_read_file` | No | — |
| `searchText` | `codeclub_search_text` | No | maxMatches 80–200 |
| `writeFile` | `codeclub_write_file` | Sí | contentPreview 800 chars |
| `runCommand` | `codeclub_run_command` | Sí | Commands: bun, npm, pnpm, node, git, cargo, python, rg |

Cada tool recibe `ToolContext` que expone:
- `projectPath`: workspace activo
- `recordToolEvent`: callback para loggear eventos en el mensaje assistant
- `setAgentState`: actualiza estado visual del agente
- `requestToolApproval`: pausa y pide aprobación humana antes de ejecutar

## Engine Callbacks

`runStream` acepta `EngineCallbacks`:
- `onTextDelta(content)` — cada chunk de texto del stream
- `onToolCall()` — cuando el agente inicia una tool
- `onToolResult()` — cuando una tool retorna
- `onError(error)` — opcional, si no se provee lanza el error

## AI SDK Dependencies

- `ai` — streamText, tool, jsonSchema, stepCountIs
- `@ai-sdk/openai-compatible` — createOpenAICompatible para providers OpenAI-compatibles
- `@ai-sdk/react` — useChat (no usado aún)

Toda la comunicación HTTP con los modelos usa `fetch` via Tauri (`codeclub_http_fetch`) para exponer errores de red en lugar de errores opacos del webview.
