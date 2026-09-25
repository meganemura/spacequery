# 0017. Processes in scope are observed through ps and lsof.

Date: 2026-09-10

Status: accepted; the scope-only process table is superseded by [0048](0048-processes-are-the-machines-and-panes-own-their-shells.md)

## Context

Before a server, watcher, or build starts, an agent needs to know which process already runs in its repository and which ports are taken.
One machine had about 1,600 processes, most unrelated to the developer's repositories.
`ps -axo pid,ppid,pgid,etime,rss,pcpu,command` took 90 ms.
The cwd `lsof` call took 370 ms and the TCP listener call took 100 ms.

## Decision

The processes table keeps processes whose cwd is inside a root in scope.
The listener table keeps every listening TCP process of the user and records its root when its cwd is in scope.
The loader runs one ps and two lsof calls concurrently.
The listener call ands its selectors with `-a`; without it lsof ors the user filter with the port filter and returns every open file of the user, and connections read as ports.

## Consequences

The provider costs 0.5 to 1 s.
A process in a repository without an agent is absent under the default scope and appears with `--scope all`.
The pane shell and spacequery appear as processes of the root when observable, which describes the machine correctly.
