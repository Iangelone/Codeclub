# Right sidebar
The right sidebar is the IDE's tool shelf. It can open, close, and resize without squeezing the chat out of the workspace.

| Tab | What it does |
| --- | --- |
| Files | Browse, search, open, and preview project files. |
| Review | Show workspace and Git changes. |
| Browser | Open pages inside Electron and reference them. |
| Terminals | Open interactive terminals that persist during the session. |

The main panel keeps a minimum width. Sidebar width is stored locally. Browser and Terminals can have multiple tabs; other tabs are reused. Panels should have clear empty states and accessible labels.

Plans and TODOs are managed by the AI tools and remain project-scoped. They have no dedicated sidebar panel, and creating or updating them does not open a sidebar tab.

## Visual rules

Use dark surfaces (#191919 and #1E1E1E), soft borders, the electric accent (#8BC7FF / #3D9BFF), thin scrollbars, and short Motion transitions.
