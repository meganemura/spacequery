# 0050. Ad hoc SQL errors name the fix.

Date: 2026-09-25

Status: accepted

## Context

`--sql` and a user query file are typed by nothing until they run. A renamed column fails at prepare, in about 0.1 seconds, before any loader starts (ADR 0002; `core/resolve.ts` calls the engine's own prepare through `tablesRead`). Until now, the message was SQLite's alone: `spacequery: no such column: cpu`. The column is now `cpu_pct`; an agent reading that one line has no way to know it.

A statement can also prepare and still be wrong. SQLite gives a text literal compared with an INTEGER or REAL column numeric affinity: the literal converts to a number first, so `pid = '1'` matches a `pid` of 1. Only a literal that is not a number, such as `'x'`, can never match. The same is true of a value outside a column's declared CHECK enum, and of comparing anything with `null` using `=` or `<>`, which SQL defines as unknown rather than false. Each of these returns zero rows in silence; nothing in the call fails.

A user query file has the same exposure, on a delay: a table change breaks it only when someone next calls it, not when the table changes.

## Decision

`core/diagnose.ts` reads the schema of the database a call already opened for this statement (the migrations, plus any user-provider tables declared for this call) and the statement's own text. It starts no loader and runs nothing of its own; where a fix is certain, it confirms the candidate by calling `raw.prepare` on it, which reads the statement without executing it.

**A prepare failure.** `core/resolve.ts` catches the engine's error inside `tablesRead`, where the database that failed to prepare is already at hand, and turns it into a `PrepareError` carrying the original `message` and a `hint`. The hint is built from a table of rules, keyed by the shape of SQLite's message: `no such column`, `no such table`, a double-quoted value SQLite already flags as a likely string, `ambiguous column name`, a misused aggregate, `no such function`, a syntax error (a trailing comma before a clause, or a reserved word used as a name), and `incomplete input`. Each rule reads the schema through the same `raw` connection to name the fix; when it can build a single corrected statement, it prepares that statement first and only calls it `try:` when that succeeds. An error with no rule still gets the columns of the tables the statement names: an agent is never left with nothing.

For `no such column`, the schema decides the order: a wrong alias when another table in the statement's own `from`/`join` has the column; the column's true table and the join key the two tables share, when it exists somewhere else the statement did not name; a close name in a table the statement did name, otherwise. Every listing of a table's columns is typed (`cpu_pct real`), marks a nullable column (`cwd text?`), and expands a CHECK enum to its values (`status text in ('observed', 'skipped')`), because the schema already carries all of that and a bare name list would throw it away.

**A comparison that can never match.** After a successful prepare, `core/diagnose.ts` scans the statement's tokens, respecting quotes and comments, for a column compared with a literal by `=`, `==`, `<>`, `!=`, or `in (...)`. This is a heuristic, stated as such in the module: it resolves a bare column only when exactly one table the statement reads has that name, and a qualified column only through an alias its own `from`/`join` declares; anything it cannot resolve to one column, it leaves alone. It warns when the literal cannot equal the column's declared type, when the literal is outside a CHECK enum, or when either side of `=`/`<>` is `null`; it also warns on `is null` against a column declared `not null`, which can never match either. A warning changes nothing about the run: rows and exit code stay as they were.

**Doctor.** `spacequery doctor` opens the same empty schema a call would (`core/run.ts` factors this into `openObservationDatabase`, shared by the call path and doctor) and prepares every user query file against it, without running any of them. Each file's status lands in a new `user_queries` list, with the same `hint` a live failure would carry. A failing file clears doctor's `ok`, because a query nobody has called yet is still broken.

## Consequences

The fix a `no such column` message offers depends on what the schema can show: a rename inside one table, the column's real table and a join, or the closest name, in that order, never more than one at a time.
A `try:` is only ever a statement this module has already confirmed prepares; running it is still the caller's decision.
The warning path is a heuristic. A query with an alias it cannot resolve, or a bare column ambiguous across the tables it reads, gets no warning rather than a wrong one.
Named, built-in queries are typed by the build already (solarsql's generated metadata) and carry none of this: `core/diagnose.ts` is reached only from `--sql`, watch's `--sql`, and a user query file, all of which go through `core/run.ts`'s `runSql`.
