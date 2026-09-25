// These tests prove statement-to-loader resolution from migrated schema metadata.
// They do not execute a provider or inspect a provider's output.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { catalog } from "../catalog.ts";
import type { Loader } from "../core/loader.ts";
import { loadersFor, tablesRead } from "../core/resolve.ts";
import { migrations } from "../migrations/index.ts";
import { migrate } from "solarsql/node";

const tablePool = Array.from({ length: 16 }, (_, index) => `t${index}`);
const undeclaredTableNames = ["undeclared0", "undeclared1", "undeclared2"];
const schemaTableNames = ["agents", "git_status", "worktrees", "repos", "tools", "tool_uses", "root_path_entries", "root_path_commands", "brew_packages", "repository_versions", "sessions", "claude_sessions", "codex_sessions", "pull_requests", "review_requests", "processes", "listeners", "skills", "plugins", "issues", "workflow_runs", "providers"];

type LoaderGraph = {
  loaders: Loader[];
  names: string[];
  owners: Map<string, Loader>;
};

function migratedDatabase(): DatabaseSync {
  const raw = new DatabaseSync(":memory:");
  migrate(raw, migrations);
  return raw;
}

function drawLoaderGraph(tc: hegel.TestCase, minimumLoaders = 0): LoaderGraph {
  const names = tc.draw(gs.arrays(gs.fromRegex("[a-h]"), { minSize: minimumLoaders, maxSize: 8, unique: true }));
  const tableOwners = names.length === 0
    ? tablePool.map(() => null)
    : tc.draw(gs.arrays(gs.optional(gs.sampledFrom(names)), { minSize: tablePool.length, maxSize: tablePool.length }));
  const loaders: Loader[] = [];
  const owners = new Map<string, Loader>();

  for (const [index, name] of names.entries()) {
    const tables = tablePool.filter((_, tableIndex) => tableOwners[tableIndex] === name);
    const after = index === 0
      ? []
      : tc.draw(gs.arrays(gs.sampledFrom(names.slice(0, index)), { minSize: 0, maxSize: index, unique: true }));
    const loader: Loader = { name, tables, after, async load() {} };
    loaders.push(loader);
    for (const table of tables) owners.set(table, loader);
  }
  return { loaders, names, owners };
}

function drawRequestedTables(tc: hegel.TestCase, graph: LoaderGraph): string[] {
  const declared = [...graph.owners.keys()].filter(() => tc.draw(gs.booleans()));
  const extra = tc.draw(gs.arrays(gs.sampledFrom(undeclaredTableNames), { minSize: 0, maxSize: undeclaredTableNames.length, unique: true }));
  return [...declared, ...extra];
}

function closure(graph: LoaderGraph, tables: readonly string[]): Set<string> {
  const byName = new Map(graph.loaders.map((loader) => [loader.name, loader]));
  const wanted = new Set<string>();
  const add = (loader: Loader) => {
    if (wanted.has(loader.name)) return;
    wanted.add(loader.name);
    for (const dependency of loader.after) add(byName.get(dependency)!);
  };
  for (const table of tables) {
    const owner = graph.owners.get(table);
    if (owner) add(owner);
  }
  return wanted;
}

function dependsOn(loaders: readonly Loader[], from: string, target: string): boolean {
  const byName = new Map(loaders.map((loader) => [loader.name, loader]));
  const visit = (name: string): boolean => {
    for (const dependency of byName.get(name)!.after) {
      if (dependency === target || visit(dependency)) return true;
    }
    return false;
  };
  return visit(from);
}

test("tablesRead finds every catalog query's declared tables", () => {
  const raw = migratedDatabase();
  try {
    const expected: Record<keyof typeof catalog, string[]> = {
      "path-entries": ["path_entries"],
      which: ["path_commands"],
      "shadowed-commands": ["path_commands"],
      agents: ["agents"],
      find: ["agents", "sessions"],
      "in-dir": ["agents"],
      working: ["agents"],
      workspaces: ["agents"],
      dirty: ["git_status"],
      "git-status": ["git_status"],
      worktrees: ["worktrees"],
      repos: ["repos"],
      tools: ["tools"],
      "tools-in-dir": ["tool_uses"],
      "path-entries-in-dir": ["root_path_entries"],
      "which-in-dir": ["root_path_commands"],
      "shadowed-commands-in-dir": ["root_path_commands"],
      "brew-packages": ["brew_packages"],
      "installed-software": ["brew_packages", "tools"],
      "repository-versions": ["repository_versions"],
      "repository-config-files": ["repository_config_files"],
      "repository-config-files-in-scope": ["repository_config_files"],
      "repository-version-sources": ["repository_versions"],
      "shared-dependencies": ["repository_versions"],
      "shared-dependency-details": ["repository_versions"],
      "dependency-coverage": ["repository_versions"],
      "claude-usage": ["claude_usage"],
      "codex-usage": ["codex_usage"],
      sessions: ["sessions"],
      "idle-sessions": ["sessions"],
      "claude-sessions": ["claude_sessions", "sessions"],
      "codex-sessions": ["codex_sessions", "sessions"],
      "cursor-agents": ["cursor_agents"],
      "pull-requests": ["pull_requests"],
      "branch-pull-requests": ["git_status", "pull_requests"],
      "review-requests": ["review_requests"],
      containers: ["containers"],
      "containers-in-dir": ["container_roots", "containers"],
      "container-ports-in-dir": ["container_ports", "container_roots", "containers"],
      "processes-in-dir": ["processes"],
      descendants: ["processes"],
      "session-processes": ["processes", "sessions"],
      "heavy-processes": ["panes", "processes"],
      "pane-load": ["panes", "processes"],
      "listening-ports": ["listeners"],
      skills: ["skills"],
      "skills-in-dir": ["skills"],
      plugins: ["plugins"],
      "agents-in-dirty-repos": ["agents", "git_status"],
      "crowded-repos": ["agents", "git_status"],
      "idle-worktrees": ["agents", "worktrees"],
      "agents-outside-ghq": ["agents", "repos"],
      "dirty-unattended": ["agents", "git_status"],
      "behind-upstream-with-agents": ["agents", "git_status"],
      "missing-tools-with-agents": ["agents", "tool_uses"],
      "tool-versions-split": ["agents", "tool_uses"],
      "agents-with-sessions": ["agents", "claude_sessions", "codex_sessions", "sessions"],
      "sessions-without-pane": ["agents", "sessions"],
      "codex-threads-with-agents": ["agents", "codex_sessions", "sessions"],
      "prs-with-agents": ["agents", "git_status", "pull_requests"],
      "failing-checks-with-agents": ["agents", "git_status", "pull_requests"],
      "review-requests-with-agents": ["agents", "review_requests"],
      "ports-in-dir": ["git_status", "listeners", "processes", "worktrees"],
      "servers-with-agents": ["agents", "listeners"],
      "long-running-without-agents": ["agents", "processes"],
      "duplicate-skill-names": ["skills"],
      "skills-in-one-agent": ["skills"],
      "project-skills-with-agents": ["agents", "skills"],
      issues: ["issues"],
      "issues-in-scope": ["issues"],
      "issues-ready": ["ready_issues"],
      "issues-with-agents": ["agents", "issues"],
      "issues-unattended": ["agents", "issues"],
      "runs-in-dir": ["runtag_jobs"],
      workflow: ["workflow_runs"],
      workflows: ["workflow_runs"],
      "running-workflows-with-agents": ["agents", "workflow_runs"],
      "running-workflows-unattended": ["agents", "workflow_runs"],
      "stopped-workflows": ["workflow_runs"],
    };
    for (const [name, named] of Object.entries(catalog) as [keyof typeof catalog, (typeof catalog)[keyof typeof catalog]][]) {
      assert.deepEqual(tablesRead(raw, named.query.sql).sort(), expected[name]);
    }
  } finally {
    raw.close();
  }
});

test("catalog query metadata matches the authorizer probe", () => {
  const raw = migratedDatabase();
  try {
    for (const [name, named] of Object.entries(catalog)) {
      assert.deepEqual(new Set(named.query.meta.reads), new Set(tablesRead(raw, named.query.sql)), name);
    }
  } finally {
    raw.close();
  }
});

test("loadersFor includes dependencies in configuration order", () => {
  const loaders: Loader[] = [
    { name: "repos", tables: ["repos"], after: [], async load() {} },
    { name: "herdr", tables: ["agents"], after: [], async load() {} },
    { name: "git", tables: ["git_status"], after: ["herdr", "repos"], async load() {} },
  ];
  assert.deepEqual(loadersFor(loaders, ["git_status"]).map((loader) => loader.name), ["repos", "herdr", "git"]);
  assert.deepEqual(loadersFor(loaders, ["agents"]).map((loader) => loader.name), ["herdr"]);
  assert.deepEqual(loadersFor(loaders, ["unknown"]).map((loader) => loader.name), []);
});

test("loadersFor adds only the dependencies for the selected scope", () => {
  const loaders: Loader[] = [
    { name: "repos", tables: ["repos"], after: [], async load() {} },
    { name: "herdr", tables: ["agents"], after: [], async load() {} },
    { name: "static", tables: ["versions"], after: [], afterForScope: (scope) => scope === "root" ? [] : scope === "agents" ? ["herdr"] : ["herdr", "repos"], async load() {} },
  ];
  assert.deepEqual(loadersFor(loaders, ["versions"], "root").map((loader) => loader.name), ["static"]);
  assert.deepEqual(loadersFor(loaders, ["versions"], "agents").map((loader) => loader.name), ["herdr", "static"]);
  assert.deepEqual(loadersFor(loaders, ["versions"], "all").map((loader) => loader.name), ["repos", "herdr", "static"]);
});

test("loadersFor rejects cycles and missing dependencies", () => {
  const cycle: Loader[] = [
    { name: "a", tables: ["a"], after: ["b"], async load() {} },
    { name: "b", tables: ["b"], after: ["a"], async load() {} },
  ];
  const missing: Loader[] = [{ name: "a", tables: ["a"], after: ["missing"], async load() {} }];
  assert.throws(() => loadersFor(cycle, ["a"]), /loader cycle: a -> b -> a/);
  assert.throws(() => loadersFor(missing, ["a"]), /loader a runs after missing, which is not configured/);
});

test("loadersFor closes the requested tables over loader dependencies", () => hegel.test((tc) => {
  const graph = drawLoaderGraph(tc);
  const tables = drawRequestedTables(tc, graph);
  const result = loadersFor(graph.loaders, tables);
  const expected = closure(graph, tables);

  assert.deepEqual(new Set(result.map((loader) => loader.name)), expected);
  for (const table of tables) {
    const owner = graph.owners.get(table);
    if (owner) assert.ok(result.some((loader) => loader.name === owner.name));
  }
}));

test("loadersFor orders dependencies once and keeps independent loader order", () => hegel.test((tc) => {
  const graph = drawLoaderGraph(tc);
  const tables = drawRequestedTables(tc, graph);
  const result = loadersFor(graph.loaders, tables);
  const names = result.map((loader) => loader.name);
  const index = new Map(names.map((name, position) => [name, position]));

  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(new Set(names), closure(graph, tables));
  for (const loader of result) {
    for (const dependency of loader.after) assert.ok(index.get(dependency)! < index.get(loader.name)!);
  }
  for (let left = 0; left < result.length; left++) {
    for (let right = left + 1; right < result.length; right++) {
      const a = result[left]!;
      const b = result[right]!;
      if (!dependsOn(graph.loaders, a.name, b.name) && !dependsOn(graph.loaders, b.name, a.name)) {
        assert.ok(graph.names.indexOf(a.name) < graph.names.indexOf(b.name));
      }
    }
  }
}));

test("loadersFor rejects a requested cycle and an unknown dependency", () => hegel.test((tc) => {
  const graph = drawLoaderGraph(tc, 2);
  const index = tc.draw(gs.integers({ minValue: 0, maxValue: graph.loaders.length - 1 }));
  const loader = graph.loaders[index]!;
  const cycleTable = "cycle_table";
  const cycle = graph.loaders.map((candidate) => candidate.name === loader.name
    ? { ...candidate, tables: [...candidate.tables, cycleTable], after: [...candidate.after, candidate.name] }
    : candidate,
  );
  const unknownTable = "unknown_dependency_table";
  const unknown = graph.loaders.map((candidate) => candidate.name === loader.name
    ? { ...candidate, tables: [...candidate.tables, unknownTable], after: [...candidate.after, "not_configured"] }
    : candidate,
  );

  assert.throws(() => loadersFor(cycle, [cycleTable]), /cycle/);
  assert.throws(() => loadersFor(unknown, [unknownTable]), /not configured/);
}));

test("tablesRead finds tables through filters and subqueries", () => {
  const raw = migratedDatabase();
  try {
    hegel.test((tc) => {
      const tables = tc.draw(gs.arrays(gs.sampledFrom(schemaTableNames), { minSize: 1, maxSize: schemaTableNames.length, unique: true }));
      const statement = `select count(*) from ${tables.join(" cross join ")}`;
      const expected = new Set(tables);

      assert.deepEqual(new Set(tablesRead(raw, statement)), expected);
      assert.deepEqual(new Set(tablesRead(raw, `${statement} where 1 = 0`)), expected);
      assert.deepEqual(new Set(tablesRead(raw, `select * from (${statement})`)), expected);
    });
  } finally {
    raw.close();
  }
});
