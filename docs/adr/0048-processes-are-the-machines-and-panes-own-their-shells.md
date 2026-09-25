# 0048. Processes are the machine's, and panes own their shells.

Date: 2026-09-25

Status: accepted

## Context

A user asked whether any process on the machine had run away.
The cause was eight interactive zsh shells sitting in herdr panes, each with no children, each with its cwd inside a repository.
The largest used 32.8 percent CPU, held 1.2 GB of resident memory, was 9 days old, and had accumulated 1039 minutes of CPU time. The eight together held about two cores.

spacequery could not answer in one call.
`session-processes` walks down from agent sessions to their descendants. A pane's shell is the parent of the session, not a descendant. That walk never reached it.
The CPU-ordered query, `busy-processes`, read only processes inside a root already in scope, and it was absent from the short help.
The `processes` table carried no cumulative CPU time, only the decaying `%cpu` average.
No row linked a process to the herdr pane that held it.

Measured on this machine: `ps -axo pid,ppid,pgid,uid,etime,time,rss,pcpu,command` took 35 ms for 1111 processes, 866 of them the user's own.
The cwd `lsof` call took 326 ms and found 86 distinct working directories.
Resolving the git root of all 86 took 6 ms in process.
`herdr pane process-info` for 22 panes, run concurrently, took 20 ms; it answers for a pane with no agent too.
`herdr api snapshot` carries `panes`, `agents`, and `workspaces`, but no pid.

## Decision

`processes` holds every process `ps` lists, for every user, because the process that runs away can belong to any user, including the system.
`cwd` comes from `lsof`, for the user's own processes.
`root` is the git toplevel of `cwd` (ADR 0003), looked up once per distinct cwd, so `--scope` no longer changes this table.
The table gains `cpu_pct` (ps's `%cpu`), `cpu_time_s` (ps's `time`), and `uid`.

herdr gains a `panes` table, from a second loader, `herdr_panes`.
It reads the snapshot, then makes one `herdr pane process-info` call per pane id from that same snapshot, run concurrently.
Each pane id is an identifier the same provider already read in this run, from the same tool (rule 2 of `docs/adding-a-provider.md`).
A separate loader means a query that reads only `agents` starts none of these calls.
A pane owns its own shell process and every process descended from that shell.

`heavy-processes` keeps the top 10 processes by each of `cpu_pct`, `cpu_time_s`, and `rss_kb`, with the owning pane joined in.
`pane-load` sums those three measures over the processes one pane owns.
`busy-processes` is removed.

## Consequences

`long-running-without-agents` filters on a known root: a process the loader could not place in a repository is excluded from that list.
`descendants` and `session-processes` see the whole process tree, not only processes inside a root in scope.
Command lines of any process on the machine can appear in output, the same as a plain `ps` shows.
`agents` stays a separate table from `panes`; folding it into `panes` as a subtype (ADR 0024) is a later decision.
This amends ADR 0017.
