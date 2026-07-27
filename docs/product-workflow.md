# Product workflow

Codeclub is currently an AI-assisted local IDE with project-level evidence, not an autonomous product analytics platform.

## What works today

### Agent & Tools
- Agents can inspect files, edit code, run commands, use terminal processes, ask for decisions and delegate work.
- Two modes: **Development** (code creation) and **Business** (commercial analysis).
- AI-powered tool router selects the right tools based on user intent.
- AI-powered tool verification checks whether executed tools accomplished their goal.
- 16 tools in development mode: filesystem, terminal, browser, planning, memory, sub-agents, execution audit.
- Business tools: business workspace CRUD, quote/budget/plan creation, AI usage metrics, WhatsApp context.
- Seven specialized sub-agents: developer, explorer, frontend, backend, QA, security, documentation.
- Risky tools require explicit human approval (writeFile, runCommand, terminal).

### Planning & Artifacts
- Plans and TODOs are persisted per project in `agent-state.json`.
- The `Artifacts` sidebar presents plan/TODO/quote state and follows the selected project.
- Structured output generates quotes, budgets, and execution plans from AI responses.

### Execution Evidence
- `execution.jsonl`: audit log of every tool execution (tool name, input, output, timestamp).
- `usage.jsonl`: every generation records provider, model, tokens, cost, duration, status.

### Business Dashboard
- Aggregates AI usage and estimated model cost without requiring Vercel Gateway.
- Charts: area, bar, line, pie, radar, radial (Recharts 3).
- Business workspace: quotes, invoices, expenses, milestones, time entries, payments.
- Project-level filtering and date-range analysis.

### Terminal
- Multi-tab floating terminal dock (PowerShell, CMD, Git Bash, WSL2).
- Draggable and resizable.
- Agent can spawn persistent background terminal processes.
- Output buffered per tab with snapshot restoration.

### Built-in Browser
- Embedded Tauri WebView with URL bar, back/forward navigation.
- DOM inspector: click elements, inspect HTML, reference selections in chat.

### WhatsApp Bridge
- WhatsApp Web via `@whiskeysockets/baileys`.
- QR-based authentication.
- Agent can read chat context for business analysis.

### File Management
- Drag-and-drop file attachments (text, images, PDF, DOCX).
- DOCX-to-text conversion via mammoth.
- File tree explorer with CRUD operations.
- Git review panel (status + diff parsing).

### Code Editor
- CodeMirror 6 with syntax highlighting (JS/TS, HTML, CSS, JSON, Markdown, Python, Rust, SQL, XML).
- One Dark theme.

### Testing
- Reproducible testing prompts make tool-driven UI states inspectable without manual conversation repetition.

## What the diagnosis means

The current evidence can describe how an application is being built: activity, AI consumption, progress, plans, TODO completion, tool execution history, and project scope. It can support a sales conversation or pilot proposal.

It does not yet establish product-market fit, end-user behavior, retention, revenue or delivered customer value. Those require instrumentation inside the generated application, consent, a definition of success and a later analytics/CRM layer.

## Recommended product boundary

Keep Codeclub free and local-first while validating the workflow. Treat the editor and agent as the creation surface; treat project artifacts and usage as the evidence surface. Add paid layers only after pilots repeatedly use the evidence to make decisions such as scoping work, pricing a project or prioritizing a product improvement.
