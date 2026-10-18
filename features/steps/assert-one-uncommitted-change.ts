import { defineStep, z } from "nukadoko";
import askForReport from "./ask-for-report.ts";

// An untracked count above zero would mean spacequery or the scenario wrote
// into the repository it only reads.
export default defineStep({
  description: "Asserts the report was printed and its checkout section counts one changed tracked file and no untracked file.",
  pattern: "the checkout section counts one uncommitted change",
  args: z.object({ exitCode: z.number(), dirtyCount: z.number(), untrackedCount: z.number() }),
  from: {
    exitCode: [askForReport, "exitCode"],
    dirtyCount: [askForReport, "dirtyCount"],
    untrackedCount: [askForReport, "untrackedCount"],
  },
  mutates: false,
  run({}, { exitCode, dirtyCount, untrackedCount }) {
    if (exitCode !== 0) throw new Error(`expected exit 0, got ${exitCode}`);
    if (dirtyCount !== 1) throw new Error(`expected 1 changed file, got ${dirtyCount}`);
    if (untrackedCount !== 0) throw new Error(`expected no untracked file, got ${untrackedCount}`);
  },
});
