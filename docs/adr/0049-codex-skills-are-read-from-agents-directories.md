# 0049. Codex skills are read from `.agents/skills` directories too.

Date: 2026-09-25

Status: accepted

## Context

Codex's own documentation names four skill locations: repository
`$CWD/.agents/skills` and parent folders up to the repository root; user
`$HOME/.agents/skills`; admin `/etc/codex/skills`; and the skills the binary
ships with. `gh skill install --agent codex --scope user` writes to
`~/.agents/skills/<name>`, the documented user location. At project scope,
several hosts share `.agents/skills`, so a skill installed there is not
Codex-only.

The skill installer bundled with the Codex binary (version 0.153.0) still
writes to `$CODEX_HOME/skills` (`~/.codex/skills`, with `.system` below it for bundled
skills). ADR 0018 gave the skills provider three Codex sources: `codex-user`,
`codex-system`, and `codex-plugin`. None of them read `.agents/skills`, so a
skill a user installed with `gh skill install` was absent from every Codex
query even though it sits at the documented location.

## Decision

`codex-user` now reads both `~/.agents/skills` and `~/.codex/skills`. `path`
tells the two rows apart when a name is present in both. Codex does not merge
duplicate names across locations; both appear.

A new source, `codex-project`, reads `<root>/.agents/skills` for every root in
scope, the same way `claude-project` reads `<root>/.claude/skills`. Codex also
scans the current working directory and parent folders below the repository
root; a project skill row is keyed and joined on `root` (see `skills-in-dir`
and `project-skills-with-agents`), so only the repository root is in scope,
not a cwd below it.

A new source, `codex-admin`, reads `/etc/codex/skills`, with `agent` `codex`
and `root` null. A missing directory yields no rows, the same as the other
sources.

`agent` stays `codex` for every `.agents/skills` row. spacequery models Claude
Code and Codex agents; other hosts that read the same shared directory are out
of scope for this table's `agent` column.

## Consequences

A name present in both `~/.agents/skills` and `~/.codex/skills` gives two
`codex-user` rows, so `duplicate-skill-names` reports it.

`codex-admin` cannot be exercised against the real `/etc/codex/skills` in a
test without writing outside the test's temporary HOME, so the provider takes
the admin path as a parameter of an internal function; a test calls that
function with a fake directory instead.

This amends [0018](0018-skills-are-read-from-the-filesystem.md).
