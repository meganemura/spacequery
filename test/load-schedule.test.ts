// These tests prove independent loaders overlap and a dependent waits.
// Injected gates stand in for process and file latency.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Exec, Loader } from "../core/loader.ts";
import { runSql } from "../core/run.ts";
import { repoForRoots } from "./fixture.ts";

const repo = repoForRoots(new Set());

function loader(name: string, tables: readonly string[], after: readonly string[], load: Loader["load"]): Loader {
  return { name, tables, after, load };
}

test("independent loaders run together", async () => {
  const started: string[] = [];
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const make = (name: string, table: string): Loader => loader(name, [table], [], async () => {
    started.push(name);
    await gate;
  });
  const pending = runSql("select count(*) as n from agents, sessions", {
    loaders: [make("herdr", "agents"), make("sessions", "sessions")],
    exec: async () => "",
    repo, env: {}, params: {},
  });
  const overlapped = await Promise.race([
    (async () => {
      while (started.length < 2) await new Promise((resolve) => setTimeout(resolve, 5));
      return true;
    })(),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 500)),
  ]);
  release();
  const result = await pending;
  assert.equal(overlapped, true);
  assert.deepEqual(started.sort(), ["herdr", "sessions"]);
  assert.equal(result.providers.every((provider) => provider.ok === 1), true);
});

test("a loader waits for the loaders it reads, including a failed one", async () => {
  const events: string[] = [];
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const loaders: Loader[] = [
    loader("herdr", ["agents"], [], async () => {
      events.push("herdr-start");
      await gate;
      events.push("herdr-end");
      throw new Error("herdr down");
    }),
    loader("git", ["git_status"], ["herdr"], async () => {
      events.push("git-start");
    }),
  ];
  const pending = runSql("select count(*) as n from git_status", {
    loaders, exec: async () => "", repo, env: {}, params: {},
  });
  setTimeout(release, 20);
  const result = await pending;
  assert.deepEqual(events, ["herdr-start", "herdr-end", "git-start"]);
  assert.equal(result.providers.find((provider) => provider.name === "herdr")?.ok, 0);
  assert.equal(result.providers.find((provider) => provider.name === "git")?.ok, 1);
});

test("overlapping child processes keep the loader that started them", async () => {
  const exec: Exec = (command) => new Promise((resolve) => setTimeout(() => resolve(command), 30));
  const loaders: Loader[] = [
    loader("herdr", ["agents"], [], async (ctx) => { await ctx.exec("herdr", ["api", "snapshot"]); }),
    loader("sessions", ["sessions"], [], async (ctx) => { await ctx.exec("lsof", ["-F", "pn"]); }),
  ];
  const result = await runSql("select count(*) as n from agents, sessions", {
    loaders, exec, repo, env: {}, params: {},
  });
  assert.deepEqual(result.trace.map((row) => [row.provider, row.command]), [
    ["herdr", "herdr"],
    ["sessions", "lsof"],
  ]);
});
