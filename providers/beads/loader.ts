// Fills beads issue tables from roots that declare repository-local beads state.
// Open issues and claimable issues are separate reads, so each query pays for
// one command. It skips one broken repository because another can still answer.
// Boundary: this provider's tables only.
import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { LoadContext, Loader } from "../../core/loader.ts";
import { discoveryLoaders, rootsInScope } from "../../core/scope.ts";
import { beadsCommands } from "./module.ts";
import type { IssuesId, ReadyIssuesId } from "./solarsql.generated.ts";

type BdIssue = { id: string; title: string; status: string; priority?: number; issue_type?: string; assignee?: string; labels?: string[]; created_at?: string; updated_at?: string; dependency_count?: number; dependent_count?: number; comment_count?: number };
type IssueRow = { id: string; root: string; issue_id: string; title: string; status: string; priority: number | null; issue_type: string | null; assignee: string | null; labels: string | null; created_at: number | null; updated_at: number | null; dependency_count: number; dependent_count: number; comment_count: number };

function date(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function integer(value: unknown, fallback: number | null): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : fallback;
}

export function issuesFrom(root: string, output: string): IssueRow[] {
  const document: unknown = JSON.parse(output);
  if (!Array.isArray(document)) throw new Error("bd returned invalid JSON");
  return document.map((value) => {
    if (value === null || typeof value !== "object") throw new Error("bd returned invalid JSON");
    const issue = value as BdIssue;
    if (typeof issue.id !== "string" || typeof issue.title !== "string" || typeof issue.status !== "string" || (issue.labels !== undefined && (!Array.isArray(issue.labels) || !issue.labels.every((label) => typeof label === "string")))) throw new Error("bd returned invalid JSON");
    return {
      id: `${root} ${issue.id}`, root, issue_id: issue.id, title: issue.title, status: issue.status,
      priority: integer(issue.priority, null), issue_type: typeof issue.issue_type === "string" ? issue.issue_type : null,
      assignee: typeof issue.assignee === "string" ? issue.assignee : null, labels: issue.labels?.join(",") ?? null,
      created_at: date(issue.created_at), updated_at: date(issue.updated_at),
      dependency_count: integer(issue.dependency_count, 0) ?? 0, dependent_count: integer(issue.dependent_count, 0) ?? 0, comment_count: integer(issue.comment_count, 0) ?? 0,
    };
  });
}

async function hasBeads(root: string): Promise<boolean> {
  try { return (await stat(join(root, ".beads"))).isDirectory(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

// `--limit 0` is unlimited. The default cap would hide the rest of the queue.
// `--claim` is a write, so this read never passes it.
async function rowsFor(ctx: LoadContext, argsFor: (root: string) => readonly string[]): Promise<IssueRow[]> {
  const roots = await rootsInScope(ctx);
  const rows = await Promise.all(roots.map(async (root) => {
    if (!await hasBeads(root)) return [];
    try { return issuesFrom(root, await ctx.exec("bd", argsFor(root))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw error;
      return [];
    }
  }));
  return rows.flat();
}

export const beadsLoader: Loader = {
  name: "beads", tables: ["issues"], after: [], afterForScope: discoveryLoaders,
  async load(ctx) {
    const rows = (await rowsFor(ctx, (root) => ["-C", root, "list", "--json"])).map((row) => ({ ...row, id: row.id as IssuesId }));
    const loaded = await ctx.db.run(beadsCommands.loadIssues, { rows });
    if (!loaded.ok) throw new Error(`issues: ${loaded.kind}`);
  },
};

export const beadsReadyLoader: Loader = {
  name: "beads_ready", tables: ["ready_issues"], after: [], afterForScope: discoveryLoaders,
  async load(ctx) {
    const rows = (await rowsFor(ctx, (root) => ["-C", root, "ready", "--json", "--limit", "0"])).map((row) => ({ ...row, id: row.id as ReadyIssuesId }));
    const loaded = await ctx.db.run(beadsCommands.loadReadyIssues, { rows });
    if (!loaded.ok) throw new Error(`ready_issues: ${loaded.kind}`);
  },
};
