// These tests prove loader selection and parameter binding for ad hoc SQL.
// They do not parse named catalog statements.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { PrepareError } from "../core/resolve.ts";
import { runSql } from "../core/run.ts";
import { loaders } from "../spacequery.config.ts";
import { fakeExec, fixtureRepo, paths } from "./fixture.ts";

function providerNames(result: { providers: { name: string }[] }): string[] {
  return result.providers.map((provider) => provider.name);
}

// `me` is the one name the core fills itself when the caller leaves it out,
// so it is not a parameter a statement can be missing. The properties draw
// every other identifier.
function parameterNames(tc: hegel.TestCase, minimum = 0): string[] {
  return tc.draw(gs.arrays(gs.fromRegex("[a-z_][a-z0-9_]{0,6}").map((name) => (name === "me" ? "me_" : name)), { minSize: minimum, maxSize: 5, unique: true }));
}

test("SQL fills :me from the caller's identity when the caller omits it", async () => {
  const result = await runSql("select :me as \"me\"", { loaders: [], params: {} });
  assert.deepEqual(result.rows, [{ me: null }]);
  assert.equal(result.me, null);
});

function parameterStatement(names: readonly string[]): string {
  return names.length === 0 ? "select 1 as x" : `select ${names.map((name) => `:${name} as \"${name}\"`).join(", ")}`;
}

test("SQL that reads agents runs herdr only", async () => {
  const result = await runSql("select root from agents order by root", {
    loaders,
    exec: fakeExec(),
    repo: fixtureRepo,
    env: {},
    scope: "agents",
    params: {},
  });
  assert.deepEqual(result.rows, [
    { root: null },
    { root: paths.alpha },
    { root: paths.alpha },
    { root: paths.beta },
  ]);
  assert.deepEqual(providerNames(result), ["herdr"]);
});

test("SQL without tables runs no loader", async () => {
  const result = await runSql("select 1 as x", {
    loaders,
    exec: fakeExec(),
    env: {},
    scope: "agents",
    params: {},
  });
  assert.deepEqual(result.rows, [{ x: 1 }]);
  assert.deepEqual(result.providers, []);
});

test("SQL binds named parameters from the caller", async () => {
  const result = await runSql("select :root as root", {
    loaders,
    exec: fakeExec(),
    env: {},
    scope: "agents",
    params: { root: paths.alpha },
  });
  assert.deepEqual(result.rows, [{ root: paths.alpha }]);
  assert.deepEqual(result.providers, []);
});

test("SQL that reads providers does not request a loader", async () => {
  const result = await runSql("select name from providers order by name", {
    loaders,
    exec: fakeExec(),
    env: {},
    scope: "agents",
    params: {},
  });
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.providers, []);
});

test("SQL binds every named parameter without a provider", () => hegel.testAsync(async (tc) => {
  const names = parameterNames(tc);
  const params = Object.fromEntries(names.map((name) => [name, tc.draw(gs.integers())]));
  const result = await runSql(parameterStatement(names), { loaders: [], params });

  assert.deepEqual(result.providers, []);
  for (const name of names) assert.equal(result.rows[0]![name], params[name]);
}));

test("SQL reports each omitted named parameter", () => hegel.testAsync(async (tc) => {
  const names = parameterNames(tc, 1);
  const missing = tc.draw(gs.sampledFrom(names));
  const params = Object.fromEntries(
    names.filter((name) => name !== missing).map((name) => [name, tc.draw(gs.integers())]),
  );

  await assert.rejects(
    runSql(parameterStatement(names), { loaders: [], params }),
    (error: unknown) => error instanceof Error && error.message.includes(`missing parameter: ${missing}`),
  );
}));

test("a comparison a declared type makes impossible carries a warning, not a failure", async () => {
  const result = await runSql("select count(*) from panes where shell_pid = 'x'", { loaders: [], params: {} });
  assert.deepEqual(result.warnings, ["panes.shell_pid is integer; 'x' can never equal it"]);
  assert.deepEqual(result.rows, [{ "count(*)": 0 }]);
});

test("a typed named-query path stays free of warnings", async () => {
  const result = await runSql("select pid from processes limit 0", { loaders: [], params: {} });
  assert.deepEqual(result.warnings, []);
});

test("a statement that does not prepare throws a PrepareError with the fix", async () => {
  await assert.rejects(
    runSql("select pid, cpu from processes", { loaders: [], params: {} }),
    (error: unknown) => {
      assert.ok(error instanceof PrepareError);
      assert.equal(error.message, "no such column: cpu");
      assert.match(error.hint ?? "", /did you mean cpu_pct\? \(processes\)/);
      return true;
    },
  );
});
