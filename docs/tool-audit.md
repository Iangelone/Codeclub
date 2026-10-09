# Tool audit — October 9, 2026

## Scope

This audit covers the built-in tool contracts, shared execution loop, chat diagnostics, native project files, commands, browser control, terminals, scheduled tasks, and plugin resource isolation. Intelligent UI was removed at the user's request, including its tool, renderer, instructions, IPC, translations, tests, and documentation. Existing chat history was preserved.

## Findings and corrections

| Finding | Correction | Evidence |
| --- | --- | --- |
| LangChain rejected invalid inputs without explaining the failed schema constraint. | Enable `verboseParsingErrors` on the shared adapter. Validation still occurs before effects. | `test-agent-graph.mjs` verifies diagnostic details reach the next model step and only the corrected call performs an effect. |
| Chat trace entries replaced execution errors with `TOOL_EXECUTION_FAILED`; raw Error objects also did not serialize useful details in the timeline. | Store the error message, bounded to 4,000 characters, and error type; use the same normalized output in the timeline. | Code review of `ChatInterface.tsx`; chat integration test passes. The chat test does not independently assert every error presentation. |
| The stream notified the UI that a tool settled only on `tool-result`. | Also notify on `tool-error`, so failed tools clear the running state. | `test-agent-graph.mjs` verifies both rejected and successful calls notify completion. |
| Lexical project containment used a case-sensitive string prefix on Windows. | Use `path.relative` containment, matching the existing realpath containment check. Symlink escape protection remains active. | `test-native-commands.mjs` reads the same file with uppercase absolute paths and rejects traversal, outside paths, and the invented Linux path. |
| Tool definitions could push older chat history beyond the context budget. | Drop older complete turns after normal pruning, retaining the latest request and its tool chain. Reject if those still exceed the budget. | Shared engine and long-history chat tests pass. Context size remains a byte-based estimate, not an exact tokenizer count. |

## Trace diagnosis

The supplied trace selected `liquid/lfm-2.5-2.6b:free`. It attempted to read `/home/user/project/customers_orders.db` while the active project was a Windows directory. Native containment correctly rejected the request. The trace also contained malformed tool arguments. Its final metadata reported cancellation with `AbortError`; this was a cancelled model request, not evidence of a damaged database.

## Test maintenance

- Catalog tests now account for the Google fallback and the existing separation between direct-provider and Gateway-only model selection. Production routing was not changed.
- The computer cancellation test waits until the native operation actually starts before aborting. Aborting earlier correctly prevents the operation from starting.
- Browser editor tests load the extracted editor stylesheet instead of slicing rules out of `globals.css`.
- The chat's initial scroll assertion runs before menu interactions, which may move the scroll position through focus.

## Verification

The final tool-contract test covers **46 definitions and 165 invalid inputs**, with zero native effects or approval requests. It checks object schemas, closed properties, required fields, and validation before execution. This is a contract audit, not successful real execution of every tool.

Passed commands during this work:

```text
npx tsx scripts/test-tool-contracts.mjs
npx tsx scripts/test-agent-graph.mjs
npx tsx scripts/test-resource-tools.mjs
npx tsx scripts/test-ai-catalog.mjs
npx tsx scripts/test-computer-tools.ts
node scripts/test-computer-use.mjs
node scripts/test-native-commands.mjs
node scripts/test-plugin-resources.mjs
node scripts/test-chat-history.mjs
node scripts/test-chat-ui.mjs
node scripts/test-page-bootstrap.mjs
npx tsx scripts/test-browser-context.mjs
node scripts/test-browser-dom-picker.mjs
node scripts/test-external-browser.mjs
node scripts/test-browser-extension-origins.mjs
node scripts/test-browser-extension-reconnect.mjs
node scripts/test-browser-extension.mjs
node scripts/test-terminal-ui.mjs
node scripts/test-task-scheduler.mjs
node scripts/test-scheduled-tasks.mjs
npx tsx scripts/test-orb-state.mjs
npx tsx scripts/test-git-paths.mjs
node scripts/test-sidebar-layout.mjs
npx tsc --noEmit
npm run next:build
npm run electron:compile
git diff --check
```

Tests use temporary projects, local browser pages, mocked providers, or isolated profiles. Model recovery checks use the installed SDK with mock responses. They do not establish reliability for every real model, third-party MCP server, or external account. No production deletion, publication, package release, or Git push was performed. Expected simulated transport failures appear in some passing test logs.

## Comments and typography

Comments added in this work are in English. User-facing Spanish labels and error messages remain Spanish where appropriate. This check does not claim that every pre-existing comment in the repository is English.

The retained typography uses locally bundled Inter variable fonts, with installed OpenAI Sans first in the font stack. Asset sources and the OFL license are recorded in `public/fonts/README.md` and `Inter-LICENSE.txt`.
