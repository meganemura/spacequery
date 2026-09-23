# The tables

What each provider fills, for a user query or an ad hoc statement.
Every table is empty until a statement reads it; a statement pays only for the providers it reads.
`root` is the join key across providers: the git toplevel of a directory.

## `path_entries` and `path_commands` (search_path)

`path_entries`: `position` (zero-based key), `dir`, `exists`, `duplicate_of?`.
The `dir` value keeps the PATH entry text, except that an empty entry becomes `.`.
`exists` is 1 when the entry is a directory.
`duplicate_of` names the first position with the same `dir` text.

`path_commands`: `name`, `dir`, `position`, `effective`, with `position` and `name` as the key.
Each row is a regular executable file in one PATH entry.
The executable test follows symbolic links and requires `X_OK` permission.
`effective` is 1 for the first match of a name in PATH order.
The row keeps `dir/name` as written and does not use the real path.
The tables describe the caller's PATH and do not change with `--scope`.

## `agents` (herdr)

| Column | Type | Meaning |
| --- | --- | --- |
| `pane_id` | text, key | herdr's pane id. |
| `session_id` | text? | The session id the agent's herdr integration reported. |
| `name` | text? | The name given in herdr. |
| `agent` | text | The detected agent: `claude`, `codex`, ... |
| `agent_status` | text | herdr's `working`, `idle`, `blocked`, or `unknown`. |
| `focused` | integer | 1 for the pane herdr has in focus. |
| `cwd` | text | The pane's working directory. |
| `foreground_cwd` | text? | The foreground process's directory when it differs. |
| `root` | text? | The git toplevel of `cwd`, or null. |
| `workspace_id`, `tab_id` | text? | Where the pane sits. |
| `title` | text? | The terminal title. |

## `sessions`, `claude_sessions`, and `codex_sessions`

`sessions` is the supertype for data both sources share. Each subtype has one row for its matching parent and keeps source column names and values.

| Column | Type | Meaning |
| --- | --- | --- |
| `session_id` | text, key | Claude Code's session id or Codex's thread id. |
| `agent` | text | `claude` or `codex`. |
| `pid` | integer? | The process. |
| `cwd`, `root` | text, text? | Where it runs. |
| `name` | text? | The registry or database name. Claude `name_source` identifies its source. |
| `started_at`, `updated_at` | integer? | Milliseconds since the epoch. |
| `last_turn_at` | integer? | The timestamp of the last record in the transcript. |
| `last_branch` | text? | The branch the last record names. |

`claude_sessions`: `session_id` (key and `sessions` reference), `model?`, `effort?`, `per_turn_effort?`, `metadata_at?`, `kind?`, `entrypoint?`, `status?`, `status_updated_at?`, `name_source?`, `version?`, `pid_domain?`, `peer_protocol?`.

Claude `model`, `effort`, and `per_turn_effort` come from the latest matching
assistant response in the final 8 KiB of the live session transcript.
`metadata_at` is that response's timestamp in milliseconds since the epoch.
These fields describe the recorded response; later setting changes can differ.
Missing fields stay null, including an effort omitted by an older Claude version.
The loader keeps all fields from one response and skips synthetic and sidechain responses.
When cwd changes, it probes the live session ID in the immediate project directories.
An ambiguous fallback or a missing transcript leaves the metadata null.
It reads local files only and does not install hooks or infer values from defaults.

`codex_sessions`: `session_id` (key and `sessions` reference), `source?`, `thread_source?`, `model?`, `model_provider?`, `reasoning_effort?`, `cli_version?`, `sandbox_policy?`, `approval_mode?`, `git_branch?`, `git_origin_url?`, `title?`, `tokens_used`, `archived`.

## `git_status` and `worktrees` (git)

`git_status`: `root` (key), `branch?`, `upstream?`, `ahead`, `behind`, `dirty_count`, `untracked_count`, `observed_at`.
`worktrees`: `path` (key), `repo_root`, `branch?`, `head?`. The main worktree has `path = repo_root`.

Under the default scope these hold the repositories that have an agent; under `--scope all`, every ghq repository too.

## `repos` (ghq)

`path` (key, the same string as a root), `host`, `owner`, `name`.

## `tools`, `tool_uses`, `root_path_entries`, and `root_path_commands` (mise)

`tools`: `id` (key, `tool@version`), `tool`, `version`, `install_path?`, `installed`, `active`.
`tool_uses`: `id` (key, `root tool`), `root`, `tool`, `version`, `source?`, `installed`. One row per root in scope and tool mise activates there.

`root_path_entries`: `root`, `position`, `dir`, `exists`, `duplicate_of?`.
The pair of `root` and `position` is the key.
`position` is zero-based.
`dir` keeps the PATH entry text, and an empty entry becomes `.`.
`exists` is 1 when the entry is a directory.
`duplicate_of` names the first position with equal `dir` text.

`root_path_commands`: `root`, `name`, `dir`, `position`, `effective`.
The combination of `root`, `position`, and `name` is the key.
Each row is a regular executable file in one PATH entry.
The executable test follows symbolic links and requires `X_OK` permission.
`effective` is 1 for the first match of a name in PATH order.
Both tables contain the `PATH` that `mise env` reports for each root in scope.

## `brew_packages` (brew)

`id` (key, `kind:name@version`), `kind`, `name`, `version`.
One row for each installed Homebrew formula or cask version.
`kind` is `formula` or `cask`.
The package name does not identify an executable name.

## `repository_versions` (repository_versions)

`id` (key), `root`, internal `repository_id?`, `project_path`, `ecosystem`, `kind`, `dependency_role?`,
`origin`, `name`, `requested?`, `locked?`, `source`, `locator?`, `status`, `detail?`.

Each row is one item of static evidence from the file in `source`.
`root` identifies the inspected checkout. The opaque `repository_id` joins linked worktrees for repository counts and is not query output.
Directories without Git metadata get separate root-based identities.
Invalid Git metadata leaves this field null, adds an error row, and makes the provider incomplete.
`project_path` is the source directory relative to the root.
`locator` identifies a JSON field, npm package location, lock section, or line.
Declaration rows fill `requested`; lock rows fill `locked`.
They stay separate because a declaration does not identify one nested lock entry.
`status` is `observed`, `unresolved`, `unsupported`, or `error`.
`dependency_role` identifies runtime, development, optional, and peer requests.
`origin` identifies a manifest, lock file, version file, or source status row.

The scan supports fixed `.node-version`, `.python-version`, `.ruby-version`,
and `.tool-versions` values, `package.json`, npm lock versions 2 and 3, and
bounded sections of `Gemfile.lock`.
The Ruby `Gemfile`, TOML manifests, and other known lock formats produce
unsupported source rows. Local, workspace, alias, Git, URL, tarball, and linked references
produce unresolved rows. A bare Bundler dependency is normalized to `*`.

The reader follows no symbolic link. It accepts regular files up to 2 MiB.
One scan accepts up to 16 MiB of source data and emits at most 50,000 evidence rows.
The reader uses one extra byte to detect each byte-limit overflow.
A row-limit failure adds one final diagnostic row.
It reads known source names at the root and in npm workspaces declared by the root.
It does not use workspace declarations from nested packages.
Workspace patterns support literal segments, `*`, `?`, and `**`.
Discovery visits at most 2,000 entries and descends through 12 directory levels.
It accepts at most 100 workspace patterns and 500 workspace projects.
It skips `.git`, `.claude`, `.claude-team`, `.codex`, `.agents`, `.hegel`,
`node_modules`, `vendor`, `dist`, `build`, `target`, `.cache`, `.next`,
`.turbo`, and `coverage` directories.
An error row means the observation is incomplete and the provider has `ok = 0`.
Lock rows describe lock file evidence. They do not prove an installed package or runtime.

## `repository_config_files` (repository_config_files)

`id` (key), `root`, `project_path`, `path?`, `format?`, `category?`,
`parse_support?`, `observation_kind`, `status`, `detail?`.

File rows inventory a fixed catalog of dependency, language, and tool source
names. Categories are `manifest`, `lock`, `version-file`, and `tool-config`.
Parser support is a capability of the static version reader. It does not prove
that present file content is readable or valid. The inventory does not read
listed file bodies. It reads the root `package.json` with the version reader's
bounds and file safety checks only to discover declared npm workspaces.

The inventory checks all recognized names at the root and in each declared
workspace. It does not recurse outside workspace declarations. Discovery rows
carry null format, category, and parser support, so they cannot look like real
files. `incomplete` records unsupported workspace syntax or a skipped workspace
link. `error` records a hard discovery failure. Both make provider status fail.
Regular unsupported formats remain successful file observations.

## `pull_requests` (github)

`id` (key, `owner/name#number`), `repo`, `root?`, `number`, `title`, `head_branch?`, `head_repo?`, `base_branch?`, `author?`, `is_draft`, `state`, `review_decision?`, `checks?`, `updated_at`, `url`.
The open pull requests of every repository in scope. `checks` comes from the last commit's status check rollup state. `head_repo` is the repository the head branch lives in; it differs from `repo` for a pull request from a fork, and the joins on the branch require the two to match. `updated_at` is milliseconds since the epoch.

## `review_requests` (github_reviews)

`id` (key, `owner/name#number`), `repo`, `root?`, `number`, `title`, `author?`, `updated_at`, `url`.
One search across GitHub for the pull requests that request the caller's review; `root` is null when the repository is not in scope. Its own loader, because the search costs 2 to 5 s and a query that does not read this table does not wait for it.

## `processes` and `listeners` (processes)

`processes`: `pid` (key), `ppid`, `pgid`, `cwd`, `root`, `command`, `executable`, `elapsed_s`, `rss_kb`, `cpu`.
It contains user processes whose cwd is inside a root in scope. `executable` is the basename of the first command field.

`listeners`: `id` (key, `pid:address:port`), `pid`, `address`, `port`, `cwd?`, `root?`, `command?`.
It contains every listening TCP socket of the user. A process can have rows for both IPv4 and IPv6 or for several ports. `root` is set when its cwd is inside a root in scope.

## `containers`, `container_roots`, and `container_ports` (docker)

`containers`: `id` (key), `name`, `image`, `state`, `health?`,
`created_at`, `started_at?`, `finished_at?`, `exit_code`, `oom_killed`,
`restart_count`, `compose_project?`, `compose_service?`.
It contains every container in the active Docker CLI context, including stopped
containers.
Timestamps are milliseconds since the epoch.
Docker zero timestamps become null.
`image` is Docker `Config.Image`, and `state` is Docker `State.Status`.
`health` is Docker `State.Health.Status` when Docker reports it.
`compose_project` and `compose_service` come from the canonical Compose labels.

`container_roots`: `container_id`, `root`, with the pair as the key.
It associates a container with repository roots found from bind mounts and the
optional Compose working-directory label.
A container that does not map to a repository remains in `containers` and has
no `container_roots` row.

`container_ports`: `id` (key), `container_id`, `container_port`, `protocol`,
`host_ip?`, `host_port?`.
It contains one row for each exposed container port and host binding.
An exposed port with no host binding has null host fields.
Multiple host bindings become multiple rows.

## `skills` and `plugins` (skills)

`skills`: `path` (key), `source`, `agent`, `name`, `description?`, `root?`, `plugin?`.
`source` is `claude-user`, `claude-project`, `claude-plugin`, `codex-user`,
`codex-system`, or `codex-plugin`. `root` is set for project skills. `plugin`
is set for plugin skills.

`plugins`: `id` (key), `agent`, `name`, `marketplace?`, `version?`, `path`,
`installed_at?`, `updated_at?`. Timestamps are milliseconds since the epoch.

## `cursor_agents` (cursor)

`composer_id` (key), `name?`, `status?`, `unified_mode?`, `model?`,
`worktree_path?`, `branch_name?`, `workspace_path?`, `root?`, `is_archived?`,
`is_subagent?`, `created_at?`, `updated_at?`.
The table contains the newest 32 conversations from Cursor's local index.
`model` is the conversation's `modelConfig.modelName`. `branch_name` is
`gitWorktree.branchName`. Timestamps are milliseconds since the epoch.
A missing database leaves the table empty and the provider `ok` 1.
Cloud agent ids are absent; this store is the IDE database on the machine
running Cursor's UI.

## `issues` (beads)

`id` (key, `root issue_id`), `root`, `issue_id`, `title`, `status`,
`priority?`, `issue_type?`, `assignee?`, `labels?`, `created_at?`,
`updated_at?`, `dependency_count`, `dependent_count`, `comment_count`.
The table contains open issues from roots in scope that have `.beads`.
`labels` joins labels with commas. Timestamps are milliseconds since the epoch.

## `ready_issues` (beads_ready)

The same columns as `issues`.
The table contains claimable issues from `bd ready` for roots in scope that have `.beads`.
A claimable issue has no open blockers. In-progress, blocked, and deferred issues stay out.
The reader passes `--limit 0` so the default cap does not hide the rest of the queue, and it does not pass `--claim`.

## `runtag_jobs` (runtag)

`id` (key), `status`, `exit_code?`, `orphan`, `repo_root?`, `cwd?`, `supervisor_pid?`.
[runtag](https://github.com/meganemura/runtag) ([npm](https://www.npmjs.com/package/runtag)) writes these files. spacequery reads them.
The table contains every readable job file under `$XDG_DATA_HOME/runtag/jobs/`, or
`~/.local/share/runtag/jobs/` when `XDG_DATA_HOME` is unset. `status` is `running`
or `exited`. `orphan` is 1 when the file says `running` and `supervisor_pid` is not
a live process; `exit_code` is null on that row. `orphan` is 0 otherwise.
A missing jobs directory leaves the table empty and the provider `ok` 1.

## `workflow_runs` (headsign)

`root` (key), `workflow`, `workflow_path?`, `status`, `phase?`,
`total_iterations`, `attempts?`, `last_failure?`, `end_reason?`,
`stop_nudges`, `driver_agent?`, `phase_entered_at?`.
The table contains roots in scope with a readable `.headsign/state.json`.
`attempts` and `last_failure` are JSON text. `phase_entered_at` is milliseconds
since the epoch.

## `providers` (the core)

`name` (key), `source`, `ok`, `observed_at`, `ms`, `error?`. One row per provider the call ran. `source` is `built-in` or `user`. A statement that reads only this table runs no provider.

## Writing a statement

- Join on `root`. `agents.root` can be null; `sessions.root` too.
- Exclude the caller with `(:me is null or a.pane_id <> :me)`; the CLI binds `:me`.
- Give every expression column a `cast(... as integer | real | text)` when you want a stable type; SQLite does not require it for a user query.
- Every table is read in full; there are no indexes, and a call holds at most a few hundred rows per table.

## `claude_usage` and `codex_usage`

Each table has `id` (key), `limit_id`, `window_minutes?`, `used_percent`,
`resets_at?`, `resets_text?`, `recorded_at`, and `source`.
Percentages mean consumed quota, not remaining quota. Timestamps use epoch milliseconds.

Claude rows preserve the CLI window label as `limit_id`.
Current session maps to 300 minutes; Current week labels map to 10080 minutes.
Other labels have a null window length. Model labels are not hard-coded.
`resets_text` preserves the yearless reset date and timezone. `resets_at` stays null.
`recorded_at` is the time the command returned; `source` is `claude /usage`.
The command's own token usage and local attribution paragraphs are not quota windows.

Codex rows retain the newest valid record for each limit ID and window length within the inspected local log tails.
`recorded_at` is the event timestamp, `resets_at` comes from the recorded epoch value,
and `source` is the log path. `resets_text` is null.
The scan inventories saved and archived sessions, then reads backward from the 32 most recently modified logs.
Reads start at 4 KiB and double until complete quota records appear, the file starts, or 256 KiB has been read.
Byte fragments are joined before decoding and parsing lines. Earlier blocks after a match are not read.
It reads at most 8 MiB of log contents. Older files and records outside the tails can contain omitted windows or newer event timestamps.
The result describes recent local evidence, not an exhaustive history scan.
Older accounts and expired windows can remain in the logs. Inspect the source and timestamps before treating a row as current.
A missing window yields no row. These percentages describe account quotas, which can include activity on other devices.
Token totals and local-only usage accounting are separate from these tables.
