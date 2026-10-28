import { defineStep, z } from "nukadoko";
import askForReport, { sectionStatus } from "./ask-for-report.ts";
import gateOnOtherAgents from "./gate-on-other-agents.ts";

// Nobody else works in a fresh scratch repository, so the plain gate must
// pass. Whether --strict passes depends on which providers this machine has,
// which the report measured: it exits 4 when a section did not answer and 0
// when every one did. observe gives the sentence's words when the exit codes
// follow that rule, and names the exit codes and the unanswered sections
// otherwise.
export default defineStep({
  description: "Claims the plain gate exits 0, and the strict gate exits 4 when a section did not answer and 0 when every one did.",
  pattern: "the gate passes, and the strict gate fails only when a provider did not answer",
  args: z.object({
    gateExit: gateOnOtherAgents.returns.shape.gateExit,
    strictExit: gateOnOtherAgents.returns.shape.strictExit,
    sections: sectionStatus,
  }),
  from: {
    gateExit: [gateOnOtherAgents, "gateExit"],
    strictExit: [gateOnOtherAgents, "strictExit"],
    sections: [askForReport, "sections"],
  },
  observe({}, { gateExit, strictExit, sections }) {
    const unanswered = sections.filter((section) => section.ok === 0).map((section) => section.section);
    const expected = unanswered.length > 0 ? 4 : 0;
    return {
      gate: gateExit === 0 ? "passes" : `exits ${gateExit}`,
      strictGate:
        strictExit === expected
          ? "fails only when a provider did not answer"
          : `exits ${strictExit} with ${unanswered.length > 0 ? `${unanswered.join(", ")} unanswered` : "every section answered"}`,
    };
  },
  claims: [
    { actual: "gate", compare: "equal", expected: { literal: "passes" } },
    { actual: "strictGate", compare: "equal", expected: { literal: "fails only when a provider did not answer" } },
  ],
});
