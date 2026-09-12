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
  const flush = async () => { await delay(40); await app.waitUntilRenderFlush(); };
  await flush();
  return {
    frame: () => frame,
    async key(key: string) { input.write(key); await flush(); },
    async close() { app.unmount(); await app.waitUntilExit(); input.destroy(); output.destroy(); },
  };
}

test("a search parameter, result detail, catalog search, and related table form one navigation flow", async () => {
  const calls: Inputs[] = [];
  const ui = await screen([query, { ...query, name: "other" }, table], async (_item, inputs) => { calls.push(inputs); return observation; });
  try {
    assert.equal(calls.length, 0);
    await ui.key("r");
    assert.match(ui.frame(), /Enter search/);
    await ui.key("\r");
    await ui.key("日本語");
    await ui.key("\r");
    await ui.key("r");
    assert.equal(calls[0]!.params.search, "日本語");
    assert.match(ui.frame(), /Incomplete: sample/);
    assert.match(ui.frame(), /scope: root/);
    assert.match(ui.frame(), /received/);
    await ui.key("1");
    await ui.key("\r");
    assert.match(ui.frame(), /Row 1/);
    assert.match(ui.frame(), /nullable: NULL/);
    await ui.key("/");
    await ui.key("other");
    await ui.key("\r");
    assert.doesNotMatch(ui.frame(), /Row 1/);
    assert.match(ui.frame(), /Press r to fetch/);
    await ui.key("4");
    await ui.key("\r");
    assert.match(ui.frame(), /\[Tables\]/);
    assert.match(ui.frame(), /sample_rows/);
    assert.equal(calls.length, 1);
  } finally { await ui.close(); }
});

test("parameter pages stay within a small terminal", async () => {
  const item = { ...query, params: Array.from({ length: 12 }, (_, i) => `p${i}`) };
  const ui = await screen([item], async () => observation, 16);
  try {
    await ui.key("3");
    for (let i = 0; i < 7; i++) await ui.key("\u001b[6~");
    assert.match(ui.frame(), /p11/);
    assert.ok(ui.frame().split("\n").length <= 17, ui.frame());
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
    assert.match(ui.frame(), /Enter scope/);
    await ui.key("\r");
    await ui.key("r");
    assert.equal(chosen, "root");
  } finally { await ui.close(); }
});
