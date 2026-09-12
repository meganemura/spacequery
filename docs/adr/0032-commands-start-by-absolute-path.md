# 0032. The core starts every command by absolute path.

Date: 2026-09-12

Status: accepted

## Context

`execFile("git", ...)` makes libuv search `PATH` before it starts the process.
Libuv tries `posix_spawn` in each `PATH` directory until one attempt succeeds.
The owner's `PATH` has 37 entries, and `/usr/bin` is the thirteenth entry.
Each Git process therefore caused 12 failed spawn attempts.
A `--scope all` Git loader started 132 name-based Git processes in one burst.
The next ghq, gh, or node process waited until approximately six seconds after that burst started.
The waiting process stayed in `_dyld_start`.
Apple platform binaries did not have the delay.
A burst that used absolute paths did not cause the delay.
A name-based burst with `PATH=/usr/bin:/bin` did not cause the delay.
Twenty nonexistent directories before `/usr/bin` made a name-based Git burst wait 8.6 seconds and a name-based `/usr/bin/true` burst wait 9.1 seconds.
Shell fork-and-exec bursts and Python `os.posix_spawn` bursts did not cause the delay.
A lower concurrency limit did not remove the delay.
The macOS daemon that causes the wait is not identified.
ADR 0022 attributed the delay to a burst of file-opening processes.
The measured trigger was the `PATH` probing of name-based spawns.
Three `dirty --scope all` calls took 0.5, 6, and 6.7 seconds with name-based Git execution.
Three `dirty --scope all` calls took 0.35 seconds each when the Git loader started Xcode's Git by absolute path.

## Decision

The core `exec` resolves each command name before it starts a child process.
A command name without a slash uses `PATH` from `ctx.env`.
The lookup falls back to `process.env.PATH` when `ctx.env` has no `PATH` value.
The core performs the lookup in-process.
It selects the first `PATH` entry where `accessSync` with `X_OK` succeeds.
A command name with a slash is used as given.
The call's `exec` wrapper stores each result in a `Map` by command name.
The `Map` limits each command name to one resolution per call.
When a lookup fails, the core gives the unresolved name to `execFile`.
The provider error keeps the `spawn <name> ENOENT` form.
Each trace row keeps the command name that the loader supplied.
Each trace row also has `path` with the resolved path that ran.
The `path` value is null when resolution fails.
Loaders continue to pass literal command names.
The core supplies the executable path.

## Consequences

The core gives `execFile` an absolute path and avoids the measured failed spawn burst.
Loader order can now follow data dependencies because the core avoids name-based `PATH` probing.
One call performs at most one `PATH` lookup for each command name.
A trace shows both the provider's command name and the executable path.
