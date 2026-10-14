import { defineStep, z } from "nukadoko";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", ["-c", "user.email=scenario@example.invalid", "-c", "user.name=scenario", ...args], { cwd });
}

export default defineStep({
  description: "Creates a scratch git repository with one committed file, then changes that file without committing it.",
  pattern: "a git repository with a committed file changed and not committed",
  args: z.object({}),
  returns: z.object({
    root: z.string().describe("the scratch repository's root"),
    configHome: z.string().describe("an empty XDG_CONFIG_HOME, so only the built-in provider defaults apply"),
    stateHome: z.string().describe("the XDG_STATE_HOME spacequery writes its call log under"),
  }),
  mutates: true,
  rationale:
    "A tracked file changed in place is one uncommitted change and no untracked file, so the count the report gives is exact. The report itself writes nothing into the repository.",
  run({ scratch }) {
    const root = scratch.dir("spacequery-scenario-repo");
    writeFileSync(join(root, "notes.txt"), "first\n");
    git(root, "init", "--quiet");
    git(root, "add", "notes.txt");
    git(root, "commit", "--quiet", "-m", "Add notes");
    writeFileSync(join(root, "notes.txt"), "second\n");
    return { root, configHome: scratch.dir("spacequery-scenario-config"), stateHome: scratch.dir("spacequery-scenario-state") };
  },
});
