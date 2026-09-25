// These tests prove that the command line exposes the catalog and rejects bad names.
// Query tests use --sql or a static repository, so they do not start a real provider tool.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { catalog, reports } from "../catalog.ts";
import { exitCodeFor, reportJson, watchExitCode } from "../cli.ts";
import { callCounts, recordCall } from "../core/calls.ts";
import type { ReportResult } from "../core/run.ts";

const execFileAsync = promisify(execFile);

test("help prints the short list and --all prints every enabled query", async () => {
  const root = mkdtempSync(join(tmpdir(), "spacequery-cli-help-"));
  const env = { ...process.env, HOME: root, XDG_CONFIG_HOME: join(root, "config"), XDG_STATE_HOME: join(root, "state") };
  try {
    const { stdout } = await execFileAsync(process.execPath, ["cli.ts", "--help"], { cwd: process.cwd(), encoding: "utf8", env });
    const names = stdout.split("\n").filter((line) => line.startsWith("  ") && !line.trim().startsWith("spacequery")).map((line) => line.trim().split(/\s+/)[0]!);
    const queries = names.filter((name) => name !== "here" && name !== "work" && name !== "dependency-report");
    assert.ok(queries.length <= 25, queries.join(","));
    assert.ok(queries.includes("in-dir"));
    assert.equal(queries.includes("issues"), false);
    assert.equal(queries.includes("runs-in-dir"), false);
    assert.match(stdout, /--help --all/);
    assert.match(stdout, /beads, beads_ready, brew, headsign, runtag/);
    assert.equal(names.includes("here"), true);
    assert.equal(names.includes("dependency-report"), false);
    const full = await execFileAsync(process.execPath, ["cli.ts", "--help", "--all"], { cwd: process.cwd(), encoding: "utf8", env });
    assert.match(full.stdout, /^ {2}repos /m);
    assert.match(full.stdout, /^ {2}cursor-agents /m);
    assert.doesNotMatch(full.stdout, /^ {2}issues /m);
    mkdirSync(join(root, "config", "spacequery"), { recursive: true });
    writeFileSync(join(root, "config", "spacequery", "config.json"), JSON.stringify({
      providers: { beads: true, brew: true, headsign: true, runtag: true },
    }));
    const enabled = await execFileAsync(process.execPath, ["cli.ts", "--help", "--all"], { cwd: process.cwd(), encoding: "utf8", env });
    for (const name of Object.keys(catalog)) assert.match(enabled.stdout, new RegExp(`^ {2}${name} `, "m"));
    for (const name of Object.keys(reports)) assert.match(enabled.stdout, new RegExp(`^ {2}${name} `, "m"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("JSON help is short by default and --all carries the catalog fields", async () => {
  const root = mkdtempSync(join(tmpdir(), "spacequery-cli-json-"));
  const env = { ...process.env, HOME: root, XDG_CONFIG_HOME: join(root, "config"), XDG_STATE_HOME: join(root, "state") };
  try {
    const { stdout } = await execFileAsync(process.execPath, ["cli.ts", "--help", "--json"], { cwd: process.cwd(), encoding: "utf8", env });
    const document = JSON.parse(stdout) as {
      mode: string;
      disabled_providers: string[];
      queries: { name: string; description: string; purpose: string; group: string; default: boolean; enabled: boolean; requires: string[]; params: string[]; source: string }[];
      reports: { name: string; sections?: [string, string][]; requires: string[]; enabled: boolean; source: string }[];
    };
    assert.equal(document.mode, "short");
    assert.deepEqual(document.disabled_providers, ["beads", "beads_ready", "brew", "headsign", "runtag"]);
    assert.equal(document.queries.some((query) => query.name === "issues"), false);
    const agents = document.queries.find((query) => query.name === "agents");
    assert.equal(agents?.source, "built-in");
    assert.equal(agents?.group, "Agents");
    assert.equal(agents?.purpose, catalog.agents?.purpose);
    assert.equal(agents?.description, catalog.agents?.description);
    assert.deepEqual(agents?.params, []);
    assert.equal(agents?.default, true);
    assert.equal(agents?.enabled, true);
    assert.deepEqual(agents?.requires, ["herdr"]);
    assert.deepEqual(document.reports.map((report) => report.name), ["here", "work"]);
    assert.equal(document.reports[0]?.enabled, true);
    assert.ok(document.reports[0]?.requires.includes("herdr"));
    const full = JSON.parse((await execFileAsync(process.execPath, ["cli.ts", "--help", "--json", "--all"], { cwd: process.cwd(), encoding: "utf8", env })).stdout) as { mode: string; queries: { name: string }[] };
    assert.equal(full.mode, "all");
    assert.ok(full.queries.length > document.queries.length);
    await assert.rejects(
      execFileAsync(process.execPath, ["cli.ts", "--help", "--all", "--short"], { cwd: process.cwd(), encoding: "utf8", env }),
      (error: NodeJS.ErrnoException & { code?: number }) => error.code === 2,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("report JSON exposes section_status in the CLI envelope", () => {
  const result: ReportResult = {
    sections: { agents: [] },
    sectionStatus: {
      agents: { providers: ["herdr"], ok: 0, errors: [{ name: "herdr", error: "spawn herdr ENOENT" }] },
    },
    providers: [{ name: "herdr", source: "built-in", ok: 0, observed_at: 1, ms: 2, error: "spawn herdr ENOENT" }],
    ms: 3,
    trace: [{ provider: "herdr", command: "herdr", path: null, args: ["api", "snapshot"], cwd: null, started_ms: 0.1, ms: 2, ok: 0 }],
    scope: "root",
    me: null,
    params: { root: "/workspace/example" },
    warnings: [],
  };

  const envelope = reportJson("here", result);
  assert.equal(Object.hasOwn(envelope, "trace"), false);
  assert.deepEqual(envelope, {
    report: "here",
    root: "/workspace/example",
    scope: "root",
    me: null,
    params: { root: "/workspace/example" },
    ms: 3,
    sections: { agents: [] },
    section_status: {
      agents: { providers: ["herdr"], ok: 0, errors: [{ name: "herdr", error: "spawn herdr ENOENT" }] },
    },
    providers: [{ name: "herdr", source: "built-in", ok: 0, observed_at: 1, ms: 2, error: "spawn herdr ENOENT" }],
  });
  assert.deepEqual(reportJson("here", result, true).trace, result.trace);
  assert.equal(Object.hasOwn(envelope, "definition"), false);
  const board = reportJson("work", result);
  assert.deepEqual(board.definition, {
    sections: reports.work.sections,
    default_scope: "all",
    refresh: reports.work.refresh,
  });
});

test("expect-empty returns 3 after it prints rows", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, ["cli.ts", "--sql", "select 1 as x", "--expect-empty"], { cwd: process.cwd(), encoding: "utf8" }),
    (error: NodeJS.ErrnoException & { code?: number; stdout?: string }) => {
      assert.equal(error.code, 3);
      const { ms, ...result } = JSON.parse(error.stdout!);
      assert.equal(typeof ms, "number");
      assert.deepEqual(result, { query: "sql", scope: "agents", me: null, params: {}, row_count: 1, rows: [{ x: 1 }], providers: [] });
      return true;
    },
  );
});

test("expect-empty returns 0 for an empty result", async () => {
  const { stdout } = await execFileAsync(process.execPath, ["cli.ts", "--sql", "select 1 as x where 0", "--expect-empty"], { cwd: process.cwd(), encoding: "utf8" });
  const { ms, ...result } = JSON.parse(stdout);
  assert.equal(typeof ms, "number");
  assert.deepEqual(result, { query: "sql", scope: "agents", me: null, params: {}, row_count: 0, rows: [], providers: [] });
});

test("the root scope is accepted", async () => {
  const { stdout } = await execFileAsync(process.execPath, ["cli.ts", "--sql", "select 1 as x", "--scope", "root"], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(JSON.parse(stdout).scope, "root");
});

test("an invalid scope exits with status 2", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, ["cli.ts", "--sql", "select 1 as x", "--scope", "invalid"], { cwd: process.cwd(), encoding: "utf8" }),
    (error: NodeJS.ErrnoException & { code?: number }) => error.code === 2,
  );
});

test("root static queries discover a root without starting repository tools", async () => {
  const root = mkdtempSync(join(tmpdir(), "spacequery-cli-static-"));
  const bin = join(root, "bin");
  const nested = join(root, "packages", "app");
  const marker = join(root, "process-marker");
  mkdirSync(join(root, ".git"));
  mkdirSync(bin);
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { postinstall: `touch ${marker}` }, dependencies: { alpha: "^1" } }));
  for (const command of ["git", "mise", "npm", "node", "ruby", "bundle"]) {
    const path = join(bin, command);
    writeFileSync(path, `#!/bin/sh\nprintf '%s\\n' ${command} >> '${marker}'\nexit 91\n`);
    chmodSync(path, 0o755);
  }
  try {
    for (const name of ["repository-versions", "repository-config-files"]) {
      const { stdout } = await execFileAsync(process.execPath, [join(process.cwd(), "cli.ts"), name], {
        cwd: nested,
        encoding: "utf8",
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, XDG_STATE_HOME: join(root, "state") },
      });
      const result = JSON.parse(stdout);
      assert.equal(result.params.root, realpathSync(root));
      assert.ok(result.rows.length > 0);
    }
    assert.throws(() => readFileSync(marker), { code: "ENOENT" });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a linked worktree remains one selected static query root", async () => {
  const base = mkdtempSync(join(tmpdir(), "spacequery-cli-worktree-"));
  const main = join(base, "main");
  const linked = join(base, "linked");
  const gitdir = join(main, ".git", "worktrees", "linked");
  mkdirSync(gitdir, { recursive: true });
  mkdirSync(linked);
  writeFileSync(join(linked, ".git"), `gitdir: ${gitdir}\n`);
  writeFileSync(join(gitdir, "commondir"), "../..\n");
  writeFileSync(join(linked, "package.json"), JSON.stringify({ dependencies: { alpha: "^1" } }));
  try {
    const { stdout } = await execFileAsync(process.execPath, [join(process.cwd(), "cli.ts"), "repository-versions"], {
      cwd: linked, encoding: "utf8", env: { ...process.env, XDG_STATE_HOME: join(base, "state") },
    });
    const result = JSON.parse(stdout);
    assert.equal(result.params.root, realpathSync(linked));
    assert.ok(result.rows.some((row: { name: string }) => row.name === "alpha"));
    assert.deepEqual(result.providers.map(({ name, ok }: { name: string; ok: number }) => [name, ok]), [["repository_versions", 1]]);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("the command runs through a symlink to cli.ts, as the npm bin is", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spacequery-cli-symlink-"));
  const link = join(dir, "spacequery");
  symlinkSync(join(process.cwd(), "cli.ts"), link);
  try {
    const { stdout } = await execFileAsync(process.execPath, [link, "--help"], { cwd: process.cwd(), encoding: "utf8" });
    assert.match(stdout, /^usage: spacequery/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("root static queries reject a wider scope before loading providers", async () => {
  for (const name of ["repository-versions", "repository-config-files"]) {
    await assert.rejects(
      execFileAsync(process.execPath, ["cli.ts", name, "--scope", "agents"], { cwd: process.cwd(), encoding: "utf8" }),
      (error: NodeJS.ErrnoException & { code?: number; stderr?: string }) => error.code === 2 && /only supports --scope root/.test(error.stderr ?? ""),
    );
  }
});

test("wide dependency commands reject root scope before loading providers", async () => {
  for (const name of ["repository-version-sources", "shared-dependencies", "shared-dependency-details", "dependency-coverage", "repository-config-files-in-scope", "dependency-report"]) {
    await assert.rejects(
      execFileAsync(process.execPath, ["cli.ts", name, "--scope", "root"], { cwd: process.cwd(), encoding: "utf8" }),
      (error: NodeJS.ErrnoException & { code?: number; stderr?: string }) => error.code === 2 && /supports --scope agents or all/.test(error.stderr ?? ""),
    );
  }
});

test("dependency-report gates expect-empty on shared dependencies", async () => {
  const base = mkdtempSync(join(tmpdir(), "spacequery-cli-dependencies-"));
  const first = join(base, "first");
  const second = join(base, "second");
  const bin = join(base, "bin");
  mkdirSync(first);
  mkdirSync(second);
  mkdirSync(bin);
  mkdirSync(join(first, ".git"));
  mkdirSync(join(second, ".git"));
  writeFileSync(join(first, "package.json"), JSON.stringify({ dependencies: { alpha: "^1" } }));
  writeFileSync(join(second, "package.json"), JSON.stringify({ dependencies: { alpha: "^2" } }));
  const herdr = join(bin, "herdr");
  const snapshot = (roots: string[]) => JSON.stringify({ result: { snapshot: { agents: roots.map((cwd, index) => ({ pane_id: String(index), agent: "codex", agent_status: "working", cwd })) } } });
  const writeHerdr = (roots: string[]) => {
    writeFileSync(herdr, `#!/bin/sh\nprintf '%s\\n' '${snapshot(roots)}'\n`);
    chmodSync(herdr, 0o755);
  };
  const options = { cwd: process.cwd(), encoding: "utf8" as const, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, XDG_STATE_HOME: join(base, "state") } };
  try {
    writeHerdr([first, second]);
    await assert.rejects(
      execFileAsync(process.execPath, ["cli.ts", "dependency-report", "--expect-empty"], options),
      (error: NodeJS.ErrnoException & { code?: number; stdout?: string }) => error.code === 3 && JSON.parse(error.stdout!).sections.shared.length === 1,
    );
    writeHerdr([first]);
    const { stdout } = await execFileAsync(process.execPath, ["cli.ts", "dependency-report", "--expect-empty"], options);
    const result = JSON.parse(stdout);
    assert.equal(result.sections.shared.length, 0);
    assert.ok(result.sections.coverage.length > 0);
    assert.ok(result.sections.sources.length > 0);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

function resultForExitCode(rows: number, oks: readonly number[]) {
  return {
    rows: Array.from({ length: rows }, () => ({})),
    providers: oks.map((ok, index) => ({ name: `provider-${index}`, source: "built-in" as const, ok, observed_at: 0, ms: 0, error: ok === 0 ? "failed" : null })),
  };
}

test("exitCodeFor gives strict provider failure priority", () => {
  assert.equal(exitCodeFor(resultForExitCode(1, [0]), { expectEmpty: true, strict: true }), 4);
  assert.equal(exitCodeFor(resultForExitCode(1, [1]), { expectEmpty: true, strict: true }), 3);
  assert.equal(exitCodeFor(resultForExitCode(0, [0]), { expectEmpty: false, strict: true }), 4);
  assert.equal(exitCodeFor(resultForExitCode(0, [1]), { expectEmpty: false, strict: false }), 0);
});

test("exitCodeFor follows the gate contract for generated results", () => hegel.test((tc) => {
  const rows = tc.draw(gs.integers({ minValue: 0, maxValue: 20 }));
  const oks = tc.draw(gs.arrays(gs.booleans().map((ok) => ok ? 1 : 0), { maxSize: 20 }));
  const flags = { expectEmpty: tc.draw(gs.booleans()), strict: tc.draw(gs.booleans()) };
  const actual = exitCodeFor(resultForExitCode(rows, oks), flags);
  const failed = oks.some((ok) => ok === 0);

  if (flags.strict && failed) assert.equal(actual, 4);
  else if (flags.expectEmpty && rows > 0) assert.equal(actual, 3);
  else assert.equal(actual, 0);
}));

test("help documents watch, --until, and the timeout exit", async () => {
  const { stdout } = await execFileAsync(process.execPath, ["cli.ts", "--help"], { cwd: process.cwd(), encoding: "utf8" });
  assert.match(stdout, /spacequery watch <query>/);
  assert.match(stdout, /--until empty matches zero rows/);
  assert.match(stdout, /agent_status=idle\|blocked/);
  assert.match(stdout, /claude-sessions uses status/);
  assert.match(stdout, /Exit 0 when --until matches, 5 on timeout, 130 on SIGINT or SIGTERM/);
  assert.match(stdout, /--interval defaults to 2000 milliseconds/);
  assert.match(stdout, /--timeout defaults to 300 seconds/);
});

test("watch prints one NDJSON line and exits 0 when --until matches", async () => {
  const state = mkdtempSync(join(tmpdir(), "spacequery-watch-match-"));
  try {
    const { stdout } = await execFileAsync(process.execPath, ["cli.ts", "watch", "--sql", "select 'idle' as status", "--until", "status=idle", "--timeout", "5"], {
      cwd: process.cwd(), encoding: "utf8", env: { ...process.env, XDG_STATE_HOME: state },
    });
    const lines = stdout.trim().split("\n");
    assert.equal(lines.length, 1);
    const { ms, ...result } = JSON.parse(lines[0]!);
    assert.equal(typeof ms, "number");
    assert.deepEqual(result, { query: "sql", scope: "agents", me: null, params: {}, row_count: 1, rows: [{ status: "idle" }], providers: [] });
    const calls = readFileSync(join(state, "spacequery", "calls.jsonl"), "utf8").trim().split("\n");
    assert.equal(calls.length, 1);
    assert.equal(JSON.parse(calls[0]!).name, "sql");
  } finally { rmSync(state, { recursive: true, force: true }); }
});

test("watch exits 5 on timeout without repeating the snapshot", async () => {
  const state = mkdtempSync(join(tmpdir(), "spacequery-watch-timeout-"));
  try {
    await assert.rejects(
      execFileAsync(process.execPath, ["cli.ts", "watch", "--sql", "select 'working' as agent_status", "--until", "agent_status=idle", "--interval", "200", "--timeout", "1"], {
        cwd: process.cwd(), encoding: "utf8", env: { ...process.env, XDG_STATE_HOME: state },
      }),
      (error: NodeJS.ErrnoException & { code?: number; stdout?: string; stderr?: string }) => {
        assert.equal(error.code, 5);
        assert.match(error.stderr ?? "", /timed out before --until matched/);
        const lines = (error.stdout ?? "").trim().split("\n");
        assert.equal(lines.length, 1);
        assert.deepEqual(JSON.parse(lines[0]!).rows, [{ agent_status: "working" }]);
        return true;
      },
    );
  } finally { rmSync(state, { recursive: true, force: true }); }
});

test("watch working does not treat a missing provider as empty", async () => {
  const state = mkdtempSync(join(tmpdir(), "spacequery-watch-working-"));
  const bin = join(state, "bin");
  mkdirSync(bin);
  const env = { ...process.env, PATH: bin, XDG_STATE_HOME: state };
  try {
    await assert.rejects(
      execFileAsync(process.execPath, ["cli.ts", "watch", "working", "--until", "empty", "--strict", "--timeout", "5"], {
        cwd: process.cwd(), encoding: "utf8", env,
      }),
      (error: NodeJS.ErrnoException & { code?: number; stdout?: string }) => {
        assert.equal(error.code, 4);
        const body = JSON.parse(error.stdout ?? "");
        assert.equal(body.query, "working");
        assert.equal(body.row_count, 0);
        assert.equal(body.providers.find((provider: { name: string }) => provider.name === "herdr").ok, 0);
        return true;
      },
    );
    await assert.rejects(
      execFileAsync(process.execPath, ["cli.ts", "watch", "working", "--until", "empty", "--interval", "200", "--timeout", "1"], {
        cwd: process.cwd(), encoding: "utf8", env,
      }),
      (error: NodeJS.ErrnoException & { code?: number; stdout?: string }) => {
        assert.equal(error.code, 5);
        const lines = (error.stdout ?? "").trim().split("\n");
        assert.equal(lines.length, 1);
        const body = JSON.parse(lines[0]!);
        assert.equal(body.query, "working");
        assert.equal(body.row_count, 0);
        assert.equal(body.providers.find((provider: { name: string }) => provider.name === "herdr").ok, 0);
        return true;
      },
    );
  } finally { rmSync(state, { recursive: true, force: true }); }
});

test("watch exits 130 on SIGINT", async () => {
  const state = mkdtempSync(join(tmpdir(), "spacequery-watch-signal-"));
  const child = spawn(process.execPath, ["cli.ts", "watch", "--sql", "select 1 as x", "--until", "empty", "--interval", "5000", "--timeout", "30"], {
    cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, XDG_STATE_HOME: state },
  });
  let stdout = "";
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`watch did not print before SIGINT: ${stdout}`));
      }, 10_000);
      child.stdout!.setEncoding("utf8");
      child.stdout!.on("data", (chunk: string) => {
        stdout += chunk;
        if (stdout.includes("\n")) child.kill("SIGINT");
      });
      child.on("exit", (status) => {
        clearTimeout(timer);
        resolve(status);
      });
    });
    assert.equal(code, 130);
    assert.equal(JSON.parse(stdout).rows[0].x, 1);
  } finally { rmSync(state, { recursive: true, force: true }); }
});

test("watch usage rejects a missing predicate, a report, and a one-shot --until", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, ["cli.ts", "watch", "--sql", "select 1 as x"], { cwd: process.cwd(), encoding: "utf8" }),
    (error: NodeJS.ErrnoException & { code?: number; stderr?: string }) => error.code === 2 && /requires --until/.test(error.stderr ?? ""),
  );
  await assert.rejects(
    execFileAsync(process.execPath, ["cli.ts", "watch", "here", "--until", "empty"], { cwd: process.cwd(), encoding: "utf8" }),
    (error: NodeJS.ErrnoException & { code?: number; stderr?: string }) => error.code === 2 && /not the report here/.test(error.stderr ?? ""),
  );
  await assert.rejects(
    execFileAsync(process.execPath, ["cli.ts", "--sql", "select 1 as x", "--until", "empty"], { cwd: process.cwd(), encoding: "utf8" }),
    (error: NodeJS.ErrnoException & { code?: number; stderr?: string }) => error.code === 2 && /--until is a watch flag/.test(error.stderr ?? ""),
  );
  await assert.rejects(
    execFileAsync(process.execPath, ["cli.ts", "watch", "--sql", "select 1 as status", "--until", "status"], { cwd: process.cwd(), encoding: "utf8" }),
    (error: NodeJS.ErrnoException & { code?: number; stderr?: string }) => error.code === 2 && /--until is empty, nonempty/.test(error.stderr ?? ""),
  );
});

test("watch work reprints the report until the deadline", async () => {
  const home = mkdtempSync(join(tmpdir(), "spacequery-watch-work-"));
  const bin = join(home, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "ghq"), "#!/usr/bin/env node\n");
  writeFileSync(join(bin, "herdr"), `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(JSON.stringify({ result: { snapshot: { agents: [] } } }))});\n`);
  writeFileSync(join(bin, "bd"), "#!/usr/bin/env node\nprocess.stdout.write('[]');\n");
  writeFileSync(join(bin, "lsof"), "#!/bin/sh\nexit 0\n");
  for (const name of ["ghq", "herdr", "bd", "lsof"]) chmodSync(join(bin, name), 0o755);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    XDG_CONFIG_HOME: join(home, "config"),
    XDG_STATE_HOME: join(home, "state"),
  };
  delete env.HERDR_PANE_ID;
  delete env.CLAUDE_CODE_SESSION_ID;
  try {
    await assert.rejects(
      execFileAsync(process.execPath, ["cli.ts", "watch", "work", "--interval", "5000", "--timeout", "1"], {
        cwd: process.cwd(), encoding: "utf8", env, timeout: 20_000,
      }),
      (error: NodeJS.ErrnoException & { code?: number; stdout?: string; stderr?: string }) => {
        assert.equal(error.code, 5);
        assert.match(error.stderr ?? "", /timed out/);
        const board = JSON.parse((error.stdout ?? "").trim().split("\n")[0] ?? "");
        assert.equal(board.report, "work");
        assert.deepEqual(Object.keys(board.sections), ["ready", "issues", "agents", "cursor"]);
        assert.equal(board.definition.default_scope, "all");
        assert.match(board.definition.refresh, /watch work/);
        return true;
      },
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("watchExitCode keeps timeout distinct from the gates", () => {
  const rows = { rows: [{ status: "working" }], providers: [{ name: "herdr", source: "built-in" as const, ok: 1, observed_at: 0, ms: 0, error: null }] };
  const failed = { rows: [], providers: [{ name: "herdr", source: "built-in" as const, ok: 0, observed_at: 0, ms: 0, error: "missing" }] };
  assert.equal(watchExitCode("matched", { rows: [], providers: rows.providers }, { expectEmpty: true, strict: false }), 0);
  assert.equal(watchExitCode("matched", rows, { expectEmpty: true, strict: false }), 3);
  assert.equal(watchExitCode("timeout", rows, { expectEmpty: true, strict: true }), 5);
  assert.equal(watchExitCode("incomplete", failed, { expectEmpty: false, strict: true }), 4);
  assert.equal(watchExitCode("aborted", rows, { expectEmpty: false, strict: false }), 130);
});

test("an unknown query exits with status 2", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, ["cli.ts", "nonesuch"], { cwd: process.cwd(), encoding: "utf8" }),
    (error: NodeJS.ErrnoException & { code?: number }) => error.code === 2,
  );
});

test("help orders queries by their call counts and does not record itself", async () => {
  const stateHome = mkdtempSync(join(tmpdir(), "spacequery-cli-calls-"));
  const env = { ...process.env, XDG_STATE_HOME: stateHome };
  try {
    for (let index = 0; index < 5; index += 1) recordCall(env, "dirty");
    recordCall(env, "agents");
    const before = callCounts(env);
    const { stdout } = await execFileAsync(process.execPath, ["cli.ts", "--help"], {
      cwd: process.cwd(), encoding: "utf8", env,
    });
    const lines = stdout.split("\n");
    const dirty = lines.findIndex((line) => line.startsWith("  dirty "));
    const agents = lines.findIndex((line) => line.startsWith("  agents "));
    assert.ok(dirty !== -1 && agents !== -1 && dirty < agents);
    assert.deepEqual(callCounts(env), before);
  } finally {
    rmSync(stateHome, { recursive: true, force: true });
  }
});

test("query documentation names every catalog query", async () => {
  const { readFile } = await import("node:fs/promises");
  const text = await readFile("skills/spacequery/references/queries.md", "utf8");
  const names = new Set([...text.matchAll(/^\| `([^`]+)` \|/gm)].map((match) => match[1]!));
  assert.deepEqual(names, new Set(Object.keys(catalog)));
});


test("work-list commands default to every ghq beads root", async () => {
  const home = mkdtempSync(join(tmpdir(), "spacequery-cli-work-"));
  const alpha = join(home, "alpha");
  const gamma = join(home, "gamma");
  const bin = join(home, "bin");
  mkdirSync(join(alpha, ".beads"), { recursive: true });
  mkdirSync(join(gamma, ".beads"), { recursive: true });
  mkdirSync(join(alpha, ".git"), { recursive: true });
  mkdirSync(join(gamma, ".git"), { recursive: true });
  mkdirSync(join(home, ".claude", "sessions"), { recursive: true });
  mkdirSync(bin);
  const open = {
    [alpha]: [{ id: "alpha-1", title: "Alpha open", status: "open", priority: 1 }],
    [gamma]: [{ id: "gamma-1", title: "Gamma open", status: "open", priority: 2 }],
  };
  const ready = { [alpha]: [], [gamma]: [{ id: "gamma-1", title: "Gamma open", status: "open", priority: 2 }] };
  const snapshot = { result: { snapshot: { agents: [{ pane_id: "pane-alpha", agent: "claude", agent_status: "working", cwd: alpha, name: "Alpha" }] } } };
  writeFileSync(join(bin, "ghq"), `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(`${alpha}\n${gamma}\n`)});\n`);
  writeFileSync(join(bin, "herdr"), `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(JSON.stringify(snapshot))});\n`);
  writeFileSync(join(bin, "lsof"), "#!/bin/sh\nexit 0\n");
  writeFileSync(join(bin, "bd"), `#!/usr/bin/env node
const args = process.argv.slice(2);
const root = args[args.indexOf("-C") + 1];
const ready = args.includes("ready");
if (ready && args[args.indexOf("--limit") + 1] !== "0") process.exit(2);
const rows = (ready ? ${JSON.stringify(ready)} : ${JSON.stringify(open)})[root];
if (!rows) process.exit(1);
process.stdout.write(JSON.stringify(rows));
`);
  for (const name of ["ghq", "herdr", "lsof", "bd"]) chmodSync(join(bin, name), 0o755);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    XDG_CONFIG_HOME: join(home, "config"),
    XDG_STATE_HOME: join(home, "state"),
  };
  delete env.HERDR_PANE_ID;
  delete env.CLAUDE_CODE_SESSION_ID;
  const run = (args: string[]) => execFileAsync(process.execPath, ["cli.ts", ...args], { cwd: process.cwd(), encoding: "utf8", env });
  try {
    const wide = JSON.parse((await run(["issues-in-scope"])).stdout);
    assert.equal(wide.scope, "all");
    assert.deepEqual(wide.rows.map((row: { issue_id: string }) => row.issue_id), ["alpha-1", "gamma-1"]);
    assert.deepEqual(wide.providers.map((provider: { name: string }) => provider.name), ["beads", "herdr", "repos"]);
    const narrow = JSON.parse((await run(["issues-in-scope", "--scope", "agents"])).stdout);
    assert.equal(narrow.scope, "agents");
    assert.deepEqual(narrow.rows.map((row: { issue_id: string }) => row.issue_id), ["alpha-1"]);
    assert.deepEqual(narrow.providers.map((provider: { name: string }) => provider.name), ["beads", "herdr"]);
    const claimable = JSON.parse((await run(["issues-ready"])).stdout);
    assert.equal(claimable.scope, "all");
    assert.deepEqual(claimable.rows.map((row: { root: string; issue_id: string }) => [row.root, row.issue_id]), [[gamma, "gamma-1"]]);
    assert.deepEqual(claimable.providers.map((provider: { name: string }) => provider.name), ["beads_ready", "herdr", "repos"]);
    const board = JSON.parse((await run(["work"])).stdout);
    assert.equal(board.scope, "all");
    assert.deepEqual(Object.keys(board.sections), ["ready", "issues", "agents", "cursor"]);
    assert.deepEqual(board.sections.ready.map((row: { issue_id: string }) => row.issue_id), ["gamma-1"]);
    assert.deepEqual(board.sections.issues.map((row: { issue_id: string }) => row.issue_id), ["alpha-1", "gamma-1"]);
    assert.equal(board.sections.agents[0].pane_id, "pane-alpha");
    assert.equal(board.sections.agents[0].model, null);
    assert.deepEqual(board.sections.cursor, []);
    assert.deepEqual(board.providers.map((provider: { name: string; ok: number }) => [provider.name, provider.ok]), [
      ["beads", 1], ["beads_ready", 1], ["cursor", 1], ["herdr", 1], ["repos", 1], ["sessions", 1],
    ]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("JSON row_count counts returned rows after filtering and limits", async () => {
  const { stdout } = await execFileAsync(process.execPath, ["cli.ts", "--sql", "select 1 as x union all select 2 union all select 3 limit 2"], { encoding: "utf8" });
  const result = JSON.parse(stdout);
  assert.equal(result.row_count, 2);
  assert.equal(result.row_count, result.rows.length);
});
