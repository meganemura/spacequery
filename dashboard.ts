// The work dashboard definition agents read and edit.
// JSON, TSV, help, and the terminal browser render this list. They do not keep a second one.
// Boundary: the section list, the scope default, and the refresh rule.
// catalog.ts registers the report. This file does not run a query.
import type { Scope } from "./core/loader.ts";

export const workDashboard = {
  description: "Claimable beads issues, open beads issues, herdr agents with their session models, and recent local Cursor agents.",
  purpose: "When you want claimable beads issues, the open work list, and the models of herdr and Cursor agents.",
  group: "Reports",
  default: true,
  defaultScope: "all" as Scope,
  gateSection: "agents",
  // Each call is a new observation (ADR 0002). Editing this list is how the dashboard changes.
  refresh: "Each call builds a new database. Re-run `spacequery work` to refresh the rows. Updated is each provider's observed_at on that call; the dashboard keeps no previous copy. To change the sections, their order, or the scope default, edit dashboard.ts. The next `spacequery work --json`, the TSV headings, help JSON, and `spacequery ui` render that list. The cursor section stays local IDE conversations.",
  sections: [
    ["ready", "issues-ready"],
    ["issues", "issues-in-scope"],
    ["agents", "agents-with-sessions"],
    ["cursor", "cursor-agents"],
  ],
} as const;
