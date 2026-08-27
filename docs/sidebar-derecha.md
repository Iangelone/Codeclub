# Right sidebar
The right sidebar is the IDE's tool shelf. It can open, close, and resize without squeezing the chat out of the workspace.

| Tab | What it does |
| --- | --- |
| Files | Browse, search, open, and preview project files. |
| Review | Show workspace and Git changes. |
| Browser | Open pages inside Electron and reference them. |
| Artifacts | Show plans and TODOs created by the agent. |
| Terminals | Open interactive terminals that persist during the session. |

The main panel keeps a minimum width. Sidebar width is stored locally. Browser and Terminals can have multiple tabs; other tabs are reused. Panels should have clear empty states and accessible labels.

Artifacts contain plans or TODOs with descriptions, progress, and status. They can be searched, referenced in chat, and deleted. Their state is project-scoped.

## Visual rules

Use dark surfaces (#191919 and #1E1E1E), soft borders, the electric accent (#8BC7FF / #3D9BFF), thin scrollbars, and short Motion transitions.
