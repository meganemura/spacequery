// These tests hold small live-session records in a temporary home directory.
// They prove the loader reads bounded transcript data and keeps a useful half
// when the other session source fails.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import type { Exec } from "../core/loader.ts";
import type { Repo } from "../core/repo.ts";
import { runSql } from "../core/run.ts";
import { sessionsLoader, parseTranscriptTail, parseClaudeMetadata } from "../providers/sessions/loader.ts";
import { sessionCommands } from "../providers/sessions/module.ts";
import type { ClaudeSessionsId } from "../providers/sessions/solarsql.generated.ts";
import { migrations } from "../migrations/index.ts";
import { migrate, node } from "solarsql/node";

const claudeId = "claude-session";
const codexId = "codex-thread";
const claudeCwd = "/work/claude";
const codexCwd = "/work/codex";

function today(): string {
  const date = new Date();
  return join(String(date.getFullYear()), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0"));
}

async function fixtureHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "spacequery-sessions-"));
  const transcript = join(home, ".claude", "projects", "-work-claude", `${claudeId}.jsonl`);
  const rollout = join(home, ".codex", "sessions", today(), `rollout-100000-${codexId}.jsonl`);
  await mkdir(join(home, ".claude", "sessions"), { recursive: true });
  await mkdir(join(home, ".codex", "thread-writer-locks"), { recursive: true });
  await mkdir(join(home, ".claude", "projects", "-work-claude"), { recursive: true });
  await mkdir(join(home, ".codex", "sessions", today()), { recursive: true });
  await writeFile(join(home, ".claude", "sessions", `${process.pid}.json`), JSON.stringify({
    pid: process.pid,
    sessionId: claudeId,
    cwd: claudeCwd,
    name: "Claude session",
    kind: "interactive",
    status: "idle",
    statusUpdatedAt: 2100,
    entrypoint: "cli",
    nameSource: "user",
    version: "2.1.0",
    pidDomain: "host",
    peerProtocol: 1,
    startedAt: 1000,
    updatedAt: 2000,
  }));
  await writeFile(transcript, `${"x".repeat(9000)}\n${JSON.stringify({ timestamp: "2026-09-10T00:00:00.000Z", gitBranch: "main" })}\n`);
  await writeFile(rollout, [
    JSON.stringify({ type: "session_meta", payload: { id: codexId, cwd: codexCwd, cli_version: "0.1.0", originator: "cli", source: "interactive" } }),
    JSON.stringify({ timestamp: "2026-09-10T00:01:00.000Z", gitBranch: "feature" }),
  ].join("\n"));
  const state = new DatabaseSync(join(home, ".codex", "state_5.sqlite"));
  try {
    state.exec(`create table threads (
      id text primary key, rollout_path text not null, created_at integer not null, updated_at integer not null, source text not null,
      model_provider text not null, cwd text not null, title text not null, sandbox_policy text not null, approval_mode text not null,
      tokens_used integer not null default 0, has_user_event integer not null default 0, archived integer not null default 0,
      archived_at integer, git_sha text, git_branch text, git_origin_url text, cli_version text not null default '',
      first_user_message text not null default '', agent_nickname text, agent_role text, memory_mode text not null default 'enabled',
      model text, reasoning_effort text, agent_path text, created_at_ms integer, updated_at_ms integer, thread_source text,
      preview text not null default '', recency_at integer not null default 0, recency_at_ms integer not null default 0,
      history_mode text not null default 'legacy', name text, is_pinned integer not null default 0, thread_section_id text,
      section_position integer, section_entered_at_ms integer, project_id text
    ) strict`);
    state.prepare(`insert into threads (id, rollout_path, created_at, updated_at, source, thread_source, model, model_provider, reasoning_effort, cwd, title, sandbox_policy, approval_mode, git_branch, git_origin_url, tokens_used, archived, created_at_ms, updated_at_ms, cli_version)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(codexId, rollout, 3, 4, "cli", "interactive", "gpt-5", "openai", "high", codexCwd, "Codex thread", "workspace-write", "never", "feature", "https://example.test/repo.git", 42, 0, 3000, 4000, "0.1.0");
  } finally {
    state.close();
  }
  return home;
}

function fixtureRepo(): Repo {
  return { rootOf: async (cwd) => cwd === claudeCwd ? "/roots/claude" : cwd === codexCwd ? "/roots/codex" : null, originOf: async () => null };
}

function execFor(home: string, options: { failCodex?: boolean } = {}): Exec {
  const lock = join(home, ".codex", "thread-writer-locks", `${codexId}.lock`);
  return async (command, args, cwd) => {
    if (command === "lsof") {
      if (options.failCodex) throw new Error("lsof failed");
      return `p${process.pid}\nn${lock}\n`;
    }
    throw new Error(`unexpected command: ${command}`);
  };
}

test("sessions loads live Claude Code and Codex rows from bounded records", async () => {
  const home = await fixtureHome();
  try {
    const result = await runSql(
      "select session_id, agent, pid, cwd, root, name, started_at, updated_at, last_turn_at, last_branch from sessions order by agent",
      { loaders: [sessionsLoader], exec: execFor(home), repo: fixtureRepo(), env: { HOME: home }, params: {} },
    );
    assert.deepEqual(result.rows, [
      { session_id: claudeId, agent: "claude", pid: process.pid, cwd: claudeCwd, root: "/roots/claude", name: "Claude session", started_at: 1000, updated_at: 2000, last_turn_at: Date.parse("2026-09-10T00:00:00.000Z"), last_branch: "main" },
      { session_id: codexId, agent: "codex", pid: process.pid, cwd: codexCwd, root: "/roots/codex", name: null, started_at: 3000, updated_at: 4000, last_turn_at: Date.parse("2026-09-10T00:01:00.000Z"), last_branch: "feature" },
    ]);
    const claude = await runSql("select session_id, kind, entrypoint, status, status_updated_at, name_source, version, pid_domain, peer_protocol from claude_sessions", { loaders: [sessionsLoader], exec: execFor(home), repo: fixtureRepo(), env: { HOME: home }, params: {} });
    assert.deepEqual(claude.rows, [{ session_id: claudeId, kind: "interactive", entrypoint: "cli", status: "idle", status_updated_at: 2100, name_source: "user", version: "2.1.0", pid_domain: "host", peer_protocol: 1 }]);
    const codex = await runSql("select session_id, source, thread_source, model, model_provider, reasoning_effort, cli_version, sandbox_policy, approval_mode, git_branch, git_origin_url, title, tokens_used, archived from codex_sessions", { loaders: [sessionsLoader], exec: execFor(home), repo: fixtureRepo(), env: { HOME: home }, params: {} });
    assert.deepEqual(codex.rows, [{ session_id: codexId, source: "cli", thread_source: "interactive", model: "gpt-5", model_provider: "openai", reasoning_effort: "high", cli_version: "0.1.0", sandbox_policy: "workspace-write", approval_mode: "never", git_branch: "feature", git_origin_url: "https://example.test/repo.git", title: "Codex thread", tokens_used: 42, archived: 0 }]);
    assert.equal(result.providers[0]?.ok, 1);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("a Claude session needs its parent session", async () => {
  const raw = new DatabaseSync(":memory:");
  try {
    migrate(raw, migrations);
    const db = node(raw);
    const result = await db.run(sessionCommands.loadClaude, { rows: [{ session_id: "absent" as ClaudeSessionsId, model: null, effort: null, per_turn_effort: null, metadata_at: null, kind: null, entrypoint: null, status: null, status_updated_at: null, name_source: null, version: null, pid_domain: null, peer_protocol: null }] });
    assert.equal(result.ok, false);
  } finally {
    raw.close();
  }
});

test("sessions keeps Claude rows when the Codex source fails", async () => {
  const home = await fixtureHome();
  try {
    const result = await runSql("select session_id, agent from sessions order by agent", {
      loaders: [sessionsLoader], exec: execFor(home, { failCodex: true }), repo: fixtureRepo(), env: { HOME: home }, params: {},
    });
    assert.deepEqual(result.rows, [{ session_id: claudeId, agent: "claude" }]);
    assert.deepEqual(result.providers.map(({ name, ok, error }) => ({ name, ok, error })), [{ name: "sessions", ok: 0, error: "codex: lsof failed" }]);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("the transcript tail parser returns the final timestamp record", () => hegel.test((tc) => {
  const count = tc.draw(gs.integers({ minValue: 1, maxValue: 12 }));
  const bytes = tc.draw(gs.integers({ minValue: 0, maxValue: 16000 }));
  const junk = tc.draw(gs.text({ codec: "ascii", minSize: bytes, maxSize: bytes })).replaceAll("\n", "x");
  const entries = Array.from({ length: count }, (_, index) => ({ timestamp: new Date(1000 + index * 1000).toISOString(), gitBranch: `branch-${index}` }));
  const file = `${junk}\n${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
  const chunk = file.slice(Math.max(0, file.length - 8192));
  const actual = parseTranscriptTail(chunk, file.length <= 8192);
  const expected = entries.at(-1)!;
  assert.deepEqual(actual, { timestamp: Date.parse(expected.timestamp), gitBranch: expected.gitBranch });
}));

const noMetadata = { model: null, effort: null, per_turn_effort: null, metadata_at: null };
function response(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ type: "assistant", sessionId: claudeId, timestamp: "2026-09-10T00:00:00.000Z", message: { model: "claude-test" }, effort: "high", perTurnEffort: "medium", ...extra });
}

test("Claude metadata keeps the newest response fields together", () => hegel.test((tc) => {
  const count = tc.draw(gs.integers({ minValue: 1, maxValue: 20 }));
  const earlier = Array.from({ length: count }, () => response());
  const latest = response({ message: { model: "claude-next" }, effort: undefined, perTurnEffort: undefined });
  const ignored = [response({ message: { model: "<synthetic>" } }), response({ sessionId: "another-session" }), response({ isSidechain: true }), '{"type":'];
  assert.deepEqual(parseClaudeMetadata([...earlier, latest, ...ignored].join("\n"), true, claudeId), {
    model: "claude-next", effort: null, per_turn_effort: null, metadata_at: Date.parse("2026-09-10T00:00:00.000Z"),
  });
}));

test("Claude metadata ignores truncated and malformed records", () => {
  assert.deepEqual(parseClaudeMetadata(response(), false, claudeId), noMetadata);
  assert.deepEqual(parseClaudeMetadata('null\n[]\n{}\n{"type":"assistant","message":null}', true, claudeId), noMetadata);
  assert.deepEqual(parseClaudeMetadata(response({ effort: {}, perTurnEffort: 42, timestamp: "invalid" }), true, claudeId), {
    model: "claude-test", effort: null, per_turn_effort: null, metadata_at: null,
  });
});

test("Claude metadata follows a live session across project directories", async () => {
  const home = await fixtureHome();
  try {
    const original = join(home, ".claude", "projects", "-work-original");
    await rename(join(home, ".claude", "projects", "-work-claude"), original);
    const transcript = join(original, `${claudeId}.jsonl`);
    await writeFile(transcript, response() + "\n");
    const options = { loaders: [sessionsLoader], exec: execFor(home), repo: fixtureRepo(), env: { HOME: home }, params: {} };
    const sql = "select model, effort, per_turn_effort, metadata_at from claude_sessions";
    assert.deepEqual((await runSql(sql, options)).rows, [{ model: "claude-test", effort: "high", per_turn_effort: "medium", metadata_at: Date.parse("2026-09-10T00:00:00.000Z") }]);
    await writeFile(transcript, response() + "\n" + "x".repeat(9000));
    assert.deepEqual((await runSql(sql, options)).rows, [noMetadata]);
    await rm(transcript);
    assert.deepEqual((await runSql(sql, options)).rows, [noMetadata]);
    await writeFile(transcript, response());
    const duplicate = join(home, ".claude", "projects", "-work-duplicate");
    await mkdir(duplicate);
    await writeFile(join(duplicate, `${claudeId}.jsonl`), response());
    assert.deepEqual((await runSql(sql, options)).rows, [noMetadata]);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
