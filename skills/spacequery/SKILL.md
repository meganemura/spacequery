---
name: spacequery
license: MIT
description: Use when an agent wants to know the state of the developer's machine before it acts. Which agents run where and what they do, which repositories are dirty or behind, which worktrees have nobody in them, which sessions are idle, which tool versions a repository activates. Also use when the user names spacequery, a spacequery query, or asks to add a query.
---

# spacequery

spacequery answers questions about one developer's machine.
Each call observes the providers (herdr, git, ghq, mise, Homebrew, gh, Docker, ps, lsof, beads, headsign state files, runtag job files, the session records, skill and plugin files, the caller's PATH) at that moment, joins them in an in-memory database, and prints rows.
Nothing is cached, and spacequery never writes to a provider.

Call it from anywhere:

```sh
spacequery <query> [--root DIR] [--scope root|agents|all] [--me PANE] [--tsv] [--trace]
spacequery watch <query> --until <predicate> [--interval MS] [--timeout SEC]
spacequery doctor [--json] [--root DIR]
```

`spacequery` is on PATH after `npm link` in the checkout; `node /path/to/spacequery/cli.ts` is the same command without the link.

The query JSON envelope carries `rows`, `row_count`, and `providers`.
Read `providers` before you trust `rows`: a provider with `ok` 0 left its tables empty in this call.
A report such as `here` also carries `section_status`.
Check the status for the section you will use.
Its `ok` value only covers the providers whose tables that section reads.
Read the report-level `providers` too when a widened scope matters.
The rules of the envelope, the flags, and the exit codes: [references/output.md](references/output.md).
Exact provider JSON names and their state sources: [references/providers.md](references/providers.md).

## Doctor

Before you assume empty means none, run `spacequery doctor` when setup is unclear or a provider looks incomplete.
Doctor loads every enabled built-in provider once on one root, the git toplevel or `--root`, and prints JSON.
`beads`, `brew`, `headsign`, and `runtag` are off until `$XDG_CONFIG_HOME/spacequery/config.json` enables them. Doctor lists those names in `disabled_providers` and does not load them.
Read the report's `ok`, then each provider's `ok` and `error`.
A provider with `ok` 0 left its tables empty. The `error` says why, such as a missing binary.
A missing runtag jobs directory is `ok` 1 and an empty table. An unreadable jobs directory, or a job file that does not parse, is `ok` 0.
`path` counts PATH entries, missing entries, and duplicates when the search path provider answered. Those are the same facts as `path-entries`.
`user_providers.present` is 1 when `$XDG_CONFIG_HOME/spacequery/providers` exists.
Doctor does not run user-provider commands, install tools, or change a provider.
`spacequery doctor --json` prints the same JSON.
Exit 0 means the report was printed, including when a provider did not answer.
When doctor itself cannot run, stdout is an `error` and a `do` command, with no stack.
The fields and exit codes: [references/output.md](references/output.md#doctor).

## Terminal browser

`spacequery ui` opens an interactive browser for tables and named queries.
Use `--root DIR`, `--scope root|agents|all`, and `--me PANE` to set its initial context.
The browser fetches data when you press `r`.
See [references/ui.md](references/ui.md) for its keys and observation rules.

## Waiting

`spacequery watch` re-runs one named query until `--until` matches, then exits.
Each tick is a new observation. Watch keeps no cache and does not write to a provider.
`--until` is required.

```sh
spacequery watch in-dir --until empty
spacequery watch working --until empty
spacequery watch in-dir --until agent_status=idle|blocked
spacequery watch claude-sessions --until status=idle
spacequery watch runs-in-dir --root <repo> --until status=exited
```

`in-dir`, `working`, and `agents` carry `agent_status` (`working`, `idle`, `blocked`, `unknown`).
`working` only returns agents that are working, so the wait for idle is `--until empty`.
`claude-sessions` carries `status`. `runs-in-dir` carries `status` (`running` or `exited`). A column predicate matches when every returned row has one of the values. Zero rows do not match it; use `empty`.
A [runtag](https://github.com/meganemura/runtag) ([npm](https://www.npmjs.com/package/runtag)) job whose file says `running` while `supervisor_pid` is dead stays `running` with `orphan` 1 and `exit_code` null. It does not satisfy `status=exited`.
An incomplete observation does not match `--until`. Empty rows beside a provider with `ok` 0 stay unknown.
The first snapshot prints immediately. Later snapshots print only when the observation changes.
JSON from watch is one envelope per line. One-shot JSON stays indented.
`--interval` defaults to 2000 milliseconds. `--timeout` defaults to 300 seconds. `--timeout 0` waits until the predicate or a signal.
Exit 0 when `--until` matches, 5 on timeout, 130 on SIGINT or SIGTERM.
The predicate, the fingerprint, and the exit codes: [references/output.md](references/output.md#watch).

## Workflow

1. **Before you start work in a repository**: `here` (one call: who else is here with `in-dir`, the checkout with `git-status` and `worktrees`, its pull request with `branch-pull-requests`, ports with `ports-in-dir`, processes with `processes-in-dir`, Docker containers with `containers-in-dir` and `container-ports-in-dir`, tools with `tools-in-dir`, issues, and the workflow). The rows exclude your own pane. As a gate: `spacequery here --expect-empty --strict` exits 0 only when nobody else is here and every provider answered. If a section looks empty and a provider did not answer, run `spacequery doctor` before you assume nobody is there. To wait until the directory is clear, `spacequery watch in-dir --until empty` exits 0 when no other agent is in the repository.
2. **When the user asks what is going on**: `agents-with-sessions` (names, model, idle time), `session-processes`, `working`, `idle-sessions`, `workspaces`.
   `model` on `agents-with-sessions` is the Claude transcript model or the Codex thread model for that pane. Herdr and the session files load together.
   Use `claude-usage` and `codex-usage` for quota percentages and reset information. Check record times; Codex reads bounded tails of recently modified local logs.
   Use `claude-sessions` and `codex-sessions` for effort and the rest of the local session record.
   `cursor-agents` lists recent Cursor conversations from the local IDE database, including each conversation's model. It does not list cloud agents.
   Claude metadata describes a recent response in the transcript tail; `metadata_at` gives its time. Unavailable values stay null.
3. **When you look for a place to work**: `idle-worktrees` (a worktree with nobody in it), `dirty-unattended` (changes nobody is tending).
4. **When a tool is missing or the wrong version**: `which-in-dir`, `which`, `path-entries`, `shadowed-commands`, `tools-in-dir`, `repository-versions`, `missing-tools-with-agents`, `tool-versions-split`.
   `repository-versions` reads static files only. It does not prove which runtime or library is installed.
   `which-in-dir` reads the repository environment from mise. `which` reads the caller environment.
   Use `installed-software` to see the installed mise and Homebrew versions together.
5. **When no query fits**: read the tables in [references/tables.md](references/tables.md) and ask the user to add a query file; how: [references/user-queries.md](references/user-queries.md). A user query shows up in `--help` with its description and is called like a built-in. When the required table is absent, a user can declare a command-backed table as a [user provider](references/user-providers.md).
6. **Before you push or open a pull request**: `prs-with-agents` for the branch you are on, then `failing-checks-with-agents`. These read GitHub and take several seconds. Do not use `--scope all` for this check.
7. **Before you start a server, a watcher, or a build**: `ports-in-dir`, `processes-in-dir`, and `container-ports-in-dir`; use `servers-with-agents` for host listeners. `ports-in-dir` shows the current checkout for the listener's working directory. It does not identify the commit loaded when the server started.
8. **When you wonder which skill applies here, or whether a name collides**: `skills-in-dir`, `duplicate-skill-names`.
9. **When you pick up a repository**: `issues` and `workflow` for its root; use `running-workflows-unattended` and `issues-unattended` for work nobody holds.
   For a work list across projects, `issues-in-scope --scope all` reads every ghq root that has `.beads`, whether or not an agent is in that repository. Herdr and ghq load together, then beads. `--scope agents` narrows the same list to roots that have an agent and does not start ghq. A call that omits `--scope` uses `agents`, because this query takes no `--root`.
10. **When you wait for a detached runtag command**: [runtag](https://github.com/meganemura/runtag) ([npm](https://www.npmjs.com/package/runtag)) records with `runtag exec --detach --cwd <repo> -- <cmd>...` and writes a job file with `id`. Then `spacequery watch runs-in-dir --root <repo> --until status=exited`. When that exits 0, `runtag status <id>` reads `exit_code`. spacequery reads the files and watches. An orphan stays `running` and does not satisfy the wait.
11. **Before you choose a dependency or tool parser**: `repository-config-files --root DIR`. It inventories recognized file names without interpreting their bodies.

Every query, its parameters, and its columns: [references/queries.md](references/queries.md).
`spacequery --help` prints the short list. `spacequery --help --all` prints every enabled query.

## Queries

The table is the curated set. It is not one machine's call history.
`spacequery --help` prints these after it drops any query whose provider is off, then adds queries this machine calls often, up to about 25. The call log only ranks that list.
`spacequery --help --json` is the same list as data, with `group`, `purpose`, `default`, `enabled`, and `requires`.
`spacequery --help --all` and `spacequery --help --all --json` list every enabled query. The columns for the rest are in [references/queries.md](references/queries.md).
`beads`, `brew`, `headsign`, and `runtag` are off until you set them to `true` under `providers` in `$XDG_CONFIG_HOME/spacequery/config.json` (`~/.config/spacequery/config.json` when the variable is unset). A named query and `--sql` still run when the provider is off in the list.

| Query | Parameter | When |
| --- | --- | --- |
| `here` | `--root` | When you start work in a repository and want the other agents, the checkout, and what is already running. |
| `agents` | | When you need every hosted agent and the repository it sits in. |
| `in-dir` | `--root` | When you are about to work in a repository and need to see who else is there. |
| `working` | | When you need the agents that are working right now. |
| `agents-with-sessions` | | When you want each agent together with its session name, model, and idle time. |
| `claude-sessions` | | When you need a live Claude session's recorded model, effort, or name. |
| `codex-sessions` | | When you need a live Codex thread's model, effort, or source. |
| `idle-sessions` | | When you want the sessions that have been quiet the longest. |
| `dirty` | | When you want repositories with uncommitted changes, busiest first. |
| `dirty-unattended` | | When uncommitted changes have no agent tending them. |
| `idle-worktrees` | | When you need a linked worktree with nobody in it. |
| `which` | `--q` | When you need every match for one command name and which one the caller runs. |
| `which-in-dir` | `--root`, `--q` | When you need the executable a repository would run for one name. |
| `tools-in-dir` | `--root` | When you need the tool versions mise activates in one repository. |
| `repository-versions` | `--root` | When you need static version and lock evidence in one repository before you trust a runtime. |
| `failing-checks-with-agents` | | When failing checks sit in a repository where an agent works. |
| `prs-with-agents` | | When you need the open pull request for a branch an agent is on. |
| `ports-in-dir` | `--root` | When you are about to bind a port and need the listeners already inside one repository. |
| `processes-in-dir` | `--root` | When you need the processes whose working directory is inside one repository. |
| `containers-in-dir` | `--root` | When you need the containers associated with one repository. |
| `skills-in-dir` | `--root` | When you need the skills an agent can use in one repository. |
| `issues` | `--root` | When you pick up a repository and need its open beads issues. |
| `issues-unattended` | | When open beads issues have no agent in the repository. |
| `running-workflows-unattended` | | When a headsign workflow is running with no agent in the repository. |
| `workflow` | `--root` | When you pick up a repository and need its headsign run. |
| `runs-in-dir` | `--root` | When you are waiting on a detached runtag job for one directory. |

`--root` defaults to the git toplevel of the current directory.
A query that takes `--root` looks at that repository only. `--scope all` runs each repository-scoped provider on every ghq repository instead of the repositories with an agent; it takes a few seconds.
`repository-versions` only supports `--scope root`. It rejects wider scopes because its reader does not start root-discovery tools.
`dependency-report` reads shared npm requests and source coverage in one snapshot.
It uses repositories with agents by default. `--scope all` also uses every ghq root.
Linked worktrees in that scope keep separate evidence. Repository counts join them through bounded Git metadata reads.
The query does not add other registered worktrees to the scope.
The wide dependency queries reject `--scope root`.
Check the report's `providers` and `sources` sections before you interpret an empty `shared` section.

## Where the reasoning is

The design records in `docs/adr/` of the repository hold the decisions and the measurements behind them.
