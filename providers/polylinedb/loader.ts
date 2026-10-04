// Reads selected projects from pd and publishes one validated observation.
// Boundary: neither table changes until every configured store read succeeds.
import { isAbsolute, join, resolve } from "node:path";
import type { LoadContext, Loader } from "../../core/loader.ts";
import { discoveryLoaders, rootsInScope } from "../../core/scope.ts";
import { polylinedbCommands } from "./module.ts";
import type { PdIssuesId, PdIssueSourcesId } from "./solarsql.generated.ts";

type ConfiguredSource = { root: string; store: string; project: string; state: "configured" };
type UnconfiguredSource = { root: string; store: null; project: null; state: "unconfigured" };
type Source = ConfiguredSource | UnconfiguredSource;
type Configured = { source: ConfiguredSource; selector: readonly string[] };
type ProjectSelection = Configured | UnconfiguredSource;
type Issue = { id: string; store: string; issue_id: string; tool: string; project: string; body: string; status: "open" | "in_progress" | "deferred" | "closed"; issue_type: "bug" | "task" | "epic" | "feature" | "chore"; priority: number; labels: string; created_at: string; updated_at: string };
const unclosedStatuses = ["open", "in_progress", "deferred"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function document(output: string): Record<string, unknown> {
  let parsed: unknown;
  try { parsed = JSON.parse(output); } catch { throw new Error("pd returned invalid JSON"); }
  if (!isRecord(parsed)) throw new Error("pd returned an invalid document");
  return parsed;
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.includes("\0")) throw new Error("pd returned an invalid text field");
  return value;
}

function name(value: unknown): string {
  const result = text(value);
  if (Buffer.byteLength(result) > 256 || /\p{Cc}/u.test(result)) throw new Error("pd returned an invalid name");
  return result;
}

function connectionName(value: unknown): string {
  const result = text(value);
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(result)) throw new Error("pd returned an invalid connection name");
  return result;
}

function projectSource(root: string, output: string): ProjectSelection {
  const value = document(output);
  if (value.mode !== "local" && value.mode !== "cloud") throw new Error("pd returned an invalid context mode");
  if (!["flag", "environment", "repository", "user_default", "legacy_default"].includes(String(value.source))) throw new Error("pd returned an invalid connection source");
  let selector: readonly string[];
  let store: string;
  if (value.mode === "local") {
    if (!Object.hasOwn(value, "connection")) throw new Error("pd returned an invalid local connection");
    if (value.connection !== null) connectionName(value.connection);
    const directory = text(value.data_dir);
    const database = text(value.database_path);
    if (!isAbsolute(directory) || !isAbsolute(database) || database !== join(resolve(directory), "polylinedb.sqlite")) {
      throw new Error("pd returned an invalid local store");
    }
    selector = ["--data-dir", directory];
    store = JSON.stringify(["local", database]);
  } else {
    const connection = connectionName(value.connection);
    const rawUrl = text(value.url);
    if (/[\s?#\p{Cc}]/u.test(rawUrl)) throw new Error("pd returned an invalid cloud store");
    let url: URL;
    try { url = new URL(rawUrl); } catch { throw new Error("pd returned an invalid cloud store"); }
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/" || value.actor_source !== "authenticated") {
      throw new Error("pd returned an invalid cloud store");
    }
    selector = ["--connection", connection];
    store = JSON.stringify(["cloud", url.origin]);
  }
  if (value.project === undefined || value.project === null) return { root, store: null, project: null, state: "unconfigured" };
  const project = name(value.project);
  return { source: { root, store, project, state: "configured" }, selector };
}

function issueId(value: unknown): string {
  const result = text(value);
  if (!/^[a-z][a-z0-9]{0,15}-[1-9][0-9]*(\.[1-9][0-9]*){0,7}$/.test(result)
    || result.slice(result.indexOf("-") + 1).split(".").some(segment => !Number.isSafeInteger(Number(segment)))) {
    throw new Error("pd returned an invalid issue ID");
  }
  return result;
}

function issueStatus(value: unknown): Issue["status"] {
  if (value === "open" || value === "in_progress" || value === "deferred" || value === "closed") return value;
  throw new Error("pd returned an invalid issue status");
}

function issueType(value: unknown): Issue["issue_type"] {
  if (value === "bug" || value === "task" || value === "epic" || value === "feature" || value === "chore") return value;
  throw new Error("pd returned an invalid issue type");
}

function labels(value: unknown): string {
  if (!Array.isArray(value) || value.length > 64) throw new Error("pd returned invalid labels");
  return JSON.stringify(value.map(name));
}

function timestamp(value: unknown): string {
  const result = text(value);
  if (!Number.isFinite(Date.parse(result))) throw new Error("pd returned an invalid timestamp");
  return result;
}

function issue(value: unknown, source: ConfiguredSource): Issue {
  if (!isRecord(value)) throw new Error("pd returned an invalid issue");
  const id = issueId(value.id);
  const project = name(value.project);
  if (project !== source.project || typeof value.priority !== "number" || !Number.isSafeInteger(value.priority) || value.priority < 0 || value.priority > 4) {
    throw new Error("pd returned an issue outside the selected project");
  }
  const body = text(value.body);
  if (Buffer.byteLength(body) > 65536) throw new Error("pd returned an oversized issue body");
  return {
    id: JSON.stringify([source.store, id]), store: source.store, issue_id: id, tool: name(value.tool), project,
    body, status: issueStatus(value.status), issue_type: issueType(value.type), priority: value.priority,
    labels: labels(value.labels), created_at: timestamp(value.created_at), updated_at: timestamp(value.updated_at),
  };
}

async function statusIssues(ctx: LoadContext, configured: Configured, status: typeof unclosedStatuses[number], seenIds: Set<string>): Promise<Issue[]> {
  const issues: Issue[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const args = [...configured.selector, "list", "--project", configured.source.project, "--status", status, "--limit", "100", "--json"];
    if (cursor !== undefined) args.push("--after", cursor);
    const page = document(await ctx.exec("pd", args, configured.source.root));
    if (!Array.isArray(page.issues) || page.issues.length > 100 || !Object.hasOwn(page, "next_cursor")) {
      throw new Error("pd returned an invalid issue page");
    }
    const items = page.issues.map(item => issue(item, configured.source));
    for (const item of items) {
      if (item.status !== status || seenIds.has(item.issue_id)) throw new Error("pd returned an issue outside the selected status");
      seenIds.add(item.issue_id);
      issues.push(item);
    }
    if (page.next_cursor === null) cursor = undefined;
    else {
      cursor = issueId(page.next_cursor);
      if (items.length !== 100 || items.at(-1)?.issue_id !== cursor || seenCursors.has(cursor)) {
        throw new Error("pd returned an invalid pagination cursor");
      }
      seenCursors.add(cursor);
    }
  } while (cursor !== undefined);
  return issues;
}

async function projectIssues(ctx: LoadContext, configured: Configured): Promise<Issue[]> {
  const issues: Issue[] = [];
  const seenIds = new Set<string>();
  for (const status of unclosedStatuses) issues.push(...await statusIssues(ctx, configured, status, seenIds));
  return issues;
}

export const polylinedbLoader: Loader = {
  name: "polylinedb", tables: ["pd_issues", "pd_issue_sources"], after: [], afterForScope: discoveryLoaders,
  async load(ctx) {
    const sources: Source[] = [];
    const projects = new Map<string, Configured>();
    for (const root of new Set(await rootsInScope(ctx))) {
      const observed = projectSource(root, await ctx.exec("pd", ["context", "--json"], root));
      if ("selector" in observed) {
        sources.push(observed.source);
        const key = JSON.stringify([observed.source.store, observed.source.project]);
        if (!projects.has(key)) projects.set(key, observed);
      } else sources.push(observed);
    }
    const issues = new Map<string, Issue>();
    for (const configured of projects.values()) {
      for (const observed of await projectIssues(ctx, configured)) {
        const previous = issues.get(observed.id);
        if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(observed)) throw new Error("pd returned a conflicting issue identity");
        issues.set(observed.id, observed);
      }
    }
    const loaded = await ctx.db.run(polylinedbCommands.loadSnapshot, {
      issues: [...issues.values()].map(item => ({ ...item, id: item.id as PdIssuesId })),
      sources: sources.map(source => ({ ...source, root: source.root as PdIssueSourcesId })),
    });
    if (!loaded.ok) throw new Error(`polylinedb snapshot: ${loaded.kind}`);
  },
};
