# 0031. The envelope lists the child processes of one call on request.

Date: 2026-09-12

Status: accepted

## Context

A provider's `ms` reports loader time and omits the child process details.
On 2026-09-12, two runs of one query gave git provider times of 0.4 and 6 seconds.
The wall time was 6.5 seconds for each query call.
Finding the slow command required a hand-written wrapper around `exec`.
Every child process already passes through the core `exec` function.

## Decision

The envelope always carries `ms`.
It is the call wall time from the start of `prepare` through the end of the statement.
spacequery rounds it to the nearest tenth of a millisecond.

With `--trace`, the envelope also carries `trace`.
The trace contains one row per child process, in start order.
Each row has `provider`, `command`, `args`, `cwd`, `started_ms`, `ms`, and `ok`.
`provider` is the loader that started the process.
`args` is the full argument list.
`cwd` is the process directory, or null when the loader did not set one.
`started_ms` is the time since the start of the call, in milliseconds.
`ms` is the process duration.
`ok` is 1 when the process exits with status 0, and 0 for another status.
A loader can accept a non-zero exit through `exitCodes`, but the trace keeps `ok` 0.

No database table stores the trace.
A trace records one call.
A query over a trace table would need the loaders of the traced query.
ADR 0009 also puts provider freshness in the envelope because it describes one call.

With `--trace --tsv`, spacequery writes trace rows to standard error as tab-separated values.
The trace output has `provider`, `command`, `args`, `cwd`, `started_ms`, `ms`, and `ok` columns.
Standard output therefore contains result rows only.

A report envelope always carries `ms` and carries `trace` with `--trace`.

## Consequences

A caller can find a slow command without adding instrumentation to spacequery.
The trace costs one array push per process.
The core always collects it, and the command line prints it only on request.
The call log does not change (ADR 0023).
