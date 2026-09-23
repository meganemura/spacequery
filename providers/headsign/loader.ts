// Fills workflow runs from repository-local headsign state files.
// It preserves rows from valid roots before it reports malformed files.
// Boundary: this provider's table only.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { LoadContext, Loader } from "../../core/loader.ts";
import { discoveryLoaders, rootsInScope } from "../../core/scope.ts";
import { headsignCommands } from "./module.ts";
import type { WorkflowRunsId } from "./solarsql.generated.ts";

type Run = { root: WorkflowRunsId; workflow: string; workflow_path: string | null; status: string; phase: string | null; total_iterations: number; attempts: string | null; last_failure: string | null; end_reason: string | null; stop_nudges: number; driver_agent: string | null; phase_entered_at: number | null };

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function optionalString(value: unknown): string | null { return typeof value === "string" ? value : null; }
function integer(value: unknown, fallback: number): number { return typeof value === "number" && Number.isInteger(value) ? value : fallback; }

export function runFrom(root: string, text: string): Run {
  const state = object(JSON.parse(text));
  if (state === null || typeof state.workflow !== "string" || typeof state.status !== "string") throw new Error("headsign state is invalid");
  const attempts = state.attempts === undefined ? null : object(state.attempts);
  if (state.attempts !== undefined && attempts === null) throw new Error("headsign state is invalid");
  const failure = state.last_failure === undefined || state.last_failure === null ? null : object(state.last_failure);
  if (state.last_failure !== undefined && state.last_failure !== null && failure === null) throw new Error("headsign state is invalid");
  const entered = optionalString(state.phase_entered_at);
  const phase_entered_at = entered === null ? null : Date.parse(entered);
  return {
    root: root as WorkflowRunsId, workflow: state.workflow, workflow_path: optionalString(state.workflow_path), status: state.status,
    phase: optionalString(state.phase), total_iterations: integer(state.total_iterations, 0),
    attempts: attempts === null ? null : JSON.stringify(attempts), last_failure: failure === null ? null : JSON.stringify(failure),
    end_reason: optionalString(state.end_reason), stop_nudges: integer(state.stop_nudges, 0), driver_agent: optionalString(state.driver_agent),
    phase_entered_at: Number.isFinite(phase_entered_at) ? phase_entered_at : null,
  };
}

export const headsignLoader: Loader = {
  name: "headsign", tables: ["workflow_runs"], after: [], afterForScope: discoveryLoaders,
  async load(ctx) {
    const invalid: string[] = [];
    const rows = await Promise.all((await rootsInScope(ctx)).map(async (root) => {
      try { return runFrom(root, await readFile(join(root, ".headsign", "state.json"), "utf8")); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        invalid.push(root);
        return null;
      }
    }));
    const loaded = await ctx.db.run(headsignCommands.loadRuns, { rows: rows.filter((row): row is Run => row !== null) });
    if (!loaded.ok) throw new Error(`workflow_runs: ${loaded.kind}`);
    if (invalid.length > 0) throw new Error(`headsign state did not parse: ${invalid.join(", ")}`);
  },
};
