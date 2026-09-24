# ADOPTION_PAIN — spacequery (rocky local dogfood)

Date: 2026-09-24 (JST)

## Setup
- Worktree: `spacequery-archstrict-adopt` from `origin/main`
- Install: `file:../archstrict` (local unpublished)
- Result: `npx archstrict check` exit 0; `todo` firstRun with 0 freezable debt

## Frictions

### 1. No `src/` — layout is `core/` + `providers/` + `ui/` + root entrypoints
`init 'providers/*'` discovers provider packages only. Root `cli.ts` / `catalog.ts` / `dashboard.ts` are first-class source, not under a directory module.

### 2. Root entrypoints vs single-file modules (archstrict-4oe)
Including `cli.ts` as its own module would need a single-file glob and breaks `todo` (ENOTDIR). First adopt excludes root `*.ts` entirely — entrypoints are out of analysis.

### 3. Brace multi-root globs do not match
`{core,providers,ui}/**` left everything uncovered. Same workaround as playmodel: `**/*` + excludes.

### 4. Whole-tree noise (archstrict-4fq)
`test/`, `migrations/`, `docs/`, `skills/` need exclude.

### 5. ModuleName hand-patch (archstrict-re9)
Init union was 19 provider names; collapsed to `"spacequery"`.

## What made it operational
- `exclude`: test/migrations/docs/skills/dist/coverage/scripts/features/fixtures + root `*.ts`
- Single module `{ name: "spacequery", glob: "**/*", surface: "index.ts" }`
- Patched `ModuleName` to `"spacequery"`
- Note: 7 unresolved `node:sqlite` specifiers (informational)

## Later refinement
- Directory modules for `core` / `providers` / `ui` once surfaces exist
- Root entrypoints need either a package wrapper directory or a fixed single-file module story (4oe)
