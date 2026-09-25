// These tests prove the v0 catalog joins against one fixed machine snapshot.
// They do not test command-line rendering or a real provider installation.
import assert from "node:assert/strict";
import { test } from "node:test";
import { catalog } from "../catalog.ts";
import type { Exec, Loader, Scope } from "../core/loader.ts";
import { runQuery } from "../core/run.ts";
import { loaders } from "../spacequery.config.ts";
import { herdrCommands } from "../providers/herdr/module.ts";
import { sessionCommands } from "../providers/sessions/module.ts";
import type { ClaudeSessionsId, CodexSessionsId, SessionsId } from "../providers/sessions/solarsql.generated.ts";
import { fakeExec, fixtureAgentsWithLinkedWorktree, fixtureRepo, paneIds, paths, sessionIds } from "./fixture.ts";

const sessionFixtureLoader: Loader = {
  name: "sessions",
  tables: ["sessions", "claude_sessions", "codex_sessions"],
  after: [],
  async load(ctx) {
    const recorded = await ctx.db.run(sessionCommands.load, {
      rows: [{
        session_id: sessionIds.alphaWorking as SessionsId,
        agent: "claude",
        pid: 100,
        cwd: paths.alpha,
        root: paths.alpha,
        name: "session needle",
        started_at: null,
        updated_at: null,
        last_turn_at: null,
        last_branch: null,
      }],
    });
    if (!recorded.ok) throw new Error(`sessions: ${recorded.kind}`);
  },
};

const fixtureLoaders = loaders.map((loader) => loader.name === "sessions" ? sessionFixtureLoader : loader);

// A dedicated loader for the shared-pid regression: the Codex app can hold
// many sessions under one pid, so two rows here carry the same pid on
// purpose. Kept separate from sessionFixtureLoader so it cannot change any
// other test's session count.
const sharedPidSessionLoader: Loader = {
  name: "sessions",
  tables: ["sessions", "claude_sessions", "codex_sessions"],
  after: [],
  async load(ctx) {
    const recorded = await ctx.db.run(sessionCommands.load, {
      rows: [
        {
          session_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as SessionsId,
          agent: "claude",
          pid: 100,
          cwd: paths.alpha,
          root: paths.alpha,
          name: "session one",
          started_at: null,
          updated_at: null,
          last_turn_at: null,
          last_branch: null,
        },
        {
          session_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" as SessionsId,
          agent: "claude",
          pid: 100,
          cwd: paths.alpha,
          root: paths.alpha,
          name: "session two",
          started_at: null,
          updated_at: null,
          last_turn_at: null,
          last_branch: null,
        },
      ],
    });
    if (!recorded.ok) throw new Error(`sessions: ${recorded.kind}`);
  },
};
const sharedPidLoaders = loaders.map((loader) => loader.name === "sessions" ? sharedPidSessionLoader : loader);

async function query(name: keyof typeof catalog, scope: Scope | undefined = undefined, params: Record<string, unknown> = {}, exec: Exec = fakeExec()) {
  const options = {
    loaders: fixtureLoaders,
    exec,
    repo: fixtureRepo,
    env: {},
    params,
  };
  return runQuery(catalog[name]!.query, scope === undefined ? options : { ...options, scope });
}

function gitStatusExec(cwds: string[]): Exec {
  const base = fakeExec();
  return async (command, args, cwd, options) => {
    if (command === "git" && args[0] === "--no-optional-locks" && args[1] === "status") cwds.push(cwd!);
    return base(command, args, cwd, options);
  };
}

function githubExec(fork = false): Exec {
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
              headRepository: { nameWithOwner: fork ? "example/fork" : repo },
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
    return base(command, args, cwd, options);
  };
}

function portExec(): Exec {
  const base = fakeExec();
  return async (command, args, cwd, options) => {
    if (command === "ps") {
      assert.deepEqual(args, ["-axo", "pid,ppid,pgid,uid,etime,time,rss,pcpu,command"]);
      return [
        "201 1 201 501 03:04 0:01.00 100 0.1 /usr/local/bin/node server.js",
      ].join("\n");
    }
    if (command === "lsof" && args.join(" ") === `-a -d cwd -u ${process.getuid!()} -Fpn`) {
      assert.deepEqual(options, { exitCodes: [1] });
      return ["p201", "fcwd", `n${paths.alpha}/app`, "p202", "fcwd", `n${paths.alpha}/other`].join("\n");
    }
    if (command === "lsof" && args.join(" ") === `-a -nP -iTCP -sTCP:LISTEN -u ${process.getuid!()} -Fpn`) {
      assert.deepEqual(options, { exitCodes: [1] });
      return ["p201", "n127.0.0.1:3000", "p202", "n127.0.0.1:3001"].join("\n");
    }
    return base(command, args, cwd, options);
  };
}

function processTreeExec(): Exec {
  const base = fakeExec();
  return async (command, args, cwd, options) => {
    if (command === "ps") {
      assert.deepEqual(args, ["-axo", "pid,ppid,pgid,uid,etime,time,rss,pcpu,command"]);
      return [
        "101 100 100 501 00:10 0:05.00 100 5.0 /bin/first --watch",
        "102 101 100 501 00:09 0:04.50 300 5.0 /bin/second child",
        "103 102 100 501 00:08 0:03.00 200 1.0 /bin/third child",
        "200 1 200 501 00:07 0:02.00 400 9.0 /bin/outside-chain",
      ].join("\n");
    }
    if (command === "lsof" && args.join(" ") === `-a -d cwd -u ${process.getuid!()} -Fpn`) {
      assert.deepEqual(options, { exitCodes: [1] });
      return [101, 102, 103, 200].flatMap((pid) => [`p${pid}`, "fcwd", `n${paths.alpha}`]).join("\n");
    }
    if (command === "lsof" && args.join(" ") === `-a -nP -iTCP -sTCP:LISTEN -u ${process.getuid!()} -Fpn`) {
      assert.deepEqual(options, { exitCodes: [1] });
      return "";
    }
    return base(command, args, cwd, options);
  };
}

// The pane's shell (pid 100) runs first --watch (101) as a child, second
// child (102) as a grandchild, and third child (103) as a great-grandchild.
// pid 200 has no ancestor in any pane.
function paneOwnershipExec(): Exec {
  const base = fakeExec();
  return async (command, args, cwd, options) => {
    if (command === "ps") {
      assert.deepEqual(args, ["-axo", "pid,ppid,pgid,uid,etime,time,rss,pcpu,command"]);
      return [
        "100 1 100 501 00:11 0:06.00 150 6.0 /bin/zsh -i",
        "101 100 100 501 00:10 0:05.00 100 5.0 /bin/first --watch",
        "102 101 100 501 00:09 0:04.50 300 5.0 /bin/second child",
        "103 102 100 501 00:08 0:03.00 200 1.0 /bin/third child",
        "200 1 200 501 00:07 0:02.00 400 9.0 /bin/outside-chain",
      ].join("\n");
    }
    if (command === "lsof" && args.join(" ") === `-a -d cwd -u ${process.getuid!()} -Fpn`) {
      assert.deepEqual(options, { exitCodes: [1] });
      return [100, 101, 102, 103, 200].flatMap((pid) => [`p${pid}`, "fcwd", `n${paths.alpha}`]).join("\n");
    }
    if (command === "lsof" && args.join(" ") === `-a -nP -iTCP -sTCP:LISTEN -u ${process.getuid!()} -Fpn`) {
      assert.deepEqual(options, { exitCodes: [1] });
      return "";
    }
    return base(command, args, cwd, options);
  };
}

test("agent catalog queries use repository roots and exclude the focused caller", async () => {
  assert.deepEqual((await query("agents")).rows, [
    {
      pane_id: paneIds.alphaWorking,
      name: "Alpha working",
      agent: "claude",
      agent_status: "working",
      cwd: paths.alpha,
      root: paths.alpha,
      workspace_id: "workspace-alpha",
      title: "alpha working",
    },
    {
      pane_id: paneIds.alphaIdle,
      name: null,
      agent: "claude",
      agent_status: "idle",
      cwd: paths.alphaSubdirectory,
      root: paths.alpha,
      workspace_id: "workspace-alpha",
      title: "alpha idle",
    },
    {
      pane_id: paneIds.scratchIdle,
      name: "Scratch idle",
      agent: "claude",
      agent_status: "idle",
      cwd: paths.scratch,
      root: null,
      workspace_id: "workspace-scratch",
      title: "scratch idle",
    },
  ]);
  assert.deepEqual((await query("in-dir", "agents", { root: paths.alpha })).rows, [
    {
      pane_id: paneIds.alphaWorking,
      name: "Alpha working",
      agent: "claude",
      agent_status: "working",
      cwd: paths.alpha,
      title: "alpha working",
    },
    {
      pane_id: paneIds.alphaIdle,
      name: null,
      agent: "claude",
      agent_status: "idle",
      cwd: paths.alphaSubdirectory,
      title: "alpha idle",
    },
  ]);
  assert.deepEqual((await query("working")).rows, [
    {
      pane_id: paneIds.alphaWorking,
      name: "Alpha working",
      agent: "claude",
      agent_status: "working",
      root: paths.alpha,
      cwd: paths.alpha,
      title: "alpha working",
    },
  ]);
  assert.deepEqual((await query("workspaces")).rows, [
    { workspace_id: "workspace-alpha", root: paths.alpha, agents: 2, working: 1 },
    { workspace_id: "workspace-beta", root: paths.beta, agents: 1, working: 1 },
    { workspace_id: "workspace-scratch", root: null, agents: 1, working: 0 },
  ]);
});

test("find matches an agent name, title, root, session name, or no agent", async () => {
  const find = async (q: string) => (await query("find", "agents", { q, me: null })).rows;
  assert.deepEqual(await find("Alpha working"), [{
    pane_id: paneIds.alphaWorking,
    agent: "claude",
    agent_status: "working",
    name: "Alpha working",
    title: "alpha working",
    root: paths.alpha,
    cwd: paths.alpha,
    session_name: "session needle",
  }]);
  assert.deepEqual(await find("alpha idle"), [{
    pane_id: paneIds.alphaIdle,
    agent: "claude",
    agent_status: "idle",
    name: null,
    title: "alpha idle",
    root: paths.alpha,
    cwd: paths.alphaSubdirectory,
    session_name: null,
  }]);
  assert.deepEqual(await find(paths.beta), [{
    pane_id: paneIds.betaWorking,
    agent: "claude",
    agent_status: "working",
    name: "Beta working",
    title: "beta working",
    root: paths.beta,
    cwd: paths.beta,
    session_name: null,
  }]);
  assert.deepEqual(await find("session needle"), [{
    pane_id: paneIds.alphaWorking,
    agent: "claude",
    agent_status: "working",
    name: "Alpha working",
    title: "alpha working",
    root: paths.alpha,
    cwd: paths.alpha,
    session_name: "session needle",
  }]);
  assert.deepEqual(await find("not in this fixture"), []);
});

test("repository catalog queries preserve their ordered rows", async () => {
  assert.deepEqual((await query("dirty")).rows, [
    { root: paths.alpha, branch: "main", dirty_count: 2, untracked_count: 1 },
  ]);
  assert.deepEqual((await query("dirty", "all")).rows, [
    { root: paths.alpha, branch: "main", dirty_count: 2, untracked_count: 1 },
    { root: paths.gamma, branch: "gamma", dirty_count: 1, untracked_count: 0 },
  ]);
  assert.deepEqual((await query("worktrees", "agents", { root: paths.alpha })).rows, [
    { path: paths.alpha, branch: "main", head: "abc" },
    { path: paths.alphaWorktree, branch: "feature", head: "def" },
  ]);
  assert.deepEqual((await query("worktrees", "agents", { root: paths.alphaWorktree }, fakeExec({ agents: fixtureAgentsWithLinkedWorktree() }))).rows, [
    { path: paths.alpha, branch: "main", head: "abc" },
    { path: paths.alphaWorktree, branch: "feature", head: "def" },
  ]);
  assert.deepEqual((await query("git-status", "agents", { root: paths.gamma })).rows, [
    { root: paths.gamma, branch: "gamma", upstream: null, ahead: 0, behind: 0, dirty_count: 1, untracked_count: 0 },
  ]);
  assert.deepEqual((await query("repos")).rows, [
    { path: paths.alpha, host: "github.com", owner: "o", name: "alpha" },
    { path: paths.beta, host: "github.com", owner: "o", name: "beta" },
    { path: paths.gamma, host: "github.com", owner: "o", name: "gamma" },
  ]);
  assert.deepEqual((await query("tools")).rows, [
    { tool: "node", version: "22.1.0", install_path: "/home/u/.local/share/mise/installs/node/22.1.0", installed: 1, active: 1 },
    { tool: "node", version: "24.10.0", install_path: "/home/u/.local/share/mise/installs/node/24.10.0", installed: 1, active: 0 },
    { tool: "ruby", version: "4.0.6", install_path: null, installed: 0, active: 0 },
  ]);
  assert.deepEqual((await query("tools-in-dir", "agents", { root: paths.alpha })).rows, [
    { tool: "node", version: "24.10.0", source: "/home/u/.config/mise/config.toml", installed: 1 },
    { tool: "ruby", version: "4.0.6", source: "/home/u/src/github.com/o/mise.toml", installed: 0 },
  ]);
  assert.deepEqual((await query("brew-packages")).rows, [
    { kind: "cask", name: "visual-studio-code", version: "1.104.2,1758661640" },
    { kind: "formula", name: "jq", version: "1.8.1" },
    { kind: "formula", name: "openssl@3", version: "3.6.1" },
    { kind: "formula", name: "openssl@3", version: "3.6.3" },
  ]);
  assert.deepEqual((await query("installed-software")).rows, [
    { manager: "brew", kind: "cask", name: "visual-studio-code", version: "1.104.2,1758661640" },
    { manager: "brew", kind: "formula", name: "jq", version: "1.8.1" },
    { manager: "brew", kind: "formula", name: "openssl@3", version: "3.6.1" },
    { manager: "brew", kind: "formula", name: "openssl@3", version: "3.6.3" },
    { manager: "mise", kind: "tool", name: "node", version: "22.1.0" },
    { manager: "mise", kind: "tool", name: "node", version: "24.10.0" },
  ]);
});

test("a root-bound query runs git status on that root only by default", async () => {
  const cwds: string[] = [];
  await query("git-status", undefined, { root: paths.alpha }, gitStatusExec(cwds));
  assert.deepEqual(cwds, [paths.alpha]);
});

test("a query without root still runs git status on every agent root", async () => {
  const cwds: string[] = [];
  await query("dirty", undefined, {}, gitStatusExec(cwds));
  assert.deepEqual(cwds, [paths.alpha, paths.beta]);
});

test("the agents scope overrides a root-bound query default", async () => {
  const cwds: string[] = [];
  await query("git-status", "agents", { root: paths.alpha }, gitStatusExec(cwds));
  assert.deepEqual(cwds, [paths.alpha, paths.beta]);
});

test("report catalog queries join the fixture tables", async () => {
  assert.deepEqual((await query("agents-in-dirty-repos")).rows, [
    {
      pane_id: paneIds.alphaWorking,
      name: "Alpha working",
      agent_status: "working",
      root: paths.alpha,
      branch: "main",
      dirty_count: 2,
      untracked_count: 1,
    },
    {
      pane_id: paneIds.alphaIdle,
      name: null,
      agent_status: "idle",
      root: paths.alpha,
      branch: "main",
      dirty_count: 2,
      untracked_count: 1,
    },
  ]);
  assert.deepEqual((await query("crowded-repos")).rows, [
    { root: paths.alpha, agents: 2, working: 1, dirty_count: 2 },
  ]);
  assert.deepEqual((await query("idle-worktrees")).rows, [
    { path: paths.alphaWorktree, branch: "feature", repo_root: paths.alpha },
  ]);
  assert.deepEqual((await query("agents-outside-ghq")).rows, [
    { pane_id: paneIds.scratchIdle, name: "Scratch idle", agent_status: "idle", cwd: paths.scratch, root: null },
  ]);
  assert.deepEqual((await query("dirty-unattended", "all")).rows, [
    { root: paths.gamma, branch: "gamma", dirty_count: 1, untracked_count: 0 },
  ]);
  assert.deepEqual((await query("behind-upstream-with-agents")).rows, [
    { root: paths.alpha, branch: "main", upstream: "origin/main", behind: 3, ahead: 2, agents: 2 },
  ]);
  assert.deepEqual((await query("behind-upstream-with-agents", "agents", { me: paneIds.alphaWorking })).rows, [
    { root: paths.alpha, branch: "main", upstream: "origin/main", behind: 3, ahead: 2, agents: 1 },
  ]);
  assert.deepEqual((await query("missing-tools-with-agents")).rows, [
    { root: paths.alpha, tool: "ruby", version: "4.0.6", source: "/home/u/src/github.com/o/mise.toml", agents: 2 },
  ]);
  assert.deepEqual((await query("missing-tools-with-agents", "agents", { me: paneIds.alphaWorking })).rows, [
    { root: paths.alpha, tool: "ruby", version: "4.0.6", source: "/home/u/src/github.com/o/mise.toml", agents: 1 },
    { root: paths.beta, tool: "ruby", version: "4.0.6", source: "/home/u/src/github.com/o/mise.toml", agents: 1 },
  ]);
  const split = await query("tool-versions-split");
  assert.deepEqual(split.rows, []);
  assert.deepEqual((await query("agents-with-sessions")).rows, [
    {
      pane_id: paneIds.alphaWorking,
      agent: "claude",
      agent_status: "working",
      name: "session needle",
      claude_status: null,
      kind: null,
      model: null,
      source: null,
      started_at: null,
      updated_at: null,
      last_turn_at: null,
      last_branch: null,
      root: paths.alpha,
      idle_minutes: null,
    },
    {
      pane_id: paneIds.alphaIdle,
      agent: "claude",
      agent_status: "idle",
      name: null,
      claude_status: null,
      kind: null,
      model: null,
      source: null,
      started_at: null,
      updated_at: null,
      last_turn_at: null,
      last_branch: null,
      root: paths.alpha,
      idle_minutes: null,
    },
    {
      pane_id: paneIds.scratchIdle,
      agent: "claude",
      agent_status: "idle",
      name: null,
      claude_status: null,
      kind: null,
      model: null,
      source: null,
      started_at: null,
      updated_at: null,
      last_turn_at: null,
      last_branch: null,
      root: null,
      idle_minutes: null,
    },
  ]);
  assert.deepEqual((await query("branch-pull-requests", "agents", { root: paths.alpha }, githubExec())).rows, [
    { repo: "example/alpha", number: 7, title: "Alpha", head_branch: "main", checks: "pass", review_decision: "APPROVED", is_draft: 0, url: "https://example.test/example/alpha/7" },
  ]);
  assert.deepEqual((await query("branch-pull-requests", "agents", { root: paths.alpha }, githubExec(true))).rows, []);
  assert.deepEqual((await query("ports-in-dir", undefined, { root: paths.alpha }, portExec())).rows, [
    {
      pid: 201,
      address: "127.0.0.1",
      port: 3000,
      cwd: `${paths.alpha}/app`,
      root: paths.alpha,
      command: "/usr/local/bin/node server.js",
      head: "abc",
      branch: "main",
      dirty_count: 2,
      untracked_count: 1,
      elapsed_s: 184,
    },
    {
      pid: 202,
      address: "127.0.0.1",
      port: 3001,
      cwd: `${paths.alpha}/other`,
      root: paths.alpha,
      command: null,
      head: "abc",
      branch: "main",
      dirty_count: 2,
      untracked_count: 1,
      elapsed_s: null,
    },
  ]);
});

test("agents-with-sessions uses the Claude or Codex model recorded for the pane", async () => {
  const loader: Loader = {
    name: "sessions",
    tables: ["sessions", "claude_sessions", "codex_sessions"],
    after: [],
    async load(ctx) {
      const recorded = await ctx.db.run(sessionCommands.load, {
        rows: [
          {
            session_id: sessionIds.alphaWorking as SessionsId,
            agent: "claude",
            pid: 100,
            cwd: paths.alpha,
            root: paths.alpha,
            name: "claude pane",
            started_at: null,
            updated_at: 1_000,
            last_turn_at: null,
            last_branch: null,
          },
          {
            session_id: sessionIds.alphaIdle as SessionsId,
            agent: "codex",
            pid: 200,
            cwd: paths.alpha,
            root: paths.alpha,
            name: "codex pane",
            started_at: null,
            updated_at: 2_000,
            last_turn_at: null,
            last_branch: null,
          },
        ],
      });
      if (!recorded.ok) throw new Error(`sessions: ${recorded.kind}`);
      const claude = await ctx.db.run(sessionCommands.loadClaude, {
        rows: [{
          session_id: sessionIds.alphaWorking as ClaudeSessionsId,
          model: "claude-opus",
          effort: "high",
          per_turn_effort: null,
          metadata_at: null,
          kind: "interactive",
          entrypoint: null,
          status: "idle",
          status_updated_at: null,
          name_source: null,
          version: null,
          pid_domain: null,
          peer_protocol: null,
        }],
      });
      if (!claude.ok) throw new Error(`claude_sessions: ${claude.kind}`);
      const codex = await ctx.db.run(sessionCommands.loadCodex, {
        rows: [{
          session_id: sessionIds.alphaIdle as CodexSessionsId,
          source: "cli",
          thread_source: null,
          model: "gpt-5",
          model_provider: null,
          reasoning_effort: "high",
          cli_version: null,
          sandbox_policy: null,
          approval_mode: null,
          git_branch: null,
          git_origin_url: null,
          title: null,
          tokens_used: 0,
          archived: 0,
        }],
      });
      if (!codex.ok) throw new Error(`codex_sessions: ${codex.kind}`);
    },
  };
  const rows = (await runQuery(catalog["agents-with-sessions"]!.query, {
    loaders: loaders.map((item) => item.name === "sessions" ? loader : item),
    exec: fakeExec(),
    repo: fixtureRepo,
    env: {},
    params: {},
  })).rows;
  const claude = rows.find((row) => row.pane_id === paneIds.alphaWorking);
  const codex = rows.find((row) => row.pane_id === paneIds.alphaIdle);
  const unmatched = rows.find((row) => row.pane_id === paneIds.scratchIdle);
  assert.equal(claude?.model, "claude-opus");
  assert.equal(claude?.kind, "interactive");
  assert.equal(claude?.claude_status, "idle");
  assert.equal(claude?.source, null);
  assert.equal(codex?.model, "gpt-5");
  assert.equal(codex?.source, "cli");
  assert.equal(codex?.kind, null);
  assert.equal(codex?.claude_status, null);
  assert.equal(unmatched?.model, null);
});

test("descendants returns the three-level process chain", async () => {
  assert.deepEqual((await query("descendants", undefined, { q: "100" }, processTreeExec())).rows, [
    { pid: 101, ppid: 100, command: "/bin/first --watch", executable: "first", elapsed_s: 10, cpu_pct: 5, cpu_time_s: 5, rss_kb: 100, root: paths.alpha },
    { pid: 102, ppid: 101, command: "/bin/second child", executable: "second", elapsed_s: 9, cpu_pct: 5, cpu_time_s: 4.5, rss_kb: 300, root: paths.alpha },
    { pid: 103, ppid: 102, command: "/bin/third child", executable: "third", elapsed_s: 8, cpu_pct: 1, cpu_time_s: 3, rss_kb: 200, root: paths.alpha },
  ]);
});

test("session-processes returns descendants for each live session", async () => {
  assert.deepEqual((await query("session-processes", undefined, {}, processTreeExec())).rows, [
    { session_id: sessionIds.alphaWorking, agent: "claude", name: "session needle", session_pid: 100, pid: 101, command: "/bin/first --watch", elapsed_s: 10, cpu_pct: 5, cpu_time_s: 5, rss_kb: 100, root: paths.alpha },
    { session_id: sessionIds.alphaWorking, agent: "claude", name: "session needle", session_pid: 100, pid: 102, command: "/bin/second child", elapsed_s: 9, cpu_pct: 5, cpu_time_s: 4.5, rss_kb: 300, root: paths.alpha },
    { session_id: sessionIds.alphaWorking, agent: "claude", name: "session needle", session_pid: 100, pid: 103, command: "/bin/third child", elapsed_s: 8, cpu_pct: 1, cpu_time_s: 3, rss_kb: 200, root: paths.alpha },
  ]);
});

test("session-processes gives each session its own rows once when two sessions share a pid", async () => {
  const options = { loaders: sharedPidLoaders, exec: processTreeExec(), repo: fixtureRepo, env: {}, params: {} };
  const sessionRows = (await runQuery(catalog["session-processes"]!.query, options)).rows;
  assert.deepEqual(sessionRows, [
    { session_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", agent: "claude", name: "session one", session_pid: 100, pid: 101, command: "/bin/first --watch", elapsed_s: 10, cpu_pct: 5, cpu_time_s: 5, rss_kb: 100, root: paths.alpha },
    { session_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", agent: "claude", name: "session one", session_pid: 100, pid: 102, command: "/bin/second child", elapsed_s: 9, cpu_pct: 5, cpu_time_s: 4.5, rss_kb: 300, root: paths.alpha },
    { session_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", agent: "claude", name: "session one", session_pid: 100, pid: 103, command: "/bin/third child", elapsed_s: 8, cpu_pct: 1, cpu_time_s: 3, rss_kb: 200, root: paths.alpha },
    { session_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", agent: "claude", name: "session two", session_pid: 100, pid: 101, command: "/bin/first --watch", elapsed_s: 10, cpu_pct: 5, cpu_time_s: 5, rss_kb: 100, root: paths.alpha },
    { session_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", agent: "claude", name: "session two", session_pid: 100, pid: 102, command: "/bin/second child", elapsed_s: 9, cpu_pct: 5, cpu_time_s: 4.5, rss_kb: 300, root: paths.alpha },
    { session_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", agent: "claude", name: "session two", session_pid: 100, pid: 103, command: "/bin/third child", elapsed_s: 8, cpu_pct: 1, cpu_time_s: 3, rss_kb: 200, root: paths.alpha },
  ]);
  const descendantRows = (await runQuery(catalog["descendants"]!.query, { ...options, params: { q: "100" } })).rows;
  assert.equal(descendantRows.length, 3);
});

function withPanes(rows: readonly { pane_id: string; workspace_id: string | null; workspace_label: string | null; tab_id: string | null; cwd: string; agent: string | null; title: string | null; shell_pid: number | null }[]): Loader {
  return {
    name: "herdr_panes",
    tables: ["panes"],
    after: [],
    async load(ctx) {
      const r = await ctx.db.run(herdrCommands.loadPanes, { rows: rows as never });
      if (!r.ok) throw new Error(`panes: ${r.kind}`);
    },
  };
}

test("heavy-processes attributes a pane's shell (depth 0) and its grandchild to the pane, and leaves an unowned process with a null pane", async () => {
  const panesLoader = withPanes([{ pane_id: "w1:p1", workspace_id: "w1", workspace_label: "alpha workspace", tab_id: "w1:t1", cwd: paths.alpha, agent: "claude", title: "alpha", shell_pid: 100 }]);
  const rows = (await runQuery(catalog["heavy-processes"]!.query, {
    loaders: [...loaders.map((item) => item.name === "herdr_panes" ? panesLoader : item)],
    exec: paneOwnershipExec(),
    repo: fixtureRepo,
    env: {},
    params: {},
  })).rows;
  const owned = new Map(rows.map((row) => [row.pid, row.pane_id]));
  assert.equal(owned.get(100), "w1:p1"); // the shell itself, depth 0
  assert.equal(owned.get(101), "w1:p1"); // its child
  assert.equal(owned.get(102), "w1:p1"); // its grandchild
  assert.equal(owned.get(103), "w1:p1"); // its great-grandchild
  assert.equal(owned.get(200), null); // no ancestor in any pane
  const shell = rows.find((row) => row.pid === 100);
  assert.equal(shell?.workspace_label, "alpha workspace");
  assert.equal(shell?.agent, "claude");
  // pid 200 has the highest cpu_pct and rss_kb; pid 100 has the highest cpu_time_s.
  assert.equal(rows.find((row) => row.pid === 200)?.cpu_rank, 1);
  assert.equal(rows.find((row) => row.pid === 200)?.rss_rank, 1);
  assert.equal(rows.find((row) => row.pid === 100)?.cpu_time_rank, 1);
});

test("heavy-processes rank filter drops a process outside every top 10", async () => {
  const rankExec: Exec = async (command, args, cwd, options) => {
    if (command === "ps") {
      assert.deepEqual(args, ["-axo", "pid,ppid,pgid,uid,etime,time,rss,pcpu,command"]);
      // 11 processes, cpu_pct, cpu_time_s, and rss_kb all decreasing together
      // with pid: pid 1 ranks 1st on every measure, pid 11 ranks 11th on all three.
      return Array.from({ length: 11 }, (_, index) => {
        const pid = index + 1;
        const level = 11 - pid;
        return `${pid} 1 ${pid} 501 00:01 ${level}:00.00 ${100 + level * 100} ${level}.0 /bin/proc-${pid}`;
      }).join("\n");
    }
    if (command === "lsof") return "";
    return fakeExec()(command, args, cwd, options);
  };
  const rows = (await runQuery(catalog["heavy-processes"]!.query, {
    loaders: [...loaders.map((item) => item.name === "herdr_panes" ? withPanes([]) : item)],
    exec: rankExec,
    repo: fixtureRepo,
    env: {},
    params: {},
  })).rows;
  assert.deepEqual(new Set(rows.map((row) => row.pid)), new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
});

test("pane-load sums processes owned by a pane and reports zero for a pane with no observed process", async () => {
  const panesLoader = withPanes([
    { pane_id: "w1:p1", workspace_id: "w1", workspace_label: "alpha workspace", tab_id: "w1:t1", cwd: paths.alpha, agent: "claude", title: "alpha", shell_pid: 100 },
    { pane_id: "w2:p1", workspace_id: "w2", workspace_label: "empty workspace", tab_id: "w2:t1", cwd: paths.beta, agent: null, title: "beta", shell_pid: 999 },
  ]);
  const rows = (await runQuery(catalog["pane-load"]!.query, {
    loaders: [...loaders.map((item) => item.name === "herdr_panes" ? panesLoader : item)],
    exec: paneOwnershipExec(),
    repo: fixtureRepo,
    env: {},
    params: {},
  })).rows;
  const alpha = rows.find((row) => row.pane_id === "w1:p1");
  const empty = rows.find((row) => row.pane_id === "w2:p1");
  assert.equal(alpha?.processes, 4);
  assert.equal(alpha?.cpu_pct, 17);
  assert.equal(alpha?.cpu_time_s, 18.5);
  assert.equal(alpha?.rss_kb, 750);
  assert.equal(empty?.processes, 0);
  assert.equal(empty?.cpu_pct, 0);
  assert.equal(empty?.cpu_time_s, 0);
  assert.equal(empty?.rss_kb, 0);
});

test("long-running-without-agents skips a process the loader could not place in a repository", async () => {
  const noRootExec: Exec = async (command, args, cwd, options) => {
    if (command === "ps") {
      assert.deepEqual(args, ["-axo", "pid,ppid,pgid,uid,etime,time,rss,pcpu,command"]);
      return ["300 1 300 501 2-00:00:00 1:00:00.00 500 1.0 /bin/long-runner"].join("\n");
    }
    if (command === "lsof" && args.join(" ") === `-a -d cwd -u ${process.getuid!()} -Fpn`) {
      assert.deepEqual(options, { exitCodes: [1] });
      return "";
    }
    if (command === "lsof" && args.join(" ") === `-a -nP -iTCP -sTCP:LISTEN -u ${process.getuid!()} -Fpn`) {
      assert.deepEqual(options, { exitCodes: [1] });
      return "";
    }
    return fakeExec()(command, args, cwd, options);
  };
  const rows = (await query("long-running-without-agents", undefined, {}, noRootExec)).rows;
  assert.deepEqual(rows, []);
});
