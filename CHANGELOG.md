# Changelog

The format follows Keep a Changelog, and the versions follow SemVer. Before 1.0 a minor version may change the queries, the tables, or the flags; the entry says what changed.

## Unreleased

- Changed: independent providers load concurrently. A named query still loads only the providers whose tables it reads. `--scope agents` does not start ghq for beads, git, and the other repository readers; `--scope all` starts herdr and ghq together, then those readers. The statement waits until the loaders it needs have finished.
- Added: `cursor-agents` lists the newest 32 Cursor agent conversations from the local IDE database, including model, status, and repository when that database records them. Cloud agents are not in this table.
- Added: `issues-in-scope` lists open beads issues across repositories in scope. `--scope all` includes every ghq root that has `.beads`, including roots with no agent. `--scope agents` narrows that list.
- Fixed: `agents-with-sessions` `model` is the Claude transcript model or the Codex thread model for that pane.
- Changed: `spacequery --help` and `spacequery --help --json` print a short list: the curated queries, plus the ones this machine calls most, after providers that are off are removed. The cap is 25. Curated queries stay when they pass it. `--help --all` lists every enabled query. Each entry has a group and a purpose.
- Changed: `$XDG_CONFIG_HOME/spacequery/config.json` turns built-in providers on or off for lists and for doctor. A missing file leaves core providers on and leaves `beads`, `brew`, `headsign`, and `runtag` off. A named query and `--sql` still run.
- Changed: `spacequery ui` shows the group and purpose, dims a query whose provider is off, and toggles providers into that config file.
- Changed: `spacequery doctor` skips providers that are off and lists them in `disabled_providers`.

## 0.3.0 (2026-09-23)

- Added: the `runtag` provider reads job files and `runs-in-dir` lists the jobs for one directory. `spacequery watch runs-in-dir --until status=exited` waits until every returned job has exited. An orphan stays `running`.
- Added: `spacequery doctor` reports whether each built-in provider answered, with the package version, PATH entry counts, and the user-provider directory. It does not install tools.
- Added: `spacequery watch <query> --until <predicate>` re-runs one query until the current rows match. JSON watch output is one envelope per line. Exit 5 means `--timeout` elapsed first.
- Changed: built with solarsql 0.5.0.

## 0.2.0 (2026-09-15)

- Added: `spacequery ui` browses tables, query SQL, parameters, results, and provider status in the terminal, with keyboard and mouse scrolling.
- Added: the `search_path` provider reports the caller's PATH entries, executable resolution, and shadowed commands without starting a process (`path-entries`, `which`, `shadowed-commands`).
- Added: mise reports the search path and executable resolution for each repository root (`path-entries-in-dir`, `which-in-dir`, `shadowed-commands-in-dir`).
- Added: `descendants`, `session-processes`, and `busy-processes` report process trees and current CPU use within the selected scope.
- Added: user provider declarations under `$XDG_CONFIG_HOME/spacequery/providers/` fill local tables from shell-free commands and join them with built-in tables. Roots run concurrently, and a failure names its root.
- Added: `claude-usage` and `codex-usage` expose timestamped subscription quota percentages from the Claude CLI and from bounded tails of recently modified Codex logs.
- Added: `claude-sessions` reports the model, the effort, the per-turn effort, and the metadata time from local session transcripts.
- Added: `--trace` lists each child process of a call with its provider, start offset, duration, and result.
- Changed: JSON envelopes always include the call `ms` and the returned `row_count`.
- Changed: built with solarsql 0.4.0.
- Fixed: the core starts every command by absolute path; a burst of name-based spawns made the next non-Apple binary wait for seconds.
- Fixed: an executable on PATH is a regular file; a directory with the command's name no longer shadows the real executable.

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
