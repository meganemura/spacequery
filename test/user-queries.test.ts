// These tests prove that configuration files form a catalog without a build.
// Boundary: the CLI tests cover command output; run-sql.test.ts covers SQL execution.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { test } from "node:test";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { loadUserQueries } from "../core/user-queries.ts";

const execFileAsync = promisify(execFile);

async function withQueries<R>(files: Readonly<Record<string, string>>, run: (configHome: string, directory: string) => Promise<R> | R): Promise<R> {
  const scratch = mkdtempSync(join(tmpdir(), "spacequery-user-queries-"));
  const configHome = join(scratch, "config");
  const directory = join(configHome, "spacequery", "queries");
  mkdirSync(directory, { recursive: true });
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(directory, name), sql);
  try {
    return await run(configHome, directory);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

test("user query files provide names, descriptions, and parameters", async () => {
  await withQueries({
    "branch.sql": "-- Repositories on one branch.\nselect :branch as branch, :branch as repeated",
    "plain.sql": "select :limit as limit",
    "Bad.sql": "select 1",
    "agents.sql": "select 1",
    "here.sql": "select 1",
  }, (configHome, directory) => {
    assert.deepEqual(loadUserQueries({ XDG_CONFIG_HOME: configHome }), [
      {
        name: "branch",
        description: "Repositories on one branch.",
        sql: "-- Repositories on one branch.\nselect :branch as branch, :branch as repeated",
        path: join(directory, "branch.sql"),
        params: ["branch"],
      },
      {
        name: "plain",
        description: "",
        sql: "select :limit as limit",
        path: join(directory, "plain.sql"),
        params: ["limit"],
      },
    ]);
  });
});

test("help lists a user query and its description", async () => {
  await withQueries({
    "branch.sql": "-- Repositories on one branch.\nselect :branch as branch",
  }, async (configHome, directory) => {
    const { stdout } = await execFileAsync(process.execPath, ["cli.ts", "--help"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, XDG_CONFIG_HOME: configHome },
    });
    assert.match(stdout, new RegExp(`user queries \\(${directory.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\):`));
    assert.match(stdout, /branch\s+Repositories on one branch\./);
  });
});

test("the CLI binds a user query flag as text", async () => {
  await withQueries({
    "branch.sql": "select :branch as branch",
  }, async (configHome) => {
    const options = { cwd: process.cwd(), encoding: "utf8" as const, env: { ...process.env, XDG_CONFIG_HOME: configHome } };
    const { stdout } = await execFileAsync(process.execPath, ["cli.ts", "branch", "--branch", "42"], options);
    const { ms, ...result } = JSON.parse(stdout);
    assert.equal(typeof ms, "number");
    assert.deepEqual(result, {
      query: "branch",
      scope: "agents",
      me: null,
      params: { branch: "42" },
      rows: [{ branch: "42" }],
      providers: [],
    });
    await assert.rejects(
      execFileAsync(process.execPath, ["cli.ts", "branch"], options),
      (error: NodeJS.ErrnoException & { code?: number; stderr?: string }) => error.code === 1 && error.stderr?.includes("missing parameter: branch") === true,
    );
    await assert.rejects(
      execFileAsync(process.execPath, ["cli.ts", "branch", "--branch"], options),
      (error: NodeJS.ErrnoException & { code?: number }) => error.code === 1,
    );
  });
});

test("a user query lists every parameter token once", () => {
  const scratch = mkdtempSync(join(tmpdir(), "spacequery-user-query-parameters-"));
  const configHome = join(scratch, "config");
  const directory = join(configHome, "spacequery", "queries");
  mkdirSync(directory, { recursive: true });
  try {
    hegel.test((tc) => {
      const names = tc.draw(gs.arrays(gs.fromRegex("[a-z_][a-z0-9_]{0,6}"), { maxSize: 5, unique: true }));
      const sql = names.length === 0 ? "select 1" : `select ${names.map((name) => `:${name} as \"${name}\"`).join(", ")}`;
      writeFileSync(join(directory, "generated.sql"), sql);

      const [query] = loadUserQueries({ XDG_CONFIG_HOME: configHome });
      assert.deepEqual(query!.params, names);
    });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
