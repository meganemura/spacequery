// These tests prove the herdr panes loader pairs each snapshot pane with its
// shell pid and its workspace label, and that a failing process-info call
// fails the whole load instead of quietly dropping one pane.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Exec } from "../core/loader.ts";
import type { Repo } from "../core/repo.ts";
import { runSql } from "../core/run.ts";
import { herdrPanesLoader } from "../providers/herdr/loader.ts";

const repo: Repo = { async rootOf() { return null; }, async originOf() { return null; } };

function snapshot(): string {
  return JSON.stringify({
    result: {
      snapshot: {
        panes: [
          { pane_id: "w1:p1", workspace_id: "w1", tab_id: "w1:t1", cwd: "/repo/alpha", agent: "claude", terminal_title_stripped: "alpha agent" },
          { pane_id: "w1:p2", workspace_id: "w1", tab_id: "w1:t1", cwd: "/repo/alpha", terminal_title_stripped: "alpha shell" },
        ],
        workspaces: [
          { workspace_id: "w1", label: "alpha" },
          { workspace_id: "w2", label: "beta" },
        ],
      },
    },
  });
}

function processInfo(paneId: string, shellPid: number): string {
  return JSON.stringify({ result: { process_info: { pane_id: paneId, shell_pid: shellPid } } });
}

function panesExec(): { exec: Exec; calls: string[][] } {
  const calls: string[][] = [];
  const exec: Exec = async (command, args) => {
    calls.push([command, ...args]);
    if (command === "herdr" && args.join(" ") === "api snapshot") return snapshot();
    if (command === "herdr" && args[0] === "pane" && args[1] === "process-info") return processInfo(args[3]!, args[3] === "w1:p1" ? 501 : 502);
    throw new Error(`unexpected fake command: ${command} ${args.join(" ")}`);
  };
  return { exec, calls };
}

test("herdr panes loader pairs each pane with its shell pid and workspace label", async () => {
  const { exec, calls } = panesExec();
  const result = await runSql("select pane_id, workspace_id, workspace_label, tab_id, cwd, agent, title, shell_pid from panes order by pane_id", {
    loaders: [herdrPanesLoader], exec, repo, env: {}, params: {},
  });
  assert.deepEqual(result.rows, [
    { pane_id: "w1:p1", workspace_id: "w1", workspace_label: "alpha", tab_id: "w1:t1", cwd: "/repo/alpha", agent: "claude", title: "alpha agent", shell_pid: 501 },
    { pane_id: "w1:p2", workspace_id: "w1", workspace_label: "alpha", tab_id: "w1:t1", cwd: "/repo/alpha", agent: null, title: "alpha shell", shell_pid: 502 },
  ]);
  assert.deepEqual(calls[0], ["herdr", "api", "snapshot"]);
  assert.deepEqual(new Set(calls.slice(1).map((call) => call.join(" "))), new Set([
    "herdr pane process-info --pane w1:p1",
    "herdr pane process-info --pane w1:p2",
  ]));
});

test("a failing process-info call fails the whole load, leaving no pane rows", async () => {
  const exec: Exec = async (command, args) => {
    if (command === "herdr" && args.join(" ") === "api snapshot") return snapshot();
    if (command === "herdr" && args[0] === "pane" && args[1] === "process-info") {
      if (args[3] === "w1:p1") throw new Error("herdr pane process-info failed");
      return processInfo(args[3]!, 502);
    }
    throw new Error(`unexpected fake command: ${command} ${args.join(" ")}`);
  };
  const result = await runSql("select pane_id from panes", { loaders: [herdrPanesLoader], exec, repo, env: {}, params: {} });
  assert.deepEqual(result.rows, []);
  const provider = result.providers.find((p) => p.name === "herdr_panes");
  assert.equal(provider?.ok, 0);
  assert.match(provider?.error ?? "", /process-info failed/);
});
