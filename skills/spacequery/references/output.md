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
| `warnings` | Present only when non-empty. One text per comparison in `--sql` or a user query file that the schema makes impossible to ever match: the wrong type, a value outside a CHECK enum, or a comparison with `null` using `=` or `<>`. The rows still ran; a warning does not remove any. |

A provider that failed leaves its tables empty, so a join through them gives no rows.
Treat empty `rows` next to a failed provider as "unknown", not as "none".
A provider the query does not read is absent from `providers`.
The exact provider names are listed in [providers.md](providers.md).
A named query is typed by the build and never carries `warnings`; only `--sql` and a user query file do.

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
A report that is a dashboard also carries `definition`.
`definition.sections` is the ordered `[section, query]` list, the same list the rows use.
`definition.default_scope` is the scope used when `--scope` is omitted, or null.
`definition.refresh` says how to run that report again on an interval.
`work` is that report. `spacequery watch work` prints the same envelope, one line per changed snapshot.
`spacequery --help --json` puts the same `sections`, `default_scope`, and `refresh` on the `work` report entry.

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
`--until` is required for a query. A report other than `work`, such as `here`, is not a watch target.
`spacequery watch work` re-runs the work report on `--interval`. `--until` is optional. When set, it reads the `agents` section, and each printed snapshot is still the whole report. The fingerprint includes every section.
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
`runs-in-dir` has `status` from the runtag job file: `running` or `exited`.

```sh
spacequery watch runs-in-dir --root <repo> --until status=exited
```

A runtag orphan stays `running` with `orphan` 1 and `exit_code` null. `--until status=exited` does not match it.
The job files and `runtag status <id>` belong to [runtag](https://github.com/meganemura/runtag) ([npm](https://www.npmjs.com/package/runtag)). runtag records the job. spacequery reads the files and watches.

The first snapshot prints immediately.
A later snapshot prints only when a fingerprint of the rows, plus each provider's `name`, `ok`, and `error`, changes.
For `work`, the fingerprint also includes every section.
`observed_at` and durations are left out of the fingerprint because they change on every tick.
Columns that change as time passes, such as `idle_minutes`, are part of the row, so they count as a change.
A sequence column such as `state_change_seq` or `revision` counts when the query returns it. Watch does not keep a sequence of its own.

JSON from watch is one envelope per line, the same fields as a one-shot query, with no indentation.
One-shot JSON stays indented. `--tsv` reprints the table on each change and puts a blank line between tables.
`--trace` adds `trace` to each printed snapshot.

`--interval` is the wait between ticks, in milliseconds. The default is 2000.
`--timeout` is the deadline, in seconds, measured from the start of the watch. The default is 300.
`--timeout 0` waits until the predicate matches or a signal arrives. For `work` without `--until`, it waits until a signal.
SIGINT or SIGTERM stops the loop after the current tick. The exit code is 130.

On timeout, spacequery writes `spacequery: timed out before --until matched` to standard error.
`watch work` without `--until` writes `spacequery: timed out`.
The last snapshot is the last line already printed. Timeout does not print that snapshot again.

## Terminal browser

`spacequery ui [--root DIR] [--scope root|agents|all] [--me PANE]` requires an interactive terminal.
`spacequery ui --help` also works with redirected output.
The browser displays definitions before it runs a query.
Its keys and result semantics are in [ui.md](ui.md).

## Doctor

`spacequery doctor [--json] [--root DIR] [--trace]` loads every enabled built-in provider once and prints one JSON document.
Providers that are off in config are named in `disabled_providers` and are not loaded. A missing optional tool that you have not enabled does not clear `ok`.
`--json` selects that same document. JSON is already the default.
`--root` defaults to the git toplevel of the current directory, or the directory itself outside a repository.
Doctor does not take `--scope`. Repository-scoped providers run on that one root.
Doctor does not run user-provider commands, install tools, or write the call log.
When `runtag` is enabled, a missing jobs directory is `ok` 1. An unreadable jobs directory, or a job file that does not parse, is `ok` 0 and clears the report's `ok`. While `runtag` is off, doctor does not load it.

```json
{
  "command": "doctor",
  "ok": 0,
  "version": "0.2.0",
  "package": "/workspace/spacequery",
  "root": "/workspace/example",
  "scope": "root",
  "ms": 420.5,
  "providers": [
    { "name": "git", "source": "built-in", "ok": 1, "observed_at": 1789038132395, "ms": 12.0, "error": null },
    { "name": "herdr", "source": "built-in", "ok": 0, "observed_at": 1789038132400, "ms": 1.2, "error": "spawn herdr ENOENT" }
  ],
  "path": { "entries": 12, "missing": 3, "duplicates": 1 },
  "user_providers": { "directory": "/home/u/.config/spacequery/providers", "present": 0, "error": null },
  "user_queries": [
    { "name": "long-running", "path": "/home/u/.config/spacequery/queries/long-running.sql", "ok": 0, "error": "no such column: cpu", "hint": "  did you mean cpu_pct? (processes)\n  ..." }
  ],
  "disabled_providers": ["beads", "beads_ready", "brew", "headsign", "runtag"],
  "config": "/home/u/.config/spacequery/config.json"
}
```

| Field | Meaning |
| --- | --- |
| `command` | Always `doctor`. |
| `ok` | 1 when every enabled built-in provider answered, the user-provider directory had no error, and every user query file still prepares. 0 otherwise. A missing user-provider directory does not clear this bit. A provider that is off does not clear it. |
| `version` | The spacequery package version. |
| `package` | The directory that contains `package.json` for this command. |
| `root` | The one repository doctor observed. |
| `scope` | Always `root`. |
| `ms` | The wall time of the observation. |
| `providers` | One row per enabled built-in provider, the same fields as a query envelope, ordered by name. |
| `path` | PATH entry, missing-entry, and duplicate-entry counts when `search_path` answered. Null when it did not. These are the facts `path-entries` stores. |
| `user_providers` | `directory` is `$XDG_CONFIG_HOME/spacequery/providers` (or `~/.config/spacequery/providers`). `present` is 1 when that path is a directory. `error` explains a path that is not a directory or cannot be listed. Absence is `present` 0 and `error` null. |
| `user_queries` | One row per user query file: `name`, `path`, `ok` (1 when it still prepares), `error` (SQLite's message, or null), and `hint` (the fix from [Errors that name the fix](#errors-that-name-the-fix), or null). Doctor prepares each file the same way a call would, including user-provider tables; it does not run the query. |
| `disabled_providers` | Built-in provider names that are off for lists and for doctor. Sorted. |
| `config` | The path of `config.json`, whether or not the file exists. |
| `trace` | With `--trace`, the same child-process rows as a query. |

Exit 0 means the report was printed. Read `ok` before you trust it.
Exit 2 is usage. Exit 1 means doctor itself failed before it could report providers.
Both of those print this object and no stack:

```json
{ "error": "Unknown option '--scope'", "do": "spacequery doctor [--json] [--root DIR] [--trace]" }
```

`do` is the command to run next.

## Errors that name the fix

`--sql` and a user query file are typed by nothing until they prepare. A wrong name fails there, in about 0.1 seconds, before any loader runs. The message on standard error carries the fix, indented under SQLite's own line:

```
spacequery: no such column: cpu
  did you mean cpu_pct? (processes)
  columns of processes: pid integer, ppid integer, ..., cwd text?, cpu_pct real, cpu_time_s real
  try: select pid, cpu_pct from processes limit 1
```

Every table's columns show their declared type, `?` for a nullable column, and the allowed values of a CHECK enum (`status text in ('observed', 'skipped')`).
A `try:` line is a corrected statement spacequery has already confirmed prepares; it is never run for you. It appears only when the fix is certain: one name is closest, or the substitution has no other reading.
A column that exists in a table the statement does not name gets `X is in T2, not T1; T2 joins T1 on <key>`, with a `try:` that adds the join, for a plain `select ... from T1 [where ...]`.
A column reached through the wrong alias gets the alias that has it instead.
Also covered: a double-quoted value (SQLite reads it as an identifier; use single quotes), `ambiguous column name`, `misuse of aggregate function`, `no such function` (with close names), `no such table` (with close tables), a syntax error (a caret under the rejected token, with a fix for a trailing comma or a reserved word used as a name), and `incomplete input` (the clause the statement ends inside).
A hint that lists no table ends with the command that lists a table's columns: `spacequery --sql "select name, type from pragma_table_info('<table>')"`.
An error this list does not cover still prints SQLite's own message and the columns of the tables the statement names.
Exit code stays 1.

A statement that prepares can still hold a comparison the schema makes impossible to ever match: the wrong type, a value outside a CHECK enum, or `= null`/`<> null` (always unknown regardless of nullability), or `is null` against a column declared `not null`. spacequery warns on standard error and keeps running; `--json` also lists it under `warnings`:

```
spacequery: warning: panes.shell_pid is integer; 'x' can never equal it
```

This is a heuristic reading of the statement's tokens, not the query planner: it resolves a bare column only when exactly one table read by the statement has that name, and a qualified column only through an alias its own `from`/`join` clause declares. A column it cannot resolve to exactly one table stays silent rather than guessed at.
`spacequery doctor` runs the same prepare check, and the same hint, against every user query file; see `user_queries` above.

## Flags

| Flag | Meaning |
| --- | --- |
| `--root DIR` | The repository for a query or report that takes `root`. Default: the git toplevel of the current directory, or the directory itself outside a repository. A query that takes `--root` runs the loaders on that root alone by default (`--scope root`); `--scope agents` widens to every repository with an agent, `--scope all` to every ghq repository. |
| `--scope root` | Repository-scoped loaders run on the root bound to the query. |
| `--scope agents` | Repository-scoped loaders run on the repositories that have an agent. |
| `--scope all` | git, mise, repository_versions, processes, beads, beads_ready, headsign, skills, and github also run on every ghq repository. Several seconds. `issues-in-scope`, `issues-ready`, and `work` use this scope when `--scope` is omitted. |
| `--me PANE` | The pane to exclude. Default: the caller's own pane, from `HERDR_PANE_ID`, then `CLAUDE_CODE_SESSION_ID` matched to a session, then the pane herdr has in focus. `--me ""` keeps every pane. |
| `--tsv` | Rows only, tab separated. A report prints named sections. |
| `--json` | The default. |
| `--trace` | List every child process with its provider, command, executable path, full arguments, directory, start offset, duration, and result. JSON adds `trace`; TSV writes it to standard error. |
| `--<name> VALUE` | A parameter of a built-in or user query, bound as text. |
| `--expect-empty` | Exit 3 after output when the query or report gate section returned rows. `here` and `work` use `agents`. `dependency-report` uses `shared`. On watch, this applies to the snapshot that satisfied `--until`. |
| `--strict` | Exit 4 after output when a provider did not answer. On watch, the first incomplete observation exits 4 instead of waiting. |
| `--until <predicate>` | Watch only. `empty`, `nonempty`, or `<column>=<value>[|<value>...]`. Required with `watch`. |
| `--interval <ms>` | Watch only. Milliseconds between ticks. Default 2000. |
| `--timeout <sec>` | Watch only. Seconds before exit 5. Default 300. `0` means no deadline. |
| `--help` | The short list: curated queries union the ones this machine calls most, after providers that are off are removed, capped at about 25. Curated queries stay when they exceed the cap. `--help --all` lists every enabled query. `--help --short` forces the short list when config asks for `all`. `--help --json` prints the same selection as a document with `mode`, `config`, `disabled_providers`, `queries`, and `reports`. Each entry has `group`, `purpose`, `default`, `enabled`, `requires`, `params`, and `source`. A report also has `sections`. A report's `enabled` follows its gate section. Its `requires` lists every provider the sections read, so `here` can stay listed while beads is off. `work` also has `default_scope` and `refresh`. |

A query that takes `--root` runs the loaders on that root alone by default (`--scope root`); `--scope agents` widens to every repository with an agent, `--scope all` to every ghq repository.
`issues-in-scope`, `issues-ready`, and `work` take no `--root` and default to `--scope all`. `--scope agents` narrows them to roots with an agent.

spacequery records call counts in `$XDG_STATE_HOME/spacequery/calls.jsonl`, or `~/.local/state/spacequery/calls.jsonl` when the variable is unset.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | The query ran, doctor printed a report, or `--until` matched on a complete observation. A failed provider does not change the code of a one-shot query or of doctor; read `providers`, or doctor's `ok`. |
| 1 | The statement did not run: a missing parameter, a statement that does not prepare. Doctor uses this when it fails before a report and prints `{error, do}`. A query message is one line on standard error, followed by the hint lines from [Errors that name the fix](#errors-that-name-the-fix). |
| 2 | Usage: an unknown query name, a bad `--scope`, no query given, `watch` without `--until`, a watch flag on a one-shot command, or a flag doctor does not take. Doctor prints `{error, do}`. |
| 3 | `--expect-empty` and the query returned rows. On watch, the matching snapshot returned rows. |
| 4 | `--strict` and a provider did not answer. |
| 5 | `watch` reached `--timeout` before `--until` matched. The last snapshot was printed. |
| 130 | `watch` received SIGINT or SIGTERM. |

## Self

`me` is the caller.
Queries that list agents exclude `me`, so "who else is here" is the default reading.
When a query counts agents (`crowded-repos`, `workspaces`), `me` is counted.
