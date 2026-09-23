// These tests prove that a failed provider leaves empty data and visible status.
// They do not test operating-system process failures.
import assert from "node:assert/strict";
import { test } from "node:test";
import { catalog } from "../catalog.ts";
import { runQuery } from "../core/run.ts";
import { loaders } from "../spacequery.config.ts";
import { fakeExec, fixtureRepo } from "./fixture.ts";

function providerFacts(rows: { name: string; ok: number; error: string | null }[]): { name: string; ok: number; error: string | null }[] {
  return rows.map(({ name, ok, error }) => ({ name, ok, error }));
}

test("a failed herdr still lets dependent providers record their result", async () => {
  const result = await runQuery(catalog["agents-in-dirty-repos"]!.query, {
    loaders,
    exec: fakeExec({ failHerdr: true }),
    repo: fixtureRepo,
    env: {},
    scope: "agents",
    params: {},
  });
  assert.deepEqual(result.rows, []);
  assert.equal(result.me, null);
  assert.deepEqual(providerFacts(result.providers), [
    { name: "git", ok: 1, error: null },
    { name: "herdr", ok: 0, error: "spawn herdr ENOENT" },
  ]);
});

test("agents records only the failed herdr provider", async () => {
  const result = await runQuery(catalog.agents!.query, {
    loaders,
    exec: fakeExec({ failHerdr: true }),
    repo: fixtureRepo,
    env: {},
    scope: "agents",
    params: {},
  });
  assert.deepEqual(result.rows, []);
  assert.equal(result.me, null);
  assert.deepEqual(providerFacts(result.providers), [{ name: "herdr", ok: 0, error: "spawn herdr ENOENT" }]);
});
