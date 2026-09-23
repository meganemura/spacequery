# Releasing

spacequery stays on 0.x.0 versions for now. A release is three things: the npm package, a git tag, and the skill.

Pushing a `v*` tag runs [`.github/workflows/publish.yml`](../.github/workflows/publish.yml). The workflow installs the tagged commit, runs the release checks, and runs `npm publish`. npm authenticates with GitHub Actions OIDC. Provenance is attached automatically because the repository and the package are public. The GitHub Environment `publish` is the human gate: the job waits there until it is approved.

## One-time setup on npmjs.com

On the `spacequery` package, add one GitHub Actions trusted publisher. The fields are case-sensitive:

- Organization or user: `meganemura`
- Repository: `spacequery`
- Workflow filename: `publish.yml` (the filename, including `.yml`)
- Environment name: `publish`
- Allowed action: `npm publish`

A trusted publisher created after 3 September 2026 starts with `npm stage publish` allowed. Select `npm publish` as well. This workflow runs `npm publish`.

`package.json` `repository.url` already points at `https://github.com/meganemura/spacequery.git`. npm checks that URL against the workflow repository.

After the first publish from Actions succeeds, the package settings can require two-factor authentication and disallow token publishing. The trusted publisher keeps working. This repository stores no `NPM_TOKEN`.

## Each version

1. Move the `(unreleased)` entry of `CHANGELOG.md` to the version and the date. Set the same version in `package.json`.
2. `npm run check && npm test`.
3. `npm pack --dry-run` and read the file list: the source, `migrations/`, `skills/`, the READMEs, the changelog, the license, and nothing from `test/`.
4. Commit as `chore: release 0.x.0`. Tag `v0.x.0`. The tag without the leading `v` is the `package.json` version; the workflow stops when they differ. Push the commit and the tag. The tag push starts the workflow.
5. Approve the `publish` environment on that Actions run. The workflow uses Node 24 on `ubuntu-latest`, runs `npm ci`, `npm run build`, `npm run check`, and `npm test`, then `npm publish`. `prepublishOnly` repeats the checks.
6. `--notes-file CHANGELOG.md` would paste every version's notes into the release, so extract the version's section first: `awk '/^## 0.x.0/{f=1;next} /^## /{f=0} f' CHANGELOG.md > notes.md`, then `gh release create v0.x.0 --title v0.x.0 --notes-file notes.md`. This is what `gh skill publish` would do, and it refuses a tag that exists; the repository already carries the `agent-skills` topic that publish adds. `gh skill publish --dry-run` still validates the skill; run it in a checkout without `node_modules` (a fresh clone, or move the directory aside), because it scans the filesystem and would count the solarsql skill under `node_modules` as well. Agents install with `gh skill install meganemura/spacequery spacequery --scope user --agent claude-code` (or `--agent codex`) and refresh with `gh skill update`.
7. On this machine, `npm link` again if the linked checkout moved, and `gh skill update` so the installed copies follow.
