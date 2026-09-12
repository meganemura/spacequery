// These tests prove that the command line exposes the catalog and rejects bad names.
// They do not run a query, so they cannot start a real provider tool.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { catalog, reports } from "../catalog.ts";
import { exitCodeFor, reportJson } from "../cli.ts";
import { callCounts, recordCall } from "../core/calls.ts";
import type { ReportResult } from "../core/run.ts";

const execFileAsync = promisify(execFile);

test("help lists every catalog query", async () => {
  const { stdout } = await execFileAsync(process.execPath, ["cli.ts", "--help"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  for (const name of Object.keys(catalog)) assert.match(stdout, new RegExp(`\\b${name}\\b`));
  assert.match(stdout, /^reports:$/m);
  for (const name of Object.keys(reports)) assert.match(stdout, new RegExp(`\\b${name}\\b`));
});

test("JSON help lists every built-in query with its parameters", async () => {
  const { stdout } = await execFileAsync(process.execPath, ["cli.ts", "--help", "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  const listed = JSON.parse(stdout) as { name: string; description: string; params: string[]; sections?: [string, string][]; source: string }[];
  const byName = new Map(listed.map((query) => [query.name, query]));
  for (const [name, query] of Object.entries(catalog)) {
    assert.deepEqual(byName.get(name), { name, description: query.description, params: query.params, source: "built-in" });
  }
  assert.deepEqual(byName.get("here"), {
    name: "here",
    description: reports.here.description,
    params: ["root"],
    sections: reports.here.sections,
    source: "report",
  });
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
});

test("expect-empty returns 3 after it prints rows", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, ["cli.ts", "--sql", "select 1 as x", "--expect-empty"], { cwd: process.cwd(), encoding: "utf8" }),
    (error: NodeJS.ErrnoException & { code?: number; stdout?: string }) => {
      assert.equal(error.code, 3);
      const { ms, ...result } = JSON.parse(error.stdout!);
      assert.equal(typeof ms, "number");
      assert.deepEqual(result, { query: "sql", scope: "agents", me: null, params: {}, rows: [{ x: 1 }], providers: [] });
      return true;
    },
  );
});

test("expect-empty returns 0 for an empty result", async () => {
  const { stdout } = await execFileAsync(process.execPath, ["cli.ts", "--sql", "select 1 as x where 0", "--expect-empty"], { cwd: process.cwd(), encoding: "utf8" });
  const { ms, ...result } = JSON.parse(stdout);
  assert.equal(typeof ms, "number");
  assert.deepEqual(result, { query: "sql", scope: "agents", me: null, params: {}, rows: [], providers: [] });
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
    assert.ok(stdout.indexOf("  dirty") < stdout.indexOf("  agents"));
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
