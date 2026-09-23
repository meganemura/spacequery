// The public surface of the beads provider.
// Boundary: exports only.
export { beadsQueries, beadsCommands } from "./module.ts";
export { beadsLoader as loader, beadsReadyLoader as readyLoader } from "./loader.ts";
export type { IssuesId, ReadyIssuesId } from "./solarsql.generated.ts";
