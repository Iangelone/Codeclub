# Agent terminal output

The terminal tool reads incremental output by default. Offsets belong to the current tool session and terminal ID. full=true rereads the entire retained buffer; truncated=true signals that earlier output was evicted. The returned offset always refers to the raw stream.

Electron strips VT presentation sequences for plainText=true snapshots. Interactive terminals and ordinary snapshot callers retain the original stream. The agent output is a plain log, not a screen reconstruction.

For write, command appends Enter automatically. data sends literal input and requires an explicit newline to submit a command. Neither operation proves process success; read output before reporting completion. No action results are cached and no new execution limits are imposed.
