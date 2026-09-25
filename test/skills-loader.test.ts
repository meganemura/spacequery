// These tests prove the filesystem provider separates skill sources and avoids
// Claude's stale plugin cache. They build every source below a temporary HOME.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import type { Exec, Loader } from "../core/loader.ts";
import { runQuery, runSql } from "../core/run.ts";
import { herdrLoader } from "../providers/herdr/loader.ts";
import { repoLoader } from "../providers/repos/loader.ts";
import { codexAdminSkills, readFrontmatter, skillsLoader, splitPluginId } from "../providers/skills/loader.ts";
import { skillsQueries } from "../providers/skills/module.ts";
import { repoForRoots } from "./fixture.ts";

const home = mkdtempSync(join(tmpdir(), "spacequery-skills-"));
const root = join(home, "src", "github.com", "example", "project");

function skill(directory: string, name: string, description: string | null = `Description for ${name}`): void {
  mkdirSync(join(directory, name), { recursive: true });
  const body = description === null ? "# Skill\n" : `---\nname: ${name}\ndescription: \"${description}\"\n---\n# Skill\n`;
  writeFileSync(join(directory, name, "SKILL.md"), body);
}

function setup(): void {
  skill(join(home, ".claude", "skills"), "claude-user");
  skill(join(home, ".agents", "skills"), "codex-agents-user");
  skill(join(home, ".codex", "skills"), "codex-user");
  skill(join(home, ".codex", "skills", ".system"), "codex-system");
  skill(join(root, ".claude", "skills"), "project", "Project description");
  skill(join(root, ".agents", "skills"), "codex-project");
  const installed = join(home, ".claude", "plugins", "cache", "example", "installed");
  skill(join(installed, "skills"), "claude-plugin");
  const stale = join(home, ".claude", "plugins", "cache", "example", "stale");
  skill(join(stale, "skills"), "stale-plugin");
  mkdirSync(join(home, ".claude", "plugins"), { recursive: true });
  writeFileSync(join(home, ".claude", "plugins", "installed_plugins.json"), JSON.stringify({ version: 2, plugins: {
    "example@market": [{ scope: "user", installPath: installed, version: "1.2.3", installedAt: "2026-09-10T00:00:00.000Z", lastUpdated: "2026-09-10T01:00:00.000Z" }],
  } }));
  const codex = join(home, ".codex", "plugins", "cache", "market", "codex-plugin", "2.0.0");
  skill(join(codex, "skills"), "codex-plugin");
  mkdirSync(join(home, ".codex"), { recursive: true });
  writeFileSync(join(home, ".codex", "config.toml"), `[plugins."codex-plugin@market"]\nenabled = true\n`);
}

function snapshot(): string {
  return JSON.stringify({ result: { snapshot: { agents: [{
    pane_id: "example:pane", agent: "claude", agent_status: "working", agent_session: { value: "example-session" },
    focused: true, cwd: root, foreground_cwd: root, workspace_id: "example", tab_id: "example", terminal_title_stripped: "example",
  }] } } });
}

const loaders: Loader[] = [repoLoader, herdrLoader, skillsLoader];
const exec: Exec = async (command, args, cwd) => {
  if (command === "ghq" && args.join(" ") === "list -p") return "";
  if (command === "herdr" && args.join(" ") === "api snapshot") return snapshot();
  throw new Error(`unexpected fake command: ${command} ${args.join(" ")}`);
};

setup();

test("skills load every source and keep the project root", async () => {
  // codex-admin reads the real /etc/codex/skills; codexAdminSkills has its own test with a fake path.
  const result = await runSql("select source, agent, name, root from skills where source <> 'codex-admin' order by source, name", { loaders, exec, repo: repoForRoots(new Set([root])), env: { HOME: home }, params: {} });
  assert.deepEqual(result.rows, [
    { source: "claude-plugin", agent: "claude", name: "claude-plugin", root: null },
    { source: "claude-project", agent: "claude", name: "project", root },
    { source: "claude-user", agent: "claude", name: "claude-user", root: null },
    { source: "codex-plugin", agent: "codex", name: "codex-plugin", root: null },
    { source: "codex-project", agent: "codex", name: "codex-project", root },
    { source: "codex-system", agent: "codex", name: "codex-system", root: null },
    { source: "codex-user", agent: "codex", name: "codex-agents-user", root: null },
    { source: "codex-user", agent: "codex", name: "codex-user", root: null },
  ]);
});

test("Claude's installed registry excludes a stale cache skill", async () => {
  const result = await runSql("select name from skills where source = 'claude-plugin' order by name", { loaders, exec, repo: repoForRoots(new Set([root])), env: { HOME: home }, params: {} });
  assert.deepEqual(result.rows, [{ name: "claude-plugin" }]);
});

test("a same-name skill in both codex-user directories gives two rows", async () => {
  const shared = mkdtempSync(join(tmpdir(), "spacequery-skills-shared-"));
  skill(join(shared, ".agents", "skills"), "shared");
  skill(join(shared, ".codex", "skills"), "shared");
  const result = await runSql(
    "select source, agent, name from skills where name = 'shared' order by path",
    { loaders, exec, repo: repoForRoots(new Set()), env: { HOME: shared }, params: {} },
  );
  assert.deepEqual(result.rows, [
    { source: "codex-user", agent: "codex", name: "shared" },
    { source: "codex-user", agent: "codex", name: "shared" },
  ]);
});

test("skills-in-dir returns the project row only for its own root", async () => {
  const other = join(home, "src", "github.com", "example", "other");
  const options = { loaders, exec, env: { HOME: home } };
  const forRoot = await runQuery(skillsQueries.inDir, { ...options, params: { root } });
  assert.ok(forRoot.rows.some((row) => row["source"] === "claude-project" && row["root"] === root));
  assert.ok(forRoot.rows.some((row) => row["source"] === "codex-project" && row["root"] === root));
  const forOther = await runQuery(skillsQueries.inDir, { ...options, params: { root: other } });
  assert.ok(!forOther.rows.some((row) => row["source"] === "claude-project" || row["source"] === "codex-project"));
});

test("the admin path is a parameter, so a fake directory proves the read", async () => {
  const admin = mkdtempSync(join(tmpdir(), "spacequery-skills-admin-"));
  skill(admin, "admin-skill");
  const rows = await codexAdminSkills(admin);
  assert.deepEqual(rows.map((row) => ({ source: row.source, agent: row.agent, name: row.name })), [
    { source: "codex-admin", agent: "codex", name: "admin-skill" },
  ]);
});

test("a missing admin directory yields no rows", async () => {
  assert.deepEqual(await codexAdminSkills(join(home, "no-such-etc-codex-skills")), []);
});

test("frontmatter reader round-trips supported YAML scalar forms", () => hegel.test((tc) => {
  const name = tc.draw(gs.text({ minSize: 1, maxSize: 24, alphabet: "abcde012345:-名" }));
  const description = tc.draw(gs.text({ minSize: 0, maxSize: 48, alphabet: "abcde012345:-説明" }));
  const quote = tc.draw(gs.sampledFrom(["plain", "single", "double"] as const));
  const value = quote === "plain" ? description : quote === "single" ? `'${description}'` : `\"${description}\"`;
  assert.deepEqual(readFrontmatter(`---\nname: ${name}\ndescription: ${value}\n---\n`), { name, description });
}));

test("plugin ID split preserves generated names and marketplaces", () => hegel.test((tc) => {
  const name = tc.draw(gs.text({ minSize: 1, maxSize: 24, alphabet: "abcdefghijklmnopqrstuvwxyz0123456789-" }));
  const marketplace = tc.draw(gs.text({ minSize: 1, maxSize: 24, alphabet: "abcdefghijklmnopqrstuvwxyz0123456789-" }));
  assert.deepEqual(splitPluginId(`${name}@${marketplace}`), { name, marketplace });
}));
