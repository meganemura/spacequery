# 0041. Runtag jobs are read from the files.

Date: 2026-09-23

Status: accepted

## Context

runtag records each detached command as one JSON file.
The file is the job. runtag's own `status` command owns the exit code after the process ends.
An agent that waits by polling runtag would be a second loop around a state file spacequery can already read.
spacequery still has no cache and no write verb.

## Decision

The provider reads `$XDG_DATA_HOME/runtag/jobs/<id>.json`.
When `XDG_DATA_HOME` is unset or empty, that directory is `$HOME/.local/share/runtag/jobs`.
It starts no process and does not write, rename, or delete a job file.
`runs-in-dir` keeps a job whose `repo_root` or `cwd` equals `--root` or is inside that directory.
A path matches only at a directory boundary, so a sibling such as `repo-other` does not match `repo`.
Status stays the file's `running` or `exited`.
When the file says `running` and `supervisor_pid` is not a live process, the row stays `running`, `exit_code` is null, and `orphan` is 1.
That row does not satisfy `status=exited`.
A missing jobs directory is an empty table and a provider row with `ok` 1.
A jobs path that cannot be read, or a job file that does not parse, is `ok` 0.
Doctor uses that same load, so a machine with no runtag jobs yet still answers, and an unreadable jobs directory does not.

## Consequences

Reading the directory costs milliseconds. On this machine, 20 job files were read and parsed in about 2 ms.
The provider does not interpret pass or fail, does not capture logs, and does not call runtag.
`runtag status <id>` remains the way to read `exit_code` after the wait.
An orphan stays in the result until the file changes, so a watch for `status=exited` waits through `--timeout` rather than treating a dead supervisor as an exit.
