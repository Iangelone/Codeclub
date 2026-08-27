# Codeclub documentation
> A compact guide to understanding, using, and maintaining the app.

## Index

| Document | Answers |
| --- | --- |
| [About Codeclub](about.md) | What is the project trying to be? |
| [Architecture](arquitectura.md) | How is the app put together? |
| [Flows and events](flujos.md) | How do its parts communicate? |
| [Persistence](persistencia.md) | Where are chats, tasks, and settings stored? |
| [Right sidebar](sidebar-derecha.md) | What do its panels do? |
| [Terminal and browser](terminal-y-navegador.md) | How do the interactive tools work? |
| [Accessibility](accesibilidad.md) | How do we keep the UI usable and observable? |
| [Development](desarrollo.md) | How do we run, verify, and publish? |
| [Synapse](synapse.md) | What is the vision for Devices and traceability? |

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
