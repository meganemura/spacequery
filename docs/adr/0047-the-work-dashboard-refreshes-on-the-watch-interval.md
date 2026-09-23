# 0047. The work dashboard refreshes on the watch interval.

Date: 2026-09-23

Status: accepted

## Context

The work dashboard is one report: claimable issues, open issues, herdr agents with their models, and local Cursor agents (ADR 0046).
An agent that wants that board to stay current was about to write its own sleep loop, or to treat the section list as something to edit.
ADR 0039 already re-runs one query on an interval until a predicate, and stores nothing.
A dashboard is a repeating observation of a fixed report, not a new scheduler and not a schema editor.

## Decision

`spacequery watch work` re-runs the `work` report on `--interval`.
The default interval is 2000 milliseconds. The default `--timeout` is 300 seconds. `--timeout 0` keeps refreshing until a signal.
`--until` is optional. When it is omitted, the loop stops on the deadline or a signal.
When it is set, it reads the `agents` section, the same gate as `--expect-empty`.
Each printed snapshot is the whole report. JSON is one envelope per line. TSV uses the same section headings as `spacequery work --tsv`.
A later snapshot is printed only when the sections or provider status change.
Each tick opens a fresh database. Watch stores no rows.
`spacequery work` and `spacequery ui` render one run of that same report.
Other reports stay outside watch. A query still requires `--until`.

## Consequences

An agent refreshes the board with `spacequery watch work` instead of a private poller.
A person reads the same sections from that command, from `spacequery work`, or from the terminal browser.
The section list is not the refresh control.
