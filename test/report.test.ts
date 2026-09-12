// These tests prove reports load every required provider once, then run their
// ordered sections against one fixture database. They do not render the CLI.
import assert from "node:assert/strict";
import { test } from "node:test";
import { catalog, reports } from "../catalog.ts";
import type { Exec } from "../core/loader.ts";
import { providerQueries } from "../core/providers/public.ts";
import { runReport } from "../core/run.ts";
import { loaders } from "../spacequery.config.ts";
import { fakeExec, fixtureRepo, paneIds, paths } from "./fixture.ts";

const hereSections = reports.here.sections.map(([section, query]) => [section, catalog[query]!.query] as const);

function reportExec(): Exec {
  const base = fakeExec();
  return async (command, args, cwd, options) => {
    if (command === "gh" && args[0] === "api" && args[1] === "graphql") {
      const aliases = [...(args[3] ?? "").matchAll(/r(\d+): repository\(owner: "([^"]+)", name: "([^"]+)"\)/g)];
      const data = Object.fromEntries(aliases.map(([, index, owner, name]) => {
        const repo = `${owner}/${name}`;
        const number = repo === "example/alpha" ? 7 : 8;
        return [`r${index}`, {
          pullRequests: {
            nodes: [{
              number,
              title: repo === "example/alpha" ? "Alpha" : "Beta",
              headRefName: "main",
              headRepository: { nameWithOwner: repo },
              baseRefName: "trunk",
              author: { login: "octo" },
              isDraft: false,
              state: "OPEN",
              reviewDecision: "APPROVED",
              updatedAt: "2026-09-10T00:00:00Z",
              url: `https://example.test/${repo}/${number}`,
              commits: { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }] },
            }],
          },
        }];
      }));
      return JSON.stringify({ data });
    }
    if (command === "ps") return "";
    if (command === "lsof") return "";
    return base(command, args, cwd, options);
  };
}

function options(root: string = paths.alpha) {
  return { loaders, exec: reportExec(), repo: fixtureRepo, env: { HOME: "/home/u" }, params: { root } };
}

test("here runs its ordered sections after one union of providers", async () => {
  const result = await runReport(hereSections, options());

  assert.deepEqual(Object.keys(result.sections), ["agents", "git", "worktrees", "pull_requests", "ports", "processes", "containers", "container_ports", "tools", "issues", "workflow"]);
  assert.deepEqual(result.sections.agents, [
    { pane_id: paneIds.alphaWorking, name: "Alpha working", agent: "claude", agent_status: "working", cwd: paths.alpha, title: "alpha working" },
    { pane_id: paneIds.alphaIdle, name: null, agent: "claude", agent_status: "idle", cwd: paths.alphaSubdirectory, title: "alpha idle" },
  ]);
  assert.deepEqual(result.sections.git, [
    { root: paths.alpha, branch: "main", upstream: "origin/main", ahead: 2, behind: 3, dirty_count: 2, untracked_count: 1 },
  ]);
  assert.deepEqual(result.sections.worktrees, [
    { path: paths.alpha, branch: "main", head: "abc" },
    { path: paths.alphaWorktree, branch: "feature", head: "def" },
  ]);
  assert.deepEqual(result.sections.pull_requests, [
    { repo: "example/alpha", number: 7, title: "Alpha", head_branch: "main", checks: "pass", review_decision: "APPROVED", is_draft: 0, url: "https://example.test/example/alpha/7" },
  ]);
  assert.deepEqual(result.sections.ports, []);
  assert.deepEqual(result.sections.processes, []);
  assert.deepEqual(result.sections.containers, []);
  assert.deepEqual(result.sections.container_ports, []);
  assert.deepEqual(result.sections.tools, [
    { tool: "node", version: "24.10.0", source: "/home/u/.config/mise/config.toml", installed: 1 },
    { tool: "ruby", version: "4.0.6", source: "/home/u/src/github.com/o/mise.toml", installed: 0 },
  ]);
  assert.deepEqual(result.sections.issues, []);
  assert.deepEqual(result.sections.workflow, []);
  assert.deepEqual(Object.fromEntries(Object.entries(result.sectionStatus)), {
    agents: { providers: ["herdr"], ok: 1, errors: [] },
    git: { providers: ["git"], ok: 1, errors: [] },
    worktrees: { providers: ["git"], ok: 1, errors: [] },
    pull_requests: { providers: ["github", "git"], ok: 1, errors: [] },
    ports: { providers: ["git", "processes"], ok: 1, errors: [] },
    processes: { providers: ["processes"], ok: 1, errors: [] },
    containers: { providers: ["docker"], ok: 1, errors: [] },
    container_ports: { providers: ["docker"], ok: 1, errors: [] },
    tools: { providers: ["mise"], ok: 1, errors: [] },
    issues: { providers: ["beads"], ok: 1, errors: [] },
    workflow: { providers: ["headsign"], ok: 1, errors: [] },
  });
  assert.deepEqual(result.providers.map((provider) => provider.name), ["beads", "docker", "git", "github", "headsign", "herdr", "mise", "processes", "repos"]);
  assert.equal(new Set(result.providers.map((provider) => provider.name)).size, result.providers.length);
  assert.equal(typeof result.ms, "number");
  assert.ok(result.trace.length > 0);
  assert.equal(result.me, paneIds.betaWorking);
  assert.deepEqual(result.params, { root: paths.alpha, me: paneIds.betaWorking });
});

test("here adds a root that has no agent to the loader scope", async () => {
  const result = await runReport(hereSections, options(paths.gamma));
  assert.deepEqual(result.sections.git, [
    { root: paths.gamma, branch: "gamma", upstream: null, ahead: 0, behind: 0, dirty_count: 1, untracked_count: 0 },
  ]);
});

test("a report whose sections read agents runs herdr only", async () => {
  const agentOnly = await runReport([["agents", catalog.agents!.query]], {
    loaders,
    exec: fakeExec(),
    repo: fixtureRepo,
    env: {},
    params: {},
  });
  assert.deepEqual(agentOnly.providers.map((provider) => provider.name), ["herdr"]);
  assert.equal(agentOnly.me, paneIds.betaWorking);
});

test("a failed direct provider makes only its empty section unknown", async () => {
  const result = await runReport([
    ["agents", catalog["in-dir"]!.query],
    ["git", catalog["git-status"]!.query],
  ], {
    loaders,
    exec: fakeExec({ failHerdr: true }),
    repo: fixtureRepo,
    env: {},
    params: { root: paths.alpha },
  });

  assert.deepEqual(result.sections.agents, []);
  assert.deepEqual(result.sectionStatus.agents, {
    providers: ["herdr"],
    ok: 0,
    errors: [{ name: "herdr", error: "spawn herdr ENOENT" }],
  });
  assert.deepEqual(result.sections.git, [
    { root: paths.alpha, branch: "main", upstream: "origin/main", ahead: 2, behind: 3, dirty_count: 2, untracked_count: 1 },
  ]);
  assert.deepEqual(result.sectionStatus.git, { providers: ["git"], ok: 1, errors: [] });
});

test("a report section without a provider-owned table stays trusted", async () => {
  const result = await runReport([["provider_rows", providerQueries.all]], {
    loaders,
    exec: fakeExec(),
    repo: fixtureRepo,
    env: {},
    params: {},
  });

  assert.deepEqual(result.sections.provider_rows, []);
  assert.deepEqual(result.sectionStatus.provider_rows, { providers: [], ok: 1, errors: [] });
});

test("a dependency failure stays in report providers for widened scope", async () => {
  const result = await runReport([["dirty", catalog.dirty!.query]], {
    loaders,
    exec: fakeExec({ failRepos: true }),
    repo: fixtureRepo,
    env: {},
    scope: "all",
    params: {},
  });

  assert.deepEqual(result.sections.dirty, [
    { root: paths.alpha, branch: "main", dirty_count: 2, untracked_count: 1 },
  ]);
  assert.deepEqual(result.sectionStatus.dirty, { providers: ["git"], ok: 1, errors: [] });
  assert.deepEqual(result.providers.map(({ name, ok, error }) => ({ name, ok, error })), [
    { name: "git", ok: 1, error: null },
    { name: "herdr", ok: 1, error: null },
    { name: "repos", ok: 0, error: "spawn ghq ENOENT" },
  ]);
});

test("report section status accepts arbitrary section names", async () => {
  const result = await runReport([["__proto__", providerQueries.all]], {
    loaders,
    exec: fakeExec(),
    repo: fixtureRepo,
    env: {},
    params: {},
  });

  assert.equal(Object.getPrototypeOf(result.sections), null);
  assert.equal(Object.getPrototypeOf(result.sectionStatus), null);
  assert.equal(Object.hasOwn(result.sections, "__proto__"), true);
  assert.equal(Object.hasOwn(result.sectionStatus, "__proto__"), true);
  assert.deepEqual(result.sections["__proto__"], []);
  assert.deepEqual(result.sectionStatus["__proto__"], { providers: [], ok: 1, errors: [] });
});
