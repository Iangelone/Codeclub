# Slash resources and management

The chat slash menu lists built-in extensions (including disabled ones), discovered plugin packages, their skills, their MCP server names, and global orbs. Plugin discovery follows the existing active-project precedence. Searching matches names, descriptions, IDs and category aliases. Creation entries prepare an editable request without sending it.

Selecting a plugin, MCP or orb adds a removable reference chip. Selecting a skill or built-in extension retains the existing session activation behavior. Sending includes identity metadata (kind, ID, plugin ID, skill/server name, scope and read-only status) in the user message, while `displayContent` preserves the user's visible text. MCP URLs, headers and environment values are excluded from discovery and references. Selection alone does not request a mutation.

The engine can discover these tools through `searchTools` / `executeTool`:

| Action | Tool |
| --- | --- |
| Discover installed resources and identities | `listResources` |
| Create a package / skill / MCP package | Existing `createExtension`, `createSkill`, `createMcpServer` |
| Read or edit a package manifest or skill instructions | `editPluginResource` |
| Remove one skill, preserving its package and siblings | `deleteSkill` |
| Edit or remove one server, preserving other servers and skills | `manageMcpServer` |
| List, create, edit, remove, run or pause a global orb | `manageOrb` |
| Remove a complete user package | Existing `deleteExtension` |

Built-in instructions and packages are read-only; create a personal copy to customize them. New targeted deletion tools request approval for the exact identity. Orb creation and editing do not start a run. Editing an existing orb also updates its existing native task while preserving schedule/status. Removing an executing orb fails through the scheduler; pause it and wait for its run to finish first. MCP updates patch only supplied fields, preserving omitted credentials and options, and take effect on the next message. Inspection returns transport and field names without secret values.

React accesses storage through the existing persistence adapter and native bridge. Electron reads/writes plugin files and removes skill directories. Plugin paths check both lexical boundaries and real ancestors, rejecting junctions outside plugin storage.

## Events

| Event | Emitter | Detail | Consumers / cleanup |
| --- | --- | --- | --- |
| `codeclub:orbs-changed` | OrbsPanel after saving; `manageOrb` after a persisted create/update/remove | None | ChatInterface reloads slash resources; OrbsPanel reloads orb definitions. Both install/remove listeners in the same `useEffect`. |
| Existing `codeclub:skills-changed`, `codeclub:extensions-changed`, `codeclub:mcp-changed` | Resource management tools after a successful mutation | `{ projectPath }`, empty for global scope | Existing extension listeners and ChatInterface reload their catalogs. ChatInterface removes all listeners in the registering effect and ignores outdated async results. |

## Verification

- `npx tsx scripts/test-resource-tools.mjs`: scoped edits, denied deletions, sibling preservation, built-in protection, orb persistence and secret-free discovery.
- `node scripts/test-plugin-resources.mjs` after Electron compilation: real native plugin operations in an isolated temporary profile, including traversal/junction rejection.
- `npm run test:chat-ui`: builds both processes and tests the slash catalog and resource references reaching the model, alongside chat stability, streaming, history and language checks.
