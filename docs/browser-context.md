# Browser context and model-call diagnostics

`src/lib/engine/browser-context.ts` compacts browser tool results in the model loop before budget checks. This uses structural compression and exact text deduplication, with no trained classifier, external service, or site-specific rules.

- The current snapshot keeps every observed selector, control name, unique text, input value, URL and media signal. Geometry and duplicate labels are removed from model context because browser actions resolve selectors natively.
- Older snapshots of the same target lose stale selectors and snapshot IDs. Their distinct text and media evidence remain. Exactly repeated text from the same page is omitted with an explicit marker.
- Errors, non-browser outputs, tool-call IDs and message order are preserved. Raw results in chat, the tool console and audit logs are unchanged.
- Different browser targets are handled independently. Compression is deterministic and idempotent.

## Diagnostics

`EngineCallbacks.onModelCall` receives a correlation ID, step, attempt and start timestamp for each model invocation. Completed calls also expose duration, provider token usage, cached input tokens when available, time to first output, response time and per-tool execution times. Failed calls report only the error name. Retry records include the scheduled delay; unavailable token counts are left unset.

Chat traces include these records in `meta.modelCalls`. Chats and scheduled tasks also write `generation.model.started`, `generation.model.completed`, `generation.model.error`, `generation.model.aborted` or `generation.model.retrying` to their existing scoped execution log. No new window events are introduced.

`context.beforeBytes` and `context.afterBytes` measure serialized messages immediately before and after browser compression. They are byte measurements, not token estimates, and exclude system instructions/tool schemas and any subsequent general budget pruning. Provider-reported token usage remains the source for actual consumption.

These measurements distinguish model response latency, tool execution and retry delays. They do not establish the provider's internal cause of a slow response. They also do not promise a particular latency or token reduction: those depend on the page and the provider.

`attempt` counts graph attempts. Usage and elapsed times belong to the SDK invocation, which may include internal SDK transport retries. Failed internal transport attempts may have no provider-reported token counts. Prompt contents and credentials are not copied into these metrics.

## Checks

`npx tsx scripts/test-browser-context.mjs` checks current selectors/media, stale references, unique evidence, error preservation, independent targets and raw-result immutability. `npm run test:agent-graph` checks that per-call measurements track the model loop without replaying tool effects.
