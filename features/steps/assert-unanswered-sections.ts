import { defineStep, z } from "nukadoko";
import askForReport, { sectionStatus } from "./ask-for-report.ts";

export default defineStep({
  description: "Asserts every section is either answered with no error or unanswered with at least one provider error, and that the checkout section was answered.",
  pattern: "each section whose provider did not answer carries that provider's error",
  args: z.object({ sections: sectionStatus }),
  returns: z.object({ unanswered: z.array(z.string()).describe("the sections whose providers did not all answer") }),
  from: { sections: [askForReport, "sections"] },
  mutates: false,
  rationale:
    "Which providers answer depends on the machine (CI has no herdr or mise), so the step checks the rule rather than a fixed list; git is the one provider every machine that runs this has.",
  run({}, { sections }) {
    for (const section of sections) {
      if (section.ok === 0 && section.errors.length === 0) throw new Error(`${section.section} did not answer and names no error`);
      if (section.ok === 1 && section.errors.length > 0) throw new Error(`${section.section} answered but names ${section.errors.join("; ")}`);
    }
    const git = sections.find((section) => section.section === "git");
    if (git?.ok !== 1) throw new Error("the checkout section did not answer");
    return { unanswered: sections.filter((section) => section.ok === 0).map((section) => section.section) };
  },
});
