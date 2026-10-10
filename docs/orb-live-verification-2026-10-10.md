# Live orb verification — October 10, 2026

Codeclub was started with `npm run dev`. The existing orb was used through its real chat and configuration UI, with maximum autonomy and ordinary computer access enabled. No paid model was used, no credential was read or copied, and no model, task, or successful result was hardcoded into the application.

## Real model and tool evidence

The successful final runs used OpenRouter's `nvidia/nemotron-3-super-120b-a12b:free`, selected through the existing model selector. The public [OpenRouter catalog](https://openrouter.ai/api/v1/models) reported zero prompt and completion prices and tool support at verification time. Existing encrypted credentials remained in the native vault.

| Capability | Observed evidence | Result |
| --- | --- | --- |
| Programming | The orb generated a CommonJS calculator and `node:test` tests. Its real `runCommand` execution at 22:53:18 UTC ran `node --test calculator.test.cjs` in the disposable workspace. | Four tests passed; exit code 0. |
| Native PC | At 22:56:39 UTC the orb focused the disposable WPF fixture. At 22:56:43 it wrote through `ValuePattern`; at 22:56:46 it invoked the button through `InvokePattern`. | The actual window displayed `Applied: Orb PC verified 2026-10-10`; both the screenshot and orb's returned observation confirmed it. |
| Integrated browser | The orb opened the local fixture, inspected fresh DOM selectors, typed and clicked. At 22:57:05 UTC the returned page contained `Applied: Orb browser verified 2026-10-10`. | The local HTTP server independently received the exact submitted text. |
| Browser navigation | Real browser action results showed `/second` with `Second page verified` at 22:57:09 UTC, followed by `/` at 22:57:11 UTC. | Navigation and return succeeded in Codeclub's Electron WebView. |

The disposable calculator workspace is `C:/Users/iange/AppData/Local/Temp/codeclub-orb-live-e8038ae3ee0046c4ab1aab12c47ec225`. During the first attempt the model wrote the files under the global filesystem root rather than the full requested temporary path. The two generated files were inspected, moved to the intended temporary workspace, independently tested, and then tested again by the orb. The initial attempt was not treated as a successful end-to-end run.

Native computer audit entries intentionally omit screen contents and typed values. The model receives observations, while the audit records dispatch method and verification status. A dispatched `InvokePattern` alone was not counted as success: the resulting visible text was checked.

## Existing behavior polished

- Saving an older orb now enables ordinary computer access consistently with current orb creation. Administrator requirements remain a separate permission.
- Filesystem tool descriptions identify the actual root and preserve complete absolute destinations. Command descriptions distinguish the executable from its arguments.
- Provider retries unwrap nested SDK errors and honor `Retry-After`, including case-insensitive headers and HTTP dates. Already dispatched tools are not replayed.
- Native focus uses UI Automation when Windows rejects foreground activation. Focusing an observed control also activates its containing window, while retaining identity and foreground checks.
- Browser opening carries the requested URL through React state. A newly mounted WebView can no longer miss a navigation event and remain on its default page. Reopening the same requested URL after link navigation explicitly navigates the guest again. Restoring a browser uses its last page instead of replaying an old opening request.
- Development and export builds use separate directories; building the production app no longer removes files needed by the running development server. Desktop startup waits for a successful HTTP response.
- The native accessibility debug regression waits for DevTools readiness before inspecting it.

## Verification

Passed:

- `npm run next:build`
- `npm run electron:compile`
- `npx tsc --noEmit`
- `git diff --check`
- `npm run test:accessibility`
- `npm run test:debug`
- `node scripts/test-orb-chat.mjs`
- `npm run test:agent-graph`
- `node scripts/test-computer-use.mjs` — seven cases
- `node scripts/verify-computer-use.mjs` — real UI Automation, Unicode input, protected input masking, native OCR and canvas click; the optional parser transport is a separate stub assertion, not a live model inference
- `node scripts/test-orb-browser.mjs` — actual orb-scoped tools and Electron WebView, server-confirmed submission, navigation, repeated opening and restoration; no model calls or browser mocks

The successful orb conversation is separate from the isolated regression tests. The latter were not presented as evidence that a live model completed the task.

## Practical limits and final state

Free Gateway alternatives returned 503 errors or a five-request-per-minute limit. One zero-price Gateway model also required a paid subscription; it was not used successfully and no credits were purchased. OpenRouter's free model completed the requested checks. These results establish the exercised workflows, not reliability of every model or every desktop application.

The owned PC fixture was closed after verification. Codeclub remains running on the orb's completed response. The disposable local browser fixture remains available for inspection. Existing user chats and credentials were preserved.
