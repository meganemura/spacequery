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

async function screen(items: Item[], execute: typeof observe, height = 24, mouse = true, width = 100) {
  let frame = "";
  let rawOutput = "";
  const output = new Writable({ write(chunk, _encoding, done) { rawOutput += String(chunk); const text = stripVTControlCharacters(String(chunk)); if (text.includes("spacequery")) frame = text; done(); } });
  Object.assign(output, { columns: width, rows: height, isTTY: true });
  const input = new PassThrough();
  Object.assign(input, { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
  const app = render(createElement(Browser, { items, initial, execute, mouse }), { stdout: output as unknown as NodeJS.WriteStream, stdin: input as unknown as NodeJS.ReadStream, debug: true, patchConsole: false, exitOnCtrlC: false });
  const exited = app.waitUntilExit();
  const flush = async () => { await delay(40); await app.waitUntilRenderFlush(); };
  await flush();
  return {
    frame: () => frame,
    raw: () => rawOutput,
    async parts(parts: string[]) { for (const part of parts) input.write(part); await flush(); },
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

function mouseAt(frame: string, label: string, button = 0) {
  const lines = frame.split("\n");
  const y = lines.findIndex((line) => line.includes(label));
  assert.ok(y >= 0, `Missing ${label}: ${frame}`);
  return `\u001b[<${button};${lines[y]!.indexOf(label) + 1};${y + 1}M`;
}

test("mouse clicks switch catalogs, select entries, run, and open rows", async () => {
  let count = 0;
  const ui = await screen([{ ...query, params: [] }, { ...query, name: "next-query", params: [] }, table], async () => { count++; return observation; });
  try {
    await ui.key(mouseAt(ui.frame(), "Tables"));
    assert.match(ui.frame(), /\[Tables\]/);
    await ui.key(mouseAt(ui.frame(), "Queries"));
    assert.match(ui.frame(), /\[Queries\]/);
    await ui.key(mouseAt(ui.frame(), "next-query"));
    assert.match(ui.frame(), /> next-query/);
    await ui.key(mouseAt(ui.frame(), "2:Results"));
    assert.match(ui.frame(), /2:\[Results\]/);
    await ui.key(mouseAt(ui.frame(), "1:Definition"));
    assert.match(ui.frame(), /1:\[Definition\]/);
    assert.equal(count, 0);
    await ui.key(mouseAt(ui.frame(), "[r Run]"));
    assert.equal(count, 1);
    await ui.key(mouseAt(ui.frame(), "a long value"));
    assert.match(ui.frame(), /Row 1/);
  } finally { await ui.close(); }
  assert.ok(ui.raw().includes("\u001b[?1000h\u001b[?1006h"));
  assert.ok(ui.raw().includes("\u001b[?1000l\u001b[?1006l"));
});

for (const height of [16, 24]) {
  test(`mouse wheels target the hovered area at height ${height}`, async () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ value: `value-${i}` }));
    const providers = Array.from({ length: 10 }, (_, i) => ({ ...observation.providers[0]!, name: `source-${i}` }));
    const ui = await screen([{ ...query, params: [] }], async () => ({ ...observation, rows, providers }), height);
    try {
      await ui.key(mouseAt(ui.frame(), "[r Run]"));
      await ui.key(mouseAt(ui.frame(), "value-0", 65));
      assert.match(ui.frame(), /> value-3/);
      await ui.key(mouseAt(ui.frame(), "Sources", 65));
      assert.match(ui.frame(), /Sources \[focused\]  4\/20/);
      assert.match(ui.frame(), /> value-3/);
      await ui.key(mouseAt(ui.frame(), "value-3"));
      assert.match(ui.frame(), /Row 4/);
      assert.ok(ui.frame().split("\n").length <= height + 1);
    } finally { await ui.close(); }
  });
}

test("mouse follows related definitions after scrolling", async () => {
  const ui = await screen([query, table], async () => observation);
  try {
    const wheel = mouseAt(ui.frame(), "SQL", 65);
    for (let i = 0; i < 3; i++) await ui.key(wheel);
    await ui.key(mouseAt(ui.frame(), "sample_rows"));
    assert.match(ui.frame(), /\[Tables\]/);
    assert.match(ui.frame(), /1:\[Definition\]/);
  } finally { await ui.close(); }
});

test("mouse can be disabled and reports cannot enter input fields", async () => {
  let count = 0;
  const ui = await screen([query, table], async () => { count++; return observation; }, 24, false);
  try {
    assert.ok(!ui.raw().includes("\u001b[?1000h"));
    await ui.key(mouseAt(ui.frame(), "Tables"));
    assert.match(ui.frame(), /\[Queries\]/);
    await ui.key("m");
    await ui.key("/");
    await ui.key(mouseAt(ui.frame(), "Tables"));
    await ui.key("\u001b[200~q\u001b[201~");
    assert.match(ui.frame(), /Search: q█/);
    assert.equal(count, 0);
    await ui.key("\u001b");
    const report = mouseAt(ui.frame(), "Tables");
    await ui.parts([report.slice(0, 4), report.slice(4)]);
    assert.match(ui.frame(), /\[Tables\]/);
    await ui.key("m");
    assert.match(ui.frame(), /mouse:off/);
    await ui.key(mouseAt(ui.frame(), "Queries"));
    assert.match(ui.frame(), /\[Tables\]/);
  } finally { await ui.close(); }
});

test("mouse tabs and Run remain usable in a 60-column terminal", async () => {
  const ui = await screen([{ ...query, params: [] }, table], async () => observation, 16, true, 60);
  try {
    await ui.key(mouseAt(ui.frame(), "Tables"));
    assert.match(ui.frame(), /\[Tables\]/);
    await ui.key(mouseAt(ui.frame(), "Queries"));
    await ui.key(mouseAt(ui.frame(), "[r Run]"));
    assert.match(ui.frame(), /2:\[Results\]/);
    assert.ok(ui.frame().split("\n").length <= 17, ui.frame());
  } finally { await ui.close(); }
});

test("coalesced wheel reports preserve each scroll step", async () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({ value: `value-${i}` }));
  const ui = await screen([{ ...query, params: [] }], async () => ({ ...observation, rows }));
  try {
    await ui.key("r");
    const wheel = mouseAt(ui.frame(), "value-0", 65);
    await ui.parts([wheel + wheel + wheel]);
    assert.match(ui.frame(), /> value-9/);
  } finally { await ui.close(); }
});

test("blank space cannot activate a hidden related entry", async () => {
  const ui = await screen([query, table], async () => observation, 16);
  try {
    const wheel = mouseAt(ui.frame(), "SQL", 65);
    for (let i = 0; i < 3; i++) await ui.key(wheel);
    assert.doesNotMatch(ui.frame(), /sample_rows/);
    const match = /;(\d+);(\d+)M/.exec(wheel)!;
    await ui.key(`\u001b[<0;${match[1]};${Number(match[2]) + 1}M`);
    assert.match(ui.frame(), /\[Queries\]/);
  } finally { await ui.close(); }
});

const viewHeader = (frame: string) => frame.split("\n").find((line) => line.includes("1:"))!;

test("horizontal indicators disappear at text edges and support clicks", async () => {
  const ui = await screen([{ ...query, sql: `select '${"x".repeat(95)}TAIL'` }], async () => observation);
  try {
    assert.match(viewHeader(ui.frame()), /→/);
    assert.doesNotMatch(viewHeader(ui.frame()), /←/);
    await ui.key(mouseAt(ui.frame(), "→"));
    assert.match(viewHeader(ui.frame()), /←→/);
    for (let i = 0; i < 15; i++) await ui.key("\u001b[C");
    assert.match(viewHeader(ui.frame()), /←/);
    assert.doesNotMatch(viewHeader(ui.frame()), /→/);
    assert.match(ui.frame(), /TAIL/);
    for (let i = 0; i < 15; i++) await ui.key("\u001b[D");
    assert.doesNotMatch(viewHeader(ui.frame()), /←/);
  } finally { await ui.close(); }
});

test("fitting definitions have no horizontal indicators", async () => {
  const ui = await screen([query], async () => observation);
  try {
    assert.doesNotMatch(viewHeader(ui.frame()), /←|→/);
    await ui.key("1");
    await ui.key("\u001b[C");
    assert.match(ui.frame(), /select :search as value/);
    assert.doesNotMatch(viewHeader(ui.frame()), /←|→/);
  } finally { await ui.close(); }
});

test("Results indicators follow hidden columns and expanded values", async () => {
  const rows = [{ a: "界".repeat(40), b: 2, c: 3, d: 4, e: 5 }];
  const ui = await screen([{ ...query, params: [] }], async () => ({ ...observation, rows }));
  try {
    await ui.key("r");
    assert.match(viewHeader(ui.frame()), /→/);
    await ui.key("\u001b[C");
    assert.match(viewHeader(ui.frame()), /←→/);
    await ui.key("\u001b[C");
    assert.match(viewHeader(ui.frame()), /←/);
    assert.doesNotMatch(viewHeader(ui.frame()), /→/);
    await ui.key("\r");
    assert.match(viewHeader(ui.frame()), /→/);
    assert.doesNotMatch(viewHeader(ui.frame()), /←/);
    await ui.key("s");
    assert.match(ui.frame().split("\n").find((line) => line.includes("Sources"))!, /Sources/);
  } finally { await ui.close(); }
});

test("wide text and Sources show independent horizontal indicators at 60 columns", async () => {
  const providers = [{ ...observation.providers[0]!, error: "界".repeat(50) }];
  const ui = await screen([{ ...query, params: [], sql: "界".repeat(25) }], async () => ({ ...observation, providers }), 24, true, 60);
  try {
    assert.match(viewHeader(ui.frame()), /→/);
    await ui.key("r");
    const sourcesHeader = () => ui.frame().split("\n").find((line) => line.includes("Sources"))!;
    assert.match(sourcesHeader(), /→/);
    await ui.key("s");
    for (let i = 0; i < 12; i++) await ui.key("\u001b[C");
    assert.match(sourcesHeader(), /←/);
    assert.doesNotMatch(sourcesHeader(), /→/);
    assert.ok(ui.frame().split("\n").length <= 25, ui.frame());
  } finally { await ui.close(); }
});

for (const glyph of ["ｶﾞ", "1⃣", "𛀀", "👨‍👩‍👧‍👦"]) {
  test(`horizontal bounds expose the complete suffix for ${glyph}`, async () => {
    const ui = await screen([{ ...query, sql: glyph.repeat(20) + "TAIL" }], async () => observation, 24, true, 60);
    try {
      assert.match(viewHeader(ui.frame()), /→/);
      await ui.key("1");
      for (let i = 0; i < 10; i++) await ui.key("\u001b[C");
      assert.doesNotMatch(viewHeader(ui.frame()), /→/);
      const tail = ui.frame().split("\n").find((line) => line.includes("TAIL"));
      assert.ok(tail, ui.frame());
      assert.doesNotMatch(tail, /…/);
    } finally { await ui.close(); }
  });
}

test("selected related links expose their suffix before the right arrow disappears", async () => {
  const name = "related_" + "x".repeat(70) + "TAIL";
  const ui = await screen([{ ...query, tables: [name] }, { ...table, name }], async () => observation);
  try {
    await ui.key("1");
    for (let i = 0; i < 10; i++) await ui.key("j");
    for (let i = 0; i < 10; i++) await ui.key("\u001b[C");
    assert.doesNotMatch(viewHeader(ui.frame()), /→/);
    const tail = ui.frame().split("\n").find((line) => line.includes("TAIL"));
    assert.ok(tail, ui.frame());
    assert.doesNotMatch(tail, /…/);
  } finally { await ui.close(); }
});

test("Definition scrollbar follows scrolling and its track jumps to the end", async () => {
  const sql = Array.from({ length: 40 }, (_, i) => `-- line ${i}`).join("\n");
  const ui = await screen([{ ...query, sql }], async () => observation);
  try {
    assert.match(ui.frame(), /┃/);
    const before = ui.frame().split("\n").findIndex((line) => line.includes("┃"));
    const down = mouseAt(ui.frame(), "↓");
    await ui.key("1");
    await ui.key("\u001b[6~");
    const after = ui.frame().split("\n").findIndex((line) => line.includes("┃"));
    assert.ok(after > before);
    const match = /;(\d+);(\d+)M/.exec(down)!;
    await ui.key(`\u001b[<0;${match[1]};${Number(match[2]) - 1}M`);
    assert.match(ui.frame(), /\(none\)/);
    assert.doesNotMatch(ui.frame().split("\n").slice(3, 18).join("\n"), /↓/);
  } finally { await ui.close(); }
});

test("result scrollbar arrows move the viewport without opening a row", async () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({ value: `value-${i}` }));
  const ui = await screen([{ ...query, params: [] }], async () => ({ ...observation, rows, providers: [] }));
  try {
    await ui.key("r");
    await ui.key(mouseAt(ui.frame(), "↓"));
    assert.match(ui.frame(), /> value-6/);
    assert.doesNotMatch(ui.frame(), /Row 7/);
    await ui.key(mouseAt(ui.frame(), "↑"));
    assert.match(ui.frame(), /> value-0/);
  } finally { await ui.close(); }
});

test("catalog pagination stays stable when the detail view changes", async () => {
  const items = Array.from({ length: 30 }, (_, i) => ({ ...query, name: `query-${i}`, params: [] }));
  const ui = await screen(items, async () => observation);
  try {
    for (let i = 0; i < 10; i++) await ui.key("j");
    const catalog = () => ui.frame().split("\n").filter((line) => line.startsWith("│")).map((line) => line.split("│")[1]).join("\n");
    const before = catalog();
    await ui.key("2");
    assert.equal(catalog(), before);
    await ui.key("r");
    assert.equal(catalog(), before);
    await ui.key("\u001b");
    await ui.key("\u001b[6~");
    assert.match(ui.frame(), /> query-23/);
  } finally { await ui.close(); }
});

test("long input retains its cursor and shows the final action separately", async () => {
  const ui = await screen([query], async () => observation, 16, true, 60);
  try {
    await ui.key(mouseAt(ui.frame(), "root:"));
    await ui.key("\u0015");
    await ui.key("/workspace/".repeat(15) + "TAIL");
    assert.match(ui.frame(), /root: ….*TAIL█/);
    assert.match(ui.frame(), /Enter Next/);
    await ui.key("\u001b");
    await ui.key("r");
    assert.match(ui.frame(), /Enter Run query/);
    await ui.key("\u001b");
    await ui.key(mouseAt(ui.frame(), "Search:"));
    assert.match(ui.frame(), /Enter Apply filter/);
    assert.ok(ui.frame().split("\n").length <= 17, ui.frame());
  } finally { await ui.close(); }
});

test("execution failures have a recovery state instead of the unexecuted hint", async () => {
  const ui = await screen([{ ...query, params: [] }], async () => { throw new Error("Fixture execution error"); });
  try {
    await ui.key("r");
    assert.match(ui.frame(), /Execution failed/);
    assert.match(ui.frame(), /Fixture execution error/);
    assert.match(ui.frame(), /press r to retry/);
    assert.doesNotMatch(ui.frame(), /No result yet/);
  } finally { await ui.close(); }
});

test("compact Results reserves space for scope and receipt time", async () => {
  const ui = await screen([{ ...query, name: "repository-config-files-in-scope", params: [] }], async () => observation, 16, true, 60);
  try {
    await ui.key("r");
    const summary = ui.frame().split("\n").find((line) => line.includes("received"));
    assert.ok(summary, ui.frame());
    assert.match(summary, /scope: root/);
    assert.match(summary, /received \d{2}:\d{2}:\d{2}/);
    assert.match(summary, /…/);
  } finally { await ui.close(); }
});

for (const width of [60, 100, 160]) {
  test(`pane boundaries stay fixed while definitions scroll at width ${width}`, async () => {
    const sql = `select '${"x".repeat(240)}' as value\n${Array.from({ length: 20 }, () => "-- short").join("\n")}`;
    const ui = await screen([{ ...query, sql }], async () => observation, 24, true, width);
    const boundary = () => {
      const border = ui.frame().split("\n").find((line) => line.startsWith("╭"));
      assert.ok(border, ui.frame());
      return [border.indexOf("╮"), border.lastIndexOf("╭"), border.length];
    };
    try {
      await ui.key("1");
      const before = boundary();
      const leftWidth = Math.max(20, Math.min(34, Math.floor(width * 0.29)));
      assert.deepEqual(before, [leftWidth - 1, leftWidth, width]);
      for (let i = 0; i < 4; i++) await ui.key("\u001b[B");
      assert.deepEqual(boundary(), before, "vertical scrolling moved the pane boundary");
      for (let i = 0; i < 12; i++) await ui.key("\u001b[C");
      assert.deepEqual(boundary(), before, "horizontal scrolling moved the pane boundary");
    } finally { await ui.close(); }
  });
}


test("catalog, result, and source scrolling keep the pane boundary fixed", async () => {
  const items = Array.from({ length: 30 }, (_, index) => ({ ...query, name: `query_${index}_${"x".repeat(index * 3)}`, params: [] }));
  const rows = Array.from({ length: 30 }, (_, index) => ({ value: "x".repeat(index * 40), other: index }));
  const providers = Array.from({ length: 10 }, (_, index) => ({ ...observation.providers[0]!, error: "x".repeat(index * 50) }));
  const ui = await screen(items, async () => ({ ...observation, rows, providers }));
  const fixed = () => {
    const border = ui.frame().split("\n").find((line) => line.startsWith("╭"));
    assert.ok(border, ui.frame());
    const leftWidth = Math.floor(100 * 0.29);
    assert.equal(border.indexOf("╮"), leftWidth - 1);
    assert.equal(border.lastIndexOf("╭"), leftWidth);
    assert.equal(border.length, 100);
  };
  try {
    fixed();
    for (let i = 0; i < 3; i++) { await ui.key("\u001b[6~"); fixed(); }
    await ui.key("r"); fixed();
    for (let i = 0; i < 3; i++) { await ui.key("\u001b[6~"); fixed(); }
    await ui.key("\r"); fixed();
    await ui.key("\u001b[C"); fixed();
    await ui.key("\u001b");
    await ui.key("s"); fixed();
    for (let i = 0; i < 3; i++) { await ui.key("\u001b[6~"); fixed(); }
    await ui.key("\u001b[C"); fixed();
  } finally { await ui.close(); }
});
