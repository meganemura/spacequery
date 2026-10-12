# 0052. firstlight runs are read from the state files.

Date: 2026-10-12

Status: accepted

## Context

firstlight starts every configured check of a repository at once and keeps the rest running in the background under one detached supervisor per run.
Its state lives under `$XDG_STATE_HOME/firstlight/<repo-key>/`, outside the repository: `runs/<run id>/run.json` (the root, the supervisor pid, the start time, and the checks), `runs/<run id>/events.jsonl` (every status change, appended only by the supervisor), one log per check, and a `current` file that names the latest run.
An agent that is about to start a run, or that waits on one, needs to know which checks still run and where, across repositories.
`firstlight results` answers for one repository and is a command of the tool that owns the state.
spacequery still has no cache and no write verb.

## Decision

The provider reads `$XDG_STATE_HOME/firstlight/`. When `XDG_STATE_HOME` is unset or blank, that directory is `$HOME/.local/state/firstlight`.
A relative `XDG_STATE_HOME` fails the provider: firstlight resolves it against its own working directory, which spacequery cannot know.
It starts no process. It does not write, rename, or prune a state file, and it does not signal a supervisor or a check.

The status of a check is the fold firstlight itself uses: every check starts `pending`, each event must be a transition firstlight's table allows, and a reused pass is the one `pending` to `passed` step that names the run it came from.
A last line without its newline is not read yet, because the supervisor may be in the middle of writing it.
A check that never reached a terminal status, in a run that has no outcome and whose supervisor pid is not a live process, is `unknown` with `orphan` 1. When the supervisor is found dead, the events are read once more first, as firstlight does, so its final event is not mistaken for an orphan.
A zombie supervisor is not alive.
`supervisor_alive` is 0 once a run has an outcome: the supervisor exits right after it writes the outcome, so a live pid then belongs to another process.
The log path of each check is derived from the run's check list with firstlight's naming rule, since firstlight stores no log path.

`latest-check-runs` takes the run the `current` file names, or the newest kept run when that file is missing or names a run that is gone.
`running-checks` keeps `pending` and `running` checks in runs whose supervisor is alive, and joins `worktrees` on the run's root for the repository and branch.

A missing state directory is an empty table and a provider row with `ok` 1: firstlight has not run on this machine.
A run directory whose `run.json` does not exist yet is skipped: firstlight creates the directory before it writes that file.
A state path that cannot be read, a `run.json` firstlight would refuse, and an `events.jsonl` with an unreadable line or a transition the table does not allow are `ok` 0, and the error names the run. The runs that did read stay in the tables.
The provider is off in lists by default, like the other author-owned tools.

## Consequences

Reading the directory costs milliseconds. On this machine, 14 runs across 5 repositories were read and folded in about 12 ms after the first call.
Every repository firstlight has recorded is read, whatever the scope, because the state is keyed by a hash of the root and holds at most 20 runs per repository.
The worktree columns of `running-checks` are null for a root outside the call's scope. The default scope covers the roots where an agent works, which is where an agent starts a run; `--scope all` covers every ghq repository at the cost of one git call pair per repository.
The provider does not estimate time left, read log text, or reuse results. `firstlight results` and `firstlight follow` remain the way to read those.
The fold, the orphan rule, and the log naming are copies of firstlight's. A change to firstlight's state format needs the same change here.
