# Orb conversations and proactive learning

## User flow

Continue saves an orb and immediately opens its persistent orb conversation outside the ordinary chat index. A local welcome message appears without an API request. The right sidebar lists pending configuration requests, devices actually used, and execution history. Its wrench opens the existing provider/model/key controls in a compact modal. Saving updates this orb without changing ordinary chat preferences. Keys remain in the native credential vault.

Maximum autonomy enables proactive suggestions during app use. The setup exposes one autonomy switch, initially disabled. New orbs use normal local computer access without an automatic elevation request; existing permission settings remain in effect. The activity menu pauses/resumes autonomy. Pausing retains learned weights, stops new observations/suggestions, and cancels proactive workers. Deleting an orb removes its learning profile on settings refresh.

## Observation boundaries

The renderer sends fixed section identifiers and credential readiness every 30 seconds while visible. Electron checks that the main window is visible, not minimized, the desktop unlocked, and inactivity under five minutes. Heartbeats older than 90 seconds block new suggestions. Closing the app stops learning; this is not an always-running cloud service.

Metadata includes section counts/transitions and native action categories. With PC access enabled, Electron samples only foreground process names through a fixed PowerShell script and excludes known password-manager names. It never reads input values, keystrokes, titles, screenshots, clipboard contents, credentials, or unrelated documents. It does not observe everything on the PC.

Profiles remain in `orb-learning.json` in Electron's user-data directory. Disabling PC access removes process counts. Profiles contain counts, bounded process identifiers, weights, timestamps, and hashes, without API keys or message text. Bounded metadata and the last ten visible orb messages are sent to the configured model provider. Existing stores retain conversation and task history.

## Actual machine learning

`OrbLearning` implements online logistic regression with stochastic gradient descent and L2 regularization. Features include bias, context frequency, bounded context changes, and sine/cosine time-of-day features. A reply within ten minutes supplies positive engagement feedback. Silence supplies weak negative feedback only during continuous active observation; an idle gap drops the pending sample.

Feedback estimates engagement, not correctness or acceptance. This trains a small local timing/filter model, not the provider's language model. Initial behavior uses a neutral prior. After five feedback samples, low estimated engagement suppresses suggestions. Context counts and transition frequency also personalize the model prompt.

## Delivery and limits

Proactive jobs use the native scheduler and canonical orb chat ID. They claim that session, preserve recent history in updates, and append assistant messages without a user message. They have **no tools** and cannot execute suggestions. Explicit background objectives use the existing separately controlled task runner.

Valid model configuration and credentials are required; busy chats are skipped. Attempts require new context and a 30-minute cooldown. Deliveries have a one-hour cooldown. `NO_SUGGESTION` remains silent. Normalized exact duplicates are rejected against twenty hashes; recent conversation discourages semantic repetition. Generation has a 350-output-token limit and existing run timeout. Provider charges may apply. Inactive/paused environments reject delivery, although an already started request may finish before rejection.

## Events and cleanup

### Upcoming scheduled tasks

While maximum autonomy and active-use observation are enabled, the orb receives task names, project paths, scheduled times, and approval policy for active user tasks due within fifteen minutes. Paused tasks, internal orb loops, and queued/running tasks are excluded. Task prompts and credentials are not included. This context spans existing global and project tasks and uses the orb's configured provider.

Each approaching occurrence can trigger one notice attempt per orb, independently of generic engagement cooldowns. Hashed occurrence keys persist across restarts; changing the scheduled time creates a new occurrence. Busy chats, missing credentials, and inactive windows still block requests. Slow responses are discarded if any anticipated task has been paused, moved, or started before delivery. A failed request is not retried for that occurrence. If the provider returns silence or an unrelated suggestion, the runner supplies a localized factual schedule notice with an offer to help prepare.

The proactive message can explain the scheduled start and offer preparation help. It has no tools and cannot execute early. The existing native scheduler starts the real task at its due time; mutations retain the existing approval flow. A notice is not a completion receipt. `test-upcoming-tasks.mjs` verifies anticipation, scope, persistence, rescheduling, gates, and execution exactly once at the due time.

Live verification on October 9, 2026 used the isolated debug profile and the zero-priced Ling model. The orb displayed a localized approaching-task notice in its persistent conversation. The one-shot task was due at `2026-10-10T01:02:45.273Z`, started at `01:02:47.907Z`, and completed at `01:02:56.149Z` with exactly one run and the expected `TASK_SCHEDULE_OK` response saved to its task chat. The normal fifteen-second scheduler polling interval explains the start delay. Computer Use confirmed the notice and the new result chat in Recents. Tool approvals, denial, credential errors, cancellation, and scoped result persistence were additionally covered by the isolated SDK regression fixture.

| Event | Emitter and payload | Consumer and cleanup |
| --- | --- | --- |
| `codeclub:configure-orb` | OrbSidebar, `{ orbId }` | OrbsPanel opens configuration and removes its listener in the same effect. |
| `codeclub:orb-agent:open-chat` | OrbAgentChat/activity row, `{ chatId, projectPath: '', name, customName: true }` | Existing ChatInterface loader and event-prefix cleanup. OrbAgentChat clears its timer. |

OrbActivityObserver listens to existing `codeclub:orbs-changed` and `codeclub:settings-changed` and removes both listeners and its timer in the same effect. UI-only native command `codeclub_orb_observe` takes `{ surface, ready, language }`. `codeclub_orb_proactive_result` takes `{ message }` only from an assigned proactive worker. Native timers stop before quit; sidebar task subscriptions are released on cleanup.

## Verification limits

Isolated fixtures cover learning updates, persistence, permissions, active-use gates, cooldowns, duplicate rejection, and provider delivery. They never contact a paid provider or request UAC. Actual elevation and foreground-process sampling still require manual Windows verification.

Validated on October 9, 2026: `next:build`, `electron:compile`, `tsc --noEmit`, and `git diff --check`; `test-orb-learning.mjs`, `test-orb-chat.mjs`, `test-scheduled-tasks.mjs`, `test-sidebar-layout.mjs`, `test-accessibility.mjs`, and `test-page-bootstrap.mjs`. The shell fixture also verifies that opening the canonical orb conversation through Recents restores the orb sidebar. All 26 previously captured editable field elements retain their source unchanged, allowing only line-ending normalization in the comparison.

See [comparison](agent-comparison.md) and [permissions](orb-permissions.md).

## Live debug verification

On October 9, 2026, the Windows app was launched with an isolated temporary Electron profile and a loopback debug port. Computer Use verified Continue, provider configuration, chat submission, and reopening the orb through its dedicated sidebar entry. The existing encrypted gateway credential remained in the native vault. The live provider catalog reported zero input/output pricing for `inclusionai/ling-3.1-flash-free`; that model returned a normal response in approximately 47 seconds and a native scheduled proactive response in approximately five seconds. These timings describe this run, not a latency guarantee.

Synthetic conversation context was used throughout. The proactive response reached the same persistent orb chat without a new user message or action tools. A subsequent synthetic reply updated and persisted the local learning weights with one feedback sample. PC access remained disabled; UAC elevation and foreground-process sampling were not verified.

This run exposed and fixed two integration faults: an uninitialized orb sidebar width and a missing one-shot execution date when saving the paused proactive scheduler job. The sidebar regression now checks visible geometry, and the learning fixture saves and executes the actual scheduler job factory. Production build, TypeScript, Electron compilation, whitespace checks, sidebar regression, and orb chat/learning regressions passed after the fixes.

## Sidebar lifecycle

The orb sidebar is mounted only while the orb surface is active. Its clear-chat action empties the orb history immediately after one click when no run is active. After persistence, OrbSidebar emits `codeclub:orb-agent:history-cleared` with `{ chatId }`. The matching ChatInterface panel clears its visible history and runtime state; the event listener is registered and removed in the same effect as its open-chat listener. Ordinary chats and project histories are unaffected.
