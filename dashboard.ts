// The fixed work dashboard. Agents refresh it with `spacequery watch work`.
// JSON, TSV, and the terminal browser render this list. They do not keep a second one.
// Boundary: the section list and the scope default. catalog.ts registers the report.
import type { Scope } from "./core/loader.ts";

export const workDashboard = {
  description: "Unclosed project issues, open project issues, project sources, herdr agents with their session models, and recent local Cursor agents.",
  purpose: "When you want open and unclosed project issues, their sources, and the models of herdr and Cursor agents.",
  group: "Reports",
  default: true,
  defaultScope: "all" as Scope,
  gateSection: "agents",
  // Periodic refresh is `spacequery watch work`, the same observation as one `spacequery work`.
  refresh: "Refresh with `spacequery watch work`. `--interval` defaults to 2000 milliseconds. `--timeout` defaults to 300 seconds; 0 keeps refreshing until a signal. Each tick builds a new database. A snapshot is printed when the sections or provider status change. `--until` is optional and reads the agents section. The printed snapshot is the whole report. The cursor section is local IDE conversations.",
  sections: [
    ["open", "issues-open"],
    ["issues", "issues-in-scope"],
    ["issue_sources", "issues-sources"],
    ["agents", "agents-with-sessions"],
    ["cursor", "cursor-agents"],
  ],
} as const;
