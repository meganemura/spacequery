# 🪐 spacequery

[日本語](README.ja.md)

spacequery gives a coding agent one current view of a developer's machine.
An agent can already call git, GitHub, process tools, terminal sessions, and worktree tools.
Each tool shows one slice.
Before the agent edits, starts a server, opens a pull request, or takes over old work, it needs to know who and what already occupies the machine and the repository.

spacequery answers that question.
It observes existing sources of state, joins their rows in a fresh in-memory SQLite database, prints the result, and exits.
A provider is one source it observes, such as herdr, git, ghq, mise, Homebrew, gh, Docker, lsof, beads, a session record, a headsign file, or a runtag job file.
spacequery reads those sources.
It does not change them.

```sh
spacequery here
spacequery in-dir --tsv
spacequery agents-with-sessions
spacequery watch in-dir --until empty
spacequery doctor
spacequery --help
```

## Terminal Browser

`spacequery ui` opens Tables and Queries in the terminal.
Inspect columns and SQL, follow related tables and queries, then press `r` to fetch rows.
The result includes provider status and observation times.
See the [browser keys and scope rules](skills/spacequery/references/ui.md).

## A First Use

Run this before work starts in a repository:

```sh
spacequery here
```

`here` is a report about one repository.
It shows other agents in the repository, the current git state, linked worktrees, the branch pull request, listening ports, local processes, Docker containers and ports, mise tools, open beads issues, and headsign workflow state.
The agent can then choose a safer next action:

- wait, with `spacequery watch in-dir --until empty`, when another agent already works in the repository
- reuse an idle worktree, or avoid a worktree that is already occupied
- notice dirty files before it edits or reviews
- avoid a port that already has a local server
- see a container or Docker-published port tied to the repository
- see a missing tool for this repository before it runs a check
- read open issues and workflow state before it continues work
- see failing pull request checks before it asks to merge

Queries that list agents exclude the caller by default.
For an agent inside a pane, `spacequery here` and `spacequery in-dir` read as "who else is here?"
That makes the result useful as a gate:

```sh
spacequery here --expect-empty --strict
```

For `here`, `--expect-empty` checks the `agents` section.
`--strict` fails if any provider did not answer.

## Why It Fits Agents

Agents need structured facts more than a screen.
spacequery returns JSON by default, so an agent can read rows, sections, provider status, and the resolved caller identity without parsing terminal text.
TSV is available when a human wants a compact table.

Agents often need a question that crosses tools.
git can say a checkout is dirty.
herdr can say which pane runs an agent.
gh can say a branch has failing checks.
spacequery joins those facts by repository root, so `agents-in-dirty-repos`, `failing-checks-with-agents`, `idle-worktrees`, and `servers-with-agents` are direct queries.

Agents should pay only for the question they ask.
A query loads the providers for the tables it reads.
`tools-in-dir` does not call GitHub.
`review-requests` does not run `git status`.
Ad hoc SQL and user query files use the same provider resolution.

Agents need to know when observation is incomplete.
Every call starts from an empty database, so there is no stale cache.
The JSON envelope includes `providers`, with `source`, `ok`, `observed_at`, `ms`, and `error` for each provider that ran.
If a provider fails, its tables are empty and its provider row says so.
Empty rows beside a failed provider mean "unknown", not "none".
When a result looks incomplete, `spacequery doctor` checks which built-in providers answered.
The skill explains how to read that report.

Reports add section-level trust data.
`here` returns `sections`, `section_status`, and report-level `providers`.
Each `section_status` entry says which direct providers the section reads and whether they answered.
Read the report-level `providers` too when `--scope agents` or `--scope all` widens the call, because root enumeration can depend on another provider.

Agents also need instructions at the moment they act.
The agent workflow lives in [skills/spacequery/SKILL.md](skills/spacequery/SKILL.md).
The README is the door: it explains what spacequery is, why it helps, how to install it, and where to read next.

## Requirements

spacequery requires Node 24.10 or later.
The build and ad hoc SQL resolver use `setAuthorizer` from `node:sqlite`.

Put the tools you want spacequery to observe on `PATH`: `herdr`, `git`, `ghq`, `mise`, `brew`, `gh` logged in, `docker`, `lsof`, and `bd`.
Headsign rows come from files and need no command on `PATH`.
Session rows come from records under `~/.claude` and `~/.codex`.
Joining a pane to a session needs herdr's Claude Code and Codex integrations.
runtag rows come from `$XDG_DATA_HOME/runtag/jobs/` (or `~/.local/share/runtag/jobs/`).
[runtag](https://github.com/meganemura/runtag) ([npm](https://www.npmjs.com/package/runtag)) records those jobs. spacequery reads the files.

## Waiting on a runtag job

[runtag](https://github.com/meganemura/runtag) ([npm](https://www.npmjs.com/package/runtag)) records a command and writes the job file.
Install it with `npm i -g runtag`.
spacequery reads that file and watches.

```sh
runtag exec --detach --cwd <repo> -- <cmd>...
spacequery watch runs-in-dir --root <repo> --until status=exited
runtag status <id>
```

`runs-in-dir` lists jobs whose `repo_root` or `cwd` is `<repo>` or inside it.
`status` is `running` or `exited`.
A job whose file still says `running` after its supervisor pid has died stays `running`, with `orphan` 1 and `exit_code` null.
That row does not satisfy `--until status=exited`.
`runtag status <id>` is where the exit code is read after the watch exits 0.
A missing jobs directory is an empty answer. `spacequery doctor` reports `runtag` as answered in that case, and as failed when the jobs directory cannot be read or a job file does not parse.

A missing provider does not make a false row.
It gives an empty table and a `providers` row that reports the failure.

`repository-versions` reads root files and declared npm workspaces from one repository.
It does not run Git, mise, a language, or a package manager.
Its lock rows are file evidence and do not prove installed versions.
`dependency-report` compares direct npm requests across active repository roots.
Use `--scope all` to include ghq roots.
The report includes source coverage and unresolved evidence from the same snapshot.

## Install

```sh
npm install -g spacequery
```

The package is published on npm as `spacequery`.

From a checkout:

```sh
npm install
npm link
spacequery --help
```

Without a link, `node cli.ts <query>` works from the checkout.

Give the skill to agents on this machine:

```sh
gh skill install meganemura/spacequery spacequery --scope user --agent claude-code
gh skill install meganemura/spacequery spacequery --scope user --agent codex
```

## Read Next

| Need | Read |
| --- | --- |
| The workflow an agent follows before it acts | [skills/spacequery/SKILL.md](skills/spacequery/SKILL.md) |
| Query names, parameters, report sections, and columns | [queries.md](skills/spacequery/references/queries.md) |
| JSON envelopes, `providers`, `section_status`, flags, `me`, and exit codes | [output.md](skills/spacequery/references/output.md) |
| Exact provider JSON names and state sources | [providers.md](skills/spacequery/references/providers.md) |
| Provider tables for ad hoc SQL or user queries | [tables.md](skills/spacequery/references/tables.md) |
| User query files under `~/.config/spacequery/queries/` | [user-queries.md](skills/spacequery/references/user-queries.md) |

## Design

The design records are in [docs/](docs/README.md).
They explain the fresh database, read-only behavior, provider freshness, selective loading, call log, Docker observation, and report model.

## License

MIT
