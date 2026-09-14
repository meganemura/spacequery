# Changelog

The format follows Keep a Changelog, and the versions follow SemVer. Before 1.0 a minor version may change the queries, the tables, or the flags; the entry says what changed.

## Unreleased

- Changed: built with solarsql 0.4.0; a report binds each section only the parameters its query declares.

- Added: query JSON includes `row_count` beside the call duration.

- Changed: `codex-usage` reads backward in expanding blocks and stops each log when quota records appear.

- Changed: `codex-usage` reads bounded tails of the 32 most recently modified logs instead of scanning all history.

- Added: `claude-usage` and `codex-usage` expose timestamped subscription quota percentages from the Claude CLI and local Codex logs.

- Added: user provider declarations can fill local tables from shell-free commands and join them with built-in tables.
- Added: mise reports the search path and executable resolution for each repository root.
- Added: `descendants`, `session-processes`, and `busy-processes` report process trees and current CPU use within the selected scope.
- Added: `spacequery ui` browses tables, query SQL, parameters, results, and provider status in the terminal.
- Added: the `search_path` provider reports PATH entries, executable resolution, and shadowed commands without starting a process.
- Fixed: the core starts every command by absolute path; a burst of name-based spawns made the next non-Apple binary wait for seconds.
- JSON envelopes always include the call `ms`; `--trace` adds each child process with its provider, start offset, duration, and result.

## 0.1.0 (2026-09-12)

The first release. The tool was developed as panoram and renamed to spacequery before this release; the package `panoram` was unpublished and nothing depends on it.

- A query layer over one developer's machine: each call observes the providers, joins them in an in-memory SQLite database, and prints rows. No cache, no writes to a provider.
- Providers: herdr (agents, panes, and agent status), git (status and worktrees, also from a linked checkout), ghq (repositories), mise (tools and the versions a root activates), Homebrew (formulae and casks), repository versions and configuration files (static declarations and lock evidence, dependency sources), sessions (Claude Code and Codex sessions alive now, as one supertype with two subtypes), GitHub through gh (open pull requests, checks, requested reviews), Docker through the CLI (containers, ports, and Compose identity), processes (ps and lsof: processes and listening ports in scope), skills and plugins of Claude Code and Codex, beads (open issues), headsign (workflow state).
- 63 named queries and 2 reports. `here` tells everything about the repository an agent sits in; `dependency-report` shows shared npm dependencies and source coverage. Every join is on the repository root.
- A query that takes `--root` runs the loaders on that root alone. `--scope root|agents|all` widens a root-bound query to the roots with an agent, or to every ghq root.
- The caller's own pane is resolved from the environment and excluded (`--me`).
- The JSON envelope carries `rows` and `providers` (`ok`, `observed_at`, `ms`, `error` per provider); a report carries the provider status per section; `--tsv` prints rows only.
- Exit codes for gates: `--expect-empty` exits 3 when the query returned rows, `--strict` exits 4 when a provider did not answer. `find --q` looks for a word in an agent's name, title, repository, or session name. `--help --json` gives the catalog as data.
- A query pays only for the tables it reads: a named query through its generated metadata, ad hoc SQL (`--sql`) through an authorizer probe.
- User-defined queries: one SQL file per query under `$XDG_CONFIG_HOME/spacequery/queries/`, parameters bound from flags, listed in `--help`.
- A call log under `$XDG_STATE_HOME/spacequery/` orders `--help` by use. It holds query names and times only.
- The usage documentation is a skill, `skills/spacequery/SKILL.md` with references, shipped in the package and installable with `gh skill install`.
- Big binaries start before the git bursts, GitHub is one GraphQL request for every repository, git status takes no optional locks, and mise runs once per distinct set of configuration files.
- A closed pipe ends the command quietly, and the command runs through the npm bin symlink.
- Tests on node:test with hegel property tests; every provider runs through an injectable exec, so no test runs a real tool.
