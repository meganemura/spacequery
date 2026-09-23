# 0045. Ready beads issues are a separate read.

Date: 2026-09-23

Status: accepted

## Context

ADR 0019 reads open issues with `bd -C <root> list --json`.
A work list that only sees roots with an agent hides repositories that have `.beads` and nobody in them.
`issues-in-scope` takes no `--root`, so an omitted `--scope` used the agents scope.
Claimable work is a different beads question: no open blockers, and not in progress, blocked, or deferred.
`bd ready` answers that. Its default limit hides the rest of the queue. `--claim` writes.

## Decision

`issues-in-scope` and `issues-ready` default to `--scope all` when `--scope` is omitted.
`--scope agents` remains an explicit narrow and does not start ghq.
For each root in scope with `.beads`, the ready loader runs `bd -C <root> ready --json --limit 0`.
`--limit 0` asks for every ready issue. The loader does not pass `--claim`.
Ready rows go in `ready_issues`, filled by the `beads_ready` loader.
Open rows stay in `issues`, filled by `bd list`.
A query pays for the table it reads. The `work` report reads both, plus herdr session models and local Cursor agents, and uses the same `--scope all` default.
`beads_ready` follows the beads on/off switch. A file that sets `beads_ready` itself wins.
Both stay off until beads is enabled. Naming the query still loads the provider.

## Consequences

A work list includes a beads root that has no agent.
`here` still reads open issues only.
The two beads commands start together when a call reads both tables, after herdr and ghq under `--scope all`.
This machine has no beads tree. The cost is the same per-root `bd` process as ADR 0019, and only for the table the call reads.
The dashboard that shows both lists is one section list (ADR 0046).
