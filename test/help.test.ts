// The short list is curated queries plus calls, after disabled providers are removed.
// These tests do not start a provider tool.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { catalog, reports } from "../catalog.ts";
import { recordCall } from "../core/calls.ts";
import { loadConfig, providersOffByDefault } from "../core/config.ts";
import { helpDocument, selectHelpEntries, shortHelpLimit } from "../core/help.ts";
import { loaders } from "../spacequery.config.ts";

test("curated entries stay when they pass the cap, and unused queries do not fill a seat", () => {
  const entries = [
    { name: "a", default: true },
    { name: "b", default: true },
    { name: "c", default: true },
    { name: "d", default: false },
    { name: "e", default: false },
  ];
  assert.deepEqual(selectHelpEntries(entries, new Map([["d", 4]]), "short", 2).map((entry) => entry.name), ["a", "b", "c"]);
  assert.deepEqual(selectHelpEntries(entries, new Map([["d", 4], ["e", 1]]), "short", 4).map((entry) => entry.name), ["d", "a", "b", "c"]);
  assert.deepEqual(selectHelpEntries(entries, new Map([["d", 4], ["e", 1]]), "short", 5).map((entry) => entry.name), ["d", "e", "a", "b", "c"]);
  assert.deepEqual(selectHelpEntries(entries, new Map(), "short", 4).map((entry) => entry.name), ["a", "b", "c"]);
  assert.deepEqual(selectHelpEntries(entries, new Map([["d", 2]]), "all", 1).map((entry) => entry.name), ["d", "a", "b", "c", "e"]);
});

test("the ship default short list is the visible curated queries", () => {
  const root = mkdtempSync(join(tmpdir(), "spacequery-help-"));
  const env = { HOME: root, XDG_CONFIG_HOME: join(root, "config"), XDG_STATE_HOME: join(root, "state") };
  try {
    const document = helpDocument({ userQueries: [], env, mode: "short", loaders, config: loadConfig(env) });
    const names = document.queries.map((query) => query.name);
    assert.ok(names.length <= shortHelpLimit, String(names.length));
    assert.deepEqual(document.disabled_providers, [...providersOffByDefault].sort());
    assert.equal(document.mode, "short");
    assert.ok(names.includes("in-dir"));
    assert.equal(names.includes("cursor-agents"), false);
    assert.equal(names.includes("issues"), false);
    assert.equal(names.includes("issues-in-scope"), false);
    assert.equal(names.includes("issues-ready"), false);
    assert.equal(names.includes("runs-in-dir"), false);
    assert.equal(names.includes("brew-packages"), false);
    assert.deepEqual(document.reports.map((report) => report.name), ["here", "work"]);
    for (const query of document.queries) {
      assert.equal(query.enabled, true, query.name);
      assert.ok(query.group, query.name);
      assert.ok(query.purpose, query.name);
      assert.ok(query.requires.length > 0, query.name);
    }
    const full = helpDocument({ userQueries: [], env, mode: "all", loaders, config: loadConfig(env) });
    assert.ok(full.queries.length > names.length);
    assert.equal(full.queries.some((query) => query.name === "issues"), false);
    assert.equal(full.queries.some((query) => query.name === "issues-in-scope"), false);
    assert.equal(full.queries.some((query) => query.name === "issues-ready"), false);
    assert.equal(full.queries.some((query) => query.name === "repos"), true);
    const cursorAgents = full.queries.find((query) => query.name === "cursor-agents");
    assert.equal(cursorAgents?.group, "Cursor");
    assert.equal(cursorAgents?.default, false);
    assert.equal(cursorAgents?.enabled, true);
    assert.deepEqual(cursorAgents?.requires, ["cursor"]);
    const curated = Object.entries(catalog).filter(([, query]) => query.default).map(([name]) => name);
    assert.equal(curated.length, 27);
    assert.ok(curated.includes("issues"));
    assert.equal(reports.here.default, true);
    assert.equal(reports.work.default, true);
    assert.equal(reports.work.defaultScope, "all");
    const board = document.reports.find((report) => report.name === "work");
    assert.deepEqual(board?.sections, reports.work.sections);
    assert.equal(board?.default_scope, "all");
    assert.match(board?.refresh ?? "", /watch work/);
    assert.match(board?.refresh ?? "", /--interval/);
    assert.equal(document.reports.find((report) => report.name === "here")?.refresh, undefined);
    assert.equal(reports["dependency-report"].default, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("enabling an optional provider returns its curated queries, and calls fill spare seats", () => {
  const root = mkdtempSync(join(tmpdir(), "spacequery-help-"));
  const configDir = join(root, "config", "spacequery");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "config.json"), JSON.stringify({
    providers: { beads: true, brew: true, headsign: true, runtag: true },
  }));
  const env = { HOME: root, XDG_CONFIG_HOME: join(root, "config"), XDG_STATE_HOME: join(root, "state") };
  try {
    const document = helpDocument({ userQueries: [], env, mode: "short", loaders, config: loadConfig(env) });
    assert.deepEqual(document.disabled_providers, []);
    assert.equal(document.queries.some((query) => query.name === "issues"), true);
    assert.equal(document.queries.some((query) => query.name === "issues-in-scope"), true);
    assert.equal(document.queries.some((query) => query.name === "issues-ready"), true);
    assert.equal(document.queries.some((query) => query.name === "runs-in-dir"), true);
    assert.equal(document.queries.some((query) => query.name === "workflow"), true);
    assert.equal(document.queries.some((query) => query.name === "repos"), false);
    assert.equal(document.queries.length, Object.values(catalog).filter((query) => query.default).length);
    assert.ok(document.queries.length > shortHelpLimit);
    recordCall(env, "repos");
    recordCall(env, "repos");
    const fresh = helpDocument({ userQueries: [], env, mode: "short", loaders, config: loadConfig({ ...env, XDG_CONFIG_HOME: join(root, "absent") }) });
    assert.equal(fresh.queries[0]?.name, "repos");
    assert.equal(fresh.queries.length, 21);
    const hidden = helpDocument({
      userQueries: [],
      env,
      mode: "all",
      loaders,
      config: loadConfig({ ...env, XDG_CONFIG_HOME: join(root, "missing") }),
    });
    assert.equal(hidden.queries.some((query) => query.name === "issues"), false);
    assert.equal(hidden.queries.some((query) => query.name === "issues-in-scope"), false);
    assert.equal(hidden.queries.some((query) => query.name === "issues-ready"), false);
    const listed = helpDocument({ userQueries: [], env, mode: "all", loaders, config: loadConfig(env) });
    const workList = listed.queries.find((query) => query.name === "issues-in-scope");
    assert.equal(workList?.group, "Issues");
    assert.equal(workList?.default, true);
    assert.equal(workList?.enabled, true);
    assert.deepEqual(workList?.requires, ["beads"]);
    assert.match(workList?.purpose ?? "", /Omitting --scope/);
    assert.match(workList?.purpose ?? "", /--scope agents/);
    const ready = listed.queries.find((query) => query.name === "issues-ready");
    assert.equal(ready?.default, true);
    assert.deepEqual(ready?.requires, ["beads_ready"]);
    assert.equal(catalog["issues-in-scope"]?.defaultScope, "all");
    assert.equal(catalog["issues-ready"]?.defaultScope, "all");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the work dashboard section list is the report and the query reference", async () => {
  const { readFile } = await import("node:fs/promises");
  const { workDashboard } = await import("../dashboard.ts");
  assert.deepEqual(reports.work.sections, workDashboard.sections);
  assert.equal(reports.work.refresh, workDashboard.refresh);
  const text = await readFile("skills/spacequery/references/queries.md", "utf8");
  const work = text.slice(text.indexOf("`work` runs"), text.indexOf("## Agents")).replace(/\s+/g, " ");
  let at = -1;
  for (const [section, query] of reports.work.sections) {
    const needle = `\`${section}\` (\`${query}\`)`;
    const found = work.indexOf(needle);
    assert.ok(found > at, needle);
    at = found;
  }
  const skill = await readFile("skills/spacequery/SKILL.md", "utf8");
  assert.match(skill, /watch work/);
  assert.match(skill, /--interval/);
  assert.match(skill, /--timeout 0/);
});

test("the skill table is the curated set, including here", async () => {
  const { readFile } = await import("node:fs/promises");
  const text = await readFile("skills/spacequery/SKILL.md", "utf8");
  const table = text.slice(text.indexOf("| Query | Parameter | When |"));
  const rows = [...table.matchAll(/^\| `([^`]+)` \|[^|]*\| ([^|]+) \|/gm)].map((match) => [match[1]!, match[2]!.trim()] as const);
  const curated = new Map<string, string>([
    ["here", reports.here.purpose],
    ["work", reports.work.purpose],
    ...Object.entries(catalog).filter(([, query]) => query.default).map(([name, query]) => [name, query.purpose] as const),
  ]);
  assert.deepEqual(new Set(rows.map(([name]) => name)), new Set(curated.keys()));
  for (const [name, purpose] of rows) assert.equal(purpose, curated.get(name), name);
});
