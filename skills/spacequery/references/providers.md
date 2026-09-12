# Provider names

spacequery reports provider status with these exact JSON names.
Use this file as a human index to what each provider observes.
Read [output.md](output.md) for JSON envelopes, provider status, and report status.

The `providers` array contains only providers required by the query or report.
A provider with `ok: 0` did not answer, so empty results that depend on it mean "unknown".
A provider with `ok: 1` answered, so empty results mean it found no matching facts in the requested scope.

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
