# Provider names

spacequery reports provider status with these exact JSON names.
Use this file as a human index to what each provider observes.
Read [output.md](output.md) for JSON envelopes, provider status, and report status.

The `providers` array contains only providers required by the query or report.
A provider with `ok: 0` did not answer, so empty results that depend on it mean "unknown".
A provider with `ok: 1` answered, so empty results mean it found no matching facts in the requested scope.

`spacequery doctor` runs every built-in provider in this list once, on one root, and prints the same `ok` and `error` fields.
Read [output.md](output.md#doctor) for the rest of that report.
Before you assume empty means none, run doctor when a provider looks incomplete.

Reports also return `section_status`.
Each section lists the direct providers it reads and whether they answered.
The report-level `providers` list can include dependencies, such as providers that enumerate roots for a widened scope.

| Provider | What it gets |
| --- | --- |
| `search_path` | The caller's PATH entries and executable names, including missing entries, duplicate entries, and shadowed commands. It starts no process. |
| `repos` | Repository locations and host, owner, and name identity known to `ghq list -p`. |
| `herdr` | Live coding-agent panes from `herdr api snapshot`, including agent type, status, focus, working directory, repository root, workspace, tab, title, and linked session id. |
| `github` | Open pull request metadata for GitHub repositories in scope, including branch names, author, draft state, review decision, last-commit check state, update time, and URL. |
| `github_reviews` | Open GitHub pull requests that request the caller's review, with repository, number, title, author, update time, URL, and in-scope repository root when known. |
| `mise` | Globally known tool versions, active root requests, and each root search path. It runs `mise ls --current` and `mise env` once per configuration group. |
| `brew` | Installed formula and cask versions reported by two local `brew list --versions` calls. |
| `repository_versions` | Static version declarations and lock evidence from repository roots and declared npm workspaces. The reader starts no process and performs no resolution. |
| `repository_config_files` | Recognized dependency, language, and tool configuration file names at repository roots and declared npm workspaces. It reads root package.json only for bounded workspace discovery. |
| `beads` | Open beads issues from repositories in scope that have `.beads`, including title, status, priority, type, assignee, labels, timestamps, and relationship counts. |
| `docker` | Containers from the current Docker CLI context, including image, lifecycle state, health, Compose identity, repository associations from bind mounts and Compose labels, and exposed or published ports. |
| `sessions` | Live Claude Code processes and held Codex thread locks, with session id, agent type, process id, working directory, repository root, name, activity times, last transcript branch, and source-specific runtime details. |
| `git` | Branch, upstream, dirty and untracked counts, observation time, linked Git checkouts, and ahead or behind counts against the local upstream reference. These counts do not prove the current remote state. |
| `processes` | User processes whose working directory is inside a repository in scope, plus listening TCP sockets with address, port, command, and repository association when known. |
| `skills` | Claude and Codex user, project, system, and plugin skills, plus installed plugin identity, source, version, path, and timestamps when those records exist. |
| `headsign` | Readable `.headsign/state.json` files for repositories in scope, including workflow, status, phase, iteration counts, attempts, last failure, stop reason, driver agent, and phase entry time. |
| `runtag` | Job files under `$XDG_DATA_HOME/runtag/jobs/` (default `~/.local/share/runtag/jobs/<id>.json`). Each row has `id`, `status` (`running` or `exited`), `exit_code`, `orphan`, `repo_root`, `cwd`, and `supervisor_pid`. The reader starts no process and does not write a job file. |

## Quota sources

`claude_usage` invokes the fixed local command `claude -p /usage --output-format json --no-session-persistence`.
The CLI can contact its service. A missing subscription, unsupported output, or failed command fails this provider.
`codex_usage` inventories `.jsonl` modification times under `CODEX_HOME/sessions` and `CODEX_HOME/archived_sessions`.
It reads backward from the 32 newest files by modification time, starting with 4 KiB and doubling each block.
Each file stops at the first block with complete quota records, its beginning, or 256 KiB; the total stays below 8 MiB.
`CODEX_HOME` defaults to `~/.codex`. This loader starts no process and makes no network request.
These providers run independently when their tables are queried. Repository scope does not filter account quotas.

## Runtag jobs

`runtag` reads the job files [runtag](https://github.com/meganemura/runtag) ([npm](https://www.npmjs.com/package/runtag)) writes with `runtag exec`. runtag records the command. This provider reads the files. `exit_code` stays the number the process returned.
A missing jobs directory is an empty table and `ok` 1: runtag has no jobs yet. An empty directory is the same.
A jobs path that exists but cannot be read, and a `*.json` file that is not a job, are `ok` 0. The error names the path. Valid jobs already read stay in the table.
`spacequery doctor` uses this load. A machine with no jobs directory still has `runtag` `ok` 1. An unreadable jobs directory or a job file that does not parse makes doctor's `ok` 0.
`status` is only `running` or `exited`. When the file says `running` and `supervisor_pid` is not a live process, the row stays `running`, `exit_code` is null, and `orphan` is 1. That row does not satisfy `status=exited`.
`runs-in-dir` keeps a job whose `repo_root` or `cwd` equals `--root` or is inside it. `repo/pkg` matches `repo`. `repo-other` does not.
