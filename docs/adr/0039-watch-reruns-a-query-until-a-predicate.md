# 0039. Watch re-runs a query until a predicate.

Date: 2026-09-23

Status: accepted

## Context

An agent that needs the machine to change was writing its own sleep loop around spacequery.
That loop is easy to get wrong: it can treat an empty result as "none" when a provider did not answer, and it can print the same observation on every tick.
spacequery still has no cache and no write verb. A resident process that stored snapshots would be a second product.

## Decision

`spacequery watch <query> --until <predicate>` runs the same query path again on an interval.
`--until` is required. Without it, watch is an open-ended poll, which this mode is not.
Each tick opens a fresh in-memory database and discards it. Watch stores no rows.
The predicate sees the current result rows: `empty`, `nonempty`, or `<column>=<value>[|<value>...]`.
A column predicate matches when every row has that column set to one of the values. Zero rows do not match it.
An incomplete observation does not match. A provider with `ok` 0 leaves the tick unknown, including when its tables are empty.
The first snapshot is printed. A later snapshot is printed only when a fingerprint of the rows, plus provider `ok` and `error`, differs.
`observed_at` and durations stay out of the fingerprint because they change on every tick.
The command exits 0 when the predicate matches, and 5 when `--timeout` elapses first.
SIGINT and SIGTERM stop the loop without a stack trace.

## Consequences

An agent can wait on `in-dir`, `working`, or `claude-sessions` without a private poller.
A failed provider cannot satisfy `--until empty`.
The call log records the query once per watch, not once per tick, so a wait does not reorder `--help`.
Watch does not notify, fan out, or mutate a provider.
