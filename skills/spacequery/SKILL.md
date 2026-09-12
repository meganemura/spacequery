---
name: spacequery
license: MIT
description: Use when an agent wants to know the state of the developer's machine before it acts. Which agents run where and what they do, which repositories are dirty or behind, which worktrees have nobody in them, which sessions are idle, which tool versions a repository activates. Also use when the user names spacequery, a spacequery query, or asks to add a query.
---

# spacequery

spacequery answers questions about one developer's machine.
Each call observes the providers (herdr, git, ghq, mise, Homebrew, gh, Docker, ps, lsof, beads, headsign state files, the session records, skill and plugin files, the caller's PATH) at that moment, joins them in an in-memory database, and prints rows.
Nothing is cached, and spacequery never writes to a provider.

Call it from anywhere:

```sh
spacequery <query> [--root DIR] [--scope root|agents|all] [--me PANE] [--tsv] [--trace]
```

`spacequery` is on PATH after `npm link` in the checkout; `node /path/to/spacequery/cli.ts` is the same command without the link.

The query JSON envelope carries `rows` and `providers`.
Read `providers` before you trust `rows`: a provider with `ok` 0 left its tables empty in this call.
A report such as `here` also carries `section_status`.
Check the status for the section you will use.
Its `ok` value only covers the providers whose tables that section reads.
Read the report-level `providers` too when a widened scope matters.
The rules of the envelope, the flags, and the exit codes: [references/output.md](references/output.md).
Exact provider JSON names and their state sources: [references/providers.md](references/providers.md).

## Workflow

1. **Before you start work in a repository**: `here` (one call: who else is here with `in-dir`, the checkout with `git-status` and `worktrees`, its pull request with `branch-pull-requests`, ports with `ports-in-dir`, processes with `processes-in-dir`, Docker containers with `containers-in-dir` and `container-ports-in-dir`, tools with `tools-in-dir`, issues, and the workflow). The rows exclude your own pane. As a gate: `spacequery here --expect-empty --strict` exits 0 only when nobody else is here and every provider answered.
2. **When the user asks what is going on**: `agents-with-sessions` (names, idle time), `session-processes`, `working`, `idle-sessions`, `workspaces`.
3. **When you look for a place to work**: `idle-worktrees` (a worktree with nobody in it), `dirty-unattended` (changes nobody is tending).
4. **When a tool is missing or the wrong version**: `which-in-dir`, `which`, `path-entries`, `shadowed-commands`, `tools-in-dir`, `repository-versions`, `missing-tools-with-agents`, `tool-versions-split`.
   `repository-versions` reads static files only. It does not prove which runtime or library is installed.
   `which-in-dir` reads the repository environment from mise. `which` reads the caller environment.
   Use `installed-software` to see the installed mise and Homebrew versions together.
5. **When no query fits**: read the tables in [references/tables.md](references/tables.md) and ask the user to add a query file; how: [references/user-queries.md](references/user-queries.md). A user query shows up in `--help` with its description and is called like a built-in. When the required table is absent, a user can declare a command-backed table as a [user provider](references/user-providers.md).
6. **Before you push or open a pull request**: `prs-with-agents` for the branch you are on, then `failing-checks-with-agents`. These read GitHub and take several seconds. Do not use `--scope all` for this check.
7. **Before you start a server, a watcher, or a build**: `ports-in-dir`, `processes-in-dir`, and `container-ports-in-dir`; use `servers-with-agents` for host listeners. `ports-in-dir` shows the current checkout for the listener's working directory. It does not identify the commit loaded when the server started.
8. **When you wonder which skill applies here, or whether a name collides**: `skills-in-dir`, `duplicate-skill-names`.
9. **When you pick up a repository**: `issues` and `workflow` for its root; use `running-workflows-unattended` and `issues-unattended` for work nobody holds.
10. **Before you choose a dependency or tool parser**: `repository-config-files --root DIR`. It inventories recognized file names without interpreting their bodies.

Every query, its parameters, and its columns: [references/queries.md](references/queries.md).

## Queries

The table lists the queries the workflow names. Every query, with its parameters and columns, is in [references/queries.md](references/queries.md); `--help` lists them all, most used first. `--help --json` gives the list as data.

| Query | Parameter | Answers |
| --- | --- | --- |
| `here` | `--root` | Everything about one repository, in sections. |
| `in-dir` | `--root` | The agents in one repository. |
| `crowded-repos` | | Repositories with more than one agent, and their dirt. |
| `dirty` | | Repositories with uncommitted changes, dirtiest first. |
| `behind-upstream-with-agents` | | Repositories behind their upstream that have an agent in them. |
| `agents-with-sessions` | | Agents with the name, start time, and last activity of their session. |
| `session-processes` | | Processes that live sessions started through their child process chains. |
| `working` | | The agents that work right now. |
| `idle-sessions` | | Sessions ordered by how long they have been idle. |
| `workspaces` | | Which workspace holds agents of which repository. |
| `idle-worktrees` | | Linked worktrees with no agent in them. |
| `dirty-unattended` | | Repositories with uncommitted changes and no agent. |
| `path-entries` | | The caller's PATH entries, including dead and duplicate entries. |
| `which` | `--q` | Every executable match for one name, in PATH order. |
| `shadowed-commands` | | Executable names that occur in more than one PATH directory. |
| `which-in-dir` | `--root`, `--q` | Every executable match for one name on a repository's PATH. |
| `tools-in-dir` | `--root` | The tools mise activates in one repository. |
| `missing-tools-with-agents` | | Repositories with an agent where a requested tool is not installed. |
| `tool-versions-split` | | Tools whose active version differs between repositories with an agent. |
| `brew-packages` | | Installed Homebrew formula and cask versions. |
| `installed-software` | | Installed versions from mise and Homebrew, kept under their source manager. |
| `repository-versions` | `--root` | Static runtime and library declarations and lock evidence in one repository. |
| `repository-version-sources` | | Inspected sources and unresolved or unsupported evidence in repositories in scope. |
| `shared-dependencies` | | Direct npm dependencies declared by more than one repository in scope. |
| `shared-dependency-details` | | Source evidence for each shared direct npm dependency. |
| `dependency-coverage` | | Source and unresolved-evidence counts for dependency inspection. |
| `prs-with-agents` | | Agents whose branch has an open pull request, with its checks. |
| `failing-checks-with-agents` | | Open pull requests with failing checks in repositories where an agent works. |
| `processes-in-dir` | `--root` | Processes whose working directory is inside one repository. |
| `descendants` | `--q` | Processes in scope that descend from one pid. |
| `busy-processes` | | Processes in scope that use the most CPU now. |
| `ports-in-dir` | `--root` | Listening ports of processes inside one repository. |
| `servers-with-agents` | | Listening processes in repositories where an agent works. |
| `containers` | | Every Docker container, with image, state, health, and Compose identity. |
| `containers-in-dir` | `--root` | Docker containers associated with one repository. |
| `container-ports-in-dir` | `--root` | Docker container ports associated with one repository. |
| `skills-in-dir` | `--root` | The skills an agent can use in one repository. |
| `duplicate-skill-names` | | Skill names that come from more than one source. |
| `issues` | `--root` | Open beads issues of one repository. |
| `workflow` | `--root` | The headsign run of one repository. |
| `running-workflows-unattended` | | Running headsign workflows with no agent in the repository. |
| `issues-unattended` | | Repositories with open beads issues and no agent. |

`--root` defaults to the git toplevel of the current directory.
A query that takes `--root` looks at that repository only. `--scope all` runs each repository-scoped provider on every ghq repository instead of the repositories with an agent; it takes a few seconds.
`repository-versions` only supports `--scope root`. It rejects wider scopes because its reader does not start root-discovery tools.
`dependency-report` reads shared npm requests and source coverage in one snapshot.
It uses repositories with agents by default. `--scope all` also uses every ghq root.
Linked worktrees in that scope keep separate evidence. Repository counts join them through bounded Git metadata reads.
The query does not add other registered worktrees to the scope.
The wide dependency queries reject `--scope root`.
Check the report's `providers` and `sources` sections before you interpret an empty `shared` section.

## Where the reasoning is

The design records in `docs/adr/` of the repository hold the decisions and the measurements behind them.
