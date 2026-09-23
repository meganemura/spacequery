// These tests prove beads reads only roots with local state and keeps rows local.
// They use a temporary tree because the marker is a directory, not command output.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { catalog } from "../catalog.ts";
import type { Exec, Loader } from "../core/loader.ts";
import { runQuery, runSql } from "../core/run.ts";
import { beadsLoader, issuesFrom } from "../providers/beads/loader.ts";
import { herdrLoader } from "../providers/herdr/loader.ts";
import { repoLoader } from "../providers/repos/loader.ts";
import { repoForRoots } from "./fixture.ts";

const home = mkdtempSync(join(tmpdir(), "spacequery-beads-"));
const alpha = join(home, "src", "github.com", "example", "alpha");
const beta = join(home, "src", "github.com", "example", "beta");
const gamma = join(home, "src", "github.com", "example", "gamma");
mkdirSync(join(alpha, ".beads"), { recursive: true });
mkdirSync(join(gamma, ".beads"), { recursive: true });

const loaders: Loader[] = [repoLoader, herdrLoader, beadsLoader];
function snapshot(roots: readonly string[]): string {
  return JSON.stringify({ result: { snapshot: { agents: roots.map((cwd, index) => ({ pane_id: `example:${index}`, agent: "claude", agent_status: "working", cwd })) } } });
}
function issue(id: string, labels: string[] = []): object {
  return { id, title: `Example ${id}`, status: "open", priority: 2, issue_type: "task", labels, created_at: "2026-09-10T00:00:00.000Z", updated_at: "2026-09-10T01:00:00.000Z", dependency_count: 1, dependent_count: 2, comment_count: 3 };
}
function execFor(outputs: Readonly<Record<string, string>>, roots = [alpha, beta, gamma]): Exec {
  return async (command, args, cwd) => {
    if (command === "ghq" && args.join(" ") === "list -p") return "";
    if (command === "herdr" && args.join(" ") === "api snapshot") return snapshot(roots);
    if (command === "bd" && args[0] === "-C" && args[2] === "list" && args[3] === "--json" && args[1] !== undefined) {
      const output = outputs[args[1]];
      if (output !== undefined) return output;
      throw new Error(`bd failed for ${args[1]}`);
    }
    throw new Error(`unexpected fake command: ${command} ${args.join(" ")}`);
  };
}

test("beads loads marker roots, skips absent and failed roots, and joins labels", async () => {
  const result = await runSql("select root, issue_id, labels from issues order by root, issue_id", {
    loaders, exec: execFor({ [alpha]: JSON.stringify([issue("ex-1", ["one", "two"])]), [gamma]: JSON.stringify([issue("ex-2")]) }), repo: repoForRoots(new Set([alpha, beta, gamma])), params: {},
  });
  assert.deepEqual(result.rows, [
    { root: alpha, issue_id: "ex-1", labels: "one,two" },
    { root: gamma, issue_id: "ex-2", labels: "" },
  ]);
  assert.equal(result.providers.find((provider) => provider.name === "beads")?.ok, 1);
});

test("beads keeps rows when one marked root fails", async () => {
  const result = await runSql("select root, issue_id from issues order by root", {
    loaders, exec: execFor({ [alpha]: JSON.stringify([issue("ex-1")]) }), repo: repoForRoots(new Set([alpha, beta, gamma])), params: {},
  });
  assert.deepEqual(result.rows, [{ root: alpha, issue_id: "ex-1" }]);
  assert.equal(result.providers.find((provider) => provider.name === "beads")?.ok, 1);
});

test("issues-in-scope lists every loaded beads root, including one with no agent", async () => {
  const listed = [alpha, beta, gamma].join("\n");
  const exec: Exec = async (command, args) => {
    if (command === "ghq" && args.join(" ") === "list -p") return listed;
    if (command === "herdr" && args.join(" ") === "api snapshot") return snapshot([alpha]);
    if (command === "bd" && args[0] === "-C" && args[2] === "list" && args[3] === "--json" && args[1] !== undefined) {
      if (args[1] === alpha) return JSON.stringify([issue("alpha-1")]);
      if (args[1] === gamma) return JSON.stringify([issue("gamma-1")]);
      throw new Error(`bd failed for ${args[1]}`);
    }
    throw new Error(`unexpected fake command: ${command} ${args.join(" ")}`);
  };
  const options = { loaders, exec, repo: repoForRoots(new Set([alpha, beta, gamma])), env: {}, params: {} };
  const wide = await runQuery(catalog["issues-in-scope"]!.query, { ...options, scope: "all" });
  assert.deepEqual(wide.rows.map((row) => [row.root, row.issue_id]), [[alpha, "alpha-1"], [gamma, "gamma-1"]]);
  const narrowed = await runQuery(catalog["issues-in-scope"]!.query, { ...options, scope: "agents" });
  assert.deepEqual(narrowed.rows.map((row) => [row.root, row.issue_id]), [[alpha, "alpha-1"]]);
});

test("beads converts RFC 3339 dates to milliseconds", () => hegel.test((tc) => {
  const milliseconds = tc.draw(gs.integers({ minValue: 0, maxValue: 4_102_444_800_000 }));
  const timestamp = new Date(milliseconds).toISOString();
  const row = issuesFrom("/home/u/src/github.com/example/project", JSON.stringify([{ ...issue("ex-date"), created_at: timestamp, updated_at: timestamp }]))[0]!;
  assert.equal(row.created_at, milliseconds);
  assert.equal(row.updated_at, milliseconds);
}));

test("beads labels join and split without loss", () => hegel.test((tc) => {
  const labels = tc.draw(gs.arrays(gs.fromRegex("[a-z]{1,12}"), { minSize: 0, maxSize: 8 }));
  const row = issuesFrom("/home/u/src/github.com/example/project", JSON.stringify([issue("ex-labels", labels)]))[0]!;
  assert.deepEqual(row.labels === "" ? [] : row.labels?.split(","), labels);
}));
