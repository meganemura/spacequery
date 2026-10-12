// These tests prove firstlight state is read the way firstlight reads it:
// the fold of events.jsonl, the orphan rule, the log names, and the latest
// run. They build a temporary state directory because the provider starts
// no command of its own.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { catalog } from "../catalog.ts";
import type { Exec } from "../core/loader.ts";
import { runQuery, runSql } from "../core/run.ts";
import {
  firstlightLoader,
  foldEvents,
  isTerminal,
  logFileNames,
  presentChecks,
  stateDirectory,
  type CheckStatus,
  type RunEventLine,
} from "../providers/firstlight/loader.ts";
import { loader as gitLoader } from "../providers/git/public.ts";

const home = mkdtempSync(join(tmpdir(), "spacequery-firstlight-"));
const env = { HOME: home, XDG_STATE_HOME: join(home, "state") };
const alpha = "/home/u/src/github.com/o/alpha";
const beta = "/home/u/src/github.com/o/beta";
const noProcess: Exec = async (command) => { throw new Error(`firstlight starts no process: ${command}`); };
const loaders = [firstlightLoader];

// The same key firstlight derives, so the fixture sits where it would write.
function repoDir(root: string, stateEnv: Record<string, string> = env): string {
  return join(stateDirectory(stateEnv), createHash("sha256").update(root).digest("hex").slice(0, 16));
}

type Fixture = { root: string; id: string; supervisor_pid: number | null; checks: string[][]; events: RunEventLine[]; tail?: string };

function writeRun(run: Fixture, stateEnv: Record<string, string> = env): string {
  const dir = join(repoDir(run.root, stateEnv), "runs", run.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "run.json"), JSON.stringify({
    id: run.id,
    root: run.root,
    supervisor_pid: run.supervisor_pid,
    started_at: "2026-10-12T06:56:26.747Z",
    checks: run.checks.map(([name, command, ...after]) => ({ name, run: command, after, timeoutSec: 600 })),
    cache_keys: {},
    reused: {},
  }, null, 2));
  writeFileSync(join(dir, "events.jsonl"), run.events.map((event) => `${JSON.stringify(event)}\n`).join("") + (run.tail ?? ""));
  return dir;
}

function setCurrent(root: string, id: string, stateEnv: Record<string, string> = env): void {
  writeFileSync(join(repoDir(root, stateEnv), "current"), `${id}\n`);
}

const at = "2026-10-12T06:56:27.000Z";
const check = (name: string, status: CheckStatus, extra: Record<string, unknown> = {}): RunEventLine => ({ type: "check", check: name, status, at, ...extra }) as RunEventLine;

async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  const pid = child.pid!;
  child.kill("SIGKILL");
  await new Promise((resolve) => child.once("exit", resolve));
  return pid;
}

const ids = {
  alphaOld: "01M4Q00000000000000000000A",
  alphaNow: "01M4Q00000000000000000000B",
  beta: "01M4Q00000000000000000000C",
};

test("a missing state directory is an empty answer", async () => {
  const absent = mkdtempSync(join(tmpdir(), "spacequery-firstlight-absent-"));
  const result = await runQuery(catalog["latest-check-runs"]!.query, { loaders, exec: noProcess, env: { HOME: absent } });
  assert.deepEqual(result.rows, []);
  const provider = result.providers.find((row) => row.name === "firstlight");
  assert.equal(provider?.ok, 1);
  assert.equal(provider?.error, null);
  assert.deepEqual(result.trace, []);
});

test("runs, checks, and the latest run per repository come from the state files", async () => {
  const dead = await deadPid();
  writeRun({
    root: alpha, id: ids.alphaOld, supervisor_pid: dead,
    checks: [["test", "npm test"]],
    events: [check("test", "running", { pid: 10 }), check("test", "failed", { pid: 10, exit_code: 1, elapsed_ms: 900 }), { type: "run", status: "done", at }],
  });
  writeRun({
    root: alpha, id: ids.alphaNow, supervisor_pid: process.pid,
    checks: [["typecheck", "npm run typecheck"], ["test", "npm test"], ["build", "npm run build", "test"], ["lint:js", "npm run lint:js"]],
    events: [
      check("lint:js", "passed", { exit_code: 0, elapsed_ms: 205, cached_from: ids.alphaOld }),
      check("typecheck", "running", { pid: 11 }),
      check("test", "running", { pid: 12 }),
      check("typecheck", "passed", { pid: 11, exit_code: 0, elapsed_ms: 1500 }),
    ],
    // The supervisor may be in the middle of this write; it is not read yet.
    tail: JSON.stringify(check("test", "passed")).slice(0, 20),
  });
  setCurrent(alpha, ids.alphaNow);
  writeRun({
    root: beta, id: ids.beta, supervisor_pid: dead,
    checks: [["lint", "npm run lint"], ["test", "npm test"], ["e2e", "npm run e2e", "test"]],
    events: [check("lint", "running", { pid: 20 }), check("test", "running", { pid: 21 }), check("lint", "failed", { pid: 20, exit_code: 2, elapsed_ms: 300 })],
  });

  const checks = await runSql(
    "select c.run_id, c.position, c.name, c.run, c.status, c.orphan, c.exit_code, c.elapsed_ms, c.pid, c.cached_from, c.log, r.supervisor_alive, r.outcome, r.current from firstlight_checks c join firstlight_runs r on r.id = c.run_id order by c.run_id, c.position",
    { loaders, exec: noProcess, env },
  );
  assert.equal(checks.providers.find((row) => row.name === "firstlight")?.ok, 1);
  const row = (runId: string, name: string) => checks.rows.find((entry) => entry.run_id === runId && entry.name === name)!;

  assert.deepEqual(checks.rows.filter((entry) => entry.run_id === ids.alphaNow).map((entry) => [entry.name, entry.status, entry.orphan]), [
    ["typecheck", "passed", 0], ["test", "running", 0], ["build", "pending", 0], ["lint:js", "passed", 0],
  ]);
  assert.equal(row(ids.alphaNow, "typecheck").elapsed_ms, 1500);
  assert.equal(row(ids.alphaNow, "test").pid, 12);
  assert.equal(row(ids.alphaNow, "test").supervisor_alive, 1);
  assert.equal(row(ids.alphaNow, "lint:js").cached_from, ids.alphaOld);
  assert.equal(row(ids.alphaNow, "lint:js").log, join(repoDir(alpha), "runs", ids.alphaNow, "lint_js.log"));
  assert.equal(row(ids.alphaNow, "build").run, "npm run build");
  // A finished run reports no live supervisor, even though its pid could be reused.
  assert.equal(row(ids.alphaOld, "test").supervisor_alive, 0);
  assert.equal(row(ids.alphaOld, "test").outcome, "done");
  assert.equal(row(ids.alphaOld, "test").current, 0);
  // A dead supervisor with no outcome: what never settled is unknown, what did stays.
  assert.deepEqual(checks.rows.filter((entry) => entry.run_id === ids.beta).map((entry) => [entry.name, entry.status, entry.orphan, entry.exit_code]), [
    ["lint", "failed", 0, 2], ["test", "unknown", 1, null], ["e2e", "unknown", 1, null],
  ]);
  assert.equal(row(ids.beta, "test").supervisor_alive, 0);

  const latest = await runQuery(catalog["latest-check-runs"]!.query, { loaders, exec: noProcess, env });
  assert.deepEqual(latest.rows.map((entry) => [entry.root, entry.run_id, entry.current, entry.checks, entry.passed, entry.failed, entry.running, entry.cancelled]), [
    [alpha, ids.alphaNow, 1, 4, 2, 0, 2, 0],
    // beta has no current file, so its newest run stands in.
    [beta, ids.beta, 0, 3, 0, 3, 0, 0],
  ]);

  const calls: [string, readonly string[], string | undefined][] = [];
  const exec: Exec = async (command, args, cwd) => {
    calls.push([command, args, cwd]);
    if (args[0] === "worktree") return `worktree ${alpha}\nHEAD abc\nbranch refs/heads/main\n`;
    return "# branch.head main\n";
  };
  const running = await runQuery(catalog["running-checks"]!.query, { loaders: [firstlightLoader, gitLoader], exec, env, scope: "root", params: { root: alpha } });
  assert.deepEqual(running.rows.map((entry) => [entry.root, entry.repo_root, entry.branch, entry.name, entry.status]), [
    [alpha, alpha, "main", "test", "running"],
    [alpha, alpha, "main", "build", "pending"],
  ]);
  assert.equal(typeof running.rows[0]!.running_ms, "number");
  assert.equal(running.rows[1]!.running_ms, null);
  assert.ok(calls.every(([command, , cwd]) => command === "git" && cwd === alpha));
});

test("a run firstlight could not have written fails the provider and keeps the others", async () => {
  const stateEnv = { HOME: home, XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "spacequery-firstlight-bad-")) };
  writeRun({ root: alpha, id: ids.alphaNow, supervisor_pid: null, checks: [["test", "npm test"]], events: [check("test", "running"), check("test", "passed", { exit_code: 0 }), { type: "run", status: "done", at }] }, stateEnv);
  writeRun({ root: beta, id: ids.beta, supervisor_pid: null, checks: [["test", "npm test"]], events: [check("test", "passed", { exit_code: 0 })] }, stateEnv);
  const result = await runQuery(catalog["latest-check-runs"]!.query, { loaders, exec: noProcess, env: stateEnv });
  assert.deepEqual(result.rows.map((entry) => entry.root), [alpha]);
  const provider = result.providers.find((row) => row.name === "firstlight");
  assert.equal(provider?.ok, 0);
  assert.match(provider?.error ?? "", new RegExp(`${ids.beta}: events.jsonl moves check test from pending to passed`));
});

test("a run directory without run.json yet is not there to read", async () => {
  const stateEnv = { HOME: home, XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "spacequery-firstlight-new-")) };
  mkdirSync(join(repoDir(alpha, stateEnv), "runs", ids.alphaNow), { recursive: true });
  setCurrent(alpha, ids.alphaNow, stateEnv);
  const result = await runQuery(catalog["latest-check-runs"]!.query, { loaders, exec: noProcess, env: stateEnv });
  assert.deepEqual(result.rows, []);
  assert.equal(result.providers.find((row) => row.name === "firstlight")?.ok, 1);
});

test("a relative XDG_STATE_HOME fails the provider instead of reading another directory", async () => {
  const result = await runQuery(catalog["latest-check-runs"]!.query, { loaders, exec: noProcess, env: { HOME: home, XDG_STATE_HOME: "state" } });
  const provider = result.providers.find((row) => row.name === "firstlight");
  assert.equal(provider?.ok, 0);
  assert.match(provider?.error ?? "", /absolute/);
  assert.equal(stateDirectory({ HOME: home, XDG_STATE_HOME: "  " }), join(home, ".local", "state", "firstlight"));
});

test("log file names are distinct, safe, and keep a safe name as it is", () => hegel.test((tc) => {
  const names = tc.draw(gs.arrays(gs.fromRegex("[A-Za-z:_.-]{0,6}", { fullmatch: true }), { minSize: 1, maxSize: 8, unique: true }));
  const files = logFileNames(names);
  const values = names.map((name) => files.get(name)!);
  assert.equal(new Set(values.map((file) => file.toLowerCase())).size, names.length);
  for (const file of values) {
    assert.match(file, /^[A-Za-z0-9._-]+\.log$/);
    assert.notEqual(file.toLowerCase(), "supervisor.log");
  }
  const safe = names.filter((name) => /^[A-Za-z0-9._-]+$/.test(name) && name.toLowerCase() !== "supervisor");
  const lowered = safe.map((name) => name.toLowerCase());
  for (const name of safe) {
    if (lowered.filter((entry) => entry === name.toLowerCase()).length === 1) assert.equal(files.get(name), `${name}.log`);
  }
}));

const next: Record<CheckStatus, readonly CheckStatus[]> = {
  pending: ["running", "skipped", "cancelled"],
  running: ["passed", "failed", "timed_out", "cancelled"],
  passed: [], failed: [], timed_out: [], cancelled: [], skipped: [],
};

test("the fold follows the transition table and the orphan rule", () => hegel.test((tc) => {
  const names = ["a", "b", "c"];
  const events: RunEventLine[] = [];
  const expected = new Map<string, CheckStatus>(names.map((name) => [name, "pending"]));
  const steps = tc.draw(gs.integers({ minValue: 0, maxValue: 8 }));
  for (let i = 0; i < steps; i += 1) {
    const name = tc.draw(gs.sampledFrom(names));
    const choices = next[expected.get(name)!];
    if (choices.length === 0) continue;
    const status = tc.draw(gs.sampledFrom([...choices]));
    events.push(check(name, status, { exit_code: status === "passed" ? 0 : null }));
    expected.set(name, status);
  }
  const outcome = tc.draw(gs.sampledFrom([null, "done", "cancelled"] as const));
  if (outcome !== null) events.push({ type: "run", status: outcome, at });
  const alive = tc.draw(gs.booleans());
  const folded = foldEvents(names, events);
  assert.equal(folded.outcome, outcome);
  const shown = presentChecks(folded, alive);
  for (const [index, name] of names.entries()) {
    const status = expected.get(name)!;
    const orphan = outcome === null && !alive && !isTerminal(status);
    assert.equal(shown[index]!.state.status, status);
    assert.equal(shown[index]!.status, orphan ? "unknown" : status);
    assert.equal(shown[index]!.orphan, orphan ? 1 : 0);
  }
  const settled = names.find((name) => isTerminal(expected.get(name)!));
  if (settled !== undefined) assert.throws(() => foldEvents(names, [...events, check(settled, "running")]), /events\.jsonl moves check/);
}));
