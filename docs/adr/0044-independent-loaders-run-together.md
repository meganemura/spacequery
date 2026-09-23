# 0044. Independent loaders run together.

Date: 2026-09-23

Status: accepted

## Context

A call loaded every required provider one after another (ADR 0008).
Herdr, ghq, Claude and Codex session files, and the Cursor database do not read each other's tables.
Beads already starts one `bd` process per root at the same time (ADR 0019). Sessions already read Claude and Codex together.
The named-query path already skips providers whose tables the statement does not read (ADR 0007).
Several loaders still named both herdr and repos for every scope, including a root-bound call and `--scope agents`, which never read the repos table.
ADR 0032 starts commands by absolute path, so a burst of name lookups is no longer a reason to keep independent loaders in series.
This machine has no herdr, ghq, or beads tree. A fixture stood in for that latency: three independent sources, each waiting 80 ms, took 254 ms. Herdr, ghq, and one beads wave of four concurrent roots, each waiting 80 ms, took 248 ms.

## Decision

The core starts a loader when every loader it runs after has finished, including a loader that failed and left its tables empty.
Loaders with no remaining dependency run concurrently on the same in-memory database.
Each solarsql command is one synchronous transaction, so those writes do not interleave inside a statement. The scheduler does not use worker threads.
A child-process trace attributes the process to the loader that started it.
A loader that discovers roots through `rootsInScope` waits for herdr only under `--scope agents`, and for herdr and repos under `--scope all`. A root-bound call does not wait for either.
The statement runs after the loaders it needs have finished. Report sections stay in order on that database.

## Consequences

The same fixture then took 93 ms for the three independent sources and 168 ms for herdr, ghq, and beads.
`--scope agents` no longer starts ghq for beads, git, or the other root-discovery providers.
A query that reads only sessions does not start herdr, and `cursor-agents` does not start either.
These steps stay ordered: a loader waits for the tables it reads while loading; the statement waits for those loaders; report sections run one after another; repository version and config-file scans still walk roots one at a time; Cursor reads the conversation index before the bounded composer documents; a discovery failure still finishes before a dependent reads the empty tables.
