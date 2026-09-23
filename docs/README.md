# Design records

How a version is released: [releasing.md](releasing.md).

This directory records architecture decisions for spacequery.
Each ADR describes one decision and its consequences.

| ADR | Decision |
| --- | --- |
| [0001](adr/0001-name-panoram.md) | The tool is named panoram (superseded by 0030). |
| [0002](adr/0002-fresh-database-per-call.md) | Each call uses a fresh in-memory database. |
| [0003](adr/0003-repository-root-join-key.md) | The repository root joins provider data. |
| [0004](adr/0004-one-module-per-provider.md) | Each provider uses one solarsql module. |
| [0005](adr/0005-read-only-tool.md) | spacequery reads provider state. |
| [0006](adr/0006-codegraph-outside-v0.md) | CodeGraph is not a provider. |
| [0007](adr/0007-resolve-loaders-with-authorizer.md) | The core resolves named queries from metadata and ad hoc SQL with an authorizer probe. |
| [0008](adr/0008-loader-order.md) | Loaders run in dependency order, then configuration order. |
| [0009](adr/0009-provider-freshness-envelope.md) | The envelope carries provider freshness. |
| [0010](adr/0010-ad-hoc-sql-for-people.md) | Ad hoc SQL is for a person at a shell. |
| [0011](adr/0011-single-regenerated-migration.md) | The schema uses one regenerated migration. |
| [0012](adr/0012-mise-provider.md) | mise is the fourth provider. |
| [0013](adr/0013-user-queries-are-sql-files.md) | User queries are SQL files. |
| [0014](adr/0014-sessions-are-observed-not-searched.md) | Sessions are observed, not searched. |
| [0015](adr/0015-the-skill-is-the-usage-documentation.md) | The skill is the usage documentation, and the README is the door. |
| [0016](adr/0016-github-is-observed-through-gh.md) | GitHub is observed through gh. |
| [0017](adr/0017-processes-in-scope-only.md) | Processes in scope are observed through ps and lsof. |
| [0018](adr/0018-skills-are-read-from-the-filesystem.md) | Skills and plugins are read from agent files. |
| [0019](adr/0019-beads-issues-are-read-per-repository.md) | Beads issues are read per repository. |
| [0020](adr/0020-headsign-state-is-read-from-the-file.md) | Headsign state is read from the file. |
| [0021](adr/0021-the-package-ships-the-source-and-the-skill.md) | The package ships the TypeScript source and the skill, and the skill installs from the repository. |
| [0022](adr/0022-no-process-bursts-before-big-binaries.md) | Large binaries run before process bursts (the order rationale is superseded by 0032; in-process root reading stays). |
| [0023](adr/0023-a-call-log-orders-help.md) | A call log orders help by use. |
| [0024](adr/0024-columns-take-the-source-name-and-subtypes-hold-the-rest.md) | Columns take the source name, and subtypes hold the rest. |
| [0025](adr/0025-a-report-is-sections-from-one-database.md) | A report is sections from one database. |
| [0026](adr/0026-docker-is-observed-through-the-cli.md) | Docker is observed through the CLI. |
| [0027](adr/0027-homebrew-is-a-machine-inventory.md) | Homebrew is a machine inventory. |
| [0028](adr/0028-repository-versions-are-static-file-evidence.md) | Repository versions are static file evidence. |
| [0029](adr/0029-repository-config-files-are-a-bounded-inventory.md) | Repository configuration files are a bounded inventory. |
| [0030](adr/0030-rename-to-spacequery.md) | The tool is renamed spacequery. |
| [0031](adr/0031-trace-lists-the-child-processes-of-one-call.md) | The envelope lists the child processes of one call on request. |
| [0032](adr/0032-commands-start-by-absolute-path.md) | The core starts every command by absolute path. |
| [0033](adr/0033-search-path-is-the-callers-environment.md) | The search path provider describes the caller's environment. |
| [0034](adr/0034-root-search-path-comes-from-mise.md) | The search path of a root comes from mise. |
| [0035](adr/0035-user-providers-are-declared-commands.md) | A user provider is a declared command that fills a declared table. |
| [0036](adr/0036-terminal-browser-uses-cli-observations.md) | The terminal browser uses fresh CLI observations. |
| [0038](adr/0038-usage-limits-come-from-cli-and-local-logs.md) | Quota observations come from the Claude CLI and local Codex logs. |
| [0039](adr/0039-watch-reruns-a-query-until-a-predicate.md) | Watch re-runs a query until a predicate. |
| [0040](adr/0040-doctor-reports-observation-health.md) | Doctor reports whether the observation stack answered. |
| [0041](adr/0041-runtag-jobs-are-read-from-the-files.md) | Runtag jobs are read from the files. |
| [0042](adr/0042-short-help-and-provider-lists.md) | Help is a short list, and config can hide a provider from lists. |
| [0043](adr/0043-cursor-agents-are-read-from-the-local-database.md) | Cursor agents are read from the local database. |
