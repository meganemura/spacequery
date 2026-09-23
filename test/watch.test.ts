// Predicate, fingerprint, and poll control. Snapshots are fake, so these
// tests do not start a provider.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  observationFingerprint,
  parseUntil,
  parseWatchTiming,
  rowFingerprint,
  untilMatches,
  watchUntil,
  type WatchSnapshot,
} from "../core/watch.ts";

const answered: WatchSnapshot["providers"] = [{ name: "herdr", ok: 1, error: null }];
const silent: WatchSnapshot["providers"] = [{ name: "herdr", ok: 0, error: "spawn herdr ENOENT" }];

function snapshot(rows: Record<string, unknown>[], providers: WatchSnapshot["providers"] = answered): WatchSnapshot {
  return { rows, providers };
}

test("parseUntil accepts empty, nonempty, and a column value set", () => {
  assert.deepEqual(parseUntil(" empty "), { kind: "empty" });
  assert.deepEqual(parseUntil("nonempty"), { kind: "nonempty" });
  assert.deepEqual(parseUntil("status=idle"), { kind: "column", column: "status", values: ["idle"] });
  assert.deepEqual(parseUntil("agent_status=idle|blocked"), { kind: "column", column: "agent_status", values: ["idle", "blocked"] });
  assert.deepEqual(parseUntil("status=idle|done"), { kind: "column", column: "status", values: ["idle", "done"] });
  for (const text of ["status", "status=", "status=idle|", "=idle", "status=idle|done|", "agent status=idle"]) {
    assert.throws(() => parseUntil(text), /--until is empty, nonempty/);
  }
});

test("until matches every row, and zero rows only match empty", () => {
  const idle = [{ agent_status: "idle" }, { agent_status: "blocked" }];
  const mixed = [{ agent_status: "idle" }, { agent_status: "working" }];
  assert.equal(untilMatches([], parseUntil("empty")), true);
  assert.equal(untilMatches([{ agent_status: "idle" }], parseUntil("empty")), false);
  assert.equal(untilMatches([], parseUntil("nonempty")), false);
  assert.equal(untilMatches(idle, parseUntil("nonempty")), true);
  assert.equal(untilMatches(idle, parseUntil("agent_status=idle|blocked")), true);
  assert.equal(untilMatches(mixed, parseUntil("agent_status=idle|blocked")), false);
  assert.equal(untilMatches([], parseUntil("agent_status=idle")), false);
  assert.equal(untilMatches([{ status: null }], parseUntil("status=idle")), false);
  assert.equal(untilMatches([{ other: "idle" }], parseUntil("status=idle")), false);
  assert.equal(untilMatches([{ status: "idle" }], parseUntil("status=idle")), true);
  assert.equal(untilMatches([{ status: 1 }], parseUntil("status=1")), true);
});

test("row fingerprints ignore key order and follow seq columns", () => {
  const first = rowFingerprint([{ revision: 3, state_change_seq: 1, status: "working" }]);
  const reordered = rowFingerprint([{ status: "working", state_change_seq: 1, revision: 3 }]);
  assert.equal(first, reordered);
  assert.notEqual(first, rowFingerprint([{ revision: 4, state_change_seq: 1, status: "working" }]));
  assert.notEqual(first, rowFingerprint([{ revision: 3, state_change_seq: 2, status: "working" }]));
  assert.notEqual(first, rowFingerprint([{ status: "idle", state_change_seq: 1, revision: 3 }]));
  assert.notEqual(
    rowFingerprint([{ pane_id: "a" }, { pane_id: "b" }]),
    rowFingerprint([{ pane_id: "b" }, { pane_id: "a" }]),
  );
});

test("a report fingerprint follows every section", () => {
  const gate = snapshot([]);
  const ready = { ...gate, sections: { ready: [{ issue_id: "a" }], agents: [] } };
  const moved = { ...gate, sections: { ready: [{ issue_id: "b" }], agents: [] } };
  assert.notEqual(observationFingerprint(ready), observationFingerprint(moved));
  assert.equal(observationFingerprint(ready), observationFingerprint({ ...ready, sections: { agents: [], ready: [{ issue_id: "a" }] } }));
});

test("a refresh loop without --until stops on the deadline", async () => {
  let ticks = 0;
  let prints = 0;
  const outcome = await watchUntil({
    intervalMs: 10,
    timeoutMs: 15,
    stopWhenIncomplete: false,
    now: () => ticks * 10,
    sleep: async () => { ticks += 1; },
    observe: async () => snapshot([{ issue_id: "a" }]),
    onSnapshot: () => { prints += 1; },
  });
  assert.equal(outcome, "timeout");
  assert.equal(prints, 1);
  assert.ok(ticks >= 1);
});

test("observation fingerprints ignore freshness and keep provider failure", () => {
  const rows = [{ agent_status: "idle" }];
  const complete = observationFingerprint(snapshot(rows));
  assert.equal(complete, observationFingerprint(snapshot(rows)));
  assert.notEqual(complete, observationFingerprint(snapshot(rows, silent)));
  assert.equal(rowFingerprint(rows), rowFingerprint([{ agent_status: "idle" }]));
});

test("watch prints changes, then exits when until matches", async () => {
  const frames = [
    snapshot([{ agent_status: "working", state_change_seq: 1 }]),
    snapshot([{ agent_status: "working", state_change_seq: 1 }]),
    snapshot([{ agent_status: "idle", state_change_seq: 2 }]),
  ];
  let index = 0;
  const printed: WatchSnapshot[] = [];
  const outcome = await watchUntil({
    until: parseUntil("agent_status=idle"),
    intervalMs: 10,
    timeoutMs: null,
    stopWhenIncomplete: false,
    now: () => 0,
    sleep: async () => {},
    observe: async () => frames[Math.min(index++, frames.length - 1)]!,
    onSnapshot: (frame) => printed.push(frame),
  });
  assert.equal(outcome, "matched");
  assert.equal(index, 3);
  assert.deepEqual(printed.map((frame) => frame.rows[0]!["agent_status"]), ["working", "idle"]);
});

test("a revision change is a new snapshot", async () => {
  const frames = [snapshot([{ revision: 1 }]), snapshot([{ revision: 1 }]), snapshot([{ revision: 2 }])];
  let index = 0;
  const printed: number[] = [];
  const outcome = await watchUntil({
    until: parseUntil("revision=2"),
    intervalMs: 5,
    timeoutMs: null,
    stopWhenIncomplete: false,
    now: () => 0,
    sleep: async () => {},
    observe: async () => frames[index++]!,
    onSnapshot: (frame) => printed.push(Number(frame.rows[0]!["revision"])),
  });
  assert.equal(outcome, "matched");
  assert.deepEqual(printed, [1, 2]);
});

test("watch prints the first snapshot and does not repeat it before timeout", async () => {
  let now = 0;
  let observes = 0;
  let prints = 0;
  const outcome = await watchUntil({
    until: parseUntil("status=idle"),
    intervalMs: 100,
    timeoutMs: 250,
    stopWhenIncomplete: false,
    now: () => now,
    sleep: async (ms) => { now += ms; },
    observe: async () => {
      observes += 1;
      return snapshot([{ status: "working" }]);
    },
    onSnapshot: () => { prints += 1; },
  });
  assert.equal(outcome, "timeout");
  assert.equal(prints, 1);
  assert.ok(observes >= 2);
});

test("an incomplete observation does not satisfy empty", async () => {
  const frames = [
    snapshot([], silent),
    snapshot([], silent),
    snapshot([], answered),
  ];
  let index = 0;
  let prints = 0;
  const outcome = await watchUntil({
    until: parseUntil("empty"),
    intervalMs: 5,
    timeoutMs: null,
    stopWhenIncomplete: false,
    now: () => 0,
    sleep: async () => {},
    observe: async () => frames[index++]!,
    onSnapshot: () => { prints += 1; },
  });
  assert.equal(outcome, "matched");
  assert.equal(index, 3);
  assert.equal(prints, 2);
});

test("strict stops on the first incomplete observation", async () => {
  let observes = 0;
  const outcome = await watchUntil({
    until: parseUntil("empty"),
    intervalMs: 5,
    timeoutMs: null,
    stopWhenIncomplete: true,
    now: () => 0,
    sleep: async () => {},
    observe: async () => {
      observes += 1;
      return snapshot([], silent);
    },
    onSnapshot: () => {},
  });
  assert.equal(outcome, "incomplete");
  assert.equal(observes, 1);
});

test("abort during the interval stops the loop", async () => {
  const controller = new AbortController();
  let observes = 0;
  const outcome = await watchUntil({
    until: parseUntil("empty"),
    intervalMs: 50,
    timeoutMs: null,
    stopWhenIncomplete: false,
    signal: controller.signal,
    now: () => 0,
    sleep: async () => { controller.abort(); },
    observe: async () => {
      observes += 1;
      return snapshot([{ status: "working" }]);
    },
    onSnapshot: () => {},
  });
  assert.equal(outcome, "aborted");
  assert.equal(observes, 1);
});

test("the first matching snapshot is enough", async () => {
  let observes = 0;
  const outcome = await watchUntil({
    until: parseUntil("empty"),
    intervalMs: 50,
    timeoutMs: 1000,
    stopWhenIncomplete: false,
    now: () => 0,
    sleep: async () => { throw new Error("sleep"); },
    observe: async () => {
      observes += 1;
      return snapshot([]);
    },
    onSnapshot: () => {},
  });
  assert.equal(outcome, "matched");
  assert.equal(observes, 1);
});

test("parseWatchTiming applies the defaults and rejects bad numbers", () => {
  assert.deepEqual(parseWatchTiming(undefined, undefined), { intervalMs: 2000, timeoutMs: 300_000 });
  assert.deepEqual(parseWatchTiming("500", "0"), { intervalMs: 500, timeoutMs: null });
  assert.deepEqual(parseWatchTiming("1500", "2"), { intervalMs: 1500, timeoutMs: 2000 });
  assert.ok("error" in parseWatchTiming("0", undefined));
  assert.ok("error" in parseWatchTiming("fast", undefined));
  assert.ok("error" in parseWatchTiming(undefined, "-1"));
});
