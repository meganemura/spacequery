// These tests prove the Cursor provider reads the local IDE index and one
// composer document per recent agent. They do not open a live Cursor database.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { catalog } from "../catalog.ts";
import { runQuery, runSql } from "../core/run.ts";
import { cursorLoader, cursorUserDirectory, fileUriToPath, selectRecent, type CursorHeader } from "../providers/cursor/loader.ts";
import { repoForRoots } from "./fixture.ts";

const home = mkdtempSync(join(tmpdir(), "spacequery-cursor-"));
const user = cursorUserDirectory(home, "linux");
const globalDatabase = join(user, "globalStorage", "state.vscdb");
const alpha = "/home/u/src/github.com/example/alpha";
const worktree = "/home/u/src/github.com/example/alpha-wt";

function writeDatabase(path: string, setup: (db: DatabaseSync) => void): void {
  mkdirSync(join(path, ".."), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("create table ItemTable (key text unique, value blob); create table cursorDiskKV (key text unique, value blob);");
  setup(db);
  db.close();
}

function put(db: DatabaseSync, table: "ItemTable" | "cursorDiskKV", key: string, value: unknown): void {
  db.prepare(`insert into ${table} (key, value) values (?, ?)`).run(key, JSON.stringify(value));
}

test("a missing Cursor database is an empty answer", async () => {
  const absent = mkdtempSync(join(tmpdir(), "spacequery-cursor-absent-"));
  const result = await runQuery(catalog["cursor-agents"]!.query, {
    loaders: [cursorLoader], exec: async () => { throw new Error("cursor reads no process"); }, repo: repoForRoots(new Set()), env: { HOME: absent }, params: {},
  });
  assert.deepEqual(result.rows, []);
  assert.equal(result.providers.find((provider) => provider.name === "cursor")?.ok, 1);
});

test("cursor-agents reads the model, branch, and repository from the global index", async () => {
  writeDatabase(globalDatabase, (db) => {
    put(db, "ItemTable", "composer.composerHeaders", {
      allComposers: [
        { composerId: "older", name: "Older", lastUpdatedAt: 10, unifiedMode: "agent", workspaceIdentifier: { uri: { fsPath: alpha } } },
        { composerId: "newer", name: "Header name", lastUpdatedAt: 20, unifiedMode: "chat", isSubagent: false, workspaceIdentifier: { uri: { external: "file:///home/u/src/github.com/example/alpha" } } },
      ],
    });
    put(db, "cursorDiskKV", "composerData:newer", {
      name: "Add the work list", status: "completed", unifiedMode: "agent", createdAt: 5, lastUpdatedAt: 25,
      modelConfig: { modelName: "composer-2", maxMode: false },
      gitWorktree: { worktreePath: worktree, branchName: "feature" },
    });
    put(db, "cursorDiskKV", "bubbleId:newer:turn-1", { text: "unread history", modelInfo: { modelName: "other-model" } });
  });
  const result = await runQuery(catalog["cursor-agents"]!.query, {
    loaders: [cursorLoader], exec: async () => { throw new Error("cursor reads no process"); }, repo: repoForRoots(new Set([worktree, alpha])), env: { HOME: home }, params: {},
  });
  assert.equal(result.providers.find((provider) => provider.name === "cursor")?.ok, 1);
  assert.deepEqual(result.rows.map((row) => row.composer_id), ["newer", "older"]);
  assert.deepEqual(result.rows[0], {
    composer_id: "newer",
    name: "Add the work list",
    status: "completed",
    unified_mode: "agent",
    model: "composer-2",
    worktree_path: worktree,
    branch_name: "feature",
    workspace_path: alpha,
    root: worktree,
    is_archived: null,
    is_subagent: 0,
    created_at: 5,
    updated_at: 25,
  });
  assert.equal(result.rows[1]?.model, null);
  assert.equal(result.rows[1]?.root, alpha);
  assert.equal(result.rows[1]?.status, null);
});

test("the composerHeaders table supplies the index when the item key is absent", async () => {
  const machine = mkdtempSync(join(tmpdir(), "spacequery-cursor-table-"));
  const path = join(cursorUserDirectory(machine, "linux"), "globalStorage", "state.vscdb");
  writeDatabase(path, (db) => {
    db.exec("create table composerHeaders (composerId text, createdAt integer, lastUpdatedAt integer, isArchived integer, isSubagent integer, value text)");
    db.prepare("insert into composerHeaders (composerId, createdAt, lastUpdatedAt, isArchived, isSubagent, value) values (?, ?, ?, ?, ?, ?)").run(
      "from-table", 1, 9, 0, 1, JSON.stringify({ name: "Table agent", unifiedMode: "agent", workspaceIdentifier: { uri: { fsPath: alpha } } }),
    );
    put(db, "cursorDiskKV", "composerData:from-table", { status: "generating", modelConfig: { modelName: "gpt-5" } });
  });
  const result = await runSql("select composer_id, name, status, model, is_subagent, root from cursor_agents", {
    loaders: [cursorLoader], exec: async () => { throw new Error("cursor reads no process"); }, repo: repoForRoots(new Set([alpha])), env: { HOME: machine }, params: {},
  });
  assert.deepEqual(result.rows, [{ composer_id: "from-table", name: "Table agent", status: "generating", model: "gpt-5", is_subagent: 1, root: alpha }]);
});

test("a Cursor 2.x workspace index is used when the global index is absent", async () => {
  const machine = mkdtempSync(join(tmpdir(), "spacequery-cursor-workspace-"));
  const workspace = join(cursorUserDirectory(machine, "linux"), "workspaceStorage", "ws");
  writeDatabase(join(workspace, "state.vscdb"), (db) => {
    put(db, "ItemTable", "composer.composerData", { allComposers: [{ composerId: "local", name: "Workspace agent", lastUpdatedAt: 4, unifiedMode: "agent" }] });
  });
  mkdirSync(workspace, { recursive: true });
  const { writeFileSync } = await import("node:fs");
  writeFileSync(join(workspace, "workspace.json"), JSON.stringify({ folder: "file:///home/u/src/github.com/example/alpha" }));
  const result = await runSql("select composer_id, name, model, workspace_path, root from cursor_agents", {
    loaders: [cursorLoader], exec: async () => { throw new Error("cursor reads no process"); }, repo: repoForRoots(new Set([alpha])), env: { HOME: machine }, params: {},
  });
  assert.deepEqual(result.rows, [{ composer_id: "local", name: "Workspace agent", model: null, workspace_path: alpha, root: alpha }]);
});

test("an unreadable composer index fails the provider", async () => {
  const machine = mkdtempSync(join(tmpdir(), "spacequery-cursor-bad-"));
  const path = join(cursorUserDirectory(machine, "linux"), "globalStorage", "state.vscdb");
  writeDatabase(path, (db) => {
    db.prepare("insert into ItemTable (key, value) values ('composer.composerHeaders', ?)").run("not-json");
  });
  const result = await runQuery(catalog["cursor-agents"]!.query, {
    loaders: [cursorLoader], exec: async () => { throw new Error("cursor reads no process"); }, repo: repoForRoots(new Set()), env: { HOME: machine }, params: {},
  });
  assert.equal(result.providers.find((provider) => provider.name === "cursor")?.ok, 0);
  assert.equal(result.rows.length, 0);
});

test("macOS state lives under Application Support", () => {
  assert.equal(cursorUserDirectory("/Users/u", "darwin"), "/Users/u/Library/Application Support/Cursor/User");
  assert.equal(fileUriToPath("file:///home/u/src/a%20b"), "/home/u/src/a b");
  assert.equal(fileUriToPath("vscode-remote://ssh/repo"), null);
});

test("selectRecent keeps the newest distinct agents", () => hegel.test((tc) => {
  const count = tc.draw(gs.integers({ minValue: 0, maxValue: 40 }));
  const rows: CursorHeader[] = [];
  for (let index = 0; index < count; index += 1) {
    rows.push({
      composerId: `c${index % 7}`,
      name: null,
      unifiedMode: null,
      workspacePath: null,
      isArchived: null,
      isSubagent: null,
      createdAt: null,
      updatedAt: tc.draw(gs.optional(gs.integers({ minValue: 0, maxValue: 100 }))) ?? null,
    });
  }
  const selected = selectRecent(rows, 3);
  assert.ok(selected.length <= 3);
  assert.equal(new Set(selected.map((row) => row.composerId)).size, selected.length);
  const newest = selected.filter((row) => row.updatedAt !== null).at(-1)?.updatedAt ?? null;
  if (newest !== null) {
    for (const row of rows) {
      if (row.updatedAt !== null && row.updatedAt > newest) assert.ok(selected.some((kept) => kept.composerId === row.composerId));
    }
  }
}));
