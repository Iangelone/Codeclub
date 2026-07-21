# Engine

The engine is the AI execution layer, separated from the React UI. Lives in `src/lib/engine/`.

## Files

| File | Purpose |
|---|---|
| `types.ts` | Shared types: `ToolEvent`, `ToolContext`, `EngineCallbacks` |
| `tools.ts` | `createTools(ctx)` — 15 tools: workspace, planning, subagent y memory CRUD |
| `run.ts` | `runStream(params)` — AI SDK `streamText` loop, returns assistant content |
| `memory.ts` | `saveMemory`, `loadMemory`, `searchMemory`, `deleteMemory`, `deleteMemoriesByTag` |

## Architecture

```
ChatInterface.tsx (orchestrator)
  ├── createTools({ projectPath, recordToolEvent, setAgentState, requestToolApproval })
  └── runStream({ model, system, messages, tools, callbacks })
        └── streamText (AI SDK)
```

## Tools

| Tool | Backend | Approval | Limits |
|---|---|---|---|
| `listFiles` | `codeclub_list_files` | No | maxFiles 400–1200 |
| `readFile` | `codeclub_read_file` | No | — |
| `searchText` | `codeclub_search_text` | No | maxMatches 80–200 |
| `writeFile` | `codeclub_write_file` | Sí | contentPreview 800 chars |
| `runCommand` | `codeclub_run_command` | Sí | Commands: bun, npm, pnpm, node, git, cargo, python, rg |
| `subagent` | `runStream` interno | No | Tools read-only (listFiles, readFile, searchText) |
| `remember` | `saveMemory` | No | Guarda en la carpeta de configuración del SO, por proyecto |
| `recall` | `searchMemory` | No | Busca por key o tag |
| `forget` | `deleteMemory` | No | Elimina por key exacta |
| `askUser` | Solicitud estructurada | No | Devuelve una pregunta pendiente sin UI |
| `createPlan` | `agent-state.json` en configuración del SO | No | Crea un plan persistente |
| `updatePlan` | `agent-state.json` en configuración del SO | No | Actualiza plan o paso |
| `todo` | `agent-state.json` en configuración del SO | No | CRUD de TODOs persistentes |
| `getTaskStatus` | `agent-state.json` en configuración del SO | No | Lee plan y TODOs actuales |

Cada tool recibe `ToolContext`:
- `projectPath`: workspace activo
- `recordToolEvent`: callback para loggear eventos en el mensaje assistant
- `setAgentState`: actualiza estado visual del agente
- `requestToolApproval`: pausa y pide aprobación humana antes de ejecutar
- `provider` / `modelId`: (opcional) para tools que spawnnean sub-agentes

## Engine Callbacks

`runStream` acepta `EngineCallbacks`:
- `onTextDelta(content)` — cada chunk de texto del stream
- `onToolCall()` — cuando el agente inicia una tool
- `onToolResult()` — cuando una tool retorna
- `onError(error)` — opcional, si no se provee lanza el error

## Memory

Las tools `remember`, `recall`, `forget` persisten en la carpeta de configuración del SO.
Cada entrada: `{ key, content, tags[], created_at, updated_at }`.
Al borrar un chat/nota/tabla, se limpian automáticamente las memorias con tag `{kind}:{itemId}` en `index.astro`.
