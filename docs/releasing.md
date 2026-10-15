# Releasing

spacequery stays on 0.x.0 versions for now. A release is three things: the npm package, a git tag, and the skill.

A push to `main` that changes `package.json` runs [`.github/workflows/publish.yml`](../.github/workflows/publish.yml). Its `check` job reads the `package.json` version and looks for the tag `v<version>`. When that tag exists, the push releases nothing, so a dependency bump or a revert of a version bump publishes nothing. When the tag is missing, the workflow installs the pushed commit, runs the release checks, and runs `npm publish`. npm authenticates with GitHub Actions OIDC through the Trusted Publisher. Provenance is attached automatically because the repository and the package are public. The repository stores no `NPM_TOKEN`; the workflow does not use a long-lived npm secret. The GitHub Environment `publish` is the human gate: it has required reviewers, and the job waits there until it is approved.

The `publish` job keeps `contents: read`. After `npm publish` succeeds, a separate `release` job creates the tag `v<version>` at the published commit and the GitHub release. Nobody pushes a `v*` tag by hand. That job is the only one with `contents: write`, so the npm OIDC token never sits on a job that can write repository contents. Both jobs check out with the same pinned `actions/checkout` commit.

Every `uses:` in a workflow must be a full-length 40-hex commit SHA, with the version in a trailing comment, for example `uses: actions/checkout@<40-hex> # vX.Y.Z`. This repository has the GitHub Actions setting "Require actions to be pinned to a full-length commit SHA" (`sha_pinning_required`) enabled. A tag ref fails that check.

## Trusted publisher

The npm Trusted Publisher and the GitHub Environment `publish` are already configured for this package (23 September 2026). Recreate the publisher only when it is missing. The fields are case-sensitive:

- Organization or user: `meganemura`
- Repository: `spacequery`
- Workflow filename: `publish.yml` (the filename, including `.yml`)
- Environment name: `publish`
- Allowed action: `npm publish`

A trusted publisher created after 3 September 2026 starts with `npm stage publish` allowed. Select `npm publish` as well. This workflow runs `npm publish`.

The publish job runs from a push to `main`, not from a tag, so the `publish` environment must allow deployments from `main`. If its deployment branches and tags rule names only `v*` tags, the owner changes it to allow `main`.

The Review deployments prompt appears only after a version bump on `main` starts `publish.yml` and the job enters the `publish` environment. Registering the Trusted Publisher does not create that prompt.

`package.json` `repository.url` already points at `https://github.com/meganemura/spacequery.git`. npm checks that URL against the workflow repository.

After a publish from Actions succeeds, the package settings can require two-factor authentication and disallow token publishing. Revoke any leftover bootstrap granular tokens. The trusted publisher keeps working.

## Each version

1. Set the version in `package.json`, and run `npm install --package-lock-only` so `package-lock.json` carries it. Turn the `## Unreleased` heading of `CHANGELOG.md` into `## 0.x.0 (<date>)`, and add an empty `## Unreleased` above it.
2. `npm run check && npm test`.
3. `npm pack --dry-run` and read the file list: the source, `migrations/`, `skills/`, the READMEs, the changelog, the license, and nothing from `test/`.
4. Commit the version, the lock file, and the changelog section together as `chore: release 0.x.0`. Land that commit on `main` through `queue`: push it to `queue`, and once CI passes on the queue tip, `main` fast-forwards to it. The push to `main` that changes `package.json` starts the workflow. Do not push a tag: the workflow creates it.
5. Approve the `publish` environment on that Actions run. Review deployments is waiting only after the job has entered the environment. The workflow uses Node 24 on `ubuntu-latest`, runs `npm ci`, `npm run build`, `npm run check`, and `npm test`, then `npm publish`. `prepublishOnly` repeats the checks.
6. After `npm publish` succeeds, the workflow's `release` job creates the tag `v0.x.0` at the published commit and the GitHub release. It extracts only that version's section from `CHANGELOG.md` (the whole file would carry every version), and it skips a release that already exists, so re-running the job is safe. If that job fails, re-run only that job from the Actions page. A new run of the whole workflow finds no tag and runs `npm publish` again, which npm refuses for a version it already holds. The owner can also extract the section and create the release by hand: `awk -v v=0.x.0 '$0 ~ "^## " v " " {in_version=1; next} /^## /{in_version=0} in_version' CHANGELOG.md > notes.md`, then `gh release create v0.x.0 --title v0.x.0 --notes-file notes.md --target <published commit>`.
7. The repository already carries the `agent-skills` topic. `gh skill publish --dry-run` still validates the skill; run it in a checkout without `node_modules` (a fresh clone, or move the directory aside), because it scans the filesystem and would count the solarsql skill under `node_modules` as well. Agents install with `gh skill install meganemura/spacequery spacequery --scope user --agent claude-code` (or `--agent codex`) and refresh with `gh skill update`.
8. On this machine, `npm link` again if the linked checkout moved, and `gh skill update` so the installed copies follow.
