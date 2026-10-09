# Codeclub — AI coding agent for Windows

> Give your coding agent access to the tools around your code: project files, PowerShell, browser tabs, and Windows apps.

Codeclub is an independent, local-first desktop workspace for developers who want to work with AI on their own Windows machine. Open a project, connect a supported AI provider, and ask the agent to understand the code, make changes, run commands, inspect a website, or interact with other desktop apps.

The idea behind Codeclub is simple: coding work does not happen in chat alone. The useful context may be in a repository, a terminal, a browser tab, or another Windows app. Codeclub brings those tools into one workflow and keeps the agent's actions visible so you can follow what it is doing.

<p align="center">
  <img src="docs/assets/installed-startup.png" alt="Codeclub desktop workspace for AI-assisted development on Windows" width="1000">
</p>

[![Beta](https://img.shields.io/badge/status-beta-3d9bff)](#project-status) [![Windows](https://img.shields.io/badge/platform-Windows-1687ff)](#requirements) [![Electron](https://img.shields.io/badge/desktop-Electron-8bc7ff)](#how-it-works)

## Why Codeclub?

Use an AI coding agent in the context where development actually happens. Codeclub connects your project to files, PowerShell, Git changes, browser pages, and Windows computer-use tools in the same desktop workspace.

- **Work on your actual project.** Ask the agent to read and search files, edit code, run commands, and review Git changes.
- **Bring your own provider and model.** Choose a supported OpenAI-compatible provider instead of being tied to a single AI vendor.
- **Connect coding work to the browser.** Inspect pages in Codeclub's built-in browser, or use the companion extension with existing Edge, Chrome, and Brave tabs.
- **Use Windows desktop tools.** Computer Use can inspect and interact with open apps through Windows accessibility and OCR. The information available depends on each app.
- **Keep the workspace on your machine.** Projects, chats, settings, and usage records are stored locally rather than in a Codeclub-hosted workspace.

## A typical workflow

1. Open a project and start a project chat.
2. Ask the agent to investigate an issue or implement a change.
3. Follow its plan as it reads files, searches the code, and uses PowerShell when needed.
4. Inspect the resulting changes and Git status in the workspace.
5. If the task involves a website, open it in the browser and reference page elements in chat. For an existing Chromium tab, connect the Browser Control extension.

The agent can also create plans and TODOs, keep project conversations together, and run scheduled tasks while Codeclub is open.

## What's included

| Workspace tool | What it does |
| --- | --- |
| **Project chat** | Keep global or project-specific coding conversations and history. |
| **Files and Review** | Browse project files, open previews, and inspect workspace or Git changes. |
| **PowerShell terminal** | Run commands and keep interactive terminal sessions available. |
| **Browser** | Open websites, inspect their DOM, and send element references to chat. |
| **Browser Control extension** | Connect to existing Edge, Chrome, and Brave tabs for DOM-aware inspection and interaction. |
| **Computer Use** | Inspect and interact with open Windows apps through UI Automation and OCR, where supported. |
| **Plans and TODOs** | Track task steps and project artifacts from the agent conversation. |
| **Plugins and MCP** | Add skills, plugins, and MCP servers for custom tools and workflows. |

## Local workspace, your choice of AI provider

Codeclub stores workspace data locally. **Local-first does not mean local AI inference:** prompts and the context needed for a response are sent to the AI provider you select. You provide that provider's API key; Codeclub stores credentials separately in its encrypted vault. The provider may charge for API usage under its own terms.

## License and cost

Codeclub is independently developed and distributed under a **dual license**. Free use covers personal use, learning and education, nonprofit organizations, qualifying open-source projects, and certain freelancers. Companies, paid services, commercial products, and other commercial uses require a commercial license. See the [full license](LICENSE.md) for the exact terms or contact [codeclubide@gmail.com](mailto:codeclubide@gmail.com).

The Codeclub app has no subscription fee for uses allowed by the free license. AI provider usage is separate and may cost money. Supporting the project through [Ko-fi](https://ko-fi.com/iangeldev) is optional.

## Get started

### Requirements

- Windows.
- An API key from a supported provider to use the AI agent.
- Node.js 24 (or a version compatible with Next.js 16) and npm 11 if running from source.

### Download

Get the latest Windows installer from [GitHub Releases](https://github.com/Iangelone/Codeclub/releases/latest). Codeclub is in early beta; see [Project status](#project-status) for current limitations.

### Run from source

```powershell
git clone https://github.com/Iangelone/Codeclub.git
cd Codeclub
npm install
npm run dev
```

To create the Windows installer:

```powershell
npm run package:win
```

The installer is generated in `release/`. See [development and releases](docs/development.md) for the full workflow.

To connect an existing Chromium browser, open **Extensions → Codeclub Browser Control → Install**. Edge opens the Add-ons listing; other detected Chromium browsers use **Developer mode → Load unpacked**. For development, load the repository's `browser-extension` folder unpacked and reload it after changes. Keep Codeclub running for normal use. Source fixes are not automatically delivered to store installations.

See [Browser Control: setup, troubleshooting, and agent contracts](docs/browser-control.md) for tab groups, permissions, visibility requirements, and direct debugging without provider calls.

## How it works

Codeclub uses React and Next.js for the interface and Electron for Windows operations. The renderer does not access Node.js directly: filesystem, terminal, browser, and computer-use actions pass through Electron's preload bridge and IPC.

The agent uses a multi-step tool loop, with LangGraph for orchestration, LangChain for tool validation and execution, and AI SDK for provider transport and streaming. MCP servers, skills, and plugins can extend the available tools.

## Project status

Codeclub is in **early beta** and currently targets Windows. Scheduled tasks run while the app remains open. Computer Use depends on what each Windows application exposes through accessibility and OCR, so some controls may provide limited information. See the [agent stack overview](docs/agent.md) for current integrations and limits.

## Documentation

- [Architecture](docs/architecture.md)
- [Agent stack, integrations, and limits](docs/agent.md)
- [Browser Control: user and agent guide](docs/browser-control.md)
- [Computer Use on Windows](docs/computer.md)
- [Scheduled AI tasks](docs/schedule.md)
- [Terminal and browser](docs/workspace.md)
- [Development and releases](docs/development.md)
- [All documentation](docs/README.md)

## Community and support

- Ideas and bug reports: [GitHub Issues](https://github.com/Iangelone/Codeclub/issues)
- Support Codeclub: [Ko-fi](https://ko-fi.com/iangeldev)
- Commercial licensing: [codeclubide@gmail.com](mailto:codeclubide@gmail.com)

Fluid Orb is adapted from [Rare UI](https://www.rareui.com/components/fluidorb).
