// These tests prove that one call records its child processes and that the
// command line reveals that record only when the caller asks for it.
// Injected executors and temporary commands isolate every provider invocation.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import type { Exec, Loader } from "../core/loader.ts";
import { runSql } from "../core/run.ts";
import { fixtureRepo } from "./fixture.ts";

const execFileAsync = promisify(execFile);

function exitFailure(code: number, stdout = ""): Error {
  return Object.assign(new Error(`exit ${code}`), { code, stdout });
}

test("a run traces each child process in start order", async () => {
  const completions = new Map<string, { resolve(value: string): void; reject(reason: unknown): void }>();
  const injected: Exec = (command) => new Promise((resolve, reject) => completions.set(command, { resolve, reject }));
  const loader: Loader = {
    name: "fixture",
    tables: ["agents"],
    after: [],
    async load(ctx) {
      const successful = ctx.exec("successful", ["one", "two"], "/workspace/example");
      const accepted = ctx.exec("accepted", ["three"], undefined, { exitCodes: [7] });
      const failed = ctx.exec("failed", []);
      const resultsPromise = Promise.allSettled([successful, accepted, failed]);
      completions.get("failed")!.reject(exitFailure(8));
      completions.get("accepted")!.reject(exitFailure(7, "accepted output"));
      completions.get("successful")!.resolve("ok");
      const results = await resultsPromise;
      assert.deepEqual(results.map((result) => result.status), ["fulfilled", "fulfilled", "rejected"]);
      assert.equal(results[1]!.status === "fulfilled" ? results[1].value : null, "accepted output");
    },
  };

  const result = await runSql("select * from agents", {
    loaders: [loader], exec: injected, repo: fixtureRepo, env: {}, params: {},
  });

  assert.deepEqual(result.trace.map(({ provider, command, args, cwd, ok }) => ({ provider, command, args, cwd, ok })), [
    { provider: "fixture", command: "successful", args: ["one", "two"], cwd: "/workspace/example", ok: 1 },
    { provider: "fixture", command: "accepted", args: ["three"], cwd: null, ok: 0 },
    { provider: "fixture", command: "failed", args: [], cwd: null, ok: 0 },
  ]);
  assert.ok(result.trace.every((row) => row.started_ms >= 0 && row.ms >= 0));
  assert.deepEqual(result.trace.map((row) => row.started_ms), [...result.trace.map((row) => row.started_ms)].sort((a, b) => a - b));
  assert.ok(result.ms >= 0);
});

test("a run preserves generated child process outcomes and order", () => hegel.testAsync(async (tc) => {
  const outcomes = tc.draw(gs.arrays(gs.booleans(), { maxSize: 12 }));
  let index = 0;
  const injected: Exec = async () => {
    const ok = outcomes[index++]!;
    if (!ok) throw exitFailure(9);
    return "ok";
  };
  const loader: Loader = {
    name: "generated",
    tables: ["agents"],
    after: [],
    async load(ctx) {
      for (let call = 0; call < outcomes.length; call += 1) {
        try { await ctx.exec(`command-${call}`, [String(call)]); } catch { /* The trace records the process fact. */ }
      }
    },
  };

  const result = await runSql("select * from agents", {
    loaders: [loader], exec: injected, repo: fixtureRepo, env: {}, params: {},
  });

  assert.deepEqual(result.trace.map((row) => row.command), outcomes.map((_, call) => `command-${call}`));
  assert.deepEqual(result.trace.map((row) => row.ok), outcomes.map((ok) => ok ? 1 : 0));
  assert.ok(result.trace.every((row) => row.provider === "generated"));
}));

async function runAgents(flags: readonly string[]): Promise<{ stdout: string; stderr: string }> {
  const root = mkdtempSync(join(tmpdir(), "spacequery-trace-"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  const herdr = join(bin, "herdr");
  writeFileSync(herdr, "#!/bin/sh\nprintf '%s\\n' '{\"result\":{\"snapshot\":{\"agents\":[]}}}'\n");
  chmodSync(herdr, 0o755);
  try {
    return await execFileAsync(process.execPath, ["cli.ts", "agents", ...flags], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, XDG_STATE_HOME: join(root, "state") },
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("--trace --json prints the call time and trace", async () => {
  const { stdout } = await runAgents(["--trace", "--json"]);
  const result = JSON.parse(stdout);
  assert.equal(typeof result.ms, "number");
  assert.deepEqual(result.trace.map(({ provider, command, args, cwd, ok }: Record<string, unknown>) => ({ provider, command, args, cwd, ok })), [
    { provider: "herdr", command: "herdr", args: ["api", "snapshot"], cwd: null, ok: 1 },
  ]);
});

test("JSON omits trace unless the caller asks for it", async () => {
  const { stdout } = await runAgents(["--json"]);
  const result = JSON.parse(stdout);
  assert.equal(typeof result.ms, "number");
  assert.equal(Object.hasOwn(result, "trace"), false);
});

test("--trace --tsv writes trace columns to standard error", async () => {
  const { stdout, stderr } = await runAgents(["--trace", "--tsv"]);
  assert.equal(stdout, "");
  assert.match(stderr, /^provider\tcommand\targs\tcwd\tstarted_ms\tms\tok\nherdr\therdr\t\["api","snapshot"\]\t\t/);
});

test("help describes the trace flag", async () => {
  const { stdout } = await execFileAsync(process.execPath, ["cli.ts", "--help"], {
    cwd: process.cwd(), encoding: "utf8",
  });
  assert.match(stdout, /--trace lists every child process of the call, with its provider, start offset, and duration\./);
});
