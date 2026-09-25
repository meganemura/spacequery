// Doctor reports provider health through the same load path as a query.
// These tests inject exec so they do not start a real provider tool.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";
import { isProviderEnabled, loadConfig, providersOffByDefault } from "../core/config.ts";
import { doctorDo, runDoctor, userProviderDirectory } from "../core/doctor.ts";
import type { Exec } from "../core/loader.ts";
import type { Repo } from "../core/repo.ts";
import { loaders } from "../spacequery.config.ts";

const execFileAsync = promisify(execFile);
const repo: Repo = { async rootOf() { return null; }, async originOf() { return null; } };
const claudeUsage = JSON.stringify({ is_error: false, local_command: "usage", num_turns: 0, result: "Current session: 10% used · resets 1am" });

function answeringExec(fail = new Set<string>()): Exec {
  return async (command, args) => {
    if (fail.has(command)) throw new Error(`spawn ${command} ENOENT`);
    if (command === "herdr") return JSON.stringify({ result: { snapshot: { agents: [], panes: [], workspaces: [] } } });
    if (command === "mise") return args[0] === "env" ? JSON.stringify({ PATH: "" }) : "{}";
    if (command === "gh") return "[]";
    if (command === "claude") return claudeUsage;
    if (command === "ghq" || command === "git" || command === "docker" || command === "brew" || command === "ps" || command === "lsof") return "";
    throw new Error(`unexpected command ${command}`);
  };
}

function fixture(): { root: string; providers: string; env: Record<string, string>; cleanup: () => void } {
  const home = mkdtempSync(join(tmpdir(), "spacequery-doctor-"));
  const root = join(home, "repo");
  const bin = join(home, "bin");
  const config = join(home, "config");
  mkdirSync(root);
  mkdirSync(bin);
  mkdirSync(join(home, ".claude", "sessions"), { recursive: true });
  return {
    root,
    providers: join(config, "spacequery", "providers"),
    env: {
      HOME: home,
      XDG_CONFIG_HOME: config,
      PATH: `${bin}${delimiter}${join(home, "missing-bin")}`,
    },
    cleanup: () => rmSync(home, { recursive: true, force: true }),
  };
}

test("doctor reports every built-in provider when the toolchain answers", async () => {
  const machine = fixture();
  try {
    const report = await runDoctor({ loaders, root: machine.root, env: machine.env, exec: answeringExec(), repo });
    assert.equal(report.command, "doctor");
    assert.equal(report.ok, 1);
    assert.equal(report.scope, "root");
    assert.equal(report.root, machine.root);
    const packageJson = fileURLToPath(new URL("../package.json", import.meta.url));
    assert.equal(report.version, JSON.parse(readFileSync(packageJson, "utf8")).version);
    assert.equal(report.package, dirname(packageJson));
    const enabled = loaders.map((loader) => loader.name).filter((name) => isProviderEnabled(name, loadConfig(machine.env))).sort();
    assert.deepEqual(report.providers.map((provider) => provider.name), enabled);
    assert.deepEqual(report.providers.map(({ source, ok, error }) => ({ source, ok, error })), enabled.map(() => ({ source: "built-in", ok: 1, error: null })));
    assert.deepEqual(report.disabled_providers, [...providersOffByDefault].sort());
    assert.equal(report.config, loadConfig(machine.env).path);
    assert.deepEqual(report.path, { entries: 2, missing: 1, duplicates: 0 });
    assert.equal(report.user_providers.present, 0);
    assert.equal(report.user_providers.error, null);
    assert.equal(report.user_providers.directory, machine.providers);
    assert.equal(Object.hasOwn(report, "trace"), false);
  } finally {
    machine.cleanup();
  }
});

test("doctor reports a provider that did not answer", async () => {
  const machine = fixture();
  try {
    const report = await runDoctor({ loaders, root: machine.root, env: machine.env, exec: answeringExec(new Set(["herdr"])), repo, trace: true });
    assert.equal(report.ok, 0);
    const herdr = report.providers.find((provider) => provider.name === "herdr");
    const git = report.providers.find((provider) => provider.name === "git");
    assert.equal(herdr?.ok, 0);
    assert.equal(herdr?.error, "spawn herdr ENOENT");
    assert.equal(git?.ok, 1);
    assert.equal(git?.error, null);
    assert.equal(report.trace?.some((row) => row.provider === "herdr" && row.ok === 0), true);
  } finally {
    machine.cleanup();
  }
});

test("doctor does not run a declared user-provider command", async () => {
  const machine = fixture();
  try {
    mkdirSync(machine.providers, { recursive: true });
    writeFileSync(join(machine.providers, "tickets.json"), JSON.stringify({
      tables: { tickets: "create table tickets (id text primary key not null) strict" },
      command: ["ticketctl", "list"],
      scope: "call",
    }));
    const report = await runDoctor({ loaders, root: machine.root, env: machine.env, exec: answeringExec(), repo });
    assert.equal(report.ok, 1);
    assert.deepEqual(report.user_providers, { directory: machine.providers, present: 1, error: null });
    assert.equal(report.providers.some((provider) => provider.source === "user"), false);
  } finally {
    machine.cleanup();
  }
});

test("a user-provider path that is not a directory clears doctor ok", async () => {
  const machine = fixture();
  try {
    mkdirSync(join(machine.env.XDG_CONFIG_HOME!, "spacequery"), { recursive: true });
    writeFileSync(machine.providers, "");
    const status = userProviderDirectory(machine.env);
    assert.equal(status.present, 0);
    assert.match(status.error ?? "", /not a directory/);
    const report = await runDoctor({ loaders, root: machine.root, env: machine.env, exec: answeringExec(), repo });
    assert.equal(report.ok, 0);
    assert.equal(report.providers.every((provider) => provider.ok === 1), true);
    assert.equal(report.user_providers.error, status.error);
  } finally {
    machine.cleanup();
  }
});

test("doctor treats a missing runtag jobs directory as answered and an unreadable one as failed", async () => {
  const machine = fixture();
  try {
    mkdirSync(join(machine.env.XDG_CONFIG_HOME!, "spacequery"), { recursive: true });
    writeFileSync(join(machine.env.XDG_CONFIG_HOME!, "spacequery", "config.json"), JSON.stringify({ providers: { runtag: true } }));
    const missing = await runDoctor({ loaders, root: machine.root, env: machine.env, exec: answeringExec(), repo });
    assert.equal(missing.providers.find((provider) => provider.name === "runtag")?.ok, 1);
    assert.equal(missing.ok, 1);
    const data = join(machine.root, "xdg");
    mkdirSync(join(data, "runtag"), { recursive: true });
    writeFileSync(join(data, "runtag", "jobs"), "");
    const blocked = await runDoctor({
      loaders, root: machine.root, env: { ...machine.env, XDG_DATA_HOME: data }, exec: answeringExec(), repo,
    });
    const runtag = blocked.providers.find((provider) => provider.name === "runtag");
    assert.equal(blocked.ok, 0);
    assert.equal(runtag?.ok, 0);
    assert.match(runtag?.error ?? "", /cannot read/);
  } finally {
    machine.cleanup();
  }
});

test("doctor reports a broken user query file and clears ok", async () => {
  const machine = fixture();
  try {
    const queries = join(machine.env.XDG_CONFIG_HOME!, "spacequery", "queries");
    mkdirSync(queries, { recursive: true });
    writeFileSync(join(queries, "broken.sql"), "select pid, cpu from processes\n");
    const report = await runDoctor({ loaders, root: machine.root, env: machine.env, exec: answeringExec(), repo });
    assert.equal(report.ok, 0);
    assert.equal(report.user_queries.length, 1);
    const broken = report.user_queries[0]!;
    assert.equal(broken.name, "broken");
    assert.equal(broken.ok, 0);
    assert.equal(broken.error, "no such column: cpu");
    assert.match(broken.hint ?? "", /did you mean cpu_pct\?/);
  } finally {
    machine.cleanup();
  }
});

test("doctor reports a good user query file as ok", async () => {
  const machine = fixture();
  try {
    const queries = join(machine.env.XDG_CONFIG_HOME!, "spacequery", "queries");
    mkdirSync(queries, { recursive: true });
    writeFileSync(join(queries, "good.sql"), "select pid from processes\n");
    const report = await runDoctor({ loaders, root: machine.root, env: machine.env, exec: answeringExec(), repo });
    assert.equal(report.ok, 1);
    assert.deepEqual(report.user_queries, [{ name: "good", path: join(queries, "good.sql"), ok: 1, error: null, hint: null }]);
  } finally {
    machine.cleanup();
  }
});

test("doctor help and a refused flag do not observe providers", async () => {
  const help = await execFileAsync(process.execPath, ["cli.ts", "doctor", "--help"], { cwd: process.cwd(), encoding: "utf8" });
  assert.match(help.stdout, /spacequery doctor/);
  const listed = await execFileAsync(process.execPath, ["cli.ts", "--help"], { cwd: process.cwd(), encoding: "utf8" });
  assert.match(listed.stdout, /spacequery doctor/);
  await assert.rejects(
    execFileAsync(process.execPath, ["cli.ts", "doctor", "--scope", "all"], { cwd: process.cwd(), encoding: "utf8" }),
    (error: NodeJS.ErrnoException & { code?: number; stdout?: string }) => {
      assert.equal(error.code, 2);
      const guidance = JSON.parse(error.stdout ?? "") as { error?: string; do?: string };
      assert.match(guidance.error ?? "", /scope/);
      assert.equal(guidance.do, doctorDo);
      return true;
    },
  );
});
