# Codeclub documentation
> A compact guide to understanding, using, and maintaining the app.

## Index

| Document | Answers |
| --- | --- |
| [Architecture](arquitectura.md) | How is the app put together? |
| [Flows and events](flujos.md) | How do its parts communicate? |
| [Persistence](persistencia.md) | Where are chats, tasks, and settings stored? |
| [Terminal and browser](terminal-y-navegador.md) | How do the interactive tools work? |
| [Floating chat](floating-chat.md) | How does the desktop widget share chats and controls with the main window? |
| [Orbe fluido](orbe-fluid.md) | ¿Cómo se genera el orbe WebGL y cómo ajustar su patrón sin perder el aspecto original? |
| [Chat history](revision-chat-historiales.md) | How are long conversations stored, paginated, and used as context? |
| [AI catalog and routing](ai-catalog.md) | How are providers, models, Gateway routes, credentials and transport errors handled? |
| [Motor del agente: resumen y límites](agent-stack.md) | ¿Qué usamos de AI SDK, Agent Plugins y LangChain, qué está probado y qué falta mejorar? |
| [Scheduled tasks](scheduled-tasks.md) | How do automatic runs, persistence, cancellation, and verification work? |
| [Prueba real de desarrollo](development-verification.md) | ¿Cómo verificar programación, tests, terminal y navegador con un modelo gratuito? |
| [Windows computer control](computer-use.md) | How do native actions, UI Automation, and OCR work? |
| [Development](desarrollo.md) | How do we run, verify, keep accessibility and publish? |

## Mental model

    Project -> Chat -> Agent -> Tool -> Result
        |       |       |        |
        |       |       |        +-> files / terminal / browser / artifacts
        |       |       +-> model and provider
        |       +-> persistent history
        +-> project settings, chats, and tasks

## Principles

- Local-first: working data lives locally.
- Project-first: each project can have its own chats, tasks, and artifacts.
- Flexible agent: the model chooses tools from the available catalog.
- Visible evidence: plans, TODOs, usage, and logs make the work easier to understand.
- Simple UI: few colors, compact controls, and clear states.
