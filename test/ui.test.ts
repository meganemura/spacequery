// The browser must inspect definitions without loading provider data.
// These checks exercise schema discovery and the actual CLI execution path.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { catalog, reports } from "../catalog.ts";
import { browserCatalog } from "../ui/catalog.ts";
import { executionArgs, observe } from "../ui/execute.ts";
import { sectionLines } from "../ui/sections.ts";

test("the browser derives columns and relations from the schema and catalog", () => {
  const items = browserCatalog();
  const table = items.find((item) => item.kind === "table" && item.name === "git_status")!;
  assert.equal(table.source, "git");
  assert.deepEqual(table.columns.find((column) => column.name === "root"), { name: "root", type: "TEXT", nullable: false, key: true });
  assert.equal(table.columns.find((column) => column.name === "branch")!.nullable, true);
  for (const [name, query] of Object.entries(catalog)) {
    const item = items.find((item) => item.kind === "query" && item.name === name)!;
    assert.equal(item.error, undefined, name);
    assert.equal(item.sql, query.query.sql);
    assert.deepEqual(item.tables, query.query.meta.reads);
    assert.equal(item.group, query.group);
    assert.equal(item.purpose, query.purpose);
    assert.ok(item.requires && item.requires.length > 0, name);
    assert.ok(item.columns.length > 0, name);
  }
  const agents = items.find((item) => item.kind === "query" && item.name === "agents")!;
  assert.deepEqual(agents.requires, ["herdr"]);
  assert.equal(agents.enabled, true);
  const issues = items.find((item) => item.kind === "query" && item.name === "issues")!;
  assert.equal(issues.enabled, false);
  assert.deepEqual(issues.requires, ["beads"]);
});

test("the browser report list is the work dashboard definition", () => {
  const items = browserCatalog();
  const work = items.find((item) => item.kind === "report" && item.name === "work")!;
  assert.deepEqual(work.sections, reports.work.sections);
  assert.equal(work.defaultScope, "all");
  assert.equal(work.refresh, reports.work.refresh);
  assert.equal(work.enabled, true);
  assert.deepEqual(work.params, []);
  assert.deepEqual(executionArgs(work, { root: "/workspace/a b", scope: "auto", params: {} }), [
    "work", "--json", "--root", "/workspace/a b",
  ]);
  const lines = sectionLines(["cursor", "ready"], {
    ready: [{ issue_id: "a" }],
    issues: [{ issue_id: "skipped" }],
  });
  assert.deepEqual(lines, ["# cursor", "(empty)", "", "# ready", "issue_id", "a"]);
  for (const [name, report] of Object.entries(reports)) {
    const item = items.find((entry) => entry.kind === "report" && entry.name === name)!;
    assert.deepEqual(item.sections, report.sections);
    assert.equal(item.purpose, report.purpose);
  }
});

test("an invalid user query stays inspectable without breaking the catalog", () => {
  const items = browserCatalog([
    { name: "bad", sql: "select * from missing_table", description: "Broken query", params: [], path: "bad.sql" },
    { name: "good", sql: "select branch from git_status", description: "Branches", params: [], path: "good.sql" },
  ]);
  assert.match(items.find((item) => item.name === "bad")!.error!, /missing_table/);
  assert.deepEqual(items.find((item) => item.name === "good")!.tables, ["git_status"]);
});

test("table inspection binds a root and retains an explicit wider scope", () => {
  const item = browserCatalog().find((item) => item.kind === "table" && item.name === "git_status")!;
  assert.deepEqual(executionArgs(item, { root: "/workspace/a b", scope: "all", me: "", params: {} }), [
    "--sql", 'select * from "git_status" where :root is not null', "--json", "--root", "/workspace/a b", "--scope", "all", "--me", "",
  ]);
});

test("inherited property names are required query parameters", () => {
  const item = { ...browserCatalog().find((item) => item.kind === "query")!, params: ["toString"] };
  assert.throws(() => executionArgs(item, { root: "/workspace", scope: "auto", params: {} }), /Enter a value for toString/);
  assert.ok(executionArgs(item, { root: "/workspace", scope: "auto", params: { toString: "value" } }).includes("value"));
});

test("scope parameters share the context flag", () => {
  const item = { ...browserCatalog().find((item) => item.kind === "query")!, params: ["scope"] };
  assert.throws(() => executionArgs(item, { root: "/workspace", scope: "auto", params: {} }), /explicit scope/);
  const args = executionArgs(item, { root: "/workspace", scope: "root", params: {} });
  assert.equal(args.filter((arg) => arg === "--scope").length, 1);
});

test("the UI help and non-terminal refusal do not need Ink or provider execution", () => {
  const output = execFileSync(process.execPath, ["cli.ts", "ui", "--no-mouse", "--help"], { encoding: "utf8" });
  assert.match(output, /spacequery ui/);
  assert.match(output, /Reports/);
  assert.throws(() => execFileSync(process.execPath, ["cli.ts", "ui"], { encoding: "utf8", stdio: "pipe" }), (error: unknown) => {
    assert.match((error as { stderr: string }).stderr, /needs an interactive terminal/);
    return true;
  });
});

test("observations use the CLI scope rules and bind parameter values", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "spacequery-ui-"));
  const before = { config: process.env.XDG_CONFIG_HOME, state: process.env.XDG_STATE_HOME };
  process.env.XDG_CONFIG_HOME = join(scratch, "config");
  process.env.XDG_STATE_HOME = join(scratch, "state");
  try {
    const item = browserCatalog().find((item) => item.kind === "query" && item.name === "repository-versions")!;
    await assert.rejects(observe(item, { root: scratch, scope: "all", params: {} }), /only supports --scope root/);
    const config = join(scratch, "config", "spacequery", "queries");
    mkdirSync(config, { recursive: true });
    writeFileSync(join(config, "echo-param.sql"), "select :value as value");
    const user = { ...item, name: "echo-param", params: ["value"] };
    const value = 'space "quote" ; $(false) 日本語';
    const observation = await observe(user, { root: scratch, scope: "auto", params: { value } });
    assert.deepEqual(observation.rows, [{ value }]);
    assert.deepEqual(observation.providers, []);
    assert.ok(observation.receivedAt > 0);
  } finally {
    for (const [key, value] of [["XDG_CONFIG_HOME", before.config], ["XDG_STATE_HOME", before.state]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(scratch, { recursive: true, force: true });
  }
});


test("cancellation stops a CLI observation and its provider process group", { skip: process.platform === "win32" }, async () => {
  const scratch = mkdtempSync(join(tmpdir(), "spacequery-ui-cancel-"));
  const marker = join(scratch, "started.json");
  const previousPath = process.env.PATH;
  const previousState = process.env.XDG_STATE_HOME;
  const controller = new AbortController();
  let pids: number[] = [];
  try {
    const bin = join(scratch, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "mise"), `#!${process.execPath}
const { spawn } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
writeFileSync(${JSON.stringify(marker)}, JSON.stringify([process.pid, child.pid]));
setInterval(() => {}, 1000);
`, { mode: 0o755 });
    process.env.PATH = bin;
    process.env.XDG_STATE_HOME = scratch;
    const item = browserCatalog().find((item) => item.kind === "query" && item.name === "tools-in-dir")!;
    const pending = observe(item, { root: scratch, scope: "root", params: {} }, controller.signal);
    const rejection = assert.rejects(pending, /Execution cancelled/);
    for (let i = 0; i < 250 && !existsSync(marker); i++) await delay(20);
    assert.ok(existsSync(marker), "the provider must start before cancellation");
    pids = JSON.parse(readFileSync(marker, "utf8"));
    controller.abort();
    await rejection;
    const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
    for (let i = 0; i < 100 && pids.some(alive); i++) await delay(10);
    assert.deepEqual(pids.filter(alive), []);
  } finally {
    controller.abort();
    for (const pid of pids) { try { process.kill(pid, "SIGKILL"); } catch {} }
    if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath;
    if (previousState === undefined) delete process.env.XDG_STATE_HOME; else process.env.XDG_STATE_HOME = previousState;
    rmSync(scratch, { recursive: true, force: true });
  }
});


test("user provider tables and query relations are inspected without executing the provider", () => {
  const items = browserCatalog([
    { name: "custom", sql: "select value from custom_rows", description: "Custom rows", params: [], path: "custom.sql" },
  ], [{
    name: "custom-source", description: "Custom source", path: "custom-source.json",
    tables: ["custom_rows"], tableDeclarations: [{ name: "custom_rows", sql: "create table custom_rows (value text)" }],
    after: [], async load() { assert.fail("catalog inspection must not run a provider"); },
  }]);
  const table = items.find((item) => item.kind === "table" && item.name === "custom_rows")!;
  assert.equal(table.source, "custom-source");
  assert.deepEqual(table.columns.map((column) => column.name), ["value"]);
  const query = items.find((item) => item.name === "custom")!;
  assert.equal(query.error, undefined);
  assert.deepEqual(query.tables, ["custom_rows"]);
});
