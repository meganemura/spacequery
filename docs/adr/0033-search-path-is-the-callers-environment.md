# 0033. The search path provider describes the caller's environment.

Date: 2026-09-12

Status: accepted

## Context

An agent wants to know what a tool name resolves to before it starts the tool.
It also wants to know whether its search path is healthy.
On 2026-09-12 the owner's `PATH` had 37 entries.
Fifteen entries named directories that did not exist.
These entries were plugin `bin` directories that were never created.
The path contained `~/.local/bin` three times.
The mise entry for `ruby` appeared before another `ruby` executable.
The nonexistent entries caused the spawn delay that ADR 0032 fixed.
An in-process scan of all 37 entries took 41 ms.
The scan found 1,437 executable files.

## Decision

The `search_path` provider uses the module in `providers/search-path/`.
It fills `path_entries` and `path_commands` in-process from `ctx.env.PATH`.
This follows rule 6 of `docs/adding-a-provider.md`, which reads environment values by name.
The provider starts no child process.
`path_entries.position` is a zero-based key.
`path_entries.dir` keeps the entry text from `PATH`.
An empty entry becomes `.`.
`path_entries.exists` is 1 when the entry is a directory and 0 otherwise.
`path_entries.duplicate_of` names the first position with the same `dir` text.
It is null for the first position.
`path_commands` has `name`, `dir`, `position`, and `effective` columns.
Its key is the pair of `position` and `name`.
`effective` is 1 for the first match of a name in path order and 0 for later matches.
An executable is a regular file with `X_OK` permission.
The regular-file test follows symbolic links.
The row keeps `dir/name` as written and does not use the real path.
The loader and the core executor use `core/search-path.ts` for the executable test.
The `which` query therefore returns the path that spacequery starts for the same environment.
The provider reads one `PATH`, which belongs to the caller.
The `--scope` option does not change the provider's rows.

## Consequences

The rows change when a shell, Claude Code, or Codex supplies a different `PATH`.
The rows describe the caller's environment and do not describe the full machine.
The measured scan took 41 ms, read 1,437 files, and started zero processes.
The `path-entries` query shows a dead or duplicate entry.
A root-bound variant that runs `mise env` for each root remains out of scope.
