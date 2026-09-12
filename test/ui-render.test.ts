// Exercise keyboard transitions against Ink's renderer and input stream.
// Execution fixtures keep these tests independent of machine provider state.
import assert from "node:assert/strict";
import { test } from "node:test";
import { PassThrough, Writable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { stripVTControlCharacters } from "node:util";
import { createElement } from "react";
import { render } from "ink";
import { Browser } from "../ui/app.ts";
import type { Item } from "../ui/catalog.ts";
import type { Inputs, Observation, observe } from "../ui/execute.ts";

const query: Item = { kind: "query", name: "sample", source: "user", description: "Sample rows", sql: "select :search as value", params: ["search"], tables: ["sample_rows"], columns: [{ name: "value", type: "TEXT", nullable: false, key: false }] };
const table: Item = { ...query, kind: "table", name: "sample_rows", params: [] };
const initial: Inputs = { root: "/workspace", scope: "auto", params: {} };
const observation: Observation = { rows: [{ value: "a long value", nullable: null }], providers: [{ name: "sample", source: "user", ok: 0, observed_at: 1000, ms: 2, error: "Fixture failure" }], scope: "root", params: {}, me: null, trace: [], ms: 2, receivedAt: 1000 };

async function screen(items: Item[], execute: typeof observe, height = 24) {
  let frame = "";
  const output = new Writable({ write(chunk, _encoding, done) { const text = stripVTControlCharacters(String(chunk)); if (text.includes("spacequery")) frame = text; done(); } });
  Object.assign(output, { columns: 100, rows: height, isTTY: true });
  const input = new PassThrough();
  Object.assign(input, { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
  const app = render(createElement(Browser, { items, initial, execute }), { stdout: output as unknown as NodeJS.WriteStream, stdin: input as unknown as NodeJS.ReadStream, debug: true, patchConsole: false, exitOnCtrlC: false });
  const exited = app.waitUntilExit();
  const flush = async () => { await delay(40); await app.waitUntilRenderFlush(); };
  await flush();
  return {
    frame: () => frame,
    async key(key: string) { input.write(key); await flush(); },
    async close() { app.unmount(); await exited; input.destroy(); output.destroy(); },
  };
}

test("a search parameter, result detail, catalog search, and related table form one navigation flow", async () => {
  const calls: Inputs[] = [];
  const ui = await screen([query, { ...query, name: "other" }, table], async (_item, inputs) => { calls.push(inputs); return observation; });
  try {
    assert.equal(calls.length, 0);
    await ui.key("r");
    assert.match(ui.frame(), /search:/);
    await ui.key("日本語");
    await ui.key("\r");
    assert.equal(calls[0]!.params.search, "日本語");
    assert.match(ui.frame(), /Incomplete: sample/);
    assert.match(ui.frame(), /scope: root/);
    assert.match(ui.frame(), /received/);
    await ui.key("2");
    await ui.key("\r");
    assert.match(ui.frame(), /Row 1/);
    assert.match(ui.frame(), /nullable: NULL/);
    await ui.key("/");
    await ui.key("other");
    await ui.key("\r");
    assert.doesNotMatch(ui.frame(), /Row 1/);
    assert.match(ui.frame(), /1:\[Definition\]/);
    await ui.key("1");
    for (let i = 0; i < 10; i++) await ui.key("j");
    await ui.key("\r");
    assert.match(ui.frame(), /\[Tables\]/);
    assert.match(ui.frame(), /sample_rows/);
    assert.equal(calls.length, 1);
  } finally { await ui.close(); }
});

test("required parameters are prompted one at a time before execution", async () => {
  const item = { ...query, params: Array.from({ length: 12 }, (_, i) => `p${i}`) };
  let values: Inputs | undefined;
  const ui = await screen([item], async (_item, inputs) => { values = inputs; return observation; }, 16);
  try {
    await ui.key("r");
    for (let i = 0; i < 12; i++) {
      assert.match(ui.frame(), new RegExp(`p${i}:`));
      assert.equal(values, undefined);
      assert.ok(ui.frame().split("\n").length <= 17, ui.frame());
      await ui.key(String(i));
      await ui.key("\r");
    }
    assert.equal(values!.params.p11, "11");
    assert.match(ui.frame(), /2:\[Results\]/);
  } finally { await ui.close(); }
});

test("quit aborts a pending observation", async () => {
  let aborted = false;
  const ui = await screen([{ ...query, params: [] }], async (_item, _inputs, signal) => new Promise<Observation>((_resolve, reject) => {
    signal!.addEventListener("abort", () => { aborted = true; reject(new Error("cancelled")); }, { once: true });
  }));
  try {
    await ui.key("r");
    assert.match(ui.frame(), /Loading/);
    await ui.key("q");
    assert.equal(aborted, true);
  } finally { await ui.close(); }
});


test("a scope parameter uses the explicit context scope", async () => {
  let chosen: string | undefined;
  const ui = await screen([{ ...query, params: ["scope"] }], async (_item, inputs) => { chosen = inputs.scope; return observation; });
  try {
    await ui.key("r");
    assert.match(ui.frame(), /scope: root/);
    await ui.key("\r");
    assert.equal(chosen, "root");
  } finally { await ui.close(); }
});


test("t toggles catalogs and Esc preserves the selected entry and search", async () => {
  const entries = [query, { ...query, name: "second_query" }, table, { ...table, name: "second_table" }];
  const ui = await screen(entries, async () => observation);
  try {
    for (const [kind, name] of [["Queries", "second_query"], ["Tables", "second_table"]]) {
      if (kind === "Tables") await ui.key("t");
      assert.match(ui.frame(), new RegExp(`\\[${kind}\\]`));
      await ui.key("j");
      assert.ok(ui.frame().includes(`> ${name}`));
      await ui.key("\r");
      await ui.key("\u001b");
      assert.ok(ui.frame().includes(`> ${name}`));
      await ui.key("/");
      await ui.key("second");
      await ui.key("\r");
      await ui.key("\r");
      await ui.key("\u001b");
      assert.match(ui.frame(), /Search: second/);
      assert.ok(ui.frame().includes(`> ${name}`));
    }
    await ui.key("t");
    assert.match(ui.frame(), /\[Queries\]/);
  } finally { await ui.close(); }
});

test("SQL that fits the detail pane keeps its original line", async () => {
  const sql = "select repository_name, branch_name from git_status";
  const ui = await screen([{ ...query, sql }], async () => observation);
  try {
    await ui.key("1");
    assert.ok(ui.frame().split("\n").some((line) => line.includes(sql)), ui.frame());
  } finally { await ui.close(); }
});

test("two detail views keep source status with the result rows", async () => {
  const ui = await screen([{ ...query, params: [] }], async () => observation, 16);
  try {
    assert.match(ui.frame(), /1:\[Definition\] 2:Results/);
    assert.doesNotMatch(ui.frame(), /3:Inputs|4:Related|5:Providers/);
    await ui.key("r");
    await ui.key("s");
    assert.match(ui.frame(), /2:\[Results\]/);
    assert.match(ui.frame(), /Sources \[focused\]/);
    await ui.key("j");
    await ui.key("j");
    assert.match(ui.frame(), /Fixture failure/);
    assert.ok(ui.frame().split("\n").length <= 17, ui.frame());
    await ui.key("s");
    await ui.key("\r");
    assert.match(ui.frame(), /Row 1/);
  } finally { await ui.close(); }
});

test("long SQL lines scroll horizontally without inserted line breaks", async () => {
  const sql = `select '${"x".repeat(100)}TAIL_MARKER' as value`;
  const ui = await screen([{ ...query, sql }], async () => observation);
  try {
    await ui.key("1");
    assert.doesNotMatch(ui.frame(), /TAIL_MARKER/);
    for (let i = 0; i < 18; i++) await ui.key("\u001b[C");
    assert.match(ui.frame(), /TAIL_MARKER/);
    for (let i = 0; i < 18; i++) await ui.key("\u001b[D");
    assert.match(ui.frame(), /select '/);
    assert.doesNotMatch(ui.frame(), /TAIL_MARKER/);
  } finally { await ui.close(); }
});

test("selection opens Definition and execution opens Results without column definitions", async () => {
  const ui = await screen([{ ...query, params: [] }, { ...query, name: "next_query" }, table], async () => observation);
  try {
    assert.match(ui.frame(), /1:\[Definition\] 2:Results/);
    await ui.key("2");
    assert.match(ui.frame(), /No result yet/);
    assert.doesNotMatch(ui.frame(), /Columns|value  TEXT/);
    await ui.key("r");
    assert.match(ui.frame(), /2:\[Results\]/);
    assert.match(ui.frame(), /a long value/);
    assert.doesNotMatch(ui.frame(), /Columns|value  TEXT/);
    await ui.key("\u001b");
    await ui.key("j");
    assert.match(ui.frame(), /1:\[Definition\]/);
    await ui.key("t");
    assert.match(ui.frame(), /1:\[Definition\]/);
  } finally { await ui.close(); }
});

test("context edits and cancelled parameter prompts do not execute", async () => {
  const calls: Inputs[] = [];
  const ui = await screen([query], async (_item, inputs) => { calls.push(inputs); return observation; });
  try {
    await ui.key("r");
    await ui.key("\u001b");
    assert.equal(calls.length, 0);
    await ui.key("c");
    await ui.key("\u0015");
    await ui.key("/another-root");
    await ui.key("\r");
    await ui.key("\u0015");
    await ui.key("invalid");
    await ui.key("\r");
    assert.match(ui.frame(), /Scope must be/);
    await ui.key("\u0015");
    await ui.key("all");
    await ui.key("\r");
    await ui.key("\u0015");
    await ui.key("\r");
    assert.equal(calls.length, 0);
    assert.match(ui.frame(), /root: \/another-root/);
    await ui.key("e");
    await ui.key("query-value");
    await ui.key("\r");
    assert.equal(calls.length, 0);
    await ui.key("r");
    assert.equal(calls[0]!.root, "/another-root");
    assert.equal(calls[0]!.scope, "all");
    assert.equal(calls[0]!.me, "");
    assert.equal(calls[0]!.params.search, "query-value");
  } finally { await ui.close(); }
});

test("accepting unchanged context preserves automatic caller detection", async () => {
  let values: Inputs | undefined;
  const ui = await screen([{ ...query, params: [] }], async (_item, inputs) => { values = inputs; return observation; });
  try {
    await ui.key("c");
    await ui.key("\r");
    await ui.key("\r");
    assert.match(ui.frame(), /me: \(auto\)/);
    await ui.key("\r");
    await ui.key("r");
    assert.equal(values!.me, undefined);
    assert.equal(values!.scope, "auto");
    assert.equal(values!.root, initial.root);
  } finally { await ui.close(); }
});

for (const height of [16, 24]) {
  test(`Sources stays fixed while rows and source lines scroll at height ${height}`, async () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ value: `value-${i}` }));
    const providers = Array.from({ length: 6 }, (_, i) => ({ ...observation.providers[0]!, name: `source-${i}` }));
    const ui = await screen([{ ...query, params: [] }], async () => ({ ...observation, rows, providers }), height);
    try {
      await ui.key("r");
      const sourceLine = () => ui.frame().split("\n").findIndex((line) => line.includes("Sources  ") || line.includes("Sources [focused]"));
      const fixedLine = sourceLine();
      assert.match(ui.frame(), /FAILED source-0/);
      for (let i = 0; i < 10; i++) await ui.key("j");
      assert.match(ui.frame(), /> value-10/);
      assert.equal(sourceLine(), fixedLine);
      await ui.key("s");
      await ui.key("\u001b[6~");
      assert.match(ui.frame(), height === 16 ? /Sources \[focused\]  2\/12/ : /Sources \[focused\]  3\/12/);
      await ui.key("\u001b[5~");
      assert.match(ui.frame(), /Sources \[focused\]  1\/12/);
      for (let i = 0; i < 5; i++) await ui.key("j");
      assert.match(ui.frame(), /> value-10/);
      assert.equal(sourceLine(), fixedLine);
      await ui.key("s");
      await ui.key("\r");
      assert.match(ui.frame(), /Row 11/);
      assert.equal(sourceLine(), fixedLine);
      await ui.key("\u001b");
      assert.match(ui.frame(), /> value-10/);
      assert.ok(ui.frame().split("\n").length <= height + 1, ui.frame());
    } finally { await ui.close(); }
  });
}

test("empty results keep source status visible", async () => {
  const ui = await screen([{ ...query, params: [] }], async () => ({ ...observation, rows: [] }));
  try {
    await ui.key("r");
    assert.match(ui.frame(), /Unknown: a source failed/);
    assert.match(ui.frame(), /FAILED sample/);
    assert.match(ui.frame(), /Sources/);
  } finally { await ui.close(); }
});
