import { defineStep, z } from "nukadoko";
import askForReport, { sectionStatus } from "./ask-for-report.ts";

// Which providers answer depends on the machine (CI has no herdr or mise), so
// the step checks the rule rather than a fixed list; git is the one provider
// every machine that runs this has. observe gives the sentence's own words
// when every section either answered with no error or did not answer and
// names one, and the checkout section answered; otherwise it names each
// section that breaks the rule.
export default defineStep({
  description:
    "Claims every section is either answered with no error or unanswered with at least one provider error, and that the checkout section was answered.",
  pattern: "each section whose provider did not answer carries that provider's error",
  args: z.object({ sections: sectionStatus }),
  from: { sections: [askForReport, "sections"] },
  observe({}, { sections }) {
    const broken = sections.flatMap((section) => {
      if (section.ok === 0 && section.errors.length === 0) return [`${section.section} did not answer and names no error`];
      if (section.ok === 1 && section.errors.length > 0) return [`${section.section} answered but names ${section.errors.join("; ")}`];
      return [];
    });
    if (sections.find((section) => section.section === "git")?.ok !== 1) broken.push("the checkout section did not answer");
    return { rule: broken.length === 0 ? "carries that provider's error" : broken.join("; ") };
  },
  claims: [{ actual: "rule", compare: "equal", expected: { literal: "carries that provider's error" } }],
});
