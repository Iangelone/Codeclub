# Product workflow

Codeclub is currently an AI-assisted local IDE with project-level evidence, not an autonomous product analytics platform.

## What works today

- Agents can inspect files, edit code, run commands, use terminal processes, ask for decisions and delegate read-only work.
- Plans and TODOs are persisted per project in `agent-state.json`.
- The `Artifacts` sidebar presents that plan/TODO state and follows the selected project.
- Each generation records local token, duration, provider and model data in `usage.jsonl`.
- The business panel aggregates usage and estimated model cost without requiring Vercel Gateway.
- Testing prompts make tool-driven UI states reproducible.

## What the diagnosis means

The current evidence can describe how an application is being built: activity, AI consumption, progress, plans, TODO completion and project scope. It can support a sales conversation or pilot proposal.

It does not yet establish product-market fit, end-user behavior, retention, revenue or delivered customer value. Those require instrumentation inside the generated application, consent, a definition of success and a later analytics/CRM layer.

## Recommended product boundary

Keep Codeclub free and local-first while validating the workflow. Treat the editor and agent as the creation surface; treat project artifacts and usage as the evidence surface. Add paid layers only after pilots repeatedly use the evidence to make decisions such as scoping work, pricing a project or prioritizing a product improvement.
