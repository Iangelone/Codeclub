# Live development verification with a free model

## Reproduce

From Codeclub, using an existing, authorized test project folder:

```powershell
node scripts/test-development-live.mjs 'C:\absolute\path\to\project'
node scripts/verify-development-site.mjs 'C:\absolute\path\to\project'
```

The first test requests the credential through stdin without echo, or reads
`AI_GATEWAY_API_KEY`. It queries the current Gateway catalog and selects a
language model with tool support and zero input/output prices. It prioritizes
coding descriptions and available context; no provider or model ID is hard-coded.
`CODECLUB_FREE_MODEL_INDEX` selects another catalog candidate for testing.
`CODECLUB_DEVELOPMENT_PROMPT` supplies a specific request for reviewing an
existing project; the evaluator keeps the same evidence requirements.

The test runs the real chat and browser components, the LangGraph/LangChain/AI
SDK engine, and Electron/preload. A temporary profile encrypts the credential
and is deleted at the end. It does not modify the user's credentials. Approve
only the effects of the development cycle authorized for the specified folder.
That approval belongs to the evaluator; it does not change the app's normal
permission policy.

The model inspects files, creates a plan, builds the website, runs tests/build,
starts the server in a PTY, and uses the WebView to test filters and submit a
local form. The evaluator requires tool results, checks with zero exit codes, a
visible confirmation button, and a completed plan. It may request continuation
if a response ends before the goal is complete. Reports without credentials are
saved in `.codeclub-qa/`: conversation, audit log, and result. Independent
verification checks routes, assets, JavaScript errors, mobile/desktop width,
filtering, validation, local persistence, and form reset.

## Fixes found during testing

- **Discovery:** `searchTools` returns the actual JSON Schema without the SDK
  wrapper. `executeTool` accepts an object or a JSON-encoded object and also
  validates discovered-tool arguments with LangChain before performing an
  effect. Invalid JSON, arrays, null, missing fields, incorrect types, and extra
  properties are rejected; invented names or arguments are not corrected.
- **Continuation:** A tool error is returned to the model so it can correct its
  arguments; it does not end the graph prematurely. Call/result metadata exposed
  by the SDK getters is preserved.
- **Windows:** `runCommand` uses an isolated PTY, literal arguments, and the real
  command exit code. The supervisor keeps the console owner alive until its
  processes close, including background processes. Timeout is configurable
  (120 seconds by default). Output combines stdout/stderr in `stdout` without
  ANSI controls; it does not keep servers running. The persistent terminal
  normalizes Enter to CR, as expected by the Windows PTY.
  `npm run test:native-commands` checks arguments, `.cmd`, errors, timeouts, and
  descendant cleanup, even after the parent has exited.
- **Browser:** A failed state keeps `ok: false`; selects expose options/values,
  checkboxes expose their state, and typing into a select validates the option.
  Each action returns updated DOM and fresh references for the next action,
  reducing model queries. `getBrowserState` observes again if the page changes or
  state is unavailable.
- **Logging:** Chat saves each tool's final execution result and reports errors
  even if partial text was produced before the failure.
- **Long tasks:** Chat allows up to 128 steps per run, with cancellation and a
  context budget; this does not mean automatic success or unlimited execution.
- **Streaming rate limits:** The graph can wait and retry generation up to twice
  if the step did not request tools. Waiting is cancellable (30/60 seconds by
  default, with a numeric `retry-after` when present, capped at 60 seconds per
  wait). If the step called tools, it fails without replaying them. Persistent
  limits are reported; the app does not silently switch models.

## Verified result on 2026-10-04

The final test in `C:\Users\iange\OneDrive\Documents\Proyectos\Salieri`
finished with `agentCycleComplete: true`, no renderer errors, and the plan
persisted as complete. It used `poolside/laguna-s-2.1-free`, selected from live
Gateway catalog candidates, with zero-priced input/output. This ID describes
the observed run; it is not a fixed product or evaluator selection.

The model ran `npm.cmd test` (21 passing tests) and `npm.cmd run build` (4 HTML
files, 54 links, and 10 files) with exit code zero. It started the server through
the persistent terminal and completed nine successful browser actions: the
“Mezcla” filter showing 3/12 projects, a completed form, visible confirmation,
and reset. It read/wrote files and checked its README before finishing. The
website was built and corrected over several attempts; the final run reviewed
those files. A partial attempt is not counted as the approved final run.

Independent review again approved all four routes and assets at 1440/390 px,
with no horizontal overflow or JavaScript errors, and verified filtering, five
validation errors, confirmation, the localStorage message, and reset. Evidence
is in `.codeclub-qa/result.json`, `chat.json`, `execution.jsonl`, and
`independent.json` in Salieri.

Next/Electron builds, TypeScript, and `git diff --check` passed. Regressions
cover the graph, dynamic arguments, task runner, chat, startup, and native
command execution. Serialized JSON arguments and nested validation were added
after the final run and checked with simulated effects, including rejected
inputs producing no effect. A real scheduled task also passed afterward with
`inclusionai/ling-3.0-flash-sante`, a free model selected from the catalog: file
read verified, one execution, result persisted, usage recorded, and credential
encrypted. Its prompt requested JSON-encoded arguments; the evaluator checks the
actual read, not the exact form of the model's call.

## Scope

The test checks one concrete workflow with a model selected from the current
catalog. It does not prove universal compatibility or guarantee the quality of
any free model. During the 2026-10-04 review, one free candidate returned
`RateLimitError`: zero price does not mean unlimited use. Another candidate in
the same catalog was tested through the test index; the app does not
automatically change the user's selected model. The test site uses Node without
external dependencies and a local contact confirmation; it does not deploy or
send messages to third parties. The graph still has no checkpoints to resume a
node after the app closes.
