# Long chat history

Date: October 3, 2026. Context and memory limits, 15-turn visual pages,
turn virtualization, and incremental SQLite storage were implemented. Page reads
use a request counter so a late response cannot replace a chat opened afterward.

Historical summaries process at most 500 messages per update and retain a
bounded excerpt. Search queries SQLite, and migration preserves earlier history.
The view keeps up to 400 messages around the user; the full history remains
persistent.

## Persistence and native bridge

Electron stores `chats.sqlite` in the app data directory, using WAL and
transactions. The key separates project and chat; Windows paths are normalized.
Older global histories are migrated from settings before the renderer starts.
Project JSONL files are imported when opened and retained as backups. Deletion
leaves a marker so old history is not imported again.

The preload exposes `chatTurns` (project, chat, cursor, count, direction),
`chatPage` (bounded messages), `chatContext`, `chatAppend`, `chatSaveTail`,
`chatSearch`, `chatCopy`, `chatDelete`, and `chatTranscript`. Consumers are the
history hook, ChatInterface, and projectManager; `chats:*` handlers live in
main.ts. No internal events were added. Tail writes check the expected total to
reject concurrent changes; retries preserve the unloaded prefix. Transcripts
are individual append-only files outside settings.

## UI and context

The view retains up to 400 messages and mounts only turns near the viewport with
TanStack Virtual. It loads in both directions, preserves the scroll anchor, and
opens at the latest turn. Ordinary windows respect turn limits; an exceptional
turn that exceeds the limit is clipped in the view. The persisted file retains
all messages.

Chat changes sequence the exit (90 ms), hidden loading and scroll adjustment,
then entrance (140 ms). The request counter discards replaced selections even
during the exit. Reduced-motion preference removes durations; cleanup stops
pending animations. Pagination waits for the transition to finish, and
historical messages do not replay entrance animations when mounted. The UI test
samples frames to check for overlap and confirm the scroll position before
revealing the next chat; it also covers returning to an empty chat.

Initial loading that fills a short viewport happens before the entrance. Scroll
position uses only the virtualizer's end, with no second direct DOM adjustment or
external spacer that could alter its calculation. Entrance waits for four frames
with stable height, scroll, viewport, and last-turn position; a generating chat
uses one frame so streaming can appear. It also waits for mounted fonts and
images. A regression with 10,000 variable-height messages measures the last
turn's position during and after entrance, with less than one pixel of tolerance.

Each generation queries up to 80 recent messages. The budget uses UTF-8 bytes as
a conservative estimate, limits historical excerpts, and reserves room for
instructions, tools, and output. It is not an exact tokenizer. Excerpts are
incomplete and marked as untrusted content; `searchChats` retrieves older
snippets. During tool steps, old results are pruned before the budget is
exceeded. An oversized message produces a clear error instead of being silently
truncated.

## Verification

`npm run test:chat-history` compiles Electron and validates 10,000 messages:
migration, project separation, pagination in both directions, conflicts,
rollback, retries, literal search, copy, reopening, and deletion without
reimport. It also checks Unicode budgeting and window limits.

`npm run test:chat-ui` builds the app and opens ChatInterface in headless Edge
with a temporary profile, temporary SQLite database, and simulated local
provider. It validated opening at the latest message, loading older messages,
chat-switch races, SDK responses and incremental persistence, bounded context,
and regeneration while retaining unloaded history. With 10,000 messages, only
nine turns remained mounted. The test does not touch real chats or credentials.

`next:build`, `electron:compile`, TypeScript, and `git diff --check` passed. This
does not promise literally infinite messages: disk, individual message size, and
model context are finite. Real-provider compatibility and the full manual
interaction across projects, languages, terminals, and panels are not covered by
the simulated provider. Restart Electron to activate the new bridge and
migration.
