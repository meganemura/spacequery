# 0034. The search path of a root comes from mise.

Date: 2026-09-12

Status: accepted

## Context

An agent starts tools inside a repository root many times each day.
mise can change `PATH` for each repository root.
The `search_path` provider reads the caller's `PATH`, so it cannot describe those root-specific changes.
`mise env -C <root> --json` reports the environment for one root.
The command took 118 ms on 2026-09-12.
The mise loader already runs once per distinct set of configuration files.

## Decision

The mise provider adds `root_path_entries` and `root_path_commands`.
`root_path_entries` has `root`, `position`, `dir`, `exists`, and `duplicate_of` columns.
Its key is the pair of `root` and `position`.
`root_path_commands` has `root`, `name`, `dir`, `position`, and `effective` columns.
Its key is `root`, `position`, and `name`.
The path column meanings follow the caller search path columns in ADR 0033.
The loader runs `mise env -C <root> --json` once per distinct configuration group.
It reads `PATH` from the JSON document.
It scans that path in-process with `scanSearchPath` from `core/search-path.ts`.
That function uses `parseSearchPath` and `isExecutableFile`.
Roots in one configuration group share scanned rows when each entry is absolute.
A relative entry uses each root as its lookup base and keeps the entry text.
Two configuration groups with equal absolute `PATH` text share one scan.
A nested map keys scans by `PATH` text and the lookup base for relative entries.
The core executor, the search path provider, and the mise provider use one executable definition.
Other environment keys from `mise env` remain outside this decision.
A root gets no path rows when its `mise env` call fails.
Roots come from `rootsInScope`, so `--scope` selects roots as it does for `tool_uses`.

## Consequences

`which-in-dir` shows which executable runs for a tool name inside one repository root.
The mise loader starts twice as many processes for each configuration group.
The number of configuration groups does not change.
A root without mise configuration still gets the `PATH` that mise reports.
mise prepends its own directories, so these rows can differ from the caller's `search_path` rows.
