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
  "row_count": 1,
  "trace": [
    { "provider": "herdr", "command": "herdr", "path": "/usr/local/bin/herdr", "args": ["api", "snapshot"], "cwd": null, "started_ms": 2.1, "ms": 185.2, "ok": 1 }
  ],
  "rows": [ { "pane_id": "w12:p2", "name": null, "agent": "claude", "agent_status": "idle", "cwd": "...", "title": "HQ" } ],
  "providers": [
    { "name": "herdr", "source": "built-in", "ok": 1, "observed_at": 1789038132395, "ms": 185.2, "error": null }
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
| `row_count` | The number of returned rows, after SQL filtering and limits. Zero for an empty result. |
| `rows` | The rows, in the order the query defines. |
| `providers` | One row per provider this call ran: `source` is `built-in` or `user`, `ok` is 1 or 0, `observed_at` is milliseconds since the epoch, `ms` is its duration, and `error` is its failure message. |

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
    { "name": "herdr", "source": "built-in", "ok": 1, "observed_at": 1789038132395, "ms": 185.2, "error": null },
    { "name": "git", "source": "built-in", "ok": 0, "observed_at": 1789038132590, "ms": 4.1, "error": "git executable not found" }
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

## Watch

`spacequery watch <query> --until <predicate>` re-runs one query until the current rows match.
`spacequery watch --sql <text> --until <predicate>` does the same for ad hoc SQL.
`--until` is required. A report such as `here` is not a watch target.
`watch` is the command word, not a query name.

Each tick opens a fresh database and discards it. Watch stores no rows.
The call log records the query once for the watch, not once per tick.

| Predicate | Matches when |
| --- | --- |
| `empty` | The result has zero rows. |
| `nonempty` | The result has one or more rows. |
| `<column>=<value>` | Every row has that column set to `value`. Add further values with a vertical bar: `status=idle\|done`. |

A column predicate does not match zero rows. Use `empty` for that.
Null does not match a listed value. A missing column does not match.
Values are compared as text, so `status=1` matches the number 1.
The column name is an identifier. A value cannot contain `=` or `|`.

An incomplete observation does not match `--until`.
A provider with `ok` 0 leaves that tick unknown, including when the rows are empty.
Empty rows beside a failed provider stay unknown.

```sh
spacequery watch in-dir --until empty
spacequery watch working --until empty
spacequery watch in-dir --until agent_status=idle|blocked
spacequery watch claude-sessions --until status=idle
```

`agent_status` on `in-dir`, `working`, and `agents` is herdr's `working`, `idle`, `blocked`, or `unknown`.
`working` only returns agents that are working, so the wait until nobody is working is `--until empty`.
`claude-sessions` has `status` from the session record. `workflow` has `status` from the headsign file.

The first snapshot prints immediately.
A later snapshot prints only when a fingerprint of the rows, plus each provider's `name`, `ok`, and `error`, changes.
`observed_at` and durations are left out of the fingerprint because they change on every tick.
Columns that change as time passes, such as `idle_minutes`, are part of the row, so they count as a change.
A sequence column such as `state_change_seq` or `revision` counts when the query returns it. Watch does not keep a sequence of its own.

JSON from watch is one envelope per line, the same fields as a one-shot query, with no indentation.
One-shot JSON stays indented. `--tsv` reprints the table on each change and puts a blank line between tables.
`--trace` adds `trace` to each printed snapshot.

`--interval` is the wait between ticks, in milliseconds. The default is 2000.
`--timeout` is the deadline, in seconds, measured from the start of the watch. The default is 300.
`--timeout 0` waits until the predicate matches or a signal arrives.
SIGINT or SIGTERM stops the loop after the current tick. The exit code is 130.

On timeout, spacequery writes `spacequery: timed out before --until matched` to standard error.
The last snapshot is the last line already printed. Timeout does not print that snapshot again.

## Terminal browser

`spacequery ui [--root DIR] [--scope root|agents|all] [--me PANE]` requires an interactive terminal.
`spacequery ui --help` also works with redirected output.
The browser displays definitions before it runs a query.
Its keys and result semantics are in [ui.md](ui.md).

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
| `--expect-empty` | Exit 3 after output when the query or report gate section returned rows. `here` uses `agents`. `dependency-report` uses `shared`. On watch, this applies to the snapshot that satisfied `--until`. |
| `--strict` | Exit 4 after output when a provider did not answer. On watch, the first incomplete observation exits 4 instead of waiting. |
| `--until <predicate>` | Watch only. `empty`, `nonempty`, or `<column>=<value>[|<value>...]`. Required with `watch`. |
| `--interval <ms>` | Watch only. Milliseconds between ticks. Default 2000. |
| `--timeout <sec>` | Watch only. Seconds before exit 5. Default 300. `0` means no deadline. |
| `--help` | The built-in and user queries, then reports, with descriptions. `--help --json` prints their names, descriptions, parameters, sources, and report sections as JSON. |

A query that takes `--root` runs the loaders on that root alone by default (`--scope root`); `--scope agents` widens to every repository with an agent, `--scope all` to every ghq repository.

spacequery records call counts in `$XDG_STATE_HOME/spacequery/calls.jsonl`, or `~/.local/state/spacequery/calls.jsonl` when the variable is unset.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | The query ran, or `--until` matched on a complete observation. A failed provider does not change the code of a one-shot query; read `providers`. |
| 1 | The statement did not run: a missing parameter, a statement that does not prepare. The message is one line on standard error. |
| 2 | Usage: an unknown query name, a bad `--scope`, no query given, `watch` without `--until`, or a watch flag on a one-shot command. |
| 3 | `--expect-empty` and the query returned rows. On watch, the matching snapshot returned rows. |
| 4 | `--strict` and a provider did not answer. |
| 5 | `watch` reached `--timeout` before `--until` matched. The last snapshot was printed. |
| 130 | `watch` received SIGINT or SIGTERM. |

## Self

`me` is the caller.
Queries that list agents exclude `me`, so "who else is here" is the default reading.
When a query counts agents (`crowded-repos`, `workspaces`), `me` is counted.
