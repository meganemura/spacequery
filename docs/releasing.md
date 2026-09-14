# Releasing

spacequery stays on 0.x.0 versions for now. A release is three things: the npm package, a git tag, and the skill.

1. Move the `(unreleased)` entry of `CHANGELOG.md` to the version and the date. Set the same version in `package.json`.
2. `npm run check && npm test`.
3. `npm pack --dry-run` and read the file list: the source, `migrations/`, `skills/`, the READMEs, the changelog, the license, and nothing from `test/`.
4. Commit as `chore: release 0.x.0`, tag `v0.x.0`, push the branch and the tag.
5. `npm publish` (the owner runs it; `prepublishOnly` repeats the checks).
6. `--notes-file CHANGELOG.md` would paste every version's notes into the release, so extract the version's section first: `awk '/^## 0.x.0/{f=1;next} /^## /{f=0} f' CHANGELOG.md > notes.md`, then `gh release create v0.x.0 --title v0.x.0 --notes-file notes.md`. This is what `gh skill publish` would do, and it refuses a tag that exists; the repository already carries the `agent-skills` topic that publish adds. `gh skill publish --dry-run` still validates the skill; run it in a checkout without `node_modules` (a fresh clone, or move the directory aside), because it scans the filesystem and would count the solarsql skill under `node_modules` as well. Agents install with `gh skill install meganemura/spacequery spacequery --scope user --agent claude-code` (or `--agent codex`) and refresh with `gh skill update`.
7. On this machine, `npm link` again if the linked checkout moved, and `gh skill update` so the installed copies follow.
