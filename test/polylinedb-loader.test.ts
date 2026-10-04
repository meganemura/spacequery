import assert from "node:assert/strict";
import { test } from "node:test";
import { node } from "solarsql/node";
import { catalog } from "../catalog.ts";
import type { Exec, Loader } from "../core/loader.ts";
import { openObservationDatabase, runQuery, runReport } from "../core/run.ts";
import { herdrLoader } from "../providers/herdr/loader.ts";
import { polylinedbCommands, polylinedbQueries } from "../providers/polylinedb/module.ts";
import { polylinedbLoader } from "../providers/polylinedb/loader.ts";
import type { PdIssuesId, PdIssueSourcesId } from "../providers/polylinedb/solarsql.generated.ts";
import { repoLoader } from "../providers/repos/loader.ts";
import { repoForRoots } from "./fixture.ts";

const roots = [
  "/home/u/src/github.com/example/alpha",
  "/home/u/src/github.com/example/beta",
  "/home/u/src/github.com/example/gamma",
  "/home/u/src/github.com/example/delta",
  "/home/u/src/github.com/example/epsilon",
];
const storeA = "/stores/a";
const storeB = "/stores/b";
const projectA = "sample";
const projectB = "other";
const loaders: Loader[] = [repoLoader, herdrLoader, polylinedbLoader];

type Context = { mode: "local"; connection: null; source: "repository"; data_dir: string; database_path: string; project: string | null };
type Listed = { store: string; project: string; status: string; after: string | null };

function context(store: string, project: string | null): Context {
  return { mode: "local", connection: null, source: "repository", data_dir: store, database_path: `${store}/polylinedb.sqlite`, project };
}

function issue(id: string, project: string, status: "open" | "in_progress" | "deferred" = "open"): object {
  return {
    id, tool: "synthetic", project, body: `Issue ${id}`, status, type: "task", priority: 1, labels: ["fixture"],
    created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-01T01:00:00.000Z",
  };
}

function fixtureExec(options: { fail?: string } = {}): { exec: Exec; contexts: string[]; lists: Listed[] } {
  const contexts: string[] = [];
  const lists: Listed[] = [];
  const rootsByProject = new Map<string, Context>([
    [roots[0]!, context(storeA, projectA)],
    [roots[1]!, context(storeA, projectA)],
    [roots[2]!, context(storeA, projectB)],
    [roots[3]!, context(storeB, projectA)],
    [roots[4]!, context(storeA, null)],
  ]);
  const openA = Array.from({ length: 101 }, (_, index) => issue(`pd-${index + 1}`, projectA));
  const pages = new Map<string, object[]>([
    [`${storeA}|${projectA}|open|`, openA.slice(0, 100)],
    [`${storeA}|${projectA}|open|pd-100`, openA.slice(100)],
    [`${storeA}|${projectA}|in_progress|`, [issue("pd-102", projectA, "in_progress")]],
    [`${storeA}|${projectA}|deferred|`, [issue("pd-103", projectA, "deferred")]],
    [`${storeA}|${projectB}|open|`, [issue("pd-104", projectB)]],
    [`${storeA}|${projectB}|in_progress|`, []],
    [`${storeA}|${projectB}|deferred|`, []],
    [`${storeB}|${projectA}|open|`, [issue("pd-1", projectA)]],
    [`${storeB}|${projectA}|in_progress|`, []],
    [`${storeB}|${projectA}|deferred|`, []],
  ]);
  const exec: Exec = async (command, args, cwd) => {
    if (command === "ghq" && args.join(" ") === "list -p") return `${roots.join("\n")}\n`;
    if (command === "herdr" && args.join(" ") === "api snapshot") return JSON.stringify({ result: { snapshot: { agents: [], focused_pane_id: null } } });
    if (command !== "pd") throw new Error(`unexpected fixture command: ${command}`);
    if (args[0] === "context" && args[1] === "--json") {
      contexts.push(cwd ?? "");
      const observed = rootsByProject.get(cwd ?? "");
      if (observed === undefined) throw new Error("unknown fixture root");
      return JSON.stringify(observed);
    }
    const dataDirectory = args[args.indexOf("--data-dir") + 1];
    const project = args[args.indexOf("--project") + 1];
    const status = args[args.indexOf("--status") + 1];
    const afterIndex = args.indexOf("--after");
    const after = afterIndex < 0 ? null : args[afterIndex + 1] ?? null;
    if (args.indexOf("list") < 0 || dataDirectory === undefined || project === undefined || status === undefined) {
      throw new Error("unexpected fixture pd arguments");
    }
    lists.push({ store: dataDirectory, project, status, after });
    if (options.fail === `${dataDirectory}|${project}|${status}`) throw new Error("synthetic pd read failed");
    const key = `${dataDirectory}|${project}|${status}|${after ?? ""}`;
    const issues = pages.get(key);
    if (issues === undefined) throw new Error(`unexpected fixture project/status: ${key}`);
    const next_cursor = dataDirectory === storeA && project === projectA && status === "open" && after === null ? "pd-100" : null;
    return JSON.stringify({ issues, next_cursor });
  };
  return { exec, contexts, lists };
}

function options(exec: Exec, params: Record<string, unknown> = {}) {
  return { loaders, exec, repo: repoForRoots(new Set(roots)), env: {}, params };
}

test("project issues paginate each active status once per store and project", async () => {
  const fixture = fixtureExec();
  const wide = await runQuery(catalog["issues-in-scope"]!.query, { ...options(fixture.exec), scope: "all" });
  assert.equal(wide.rows.length, 105);
  assert.equal(new Set(wide.rows.map(row => row.id)).size, 105);
  assert.equal(wide.rows.filter(row => row.issue_id === "pd-1").length, 2);
  assert.equal(wide.rows.filter(row => row.status === "closed").length, 0);
  assert.equal(fixture.contexts.length, roots.length);
  assert.equal(new Set(fixture.contexts).size, roots.length);
  assert.equal(fixture.lists.length, 10);
  assert.equal(fixture.lists.filter(call => call.store === storeA && call.project === projectA && call.status === "open").length, 2);
  assert.equal(fixture.lists.filter(call => call.store === storeA && call.project === projectA).length, 4);
  assert.equal(fixture.lists.some(call => call.status === "closed"), false);

  const open = await runQuery(catalog["issues-open"]!.query, { ...options(fixture.exec), scope: "all" });
  assert.equal(open.rows.length, 103);
  assert.equal(open.rows.every(row => row.status === "open"), true);

  const sourceRows = await runQuery(catalog["issues-sources"]!.query, { ...options(fixture.exec), scope: "all" });
  assert.deepEqual(sourceRows.rows.map(row => [row.root, row.store, row.project, row.state]), [
    [roots[0], JSON.stringify(["local", `${storeA}/polylinedb.sqlite`]), projectA, "configured"],
    [roots[1], JSON.stringify(["local", `${storeA}/polylinedb.sqlite`]), projectA, "configured"],
    [roots[3], JSON.stringify(["local", `${storeB}/polylinedb.sqlite`]), projectA, "configured"],
    [roots[4], null, null, "unconfigured"],
    [roots[2], JSON.stringify(["local", `${storeA}/polylinedb.sqlite`]), projectB, "configured"],
  ]);

  const rooted = await runQuery(catalog.issues!.query, { ...options(fixture.exec, { root: roots[1] }), params: { root: roots[1] } });
  assert.equal(rooted.rows.length, 103);
  assert.equal(rooted.rows.every(row => row.root === roots[1]), true);
});

test("a failed project read leaves both polylinedb tables empty", async () => {
  const fixture = fixtureExec({ fail: `${storeA}|${projectA}|in_progress` });
  const result = await runQuery(catalog["issues-in-scope"]!.query, { ...options(fixture.exec), scope: "all" });
  assert.deepEqual(result.rows, []);
  assert.equal(result.providers.find(provider => provider.name === "polylinedb")?.ok, 0);
  const sources = await runQuery(catalog["issues-sources"]!.query, { ...options(fixture.exec), scope: "all" });
  assert.deepEqual(sources.rows, []);
});

test("cloud aliases at one origin share a project read and issue row", async () => {
  const aliasRoots = [roots[0]!, roots[1]!];
  const aliases = new Map([[aliasRoots[0]!, "alias-a"], [aliasRoots[1]!, "alias-b"]]);
  const contexts: string[] = [];
  const lists: { alias: string; project: string; status: string }[] = [];
  const exec: Exec = async (command, args, cwd) => {
    if (command === "ghq" && args.join(" ") === "list -p") return `${aliasRoots.join("\n")}\n`;
    if (command === "herdr" && args.join(" ") === "api snapshot") return JSON.stringify({ result: { snapshot: { agents: [], focused_pane_id: null } } });
    if (command !== "pd") throw new Error(`unexpected fixture command: ${command}`);
    if (args[0] === "context" && args[1] === "--json") {
      const root = cwd ?? "";
      const connection = aliases.get(root);
      if (connection === undefined) throw new Error("unknown fixture root");
      contexts.push(root);
      return JSON.stringify({
        mode: "cloud", connection, source: "repository", url: "https://fixture.example/",
        actor_source: "authenticated", project: projectA,
      });
    }
    const selector = args.indexOf("--connection");
    const commandIndex = args.indexOf("list");
    const projectIndex = args.indexOf("--project");
    const statusIndex = args.indexOf("--status");
    const alias = selector < 0 ? undefined : args[selector + 1];
    const project = projectIndex < 0 ? undefined : args[projectIndex + 1];
    const status = statusIndex < 0 ? undefined : args[statusIndex + 1];
    if (commandIndex < 0 || alias === undefined || project === undefined || status === undefined) {
      throw new Error("unexpected fixture pd arguments");
    }
    lists.push({ alias, project, status });
    return JSON.stringify({ issues: status === "open" ? [issue("pd-1", projectA)] : [], next_cursor: null });
  };
  const result = await runReport([
    ["issues", catalog["issues-in-scope"]!.query],
    ["sources", catalog["issues-sources"]!.query],
  ], {
    loaders, exec, repo: repoForRoots(new Set(aliasRoots)), env: {}, scope: "all", params: {},
  });
  const issueRows = result.sections["issues"] ?? [];
  const sourceRows = result.sections["sources"] ?? [];
  assert.equal(issueRows.length, 1);
  assert.equal(issueRows[0]?.["issue_id"], "pd-1");
  assert.equal(contexts.length, 2);
  assert.equal(lists.length, 3);
  assert.deepEqual(new Set(lists.map(call => call.status)), new Set(["open", "in_progress", "deferred"]));
  assert.deepEqual(new Set(lists.map(call => call.alias)), new Set(["alias-a"]));
  assert.deepEqual(sourceRows.map(row => [row["root"], row["store"], row["project"], row["state"]]), aliasRoots.map(root => [
    root, JSON.stringify(["cloud", "https://fixture.example"]), projectA, "configured",
  ]));
});

test("the two-table snapshot command rolls back issue rows when source insertion fails", async () => {
  const raw = openObservationDatabase([]);
  const db = node(raw);
  try {
    await assert.rejects(db.run(polylinedbCommands.loadSnapshot, {
      issues: [{
        id: JSON.stringify(["local", "/stores/a/polylinedb.sqlite"]) as PdIssuesId,
        store: JSON.stringify(["local", "/stores/a/polylinedb.sqlite"]), issue_id: "pd-1", tool: "synthetic",
        project: "sample", body: "Issue pd-1", status: "open", issue_type: "task", priority: 1,
        labels: "[]", created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-01T01:00:00.000Z",
      }],
      sources: [{ root: roots[0]! as PdIssueSourcesId, store: null, project: null, state: "configured" }],
    }), /CHECK constraint failed/);
    assert.deepEqual(await db.all(polylinedbQueries.all), []);
    assert.deepEqual(await db.all(polylinedbQueries.sources), []);
  } finally { raw.close(); }
});

test("an incomplete page contract fails without publishing rows", async () => {
  const rootsSet = new Set([roots[0]!]);
  const exec: Exec = async (command, args) => {
    if (command !== "pd") throw new Error(`unexpected fixture command: ${command}`);
    if (args[0] === "context") return JSON.stringify(context(storeA, projectA));
    return JSON.stringify({ issues: [issue("pd-1", projectA)] });
  };
  const result = await runQuery(catalog.issues!.query, { ...options(exec, { root: roots[0] }), repo: repoForRoots(rootsSet), params: { root: roots[0] } });
  assert.deepEqual(result.rows, []);
  assert.equal(result.providers.find(provider => provider.name === "polylinedb")?.ok, 0);
});
