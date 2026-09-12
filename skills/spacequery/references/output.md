# Output, flags, and exit codes

## The envelope

JSON is the default output, and this example uses `--trace`:

```json
{
  "query": "in-dir",
  "scope": "agents",
  "me": "w3S:p1",
  "params": { "root": "/workspace/example", "me": "w3S:p1" },
  "ms": 186.0,
  "trace": [
    { "provider": "herdr", "command": "herdr", "path": "/usr/local/bin/herdr", "args": ["api", "snapshot"], "cwd": null, "started_ms": 2.1, "ms": 185.2, "ok": 1 }
  ],
  "rows": [ { "pane_id": "w12:p2", "name": null, "agent": "claude", "agent_status": "idle", "cwd": "...", "title": "HQ" } ],
  "providers": [
    { "name": "herdr", "ok": 1, "observed_at": 1789038132395, "ms": 185.2, "error": null }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `query` | The query name, or `sql`. |
| `scope` | `root`, `agents`, or `all`. |
| `me` | The caller's pane, or null when the environment names none. |
| `params` | Every value the statement bound. |
| `ms` | The wall time from the start of call preparation through the end of the statement. |
| `trace` | With `--trace`, the envelope has one row per child process, in start order. Each row has `provider`, `command`, `path`, the full `args` list, `cwd`, `started_ms`, `ms`, and `ok`. `path` is the executable path, or null when resolution failed. |
| `rows` | The rows, in the order the query defines. |
| `providers` | One row per provider this call ran: `ok` 1 or 0, `observed_at` in milliseconds since the epoch, `ms` the time it took, `error` the message when it failed. |

A provider that failed leaves its tables empty, so a join through them gives no rows.
Treat empty `rows` next to a failed provider as "unknown", not as "none".
A provider the query does not read is absent from `providers`.
The exact provider names are listed in [providers.md](providers.md).

A report has a report envelope instead of `query` and `rows`:

```json
{
  "report": "here",
  "root": "/workspace/example",
  "scope": "agents",
  "me": "w3S:p1",
  "params": { "root": "/workspace/example", "me": "w3S:p1" },
  "ms": 194.8,
  "sections": { "agents": [], "git": [] },
  "section_status": {
    "agents": { "providers": ["herdr"], "ok": 1, "errors": [] },
    "git": { "providers": ["git"], "ok": 0, "errors": [ { "name": "git", "error": "git executable not found" } ] }
  },
  "providers": [
    { "name": "herdr", "ok": 1, "observed_at": 1789038132395, "ms": 185.2, "error": null },
    { "name": "git", "ok": 0, "observed_at": 1789038132590, "ms": 4.1, "error": "git executable not found" }
  ]
}
```

A report always carries its call duration in `ms`.
With `--trace`, a report also lists its child processes in `trace`.

`root` is the resolved root for a root-bound report. It is absent for a wide report.
`sections` keeps the report order and each value
is the rows of its named query. `section_status` uses the same section names.
Its `providers` list names the providers whose tables the section query reads,
in provider configuration order. `ok` is 1 when all those providers answered.
`errors` gives the name and error text of each direct provider that failed.
A loader dependency is absent unless the section query reads one of its tables.
A section with no provider-owned tables has an empty provider list, `ok` 1,
and an empty error list.
For `--scope agents` and `--scope all`, also read the report-level `providers`.
A section status does not show whether providers that enumerate roots answered.

`--tsv` prints a header line and the rows, tab separated, null as an empty cell.
With `--trace`, it writes the trace header and rows to standard error.
The `path` cell is the executable path, or empty when resolution failed.
The `args` cell is a JSON array, so it keeps the full argument list.
A failed provider goes to standard error as `spacequery: provider <name> failed: <error>`.
For a report, TSV prints `# <section>` before each non-empty section's TSV
table and an empty line after that table. An empty section prints only its
`# <section>` line.

`observed_at`, `started_at`, `updated_at`, and `last_turn_at` are milliseconds since the epoch.
`started_ms` is milliseconds since the start of the call.
Other `ms` values are durations in milliseconds.
`idle_minutes` is computed at call time.

Read activity in this order: `agent_status` from herdr describes the present.
`updated_at` and `last_turn_at` belong to the session record. `idle_minutes`
derives from `updated_at`.

## Flags

| Flag | Meaning |
| --- | --- |
| `--root DIR` | The repository for a query or report that takes `root`. Default: the git toplevel of the current directory, or the directory itself outside a repository. A query that takes `--root` runs the loaders on that root alone by default (`--scope root`); `--scope agents` widens to every repository with an agent, `--scope all` to every ghq repository. |
| `--scope root` | Repository-scoped loaders run on the root bound to the query. |
| `--scope agents` | Repository-scoped loaders run on the repositories that have an agent. |
| `--scope all` | git, mise, repository_versions, processes, beads, headsign, skills, and github also run on every ghq repository. Several seconds. |
| `--me PANE` | The pane to exclude. Default: the caller's own pane, from `HERDR_PANE_ID`, then `CLAUDE_CODE_SESSION_ID` matched to a session, then the pane herdr has in focus. `--me ""` keeps every pane. |
| `--tsv` | Rows only, tab separated. A report prints named sections. |
| `--json` | The default. |
| `--trace` | List every child process with its provider, command, executable path, full arguments, directory, start offset, duration, and result. JSON adds `trace`; TSV writes it to standard error. |
| `--<name> VALUE` | A parameter of a built-in or user query, bound as text. |
| `--expect-empty` | Exit 3 after output when the query or report gate section returned rows. `here` uses `agents`. `dependency-report` uses `shared`. |
| `--strict` | Exit 4 after output when a provider did not answer. |
| `--help` | The built-in and user queries, then reports, with descriptions. `--help --json` prints their names, descriptions, parameters, sources, and report sections as JSON. |

A query that takes `--root` runs the loaders on that root alone by default (`--scope root`); `--scope agents` widens to every repository with an agent, `--scope all` to every ghq repository.

spacequery records call counts in `$XDG_STATE_HOME/spacequery/calls.jsonl`, or `~/.local/state/spacequery/calls.jsonl` when the variable is unset.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | The query ran. A failed provider does not change the code; read `providers`. |
| 1 | The statement did not run: a missing parameter, a statement that does not prepare. The message is one line on standard error. |
| 2 | Usage: an unknown query name, a bad `--scope`, no query given. |
| 3 | `--expect-empty` and the query returned rows. |
| 4 | `--strict` and a provider did not answer. |

## Self

`me` is the caller.
Queries that list agents exclude `me`, so "who else is here" is the default reading.
When a query counts agents (`crowded-repos`, `workspaces`), `me` is counted.
