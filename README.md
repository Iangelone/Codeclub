# Codeclub

Open source desktop IDE for building applications with AI, made in Argentina.

[Ko-fi](https://ko-fi.com/codeclubide) · [Licencia](LICENSE.md)

## What is Codeclub

Codeclub is an AI agent workspace that helps developers build applications with AI while producing auditable evidence — plans, TODOs, token usage, estimated costs — that supports commercial proposals, scoping, and pricing conversations.

It is **local-first**: all data lives on your filesystem. No cloud, no vendor lock-in, no telemetry.

## Features

### AI Agent
- Multi-step agent with filesystem access, terminal execution, and browser control
- Supports any OpenAI-compatible provider (live catalog from [models.dev](https://models.dev))
- **Two modes**: Development (code creation) and Business (commercial analysis)
- Provider-agnostic `Custom` endpoint for self-hosted or private models
- AI-powered tool router selects the right tools based on user intent
- AI-powered tool verification checks whether executed tools accomplished the goal
- Human-in-the-loop approvals for risky operations

### Agent Tools (Development)
| Tool | Description |
|---|---|
| `listFiles` | List workspace directory contents |
| `readFile` | Read any project file |
| `searchText` | Full-text search across the workspace |
| `writeFile` | Create or modify files (requires approval) |
| `runCommand` | Execute commands — `bun`, `npm`, `git`, `cargo`, `python`, `rg` (requires approval) |
| `terminal` | Spawn persistent background terminal processes |
| `openBrowser` | Open URLs in the built-in browser |
| `askUser` | Request structured human decisions |
| `createPlan` / `updatePlan` / `todo` / `getTaskStatus` | Persistent planning and TODOs |
| `subagent` | Delegate to specialized read-only agents (developer, explorer, frontend, backend, QA, security, docs) |
| `remember` / `recall` / `forget` | Persistent memory per project |
| `getExecutionLog` | Auditable tool execution history |

### Agent Tools (Business / Economy)
Provides development tools for files, terminal, browser, memory, plans, TODOs and agent delegation.

### Panels & Views
- **Left sidebar**: project management, chat history, file explorer with CRUD, drag-and-drop
- **Right sidebar** (resizable): file browser, git review, embedded WebView browser, artifacts (plans/TODOs/quotes), WhatsApp bridge
- **Terminal dock**: multi-tab floating terminal (PowerShell, CMD, Git Bash, WSL2), draggable and resizable
- **Code editor**: CodeMirror 6 with syntax highlighting (JS/TS/HTML/CSS/JSON/MD/Python/Rust/SQL/XML)

### Built-in Browser
- Embedded Tauri WebView with URL bar, back/forward navigation
- **DOM inspector**: click elements in the browser, inspect HTML, and reference selections in chat
- Visibility toggle and resize support

### Business Dashboard
- Aggregates AI usage: generations, tokens, estimated cost, duration
- Tracks business metrics: revenue, expenses, hours, monthly fees
- Charts powered by **Recharts**: area, bar, line, pie, radar, radial
- Project-level filtering and date-range analysis
- Business workspace: quotes, invoices, expenses, milestones, time entries, payments

### Usage Tracking
- Every AI generation records to `usage.jsonl`: provider, model, tokens, cost, duration
- Local-only, no cloud dependency
- Per-project and global aggregation

### WhatsApp Integration
- WhatsApp Web bridge via `@whiskeysockets/baileys`
- QR-based authentication
- Agent can read WhatsApp context for business analysis
- Read-only from the agent side

### File Attachments
- Drag-and-drop or file-picker for text, images, PDFs, and DOCX
- DOCX conversion via `mammoth`
- File content inlined as message context

## Architecture

```
ChatInterface.tsx (React orchestrator)
  ├── createTools()  — AI agent tools
  ├── runStream() → streamText (AI SDK v7)   — core agent loop
  └── Tool execution backed by Tauri commands (Rust → native OS)
```

**Frontend**: Astro 7 + React 19 + TypeScript + Tailwind CSS 4
**Backend**: Rust + Tauri 2 (filesystem, terminal, HTTP fetch, browser, WhatsApp)
**Runtime**: Bun 1.3
**AI**: AI SDK v7 (`ai`, `@ai-sdk/openai-compatible`, `@ai-sdk/react`)

## Getting Started

### Prerequisites
- [Bun](https://bun.com) 1.3+
- [Rust](https://rustup.rs) (for Tauri native backend)

### Install & Run

```bash
bun install
bun run dev
```

### Build

```bash
bun run build
```

## Documentation

- [Product Workflow](docs/product-workflow.md) — current boundaries and next steps
- [Engine](docs/engine/) — AI execution layer
- [Components](docs/components/) — UI components and design tokens
- [Models & Providers](docs/models/) — AI catalog
- [AI SDK 7](docs/stack/ai-sdk-7.md) — AI SDK integration notes

## AI Catalog

Providers and models are sourced live from [models.dev](https://models.dev):

- Models: https://models.dev/models/
- Providers: https://models.dev/providers/

## AI SDK

AI SDK documentation: https://ai-sdk.dev/docs

## License

**Dual license** — see [LICENSE.md](LICENSE.md) for full terms.

- **Gratis**: uso personal, educativo, freelancers (< USD 60k/año), ONGs, open source.
- **Comercial paga**: empresas, corporaciones, uso comercial, SaaS, freelancers (> USD 60k/año).

Contacto para licencias comerciales: **codeclubide@gmail.com**
