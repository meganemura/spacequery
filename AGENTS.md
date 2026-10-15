# AGENTS.md

Context for agents that work in this repository.

## What this is

spacequery answers questions about the state of one developer's machine: which coding agents run where, which repositories are dirty, which worktrees have nobody in them.
It is a query layer with no data of its own.
Each provider (a terminal multiplexer, git, a repository manager) fills its own tables at query time, and named queries join them.
Every call starts from an empty in-memory SQLite database, so there is no cache and nothing to invalidate.
The tables, the loaders, and the queries are written with solarsql, so the shape of every row is a type.

The design records live in `docs/` as ADRs.
Read them before you change the shape.
The rules for a provider, and the steps to add one, are in `docs/adding-a-provider.md`.
The usage documentation of spacequery is `skills/spacequery/SKILL.md` with its references; a change to a flag or a query edits it in the same commit.
The usage documentation of solarsql is `node_modules/solarsql/skills/solarsql/SKILL.md`.

## Visibility

This repository is private today and may turn public.
Write all committed text in English: code comments, docs, commit messages.
Do not reference private tools, private repositories, or internal working documents in committed content.
If you want to cite an internal document, write its substance in place instead.

## Rules

- Do not add dependencies without the owner's approval. Pin exact versions. Prefer language-official packages, then vendor packages, and avoid single-maintainer packages.
- Comments say why, not what. Each module starts with its responsibility and its boundary.
- Do not publish a version without the owner's explicit approval. A push to `main` that changes `package.json` runs `.github/workflows/publish.yml`. When no `v<version>` tag exists yet, it publishes to npm after the `publish` environment is approved, then creates the tag and the GitHub release. Nobody pushes a `v*` tag by hand. The steps are in `docs/releasing.md`.
- spacequery reads. It never writes to a provider. Actions stay with the tools that own the state.
- The database is new on every call, so there is one migration. On a schema change, delete `migrations/`, run `npx solarsql build spacequery.config.ts`, then `npx solarsql migration initial spacequery.config.ts`, and commit what they wrote.
- spacequery holds no cache. The call log under the state directory is the one file spacequery writes; it holds query names and times only. A provider that does not answer gives an empty table and a row in `providers` that says so.


<!-- ARCHSTRICT_START -->
## archstrict

In projects with an `archstrict.config.ts` (module-boundary/architecture linting), run `archstrict rules <path>` BEFORE creating a file or adding an import - it reports the module, tags, and constraints that would govern that path, even before it exists. Run `archstrict check` after editing to confirm.

The full rule reference (every rule's evidence/because/do shape, the config schema, the pre-edit query) is at `node_modules/archstrict/skills/archstrict/SKILL.md` when installed via npm - read it before configuring `archstrict.config.ts`, or when a violation's `do:` text alone isn't enough.

If there is no `archstrict.config.ts`, skip archstrict entirely - it may not be installed here.
<!-- ARCHSTRICT_END -->
