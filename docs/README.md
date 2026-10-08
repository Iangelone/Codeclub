# Codeclub documentation
> A compact guide to understanding, using, and maintaining the app.

## Index

| Document | Answers |
| --- | --- |
| [Architecture](architecture.md) | How is the app put together? |
| [Flows and events](flows.md) | How do its parts communicate? |
| [Persistence](storage.md) | Where are chats, tasks, and settings stored? |
| [Terminal and browser](workspace.md) | How do the interactive tools work? |
| [Floating chat](widget.md) | How does the desktop widget share chats and controls with the main window? |
| [Fluid orb](orb.md) | How is the WebGL orb generated, and how can its pattern be adjusted without losing its original look? |
| [Browser style editor](styles.md) | How are selected page styles previewed, confirmed, and reverted? |
| [Chat history](history.md) | How are long conversations stored, paginated, and used as context? |
| [AI catalog and routing](catalog.md) | How are providers, models, Gateway routes, credentials and transport errors handled? |
| [Agent engine: overview and limits](agent.md) | What do we use from AI SDK, Agent Plugins, and LangChain, what has been tested, and what remains to improve? |
| [Scheduled tasks](schedule.md) | How do automatic runs, persistence, cancellation, and verification work? |
| [Live development verification](verification.md) | How can coding, tests, the terminal, and browser be verified with a free model? |
| [Windows computer control](computer.md) | How do native actions, UI Automation, and OCR work? |
| [Development](development.md) | How do we run, verify, keep accessibility and publish? |
| [Browser extension privacy](privacy.md) | What browser data can the extension access, and how is it used? |
| [Browser extension listing](listing.md) | What store listing text and permission explanations are prepared? |

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
