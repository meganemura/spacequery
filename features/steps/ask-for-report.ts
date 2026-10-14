import { defineStep, z } from "nukadoko";
import createDirtyRepository from "./create-dirty-repository.ts";
import { runSpacequery } from "./spacequery-cli.ts";

export const sectionStatus = z
  .array(z.object({ section: z.string(), ok: z.number(), errors: z.array(z.string()) }))
  .describe("one entry per report section: whether every provider it reads answered, and the error of each one that did not");

interface HereReport {
  sections: { git: { dirty_count: number; untracked_count: number }[] };
  section_status: Record<string, { ok: number; errors: { name: string; error: string | null }[] }>;
}

export default defineStep({
  description: "Runs `spacequery here --root <repo> --json` and reads the checkout section and each section's provider status.",
  pattern: "the agent asks spacequery for the report on that repository",
  args: z.object({ root: z.string(), configHome: z.string(), stateHome: z.string() }),
  returns: z.object({
    exitCode: z.number().describe("spacequery's exit code: 0 when the report was printed"),
    dirtyCount: z.number().describe("the checkout section's count of changed tracked files"),
    untrackedCount: z.number().describe("the checkout section's count of untracked files"),
    sections: sectionStatus,
  }),
  from: {
    root: [createDirtyRepository, "root"],
    configHome: [createDirtyRepository, "configHome"],
    stateHome: [createDirtyRepository, "stateHome"],
  },
  mutates: false,
  rationale: "The JSON envelope is what an agent reads, so the step parses it rather than the table text.",
  run({}, { root, configHome, stateHome }) {
    const { exitCode, stdout } = runSpacequery(["here", "--root", root, "--json"], { configHome, stateHome });
    const report = JSON.parse(stdout) as HereReport;
    const git = report.sections.git[0];
    if (git === undefined) throw new Error("the report has no checkout row");
    const sections = Object.entries(report.section_status).map(([section, status]) => ({
      section,
      ok: status.ok,
      errors: status.errors.map((entry) => `${entry.name}: ${entry.error ?? ""}`),
    }));
    return { exitCode, dirtyCount: git.dirty_count, untrackedCount: git.untracked_count, sections };
  },
});
