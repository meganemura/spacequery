// Fills skills and plugins from Claude Code and Codex files under HOME.
// It reads installed plugin records and roots in scope, never agent history.
// Boundary: this provider's tables only.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { LoadContext, Loader } from "../../core/loader.ts";
import { discoveryLoaders, rootsInScope } from "../../core/scope.ts";
import { skillsCommands } from "./module.ts";
import type { PluginsId, SkillsId } from "./solarsql.generated.ts";

type Source = "claude-user" | "claude-project" | "claude-plugin" | "codex-user" | "codex-project" | "codex-admin" | "codex-system" | "codex-plugin";
type Skill = { path: SkillsId; source: Source; agent: "claude" | "codex"; name: string; description: string | null; root: string | null; plugin: string | null };
type Plugin = { id: PluginsId; agent: "claude" | "codex"; name: string; marketplace: string | null; version: string | null; path: string; installed_at: number | null; updated_at: number | null };
type ClaudeInstall = { scope?: unknown; installPath?: unknown; version?: unknown; installedAt?: unknown; lastUpdated?: unknown };

async function namesAt(path: string): Promise<string[]> {
  try { return await readdir(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}

function scalar(value: string): string | null {
  const quote = value[0];
  if (quote === "\"" || quote === "'") return value.endsWith(quote) ? value.slice(1, -1) : null;
  return value;
}

// This reader keeps the provider dependency-free. It recognizes only the two
// documented frontmatter keys, so advanced YAML cannot change a skill's row.
export function readFrontmatter(text: string): { name: string | null; description: string | null } {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") return { name: null, description: null };
  const end = lines.indexOf("---", 1);
  if (end < 0) return { name: null, description: null };
  const result: { name: string | null; description: string | null } = { name: null, description: null };
  for (let index = 1; index < end; index += 1) {
    const match = /^(name|description):[ \t]*(.*)$/.exec(lines[index]!);
    if (!match) continue;
    const key = match[1] as keyof typeof result;
    let value = match[2]!;
    const quote = value[0];
    if (quote === "\"" || quote === "'") while (!value.endsWith(quote) && index + 1 < end) value += `\n${lines[++index]!}`;
    result[key] = scalar(value);
  }
  return result;
}

export function splitPluginId(id: string): { name: string; marketplace: string | null } {
  const at = id.lastIndexOf("@");
  return at <= 0 || at === id.length - 1 ? { name: id, marketplace: null } : { name: id.slice(0, at), marketplace: id.slice(at + 1) };
}

async function skillsAt(path: string, source: Source, agent: "claude" | "codex", root: string | null, plugin: string | null): Promise<Skill[]> {
  const entries = await namesAt(path);
  return Promise.all(entries.map(async (entry) => {
    const skillPath = join(path, entry, "SKILL.md");
    try {
      const frontmatter = readFrontmatter(await readFile(skillPath, "utf8"));
      return { path: skillPath as SkillsId, source, agent, name: frontmatter.name ?? entry, description: frontmatter.description, root, plugin };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as NodeJS.ErrnoException).code === "ENOTDIR") return null;
      throw error;
    }
  })).then((rows) => rows.filter((row) => row !== null));
}

// The admin path is a parameter, not a literal `/etc/codex/skills`, so a test
// can prove the read without writing outside its temporary HOME.
export function codexAdminSkills(path: string): Promise<Skill[]> {
  return skillsAt(path, "codex-admin", "codex", null, null);
}

function date(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

async function claudePlugins(home: string): Promise<{ plugins: Plugin[]; skills: Skill[] }> {
  const path = join(home, ".claude", "plugins", "installed_plugins.json");
  let document: { plugins?: Record<string, ClaudeInstall[]> };
  try { document = JSON.parse(await readFile(path, "utf8")) as { plugins?: Record<string, ClaudeInstall[]> }; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { plugins: [], skills: [] };
    throw error;
  }
  const installs = Object.entries(document.plugins ?? {}).flatMap(([id, entries]) => entries.map((entry) => ({ id, entry })));
  const plugins: Plugin[] = [];
  const skills: Skill[] = [];
  for (const { id, entry } of installs) {
    if (typeof entry.installPath !== "string") continue;
    const { name, marketplace } = splitPluginId(id);
    plugins.push({ id: id as PluginsId, agent: "claude", name, marketplace, version: typeof entry.version === "string" ? entry.version : null, path: entry.installPath, installed_at: date(entry.installedAt), updated_at: date(entry.lastUpdated) });
    skills.push(...await skillsAt(join(entry.installPath, "skills"), "claude-plugin", "claude", null, id));
  }
  return { plugins, skills };
}

function configuredCodexPlugins(text: string): string[] {
  const result: string[] = [];
  let id: string | null = null;
  let enabled = true;
  const add = () => { if (id !== null && enabled) result.push(id); };
  for (const line of text.split(/\r?\n/)) {
    const section = /^\[plugins\."([^"]+)"\]$/.exec(line);
    if (section) { add(); id = section[1]!; enabled = true; continue; }
    if (id !== null && /^enabled\s*=\s*false\s*$/.test(line)) enabled = false;
    if (id !== null && /^\[/.test(line)) { add(); id = null; enabled = true; }
  }
  add();
  return result;
}

async function codexPlugins(home: string): Promise<{ plugins: Plugin[]; skills: Skill[] }> {
  let ids: string[];
  try { ids = configuredCodexPlugins(await readFile(join(home, ".codex", "config.toml"), "utf8")); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { plugins: [], skills: [] };
    throw error;
  }
  const plugins: Plugin[] = [];
  const skills: Skill[] = [];
  for (const id of ids) {
    // Claude and Codex can select the same marketplace ID. The table key must
    // retain both installed rows, so Codex selectors carry their agent prefix.
    const pluginId = `codex:${id}`;
    const { name, marketplace } = splitPluginId(id);
    if (marketplace === null) continue;
    const base = join(home, ".codex", "plugins", "cache", marketplace, name);
    for (const version of await namesAt(base)) {
      const path = join(base, version);
      plugins.push({ id: pluginId as PluginsId, agent: "codex", name, marketplace, version, path, installed_at: null, updated_at: null });
      skills.push(...await skillsAt(join(path, "skills"), "codex-plugin", "codex", null, pluginId));
    }
  }
  return { plugins, skills };
}

export const skillsLoader: Loader = {
  name: "skills", tables: ["skills", "plugins"], after: [], afterForScope: discoveryLoaders,
  async load(ctx) {
    const home = ctx.env["HOME"];
    if (!home) throw new Error("skills: HOME is not set");
    const roots = await rootsInScope(ctx);
    const [claude, codex, claudeUser, codexUserAgents, codexUserCodex, codexSystem, codexAdmin, claudeProjects, codexProjects] = await Promise.all([
      claudePlugins(home), codexPlugins(home),
      skillsAt(join(home, ".claude", "skills"), "claude-user", "claude", null, null),
      // Codex's own docs name `~/.agents/skills` as the user location, but the
      // installer bundled with Codex still writes to `~/.codex/skills`. Both
      // directories are read under one source; a name in both gives two rows,
      // because Codex does not merge duplicate names either.
      skillsAt(join(home, ".agents", "skills"), "codex-user", "codex", null, null),
      skillsAt(join(home, ".codex", "skills"), "codex-user", "codex", null, null),
      skillsAt(join(home, ".codex", "skills", ".system"), "codex-system", "codex", null, null),
      codexAdminSkills("/etc/codex/skills"),
      Promise.all(roots.map((root) => skillsAt(join(root, ".claude", "skills"), "claude-project", "claude", root, null))),
      // Codex also scans the cwd and parent folders below the repository
      // root. A project skill row is keyed and joined on `root` (see
      // `skills-in-dir`), so only the root itself is in scope here.
      Promise.all(roots.map((root) => skillsAt(join(root, ".agents", "skills"), "codex-project", "codex", root, null))),
    ]);
    const loadedSkills = await ctx.db.run(skillsCommands.loadSkills, { rows: [...claude.skills, ...codex.skills, ...claudeUser, ...codexUserAgents, ...codexUserCodex, ...codexSystem, ...codexAdmin, ...claudeProjects.flat(), ...codexProjects.flat()] });
    if (!loadedSkills.ok) throw new Error(`skills: ${loadedSkills.kind}`);
    const loadedPlugins = await ctx.db.run(skillsCommands.loadPlugins, { rows: [...claude.plugins, ...codex.plugins] });
    if (!loadedPlugins.ok) throw new Error(`plugins: ${loadedPlugins.kind}`);
  },
};
