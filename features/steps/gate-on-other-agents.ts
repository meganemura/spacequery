import { defineStep, z } from "nukadoko";
import createDirtyRepository from "./create-dirty-repository.ts";
import { runSpacequery } from "./spacequery-cli.ts";

// The exit code is the gate an agent scripts against, so the step keeps it
// and not the printed rows.
export default defineStep({
  description: "Runs `spacequery here --expect-empty`, then the same with `--strict`, and keeps both exit codes.",
  pattern: "the agent gates on other agents in the repository",
  args: z.object({ root: z.string(), configHome: z.string(), stateHome: z.string() }),
  returns: z.object({
    gateExit: z.number().describe("the exit code of `here --expect-empty`: 3 when another agent is in the repository"),
    strictExit: z.number().describe("the exit code of `here --expect-empty --strict`: 4 when a provider did not answer"),
  }),
  from: {
    root: [createDirtyRepository, "root"],
    configHome: [createDirtyRepository, "configHome"],
    stateHome: [createDirtyRepository, "stateHome"],
  },
  mutates: false,
  async run({}, { root, configHome, stateHome }) {
    const homes = { configHome, stateHome };
    const gate = await runSpacequery(["here", "--root", root, "--expect-empty"], homes);
    const strict = await runSpacequery(["here", "--root", root, "--expect-empty", "--strict"], homes);
    return { gateExit: gate.exitCode, strictExit: strict.exitCode };
  },
});
