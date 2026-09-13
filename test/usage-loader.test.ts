// Fixture-only quota observations verify source isolation and timestamp selection.
// These tests never start a real agent or contact an account service.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSql } from "../core/run.ts";
import { claudeUsageLoader, codexUsageLoader, parseClaudeUsage, parseCodexUsage, readCodexUsageTail } from "../providers/usage/loader.ts";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";

const reply = (result: string) => JSON.stringify({ is_error: false, local_command: "usage", num_turns: 0, result });
const sample = "Current session: 1% used · resets Sep 13 at 11:30pm (Asia/Tokyo)\nCurrent week (all models): 4% used · resets Sep 18 at 11am (Asia/Tokyo)\nCurrent week (Model): 5% used · resets Sep 18 at 10:59am (Asia/Tokyo)\n\nLast 24h · 58 requests · 1 session\n  34% of your usage was at >150k context";
const event = (timestamp: string, used: number, minutes = 300, id = "codex") => JSON.stringify({ type: "event_msg", timestamp, payload: { type: "token_count", rate_limits: { limit_id: id, primary: { used_percent: used, window_minutes: minutes, resets_at: 1900000000 } } } });

test("Claude quota parsing keeps source labels and yearless dates", () => {
  const rows = parseClaudeUsage(reply(sample), 1234);
  assert.deepEqual(rows.map((r) => [r.limit_id, r.window_minutes, r.used_percent]), [["Current session", 300, 1], ["Current week (all models)", 10080, 4], ["Current week (Model)", 10080, 5]]);
  assert.equal(rows[0]?.resets_text, "Sep 13 at 11:30pm (Asia/Tokyo)");
  assert.equal(rows[0]?.resets_at, null);
  assert.equal(rows[0]?.recorded_at, 1234);
  for (const bad of [reply("No subscription"), '{}', JSON.stringify({ is_error: true, result: sample }), JSON.stringify({ is_error: false, num_turns: 1, local_command: "usage", result: sample })]) assert.throws(() => parseClaudeUsage(bad, 0));
});

test("Codex quota percentages preserve generated values and window durations", () => hegel.test((tc) => {
  const used = tc.draw(gs.integers({ minValue: 0, maxValue: 100 }));
  const minutes = tc.draw(gs.integers({ minValue: 1, maxValue: 20000 }));
  const row = parseCodexUsage(event("2026-09-13T00:00:00Z", used, minutes), "fixture")[0]!;
  assert.equal(row.used_percent, used);
  assert.equal(row.window_minutes, minutes);
  assert.equal(row.resets_at, 1900000000000);
  assert.deepEqual(parseCodexUsage('{"token_count":', "fixture"), []);
}));

test("Claude query invokes only the fixed local command", async () => {
  let calls = 0;
  const result = await runSql("select used_percent from claude_usage order by used_percent", { loaders: [claudeUsageLoader, codexUsageLoader], params: {}, exec: async (command, args, cwd) => {
    calls++;
    assert.equal(command, "claude");
    assert.deepEqual(args, ["-p", "/usage", "--output-format", "json", "--no-session-persistence"]);
    assert.equal(cwd, undefined);
    return reply(sample);
  } });
  assert.equal(calls, 1);
  assert.deepEqual(result.rows, [{ used_percent: 1 }, { used_percent: 4 }, { used_percent: 5 }]);
  assert.equal(result.providers[0]?.ok, 1);
});

test("Codex finds the latest event per window across active and archived logs", async () => {
  const home = await mkdtemp(join(tmpdir(), "spacequery-usage-"));
  try {
    await mkdir(join(home, "sessions")); await mkdir(join(home, "archived_sessions"));
    await writeFile(join(home, "sessions", "new.jsonl"), [event("2026-09-13T02:00:00Z", 9), event("2026-09-13T01:00:00Z", 8), event("2026-09-13T03:00:00Z", 6, 300, "other"), '{"token_count":'].join("\n"));
    await writeFile(join(home, "archived_sessions", "old.jsonl"), [event("2026-09-12T00:00:00Z", 2), event("2026-09-13T04:00:00Z", 7, 10080)].join("\n"));
    const result = await runSql("select limit_id, window_minutes, used_percent from codex_usage order by limit_id, window_minutes", { loaders: [claudeUsageLoader, codexUsageLoader], env: { CODEX_HOME: home }, params: {}, exec: async () => { throw new Error("Codex quota reads must not start a process"); } });
    assert.deepEqual(result.rows, [{ limit_id: "codex", window_minutes: 300, used_percent: 9 }, { limit_id: "codex", window_minutes: 10080, used_percent: 7 }, { limit_id: "other", window_minutes: 300, used_percent: 6 }]);
    assert.equal(result.providers[0]?.ok, 1);
  } finally { await rm(home, { recursive: true, force: true }); }
});


test("Codex bounds reads to recent file tails and compares event timestamps", async () => {
  const home = await mkdtemp(join(tmpdir(), "spacequery-usage-recent-"));
  try {
    await mkdir(join(home, "sessions"));
    for (let i = 0; i < 34; i++) {
      const path = join(home, "sessions", `${i}.jsonl`);
      // Old files and the beginning of large files carry deliberately newer
      // timestamps. Reading either would violate the recent-tail contract.
      const text = i < 2 ? event("2099-01-01T00:00:00Z", 99)
        : i === 33 ? event("2099-01-01T00:00:00Z", 98) + "\n" + "x".repeat(300000) + "\n" + event("2026-09-13T01:00:00Z", 1)
        : i === 32 ? event("2026-09-13T02:00:00Z", 2) + "\n" + event("2026-09-13T03:00:00Z", 3, 10080)
        : '{"token_count":';
      await writeFile(path, text);
      await utimes(path, 1000 + i, 1000 + i);
    }
    const result = await runSql("select window_minutes, used_percent from codex_usage order by window_minutes", {
      loaders: [codexUsageLoader], env: { CODEX_HOME: home }, params: {},
      exec: async () => { throw new Error("Unexpected process"); },
    });
    assert.deepEqual(result.rows, [{ window_minutes: 300, used_percent: 2 }, { window_minutes: 10080, used_percent: 3 }]);
    assert.equal(result.providers[0]?.ok, 1);
  } finally { await rm(home, { recursive: true, force: true }); }
});


test("Codex stops at the first block with quota records", async () => {
  const home = await mkdtemp(join(tmpdir(), "spacequery-usage-tail-"));
  try {
    const path = join(home, "log.jsonl");
    await writeFile(path, "x".repeat(300000) + "\n" + event("2026-09-13T00:00:00Z", 7));
    const result = await readCodexUsageTail(path);
    assert.equal(result.bytesRead, 4096);
    assert.equal(result.rows[0]?.used_percent, 7);
    await writeFile(path, "x".repeat(300000));
    const absent = await readCodexUsageTail(path);
    assert.equal(absent.bytesRead, 256 * 1024);
    assert.deepEqual(absent.rows, []);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("Codex reconstructs quota lines and Unicode across backward blocks", async () => {
  const home = await mkdtemp(join(tmpdir(), "spacequery-usage-boundary-"));
  try {
    const path = join(home, "log.jsonl");
    for (const padding of [3500, 4090, 4100, 12000, 30000]) {
      const quota = event("2026-09-13T00:00:00Z", 8, 300, "窓".repeat(2000));
      const suffix = "\n" + JSON.stringify({ type: "other", content: "x".repeat(padding) });
      await writeFile(path, quota + suffix);
      const result = await readCodexUsageTail(path);
      assert.equal(result.rows[0]?.limit_id, "窓".repeat(2000));
      assert.equal(result.rows[0]?.used_percent, 8);
      assert.ok(result.bytesRead <= 256 * 1024);
    }
  } finally { await rm(home, { recursive: true, force: true }); }
});
