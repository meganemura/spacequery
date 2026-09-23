# The queries

Every built-in query, its parameters, and its columns.
Columns marked `?` can be null.
`root` is the git toplevel of a repository, the key every join uses.

## Reports

`here` runs these ordered sections for one `root`: `agents` (`in-dir`), `git`
(`git-status`), `worktrees`, `pull_requests` (`branch-pull-requests`), `ports`
(`ports-in-dir`), `processes` (`processes-in-dir`), `containers`
(`containers-in-dir`), `container_ports` (`container-ports-in-dir`), `tools`
(`tools-in-dir`), `issues`, and `workflow`.

## Agents (herdr)

| Query | Parameters | Columns |
| --- | --- | --- |
| `agents` | | `pane_id`, `name?`, `agent`, `agent_status`, `cwd`, `root?`, `workspace_id?`, `title?` |
| `find` | `q` | `pane_id`, `agent`, `agent_status`, `name?`, `title?`, `root?`, `cwd`, `session_name?` |
| `in-dir` | `root` | `pane_id`, `name?`, `agent`, `agent_status`, `cwd`, `title?` |
| `working` | | `pane_id`, `name?`, `agent`, `agent_status`, `root?`, `cwd`, `title?` |
| `workspaces` | | `workspace_id?`, `root?`, `agents`, `working?` |

`agent` is the label herdr detected (`claude`, `codex`, ...).
`agent_status` is herdr's field and uses herdr's values: `working`, `idle`, `blocked`, `unknown`.
`spacequery watch in-dir --until agent_status=idle` waits until every returned row has `agent_status` idle.
`working` only lists agents that are working, so `spacequery watch working --until empty` is the wait for idle.
The watch rules are in [output.md](output.md#watch).
`root` is null for an agent outside any repository.
`agents`, `find`, `in-dir`, and `working` exclude `me`.

## Search path

| Query | Parameters | Columns |
| --- | --- | --- |
| `path-entries` | | `position`, `dir`, `exists`, `duplicate_of?` |
| `which` | `q` | `name`, `dir`, `position`, `effective` |
| `shadowed-commands` | | `name`, `effective_dir`, `shadowed_dirs` |
| `path-entries-in-dir` | `root` | `root`, `position`, `dir`, `exists`, `duplicate_of?` |
| `which-in-dir` | `root`, `q` | `root`, `name`, `dir`, `position`, `effective` |
| `shadowed-commands-in-dir` | `root` | `root`, `name`, `effective_dir`, `shadowed_dirs` |

`path-entries` follows the caller's PATH order.
An empty PATH entry appears as `.`.
`duplicate_of` is the first position with the same `dir` text.
`which` lists each executable match in PATH order.
The row with `effective = 1` is the command that spacequery starts.
`shadowed_dirs` is a comma-separated list of distinct directories in PATH order.
The provider follows symbolic links for the executable test and keeps the path text as written.
It starts no process, and `--scope` does not change its rows.
The three `-in-dir` queries use the `PATH` that mise reports for one repository.
A relative entry resolves from the repository root and keeps its `PATH` text.
A root without mise configuration still uses mise's environment output.
mise can prepend directories, so these rows can differ from the caller search path rows.

## Sessions (Claude Code, Codex)

| Query | Parameters | Columns |
| --- | --- | --- |
| `sessions` | | `session_id`, `agent`, `pid?`, `cwd`, `root?`, `name?`, `started_at?`, `updated_at?`, `last_turn_at?`, `last_branch?` |
| `idle-sessions` | | the same, plus `idle_minutes?`, ordered by `updated_at` ascending |
| `claude-sessions` | | `session_id`, `cwd`, `root?`, `name?`, `updated_at?`, `model?`, `effort?`, `per_turn_effort?`, `metadata_at?`, `kind?`, `entrypoint?`, `status?`, `status_updated_at?`, `name_source?`, `version?`, `pid_domain?`, `peer_protocol?` |
| `codex-sessions` | | `session_id`, `cwd`, `root?`, `name?`, `updated_at?`, `model?`, `reasoning_effort?`, `source?`, `thread_source?`, `model_provider?`, `cli_version?`, `sandbox_policy?`, `approval_mode?`, `git_branch?`, `git_origin_url?`, `title?`, `tokens_used`, `archived` |
| `agents-with-sessions` | | `pane_id`, `agent`, `agent_status`, `name?`, `claude_status?`, `kind?`, `model?`, `source?`, `started_at?`, `updated_at?`, `last_turn_at?`, `last_branch?`, `root?`, `idle_minutes?` |
| `session-processes` | | `session_id`, `agent`, `name?`, `session_pid`, `pid`, `command`, `elapsed_s`, `cpu`, `root` |
| `sessions-without-pane` | | `session_id`, `agent`, `cwd`, `root?`, `name?`, `updated_at?` |
| `codex-threads-with-agents` | | `pane_id`, `root?`, `model?`, `reasoning_effort?`, `source?`, `tokens_used`, `updated_at?` |

`name` is the session registry or database name. Claude `name_source` identifies its source.
For Claude, `model`, `effort`, and `per_turn_effort` describe one recorded assistant response; `metadata_at` gives its time.
These nullable fields use a bounded transcript tail. See [session tables](tables.md#sessions-claude_sessions-and-codex_sessions) for the observation rules.
`kind` and `claude_status` are Claude Code values. `source` is a Codex value.
`spacequery watch claude-sessions --until status=idle` waits until every returned row has `status` idle. A null `status` does not match.
A session joins an agent through the session id herdr's integration reports.
`agents-with-sessions` keeps an agent with no session and returns null session columns.
A session without a pane appears in `sessions-without-pane`.
In `session-processes`, Codex threads that run inside the Codex app share the app's pid, so their descendant rows are the same set for each thread.

## Git

| Query | Parameters | Columns |
| --- | --- | --- |
| `dirty` | | `root`, `branch?`, `dirty_count`, `untracked_count` |
| `git-status` | `root` | `root`, `branch?`, `upstream?`, `ahead`, `behind`, `dirty_count`, `untracked_count` |
| `worktrees` | `root` | `path`, `branch?`, `head?` |
| `agents-in-dirty-repos` | | `pane_id`, `name?`, `agent_status`, `root?`, `branch?`, `dirty_count`, `untracked_count` |
| `crowded-repos` | | `root?`, `agents`, `working?`, `dirty_count` |
| `idle-worktrees` | | `path`, `branch?`, `repo_root` |
| `dirty-unattended` | | `root`, `branch?`, `dirty_count`, `untracked_count` |
| `behind-upstream-with-agents` | | `root`, `branch?`, `upstream?`, `behind`, `ahead`, `agents` |

`dirty_count` counts tracked files with changes (staged or not, renames, conflicts); `untracked_count` counts untracked files.
`worktrees` takes the main root; a linked worktree has `path <> repo_root`.
`agents` in `behind-upstream-with-agents` counts agents other than `me`.

## Repositories (ghq)

| Query | Parameters | Columns |
| --- | --- | --- |
| `repos` | | `path`, `host`, `owner`, `name` |
| `agents-outside-ghq` | | `pane_id`, `name?`, `agent_status`, `cwd`, `root?` |

## Tools (mise)

| Query | Parameters | Columns |
| --- | --- | --- |
| `tools` | | `tool`, `version`, `install_path?`, `installed`, `active` |
| `tools-in-dir` | `root` | `tool`, `version`, `source?`, `installed` |
| `missing-tools-with-agents` | | `root`, `tool`, `version`, `source?`, `agents` |
| `tool-versions-split` | | `tool`, `versions`, `version_list?` |

`source` is the path of the mise file that requested the version; a file above the repository counts.
`active` in `tools` is relative to the directory spacequery ran from.

## Installed software (mise, Homebrew)

| Query | Parameters | Columns |
| --- | --- | --- |
| `brew-packages` | | `kind`, `name`, `version` |
| `installed-software` | | `manager`, `kind`, `name`, `version` |

`kind` is `formula` or `cask` for Homebrew and `tool` for mise.
`installed-software` uses `manager` to keep package identities separate.
It does not map a package name to an executable name.
The brew provider uses the local inventory forms in the [Homebrew list command](https://docs.brew.sh/Manpage#list-ls-options-installed_formulainstalled_cask-).

## Repository versions

| Query | Parameters | Columns |
| --- | --- | --- |
| `repository-versions` | `root` | `project_path`, `ecosystem`, `kind`, `dependency_role?`, `origin`, `name`, `requested?`, `locked?`, `source`, `locator?`, `status`, `detail?` |
| `repository-version-sources` | | Source rows plus unresolved, unsupported, and error evidence in scope. |
| `shared-dependencies` | | Package identity, repository, checkout, project, declaration, and request-string counts, plus request and role JSON. |
| `shared-dependency-details` | | The shared counts plus `root`, `project_path`, `dependency_role`, `requested`, `source`, and `locator`. |
| `dependency-coverage` | | Per-source observed, unsupported, unresolved, and error counts. |

`repository-versions` supports `--scope root` only.
This root query reads bounded static file evidence and starts no Git, mise, language, or package manager process.
The root query does not execute scripts from a repository.
`repository-versions` keeps declaration and lock rows separate, and duplicate npm versions keep their package locations.
The shared queries use observed npm declarations from manifests.
`repository_count` counts distinct local Git repositories. `checkout_count` counts inspected roots, including linked worktrees.
Two linked worktrees alone do not make a dependency shared. Separate clones remain separate local repositories.
They exclude lock rows and unresolved local, alias, workspace, Git, URL, and tarball references.
`requested_versions` and `roles` are sorted JSON arrays stored as text.
Request differences do not state a compatibility conflict.
`dependency-report` returns `shared`, `coverage`, and `sources` sections from one observation.
The wide queries and report support `--scope agents` and `--scope all`.
They inspect only roots supplied by the selected scope. They do not add registered linked worktrees automatically.
The table reference lists the supported formats, workspace limits, and excluded directories.

## Repository configuration files

| Query | Parameters | Columns |
| --- | --- | --- |
| `repository-config-files` | `root` | `root`, `project_path`, `path?`, `format?`, `category?`, `parse_support?`, `observation_kind`, `status`, `detail?` |
| `repository-config-files-in-scope` | | The same columns for repositories in scope. |

`repository-config-files` supports `--scope root` only. The wide query supports
`--scope agents` and `--scope all`. Both queries inspect fixed recognized names
at the root and each root-declared npm workspace. They do not search arbitrary
files. The inventory reads root `package.json` only to discover declared
workspaces. It does not open other regular files.

`parse_support` says whether the static version reader has a parser for that
file name. It does not say that the file is readable or valid. For example, an
invalid or oversized `package-lock.json` is still an observed inventory file
with supported parser capability. A later version query can reject its content.

`observation_kind` distinguishes real file observations from workspace
discovery diagnostics. A symbolic link or special file has `status = skipped`.
Unsupported workspace syntax and skipped workspace links have `status =
incomplete`. Hard discovery errors have `status = error`. Incomplete and error
rows fail the provider, so strict mode rejects partial coverage. A regular file
with an unsupported format does not fail the provider.

## GitHub (gh)

| Query | Parameters | Columns |
| --- | --- | --- |
| `pull-requests` | `root` | `id`, `repo`, `root?`, `number`, `title`, `head_branch?`, `head_repo?`, `base_branch?`, `author?`, `is_draft`, `state`, `review_decision?`, `checks?`, `updated_at`, `url` |
| `branch-pull-requests` | `root` | `repo`, `number`, `title`, `head_branch?`, `checks?`, `review_decision?`, `is_draft`, `url` |
| `review-requests` | | `id`, `repo`, `root?`, `number`, `title`, `author?`, `updated_at`, `url`, ordered by `updated_at` descending |
| `prs-with-agents` | | `pane_id`, `name?`, `agent_status`, `repo`, `number`, `title`, `head_branch?`, `checks?`, `review_decision?`, `is_draft`, `url` |
| `failing-checks-with-agents` | | `repo`, `number`, `title`, `head_branch?`, `checks?`, `review_decision?`, `is_draft`, `url`, `agents` |
| `review-requests-with-agents` | | `repo`, `number`, `title`, `author?`, `updated_at`, `url`, `agents` |

`repo` is the `owner/name` parsed from origin. The list holds at most 50 open pull requests per repository, the newest first; a repository with more can answer "no pull request" for an older branch. `checks` comes from the last commit's status check rollup state: `SUCCESS` is `pass`; `FAILURE` and `ERROR` are `fail`; `PENDING` and `EXPECTED` are `pending`; a null rollup or no commit is `none`. `prs-with-agents` and `failing-checks-with-agents` match an agent's branch to a pull request whose head lives in the same repository, so a pull request from a fork does not pair with a local branch of the same name. `agents` excludes `me`. The pull request query takes 2.2 to 2.8 seconds for 18 repositories; `review-requests` takes 2 to 5 seconds.

## Processes (ps, lsof)

| Query | Parameters | Columns |
| --- | --- | --- |
| `processes-in-dir` | `root` | `pid`, `ppid`, `executable`, `command`, `cwd`, `elapsed_s`, `rss_kb`, `cpu` |
| `descendants` | `q` | `pid`, `ppid`, `command`, `executable`, `elapsed_s`, `cpu`, `root` |
| `busy-processes` | | `pid`, `cpu`, `rss_kb`, `elapsed_s`, `root`, `command` |
| `listening-ports` | | `pid`, `address`, `port`, `cwd?`, `root?`, `command?` |
| `ports-in-dir` | `root` | `pid`, `address`, `port`, `cwd?`, `root?`, `command?`, `head?`, `branch?`, `dirty_count?`, `untracked_count?`, `elapsed_s?` |
| `servers-with-agents` | | `root`, `port`, `address`, `pid`, `command?`, `agents` |
| `long-running-without-agents` | | `root`, `pid`, `executable`, `elapsed_s`, `rss_kb` |

`elapsed_s` is process age in seconds. `rss_kb` is resident memory in KiB. `cpu` is the current CPU percentage from ps. A listener can have null location fields when lsof cannot examine its cwd or it is outside the roots in scope. `ports-in-dir` reports the checkout observed for the process working directory at call time. It does not prove which commit the running process loaded at startup, because the checkout can change after launch. `agents` excludes `me`.

The `processes` table contains processes whose working directory is inside a root in scope.
`descendants`, `session-processes`, and `busy-processes` use this bounded set.
A descendant that works elsewhere is absent.
`--scope all` widens this set to every ghq root.

## Docker

| Query | Parameters | Columns |
| --- | --- | --- |
| `containers` | | `id`, `name`, `image`, `state`, `health?`, `created_at`, `started_at?`, `finished_at?`, `exit_code`, `oom_killed`, `restart_count`, `compose_project?`, `compose_service?` |
| `containers-in-dir` | `root` | the same columns, for containers associated with one repository |
| `container-ports-in-dir` | `root` | `name`, `state`, `container_id`, `container_port`, `protocol`, `host_ip?`, `host_port?` |

`containers` includes stopped containers.
It orders running containers first, then by name.
`containers-in-dir` uses roots found from bind mounts and the optional Compose
working-directory label.
`container-ports-in-dir` includes the container state.
It includes exposed ports with no host binding after published ports.
Multiple host bindings become multiple rows.
Docker daemon and socket errors are provider failures, so empty rows beside a
failed Docker provider mean unknown.

## Skills and plugins (Claude Code, Codex)

| Query | Parameters | Columns |
| --- | --- | --- |
| `skills` | | `path`, `source`, `agent`, `name`, `description?`, `root?`, `plugin?` |
| `skills-in-dir` | `root` | the same columns, for skills an agent can use in that repository |
| `plugins` | | `id`, `agent`, `name`, `marketplace?`, `version?`, `path`, `installed_at?`, `updated_at?` |
| `duplicate-skill-names` | | `agent`, `name`, `sources`, `source_list` |
| `skills-in-one-agent` | | `name`, `agent` |
| `project-skills-with-agents` | | `root`, `name`, `description?`, `agents` |

`source` identifies a user, project, plugin, or Codex system skill. Claude
plugins come from installed registry entries, so an older cache copy is absent.
Codex records enabled plugin IDs but no installed version, so each cached
version of an enabled plugin appears. A Codex plugin ID starts with `codex:`
to keep it distinct from a Claude Code plugin with the same marketplace ID.

## Issues (beads)

| Query | Parameters | Columns |
| --- | --- | --- |
| `issues` | `root` | `id`, `root`, `issue_id`, `title`, `status`, `priority?`, `issue_type?`, `assignee?`, `labels?`, `created_at?`, `updated_at?`, `dependency_count`, `dependent_count`, `comment_count` |
| `issues-with-agents` | | `root`, `open_issues`, `top_priority?`, `agents` |
| `issues-unattended` | | `root`, `open_issues`, `top_priority?` |

`issues` reads open beads issues only. `labels` joins label values with commas.
`agents` excludes `me`.

## Workflows (headsign)

| Query | Parameters | Columns |
| --- | --- | --- |
| `workflow` | `root` | `root`, `workflow`, `workflow_path?`, `status`, `phase?`, `total_iterations`, `attempts?`, `last_failure?`, `end_reason?`, `stop_nudges`, `driver_agent?`, `phase_entered_at?` |
| `workflows` | | the same columns, ordered by `status`, `root` |
| `running-workflows-with-agents` | | `root`, `workflow`, `phase?`, `total_iterations`, `phase_entered_at?`, `agents` |
| `running-workflows-unattended` | | `root`, `workflow`, `phase?`, `phase_entered_at?` |
| `stopped-workflows` | | `root`, `workflow`, `phase?`, `status`, `end_reason?`, `last_failure?` |

`attempts` and `last_failure` hold JSON text from the state file. `agents`
excludes `me`.

## Subscription quota observations

| Query | Parameters | Columns |
| --- | --- | --- |
| `claude-usage` | | `id`, `limit_id`, `window_minutes?`, `used_percent`, `resets_at?`, `resets_text?`, `recorded_at`, `source` |
| `codex-usage` | | The same columns, from local Codex logs. |

These queries observe account quota windows, not per-session token totals.
Claude reads the CLI result. Codex selects the latest recorded timestamp per limit and window within adaptively read tails of the 32 most recently modified logs (4 KiB initial read, 256 KiB maximum per file).
Codex rows can be stale; they do not certify the currently signed-in account.
