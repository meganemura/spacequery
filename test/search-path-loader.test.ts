// These tests prove the search path provider reports the caller's PATH.
// Temporary directories isolate its rows from the machine search path.
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { catalog } from "../catalog.ts";
import type { Exec } from "../core/loader.ts";
import { runQuery, runSql } from "../core/run.ts";
import { searchPathLoader } from "../providers/search-path/loader.ts";
import { searchPathQueries } from "../providers/search-path/public.ts";

const noProcess: Exec = async (command) => { throw new Error(`search path started ${command}`); };

function commandFixture(prefix: string): { root: string; first: string; second: string } {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const first = join(root, "first");
  const second = join(root, "second");
  mkdirSync(first);
  mkdirSync(second);
  mkdirSync(join(first, "directory-command"));
  writeFileSync(join(first, "shared"), "fixture\n");
  writeFileSync(join(second, "shared"), "fixture\n");
  writeFileSync(join(root, "target"), "fixture\n");
  chmodSync(join(first, "shared"), 0o755);
  chmodSync(join(second, "shared"), 0o755);
  chmodSync(join(root, "target"), 0o755);
  symlinkSync(join(root, "target"), join(second, "linked"));
  return { root, first, second };
}

test("the caller's PATH records dead, duplicate, regular, and symbolic entries", async () => {
  const { root, first, second } = commandFixture("spacequery-search-path-loader-");
  const dead = join(root, "dead");

  try {
    const result = await runQuery(searchPathQueries.pathEntries, {
      loaders: [searchPathLoader], exec: noProcess,
      env: { PATH: [dead, first, first, second].join(delimiter) },
    });
    assert.deepEqual(result.rows, [
      { position: 0, dir: dead, exists: 0, duplicate_of: null },
      { position: 1, dir: first, exists: 1, duplicate_of: null },
      { position: 2, dir: first, exists: 1, duplicate_of: 1 },
      { position: 3, dir: second, exists: 1, duplicate_of: null },
    ]);
    assert.deepEqual(result.trace, []);
    assert.deepEqual(result.providers.map(({ name, ok }) => ({ name, ok })), [{ name: "search_path", ok: 1 }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("command queries include executable files and follow PATH order", async () => {
  const { root, first, second } = commandFixture("spacequery-path-commands-");
  const options = {
    loaders: [searchPathLoader], exec: noProcess,
    env: { PATH: [first, second].join(delimiter) },
  };

  try {
    assert.deepEqual((await runQuery(catalog["which"]!.query, { ...options, params: { q: "shared" } })).rows, [
      { name: "shared", dir: first, position: 0, effective: 1 },
      { name: "shared", dir: second, position: 1, effective: 0 },
    ]);
    assert.deepEqual((await runQuery(catalog["which"]!.query, { ...options, params: { q: "linked" } })).rows, [
      { name: "linked", dir: second, position: 1, effective: 1 },
    ]);
    assert.deepEqual((await runQuery(catalog["which"]!.query, { ...options, params: { q: "directory-command" } })).rows, []);
    assert.deepEqual((await runQuery(catalog["shadowed-commands"]!.query, options)).rows, [
      { name: "shared", effective_dir: first, shadowed_dirs: second },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("each generated command has one effective row at its first PATH position", () => hegel.testAsync(async (tc) => {
  const root = mkdtempSync(join(tmpdir(), "spacequery-path-property-"));
  const dirIds = tc.draw(gs.arrays(gs.integers({ minValue: 0, maxValue: 5 }), { minSize: 1, maxSize: 10 }));
  const names = tc.draw(gs.arrays(
    gs.text({ minSize: 1, maxSize: 12, alphabet: "abcdefghijklmnopqrstuvwxyz0123456789-" }),
    { minSize: 1, maxSize: 8, unique: true },
  ));
  const uniqueDirIds = [...new Set(dirIds)];
  const dirs = new Map(uniqueDirIds.map((id) => [id, join(root, `dir-${id}`)]));
  const locations = new Map<string, Set<number>>();

  try {
    for (const dir of dirs.values()) mkdirSync(dir);
    for (const name of names) {
      const ids = tc.draw(gs.sets(gs.sampledFrom(uniqueDirIds), { minSize: 1, maxSize: uniqueDirIds.length }));
      locations.set(name, ids);
      for (const id of ids) {
        const path = join(dirs.get(id)!, name);
        writeFileSync(path, "fixture\n");
        chmodSync(path, 0o755);
      }
    }
    const all = await runSql("select name, dir, position, effective from path_commands order by position, name", {
      loaders: [searchPathLoader], exec: noProcess,
      env: { PATH: dirIds.map((id) => dirs.get(id)!).join(delimiter) },
      params: {},
    });
    for (const name of names) {
      const rows = all.rows.filter((row) => row.name === name);
      const effective = rows.filter((row) => row.effective === 1);
      const firstPosition = dirIds.findIndex((id) => locations.get(name)!.has(id));
      assert.equal(effective.length, 1);
      assert.equal(effective[0]!.position, firstPosition);
      assert.equal(Math.min(...rows.map((row) => row.position as number)), firstPosition);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}));
