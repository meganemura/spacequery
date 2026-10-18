import { defineStep, z } from "nukadoko";
import assertUnansweredSections from "./assert-unanswered-sections.ts";
import gateOnOtherAgents from "./gate-on-other-agents.ts";

// Nobody else works in a fresh scratch repository, so the plain gate must
// pass. Whether --strict passes depends on which providers this machine has,
// which the earlier step measured.
export default defineStep({
  description: "Asserts the plain gate exits 0, and the strict gate exits 4 when a section did not answer and 0 when every one did.",
  pattern: "the gate passes, and the strict gate fails only when a provider did not answer",
  args: z.object({ gateExit: z.number(), strictExit: z.number(), unanswered: z.array(z.string()) }),
  from: {
    gateExit: [gateOnOtherAgents, "gateExit"],
    strictExit: [gateOnOtherAgents, "strictExit"],
    unanswered: [assertUnansweredSections, "unanswered"],
  },
  mutates: false,
  run({}, { gateExit, strictExit, unanswered }) {
    if (gateExit !== 0) throw new Error(`expected the gate to exit 0, got ${gateExit}`);
    const expected = unanswered.length > 0 ? 4 : 0;
    if (strictExit !== expected) throw new Error(`expected the strict gate to exit ${expected} (unanswered: ${unanswered.join(", ") || "none"}), got ${strictExit}`);
  },
});
