// These tests prove runtag reads job files and keeps a dead supervisor running.
// They build a temporary jobs directory because the provider starts no command.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { catalog } from "../catalog.ts";
import type { Exec } from "../core/loader.ts";
import { runQuery } from "../core/run.ts";
import { parseUntil, untilMatches, watchUntil } from "../core/watch.ts";
import { runtagLoader, jobsDirectory, observeJob, pathMatchesDirectory } from "../providers/runtag/loader.ts";

const home = mkdtempSync(join(tmpdir(), "spacequery-runtag-"));
const data = join(home, "data");
const root = join(home, "repo");
const nested = join(root, "pkg");
const sibling = `${root}-other`;
const env = { HOME: home, XDG_DATA_HOME: data };
const exec: Exec = async (command) => { throw new Error(`runtag starts no process: ${command}`); };
const loaders = [runtagLoader];

function writeJob(id: string, value: unknown): void {
  const directory = jobsDirectory(env);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, `${id}.json`), JSON.stringify(value));
}

function job(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, status: "running", exit_code: null, repo_root: root, cwd: root, supervisor_pid: process.pid, ...overrides };
}

test("a missing jobs directory is an empty answer", async () => {
  const absent = mkdtempSync(join(tmpdir(), "spacequery-runtag-absent-"));
  const result = await runQuery(catalog["runs-in-dir"]!.query, {
    loaders, exec, env: { HOME: absent, XDG_DATA_HOME: join(absent, "data") }, params: { root },
  });
  assert.deepEqual(result.rows, []);
  assert.equal(result.providers.find((provider) => provider.name === "runtag")?.ok, 1);
  assert.deepEqual(result.trace, []);
});

test("runs-in-dir keeps jobs inside the root and not a sibling prefix", async () => {
  writeJob("inside", job("inside", { cwd: nested, repo_root: root, status: "exited", exit_code: 0, supervisor_pid: 1 }));
  writeJob("exact", job("exact", { cwd: sibling, repo_root: root, status: "exited", exit_code: 2, supervisor_pid: null }));
  writeJob("sibling", job("sibling", { cwd: sibling, repo_root: sibling, status: "running", supervisor_pid: process.pid }));
  writeJob("by-cwd", job("by-cwd", { cwd: nested, repo_root: sibling, status: "exited", exit_code: 7, supervisor_pid: null }));
  const result = await runQuery(catalog["runs-in-dir"]!.query, { loaders, exec, env, params: { root } });
  assert.deepEqual(result.rows.map((row) => row.id), ["by-cwd", "exact", "inside"]);
  assert.equal(result.providers.find((provider) => provider.name === "runtag")?.ok, 1);
  const inside = result.rows.find((row) => row.id === "inside");
  assert.equal(inside?.status, "exited");
  assert.equal(inside?.exit_code, 0);
  assert.equal(inside?.orphan, 0);
});

test("a dead supervisor stays running and does not satisfy status=exited", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  const pid = child.pid;
  assert.equal(typeof pid, "number");
  child.kill("SIGKILL");
  await new Promise((resolve) => child.once("exit", resolve));
  rmSync(jobsDirectory(env), { recursive: true, force: true });
  writeJob("live", job("live", { supervisor_pid: process.pid, status: "running", exit_code: null }));
  writeJob("orphan", job("orphan", { supervisor_pid: pid, status: "running", exit_code: 9 }));
  writeJob("done", job("done", { supervisor_pid: pid, status: "exited", exit_code: 3 }));
  const running = await runQuery(catalog["runs-in-dir"]!.query, { loaders, exec, env, params: { root } });
  const orphan = running.rows.find((row) => row.id === "orphan");
  const live = running.rows.find((row) => row.id === "live");
  const done = running.rows.find((row) => row.id === "done");
  assert.equal(orphan?.status, "running");
  assert.equal(orphan?.exit_code, null);
  assert.equal(orphan?.orphan, 1);
  assert.equal(live?.status, "running");
  assert.equal(live?.orphan, 0);
  assert.equal(live?.supervisor_pid, process.pid);
  assert.equal(done?.status, "exited");
  assert.equal(done?.exit_code, 3);
  assert.equal(done?.orphan, 0);
  assert.equal(untilMatches(running.rows, parseUntil("status=exited")), false);
  writeJob("live", job("live", { status: "exited", exit_code: 0, supervisor_pid: null }));
  writeJob("orphan", job("orphan", { status: "exited", exit_code: 9, supervisor_pid: null }));
  const finished = await runQuery(catalog["runs-in-dir"]!.query, { loaders, exec, env, params: { root } });
  assert.equal(untilMatches(finished.rows, parseUntil("status=exited")), true);
  let reads = 0;
  const outcome = await watchUntil({
    until: parseUntil("status=exited"),
    intervalMs: 1,
    timeoutMs: null,
    stopWhenIncomplete: false,
    now: () => 0,
    sleep: async () => {},
    observe: async () => {
      reads += 1;
      return reads === 1 ? { rows: running.rows, providers: running.providers } : { rows: finished.rows, providers: finished.providers };
    },
    onSnapshot: () => {},
  });
  assert.equal(outcome, "matched");
  assert.equal(reads, 2);
});

test("an unreadable jobs path fails and a bad file keeps the valid rows", async () => {
  const blocked = mkdtempSync(join(tmpdir(), "spacequery-runtag-block-"));
  const jobs = join(blocked, "runtag", "jobs");
  mkdirSync(join(blocked, "runtag"), { recursive: true });
  writeFileSync(jobs, "");
  const unreadable = await runQuery(catalog["runs-in-dir"]!.query, {
    loaders, exec, env: { HOME: blocked, XDG_DATA_HOME: blocked }, params: { root },
  });
  assert.deepEqual(unreadable.rows, []);
  const failed = unreadable.providers.find((provider) => provider.name === "runtag");
  assert.equal(failed?.ok, 0);
  assert.match(failed?.error ?? "", new RegExp(jobs));
  rmSync(jobsDirectory(env), { recursive: true, force: true });
  writeJob("kept", job("kept", { status: "exited", exit_code: 0, supervisor_pid: null }));
  writeJob("broken", "not JSON");
  const mixed = await runQuery(catalog["runs-in-dir"]!.query, { loaders, exec, env, params: { root } });
  assert.deepEqual(mixed.rows.map((row) => row.id), ["kept"]);
  const provider = mixed.providers.find((row) => row.name === "runtag");
  assert.equal(provider?.ok, 0);
  assert.match(provider?.error ?? "", /broken\.json/);
});

test("an empty jobs directory answers with no rows", async () => {
  rmSync(jobsDirectory(env), { recursive: true, force: true });
  mkdirSync(jobsDirectory(env), { recursive: true });
  const result = await runQuery(catalog["runs-in-dir"]!.query, { loaders, exec, env, params: { root } });
  assert.deepEqual(result.rows, []);
  assert.equal(result.providers.find((provider) => provider.name === "runtag")?.ok, 1);
});

test("a jobs directory without read permission fails the provider", async () => {
  if (typeof process.getuid === "function" && process.getuid() === 0) return;
  const hidden = mkdtempSync(join(tmpdir(), "spacequery-runtag-mode-"));
  const jobs = join(hidden, "runtag", "jobs");
  mkdirSync(jobs, { recursive: true });
  chmodSync(jobs, 0);
  try {
    const result = await runQuery(catalog["runs-in-dir"]!.query, {
      loaders, exec, env: { HOME: hidden, XDG_DATA_HOME: hidden }, params: { root },
    });
    assert.equal(result.providers.find((provider) => provider.name === "runtag")?.ok, 0);
    assert.match(result.providers.find((provider) => provider.name === "runtag")?.error ?? "", /EACCES/);
  } finally {
    chmodSync(jobs, 0o700);
    rmSync(hidden, { recursive: true, force: true });
  }
});

test("directory matching stops at a path boundary", () => hegel.test((tc) => {
  const segments = tc.draw(gs.arrays(gs.fromRegex("[a-z]{1,6}"), { minSize: 1, maxSize: 4, unique: true }));
  const directory = `/${segments.join("/")}`;
  const child = tc.draw(gs.fromRegex("[a-z]{1,6}"));
  assert.equal(pathMatchesDirectory(directory, directory), true);
  assert.equal(pathMatchesDirectory(`${directory}/${child}`, directory), true);
  assert.equal(pathMatchesDirectory(`${directory}/${child}/`, `${directory}/`), true);
  assert.equal(pathMatchesDirectory(`${directory}-other`, directory), false);
  assert.equal(pathMatchesDirectory(`${directory}-other/${child}`, directory), false);
  assert.equal(pathMatchesDirectory(directory, `${directory}/${child}`), false);
}));

test("observation keeps running when the supervisor is dead and exited otherwise", () => hegel.test((tc) => {
  const status = tc.draw(gs.sampledFrom(["running", "exited"] as const));
  const exitCode = tc.draw(gs.optional(gs.integers({ minValue: 0, maxValue: 255 })));
  const pid = tc.draw(gs.integers({ minValue: 1, maxValue: 100000 }));
  const alive = tc.draw(gs.booleans());
  const calls: number[] = [];
  const row = observeJob({
    id: "job",
    status,
    exit_code: exitCode,
    repo_root: "/repo",
    cwd: "/repo",
    supervisor_pid: pid,
  }, (seen) => { calls.push(seen); return alive; });
  assert.ok(row.status === "running" || row.status === "exited");
  if (status === "running" && !alive) {
    assert.equal(row.status, "running");
    assert.equal(row.orphan, 1);
    assert.equal(row.exit_code, null);
    assert.deepEqual(calls, [pid]);
  } else if (status === "exited") {
    assert.equal(row.status, "exited");
    assert.equal(row.orphan, 0);
    assert.equal(row.exit_code, exitCode ?? null);
    assert.deepEqual(calls, []);
  } else {
    assert.equal(row.orphan, 0);
    assert.equal(row.exit_code, exitCode ?? null);
    assert.deepEqual(calls, [pid]);
  }
}));
