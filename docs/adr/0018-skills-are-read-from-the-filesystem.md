# 0018. Skills and plugins are read from agent files.

Date: 2026-09-10

Status: accepted; the Codex skill locations are extended by [0049](0049-codex-skills-are-read-from-agents-directories.md)

## Context

Skills describe the tools that Claude Code and Codex can use. Claude Code has
user skills, project skills, and installed plugin skills. On 2026-09-10 the
user directory held 33 skills and project roots held 31 skills. Its installed
plugin registry names the installed versions, while its cache can hold older
versions beside them.

Codex has user skills, system skills, and plugin skills. Codex records enabled
plugins by ID in `config.toml`. Cache entries use
`cache/<marketplace>/<plugin>/<version>/`, contain a plugin manifest, and hold
skills below `skills/`. The enabled-plugin records do not name a version, so
the provider reports every cached version for an enabled ID.

## Decision

The skills provider owns `skills` and `plugins`. `skills` records the path,
agent, source, name, description, project root, and plugin ID. `plugins`
records the ID, name, marketplace, version, path, and install timestamps.
Codex IDs use `codex:<configured-id>` because Claude Code can install the
same configured ID and `plugins.id` is the table key.

The six skill sources are `claude-user`, `claude-project`, `claude-plugin`,
`codex-user`, `codex-system`, and `codex-plugin`. Project skills use roots
from the agents table. Claude plugin rows use installed registry entries only.

The provider uses a small frontmatter reader. It reads the block between the
first two `---` lines, and recognizes only column-zero `name` and
`description` keys. It accepts plain values and single- or double-quoted
values, including quoted lines. It does not parse YAML metadata, nesting,
escapes, or other YAML features.

## Consequences

Filesystem reads take milliseconds and need no cache. A frontmatter shape that
the reader cannot parse still yields a row with the directory name and a null
description.

Codex cache rows can include more than one version for an enabled plugin until
Codex adds a versioned installed-plugin record. The provider reports that
state instead of inferring one current version.
