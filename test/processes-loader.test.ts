// These tests prove that ps and lsof join by pid, that a process without an
// observable cwd still gets a row, and that root comes from one lookup per
// distinct cwd against the injected repo.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import type { Exec, Loader } from "../core/loader.ts";
import type { Repo } from "../core/repo.ts";
import { runSql } from "../core/run.ts";
import { parseCpuTime, parseElapsed, parseLsof, processesLoader } from "../providers/processes/loader.ts";
import { paths } from "./fixture.ts";

const loaders: Loader[] = [processesLoader];

function repoFor(roots: ReadonlyMap<string, string>, calls: string[] = []): Repo {
  return {
    async rootOf(cwd) {
      calls.push(cwd);
      return roots.get(cwd) ?? null;
    },
    async originOf() { return null; },
  };
}

function processExec(): Exec {
  return async (command, args, cwd, options) => {
    if (command === "ps") {
      assert.deepEqual(args, ["-axo", "pid,ppid,pgid,uid,etime,time,rss,pcpu,command"]);
      return [
        "101 1 101 501 01:02 1320:09.19 100 0.1 /usr/local/bin/node server.js",
        `102 ${process.pid} 102 501 00:10 0:05.00 101 0.2 /bin/sh child`,
        "103 1 103 501 1-02:03:04 02:03:04.5 102 0.3 /usr/bin/vitest --watch",
        "104 1 104 501 02:03:04 0:01.00 103 0.4 /bin/node outside.js",
      ].join("\n");
    }
    if (command === "lsof" && args.join(" ") === `-a -d cwd -u ${process.getuid!()} -Fpn`) {
      assert.deepEqual(options, { exitCodes: [1] });
      // pid 104 has no cwd entry: lsof could not read it, and its row still loads.
      return [`p101`, "fcwd", `n${paths.alpha}/app`, "p102", "fcwd", `n${paths.alpha}`, "p103", "fcwd", `n${paths.beta}`].join("\n");
    }
    if (command === "lsof" && args.join(" ") === `-a -nP -iTCP -sTCP:LISTEN -u ${process.getuid!()} -Fpn`) {
      assert.deepEqual(options, { exitCodes: [1] });
      return ["p101", "n*:3000", "n[::1]:3000", "p104", "n127.0.0.1:5173"].join("\n");
    }
    throw new Error(`unexpected fake command: ${command} ${args.join(" ")}`);
  };
}

test("processes join ps to cwd, keep a row without cwd, and resolve root through the injected repo", async () => {
  const rootCalls: string[] = [];
  const repo = repoFor(new Map([[`${paths.alpha}/app`, paths.alpha], [paths.beta, paths.beta]]), rootCalls);
  const options = { loaders, exec: processExec(), repo, env: {}, params: {} };
  const result = await runSql("select pid, executable, cwd, root, elapsed_s, cpu_pct, cpu_time_s from processes order by pid", options);
  assert.deepEqual(result.rows, [
    { pid: 101, executable: "node", cwd: `${paths.alpha}/app`, root: paths.alpha, elapsed_s: 62, cpu_pct: 0.1, cpu_time_s: 79209.19 },
    { pid: 103, executable: "vitest", cwd: paths.beta, root: paths.beta, elapsed_s: 93784, cpu_pct: 0.3, cpu_time_s: 7384.5 },
    { pid: 104, executable: "node", cwd: null, root: null, elapsed_s: 7384, cpu_pct: 0.4, cpu_time_s: 1 },
  ]);
  // One lookup per distinct cwd lsof reported (alpha/app, alpha, beta), not one per pid.
  assert.equal(rootCalls.length, 3);
  assert.deepEqual(new Set(rootCalls), new Set([`${paths.alpha}/app`, paths.alpha, paths.beta]));

  const listeners = await runSql("select pid, address, port, cwd, root, command from listeners order by pid, address", options);
  assert.deepEqual(listeners.rows, [
    { pid: 101, address: "*", port: 3000, cwd: `${paths.alpha}/app`, root: paths.alpha, command: "/usr/local/bin/node server.js" },
    { pid: 101, address: "[::1]", port: 3000, cwd: `${paths.alpha}/app`, root: paths.alpha, command: "/usr/local/bin/node server.js" },
    { pid: 104, address: "127.0.0.1", port: 5173, cwd: null, root: null, command: "/bin/node outside.js" },
  ]);
});

test("the elapsed parser preserves generated durations", () => hegel.test((tc) => {
  const d = tc.draw(gs.integers({ minValue: 0, maxValue: 99 }));
  const h = tc.draw(gs.integers({ minValue: 0, maxValue: 23 }));
  const m = tc.draw(gs.integers({ minValue: 0, maxValue: 59 }));
  const s = tc.draw(gs.integers({ minValue: 0, maxValue: 59 }));
  const kind = tc.draw(gs.sampledFrom(["minutes", "hours", "days"] as const));
  const shape = kind === "minutes" ? `${m}:${String(s).padStart(2, "0")}` : kind === "hours" ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${d}-${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  assert.equal(parseElapsed(shape), kind === "minutes" ? m * 60 + s : kind === "hours" ? h * 3600 + m * 60 + s : d * 86400 + h * 3600 + m * 60 + s);
}));

test("the lsof field parser preserves generated pid paths", () => hegel.test((tc) => {
  const pids = tc.draw(gs.arrays(gs.integers({ minValue: 1, maxValue: 9999 }), { maxSize: 10, unique: true }));
  const pairs = pids.map((pid) => [pid, tc.draw(gs.fromRegex("/[a-z]{1,8}/[a-z]{1,8}"))] as const);
  const output = pairs.flatMap(([pid, path]) => [`p${pid}`, "fcwd", `n${path}`]).join("\n");
  assert.deepEqual(parseLsof(output), new Map(pairs.map(([pid, path]) => [pid, [path]])));
}));

test("the cpu time parser accepts minute, hour, and day shapes and rejects invalid seconds and text", () => {
  assert.equal(parseCpuTime("1320:09.19"), 79209.19);
  assert.equal(parseCpuTime("2:01.62"), 121.62);
  assert.equal(parseCpuTime("1-02:03:04"), 93784);
  assert.equal(parseCpuTime("02:03:04.5"), 7384.5);
  assert.equal(parseCpuTime("61:61"), null);
  assert.equal(parseCpuTime("abc"), null);
});

test("the cpu time parser preserves generated durations", () => hegel.test((tc) => {
  const d = tc.draw(gs.integers({ minValue: 0, maxValue: 99 }));
  const h = tc.draw(gs.integers({ minValue: 0, maxValue: 23 }));
  const m = tc.draw(gs.integers({ minValue: 0, maxValue: 59 }));
  const s = tc.draw(gs.integers({ minValue: 0, maxValue: 59 }));
  const cc = tc.draw(gs.integers({ minValue: 0, maxValue: 99 }));
  const bigMinutes = tc.draw(gs.integers({ minValue: 0, maxValue: 99999 }));
  const kind = tc.draw(gs.sampledFrom(["minutes", "hours", "days"] as const));
  const frac = `.${String(cc).padStart(2, "0")}`;
  const shape = kind === "minutes"
    ? `${bigMinutes}:${String(s).padStart(2, "0")}${frac}`
    : kind === "hours"
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}${frac}`
    : `${d}-${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}${frac}`;
  const whole = kind === "minutes" ? bigMinutes * 60 + s : kind === "hours" ? h * 3600 + m * 60 + s : d * 86400 + h * 3600 + m * 60 + s;
  // Parsed the same way the implementation combines whole seconds and the
  // fractional text, so this stays exact instead of comparing floats.
  assert.equal(parseCpuTime(shape), Number(`${whole}${frac}`));
}));
