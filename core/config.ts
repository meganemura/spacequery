// Which built-in providers appear in help and the terminal browser.
// A missing file keeps the ship defaults: core providers stay on, and the
// optional inventories stay off. Running a named query does not read this file.
// Boundary: the config file only. Callers decide what to list or load.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// These inventories are useful when the tool is installed and unused noise
// when it is not. Author-owned tools are in this set so a fresh machine does
// not advertise them. Every other built-in provider stays on.
export const providersOffByDefault = ["beads", "beads_ready", "brew", "headsign", "runtag"] as const;

const offByDefault = new Set<string>(providersOffByDefault);

// One line for the browser's provider list. The on/off clause matches the ship default.
export const providerSummaries: Readonly<Record<string, string>> = {
  search_path: "PATH entries and the executable that would run. On by default.",
  repos: "Repositories ghq manages. On by default.",
  herdr: "Live coding-agent panes. On by default.",
  github: "Open pull requests for repositories in scope. On by default.",
  github_reviews: "Pull requests that request your review. On by default.",
  mise: "Tool versions and the PATH mise gives a repository. On by default.",
  brew: "Installed Homebrew formulae and casks. Off until you enable it.",
  repository_versions: "Static version and lock files. On by default.",
  repository_config_files: "Recognized dependency and tool config files. On by default.",
  beads: "Open beads issues. Off until you enable it.",
  beads_ready: "Claimable beads issues. Follows beads unless you set this name.",
  docker: "Containers and published ports. On by default.",
  sessions: "Live Claude Code and Codex sessions. On by default.",
  cursor: "Recent Cursor agent conversations and their models. On by default.",
  git: "Branch, dirt, and worktrees. On by default.",
  processes: "Processes and listening ports in scope. On by default.",
  skills: "Skills and plugins Claude Code and Codex can load. On by default.",
  headsign: "Headsign workflow state. Off until you enable it.",
  claude_usage: "Claude subscription quota. On by default.",
  codex_usage: "Codex quota from local logs. On by default.",
  runtag: "runtag job files. Off until you enable it.",
};

export type HelpMode = "short" | "all";

export type LoadedConfig = {
  path: string;
  helpMode: HelpMode;
  overrides: Readonly<Record<string, boolean>>;
  warnings: readonly string[];
};

export function configPath(env: Readonly<Record<string, string | undefined>>): string {
  const configHome = env["XDG_CONFIG_HOME"] || join(env["HOME"] || homedir(), ".config");
  return join(configHome, "spacequery", "config.json");
}

export function emptyConfig(env: Readonly<Record<string, string | undefined>> = {}): LoadedConfig {
  return { path: configPath(env), helpMode: "short", overrides: {}, warnings: [] };
}

export function isProviderEnabled(name: string, config: LoadedConfig): boolean {
  if (Object.hasOwn(config.overrides, name)) return config.overrides[name] === true;
  // Ready issues are the same optional inventory as open issues. Enabling
  // beads enables this loader unless the file names beads_ready itself.
  if (name === "beads_ready") return isProviderEnabled("beads", config);
  return !offByDefault.has(name);
}

export function disabledProviderNames(names: readonly string[], config: LoadedConfig): string[] {
  return names.filter((name) => !isProviderEnabled(name, config)).sort();
}

export function unknownProviderWarnings(names: readonly string[], config: LoadedConfig): string[] {
  const known = new Set(names);
  return Object.keys(config.overrides)
    .filter((name) => !known.has(name))
    .sort()
    .map((name) => `config ${config.path} names ${name}, which is not a built-in provider`);
}

export function loadConfig(env: Readonly<Record<string, string | undefined>>): LoadedConfig {
  const path = configPath(env);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyConfig(env);
    return { ...emptyConfig(env), warnings: [`cannot read ${path}: ${message(error)}`] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ...emptyConfig(env), warnings: [`${path} is not JSON: ${message(error)}`] };
  }
  if (!isRecord(parsed)) return { ...emptyConfig(env), warnings: [`${path} must be a JSON object`] };
  const warnings: string[] = [];
  const overrides: Record<string, boolean> = {};
  if (parsed.providers !== undefined) {
    if (!isRecord(parsed.providers)) warnings.push(`${path} providers must be an object of true or false`);
    else {
      for (const [name, value] of Object.entries(parsed.providers)) {
        if (typeof value === "boolean") overrides[name] = value;
        else warnings.push(`${path} providers.${name} must be true or false`);
      }
    }
  }
  let helpMode: HelpMode = "short";
  if (parsed.help !== undefined) {
    if (!isRecord(parsed.help)) warnings.push(`${path} help must be an object`);
    else if (parsed.help.mode === "short" || parsed.help.mode === "all") helpMode = parsed.help.mode;
    else if (parsed.help.mode !== undefined) warnings.push(`${path} help.mode must be "short" or "all"`);
  }
  return { path, helpMode, overrides, warnings };
}

// A value equal to the ship default is omitted so the file only records choices.
// An unreadable or invalid file is left in place; replacing it would drop keys.
export function saveProviderEnabled(env: Readonly<Record<string, string | undefined>>, name: string, enabled: boolean): void {
  const path = configPath(env);
  const raw = readRaw(path);
  const providers = isRecord(raw.providers) ? { ...raw.providers } : {};
  if (enabled === !offByDefault.has(name)) delete providers[name];
  else providers[name] = enabled;
  raw.providers = providers;
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(raw, null, 2)}\n`);
  renameSync(temporary, path);
}

function readRaw(path: string): Record<string, unknown> {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`cannot read ${path}: ${message(error)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${path} is not JSON: ${message(error)}`);
  }
  if (!isRecord(parsed)) throw new Error(`${path} must be a JSON object`);
  return { ...parsed };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
