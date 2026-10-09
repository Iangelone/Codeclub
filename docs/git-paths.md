# Machine-readable Git paths

Workspace snapshots and the Review panel use `nativeInvoke('codeclub_git_read', { projectPath, operation, scope?, ref? })`. The native handler resolves the project root and scheduled workers enforce the same project scope as other workspace commands.

Supported read operations are `files`, `status` and `numstat`. Electron runs Git through pipes with NUL-separated output (`-z`), UTF-8 decoding, a 15-second timeout and an 8 MB buffer limit. It does not pass this output through the terminal emulator. Reference arguments cannot start with `-`.

`src/lib/git-output.ts` parses literal paths without trimming spaces or interpreting Git's human-readable quoting. Rename records are consumed as separate source/destination fields. Both UI consumers use the same parsers.

This fixes two distinct failures: Git's quoted octal UTF-8 paths were previously read as literal filenames, and the PTY could remove the first status-column space, making a fixed-width parser drop the first filename character. Raw file-tool paths are not decoded heuristically.

Check: `npx tsx scripts/test-git-paths.mjs`.
