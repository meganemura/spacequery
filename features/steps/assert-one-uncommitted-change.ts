import { defineStep, z } from "nukadoko";
import askForReport from "./ask-for-report.ts";

// An untracked count above zero would mean spacequery or the scenario wrote
// into the repository it only reads. The sentence says "one", so observe
// gives the count in that word only when the report was printed and nothing
// is untracked; otherwise it names the exit code and both counts.
export default defineStep({
  description: "Claims the report was printed and its checkout section counts one changed tracked file and no untracked file.",
  pattern: "the checkout section counts one uncommitted change",
  args: z.object({
    exitCode: askForReport.returns.shape.exitCode,
    dirtyCount: askForReport.returns.shape.dirtyCount,
    untrackedCount: askForReport.returns.shape.untrackedCount,
  }),
  from: {
    exitCode: [askForReport, "exitCode"],
    dirtyCount: [askForReport, "dirtyCount"],
    untrackedCount: [askForReport, "untrackedCount"],
  },
  observe({}, { exitCode, dirtyCount, untrackedCount }) {
    const printed = exitCode === 0 && untrackedCount === 0;
    return {
      changes: printed && dirtyCount === 1 ? "one" : `exit ${exitCode}, ${dirtyCount} changed and ${untrackedCount} untracked`,
    };
  },
  claims: [{ actual: "changes", compare: "equal", expected: { literal: "one" } }],
});
