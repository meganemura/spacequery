// Reads bounded static version evidence from roots and declared npm workspaces.
// Repository files are data: this provider starts no process, evaluates no
// configuration, follows no symlink, and performs no dependency resolution.
// Boundary: this provider's table only.
import { constants } from "node:fs";
import { open, opendir, lstat } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import type { LoadContext, Loader } from "../../core/loader.ts";
import { repositoryIdentity } from "../../core/repo.ts";
import { discoveryLoaders, rootsInScope } from "../../core/scope.ts";
import { repositoryVersionCommands } from "./module.ts";
import type { RepositoryVersionsId } from "./solarsql.generated.ts";

const MAX_ENTRIES = 2_000;
const MAX_WORKSPACE_DEPTH = 12;
const MAX_WORKSPACE_PATTERNS = 100;
const MAX_PROJECTS = 500;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const MAX_ROWS = 50_000;
const excludedDirectories = new Set([".git", ".claude", ".claude-team", ".codex", ".agents", ".hegel", "node_modules", "vendor", "dist", "build", "target", ".cache", ".next", ".turbo", "coverage"]);
export type RepositorySourceDefinition = {
  name: string;
  format: string;
  category: "manifest" | "lock" | "version-file" | "tool-config";
  parseSupport: "supported" | "unsupported";
  versionWorkspace: boolean;
};

// This catalog defines the bounded source surface for evidence parsing and file
// inventory. Parser support describes capability, not the validity of a file.
export const repositorySourceDefinitions: readonly RepositorySourceDefinition[] = [
  { name: ".node-version", format: "node-version", category: "version-file", parseSupport: "supported", versionWorkspace: false },
  { name: ".python-version", format: "python-version", category: "version-file", parseSupport: "supported", versionWorkspace: false },
  { name: ".ruby-version", format: "ruby-version", category: "version-file", parseSupport: "supported", versionWorkspace: false },
  { name: ".tool-versions", format: "tool-versions", category: "version-file", parseSupport: "supported", versionWorkspace: false },
  { name: "package.json", format: "npm-package-json", category: "manifest", parseSupport: "supported", versionWorkspace: true },
  { name: "package-lock.json", format: "npm-package-lock", category: "lock", parseSupport: "supported", versionWorkspace: true },
  { name: "Gemfile.lock", format: "bundler-lock", category: "lock", parseSupport: "supported", versionWorkspace: false },
  { name: "Gemfile", format: "bundler-ruby", category: "manifest", parseSupport: "unsupported", versionWorkspace: false },
  { name: "mise.toml", format: "mise-toml", category: "tool-config", parseSupport: "unsupported", versionWorkspace: false },
  { name: ".mise.toml", format: "mise-toml", category: "tool-config", parseSupport: "unsupported", versionWorkspace: false },
  { name: "pyproject.toml", format: "python-pyproject-toml", category: "manifest", parseSupport: "unsupported", versionWorkspace: false },
  { name: "Cargo.toml", format: "cargo-toml", category: "manifest", parseSupport: "unsupported", versionWorkspace: false },
  { name: "Cargo.lock", format: "cargo-lock", category: "lock", parseSupport: "unsupported", versionWorkspace: false },
  { name: "Package.swift", format: "swift-package", category: "manifest", parseSupport: "unsupported", versionWorkspace: false },
  { name: "Package.resolved", format: "swift-package-resolved", category: "lock", parseSupport: "unsupported", versionWorkspace: false },
  { name: "yarn.lock", format: "yarn-lock", category: "lock", parseSupport: "unsupported", versionWorkspace: false },
  { name: "pnpm-lock.yaml", format: "pnpm-lock-yaml", category: "lock", parseSupport: "unsupported", versionWorkspace: false },
  { name: "Pipfile", format: "pipenv-manifest", category: "manifest", parseSupport: "unsupported", versionWorkspace: false },
  { name: "Pipfile.lock", format: "pipenv-lock", category: "lock", parseSupport: "unsupported", versionWorkspace: false },
  { name: "poetry.lock", format: "poetry-lock", category: "lock", parseSupport: "unsupported", versionWorkspace: false },
  { name: "uv.lock", format: "uv-lock", category: "lock", parseSupport: "unsupported", versionWorkspace: false },
  { name: "go.mod", format: "go-module", category: "manifest", parseSupport: "unsupported", versionWorkspace: false },
  { name: "go.sum", format: "go-checksum", category: "lock", parseSupport: "unsupported", versionWorkspace: false },
  { name: "Brewfile", format: "homebrew-ruby", category: "tool-config", parseSupport: "unsupported", versionWorkspace: false },
];
const supportedFiles = new Set(repositorySourceDefinitions.filter((source) => source.parseSupport === "supported").map((source) => source.name));
const unsupportedFiles = new Set(repositorySourceDefinitions.filter((source) => source.parseSupport === "unsupported" && source.name !== "Brewfile").map((source) => source.name));

type Status = "observed" | "unresolved" | "unsupported" | "error";
type Row = {
  id: RepositoryVersionsId; root: string; repository_id: string | null; project_path: string; ecosystem: string; kind: string; name: string;
  dependency_role: "runtime" | "development" | "optional" | "peer" | null;
  origin: "manifest" | "lock" | "version-file" | "source";
  requested: string | null; locked: string | null; source: string; locator: string | null; status: Status; detail: string | null;
};
type Draft = Omit<Row, "id" | "root" | "repository_id" | "project_path" | "source">;
export type ReadBudget = { used: number; limit: number };

class ScanByteLimitError extends Error {}

function jsonPointer(value: string): string { return value.replaceAll("~", "~0").replaceAll("/", "~1"); }
function projectPath(root: string, source: string): string { return source === root ? "." : relative(root, dirname(source)) || "."; }
function row(root: string, source: string, draft: Draft): Row {
  const locator = draft.locator ?? "";
  const evidence = draft.requested ?? draft.locked ?? "";
  return { ...draft, id: `${source}\0${locator}\0${draft.kind}\0${draft.origin}\0${draft.name}\0${evidence}` as RepositoryVersionsId, root, repository_id: null, project_path: projectPath(root, source), source };
}
function diagnostic(root: string, source: string, status: Status, detail: string, locator: string | null = null): Row {
  return row(root, source, { ecosystem: "unknown", kind: "source", dependency_role: null, origin: "source", name: basename(source), requested: null, locked: null, locator, status, detail });
}
function sourceObserved(root: string, source: string, ecosystem: string, format: string): Row {
  return row(root, source, { ecosystem, kind: "source", dependency_role: null, origin: "source", name: format, requested: null, locked: null, locator: null, status: "observed", detail: "The static reader inspected this source." });
}
function emptyProject(root: string, project: string): Row {
  return row(root, join(project, "[project]"), { ecosystem: "unknown", kind: "source", dependency_role: null, origin: "source", name: "project", requested: null, locked: null, locator: "no-known-source", status: "unsupported", detail: "The project has no recognized static version source." });
}

export async function readRegularFile(path: string, budget: ReadBudget): Promise<string> {
  const noFollow = constants.O_NOFOLLOW ?? 0;
  const handle = await open(path, constants.O_RDONLY | noFollow | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error("source is not a regular file");
    const chunks: Buffer[] = [];
    let fileBytes = 0;
    for (;;) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, MAX_BYTES + 1 - fileBytes, budget.limit + 1 - budget.used));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      fileBytes += bytesRead;
      budget.used += bytesRead;
      if (budget.used > budget.limit) throw new ScanByteLimitError(`Scan stopped after ${budget.limit} source bytes.`);
      if (fileBytes > MAX_BYTES) throw new Error(`source exceeds ${MAX_BYTES} bytes`);
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } finally { await handle.close(); }
}

function fixedValueRows(root: string, source: string, text: string): Row[] {
  const file = basename(source);
  if (file === ".tool-versions") {
    const rows: Row[] = [];
    for (const [index, raw] of text.split(/\r?\n/).entries()) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const parts = line.split(/\s+/);
      const tool = parts.shift()!;
      if (parts.length !== 1 || /[$`(){}]/.test(parts[0]!) || /^(system|latest|path:|ref:)/.test(parts[0]!)) {
        rows.push(row(root, source, { ecosystem: "tool", kind: "runtime", dependency_role: null, origin: "version-file", name: tool, requested: parts.join(" ") || null, locked: null, locator: `line:${index + 1}`, status: "unresolved", detail: "The line is not one fixed tool version." }));
      } else {
        rows.push(row(root, source, { ecosystem: "tool", kind: "runtime", dependency_role: null, origin: "version-file", name: tool, requested: parts[0]!, locked: null, locator: `line:${index + 1}`, status: "observed", detail: null }));
      }
    }
    return rows.length ? rows : [diagnostic(root, source, "error", "The file has no version entries.")];
  }
  const names: Record<string, string> = { ".node-version": "node", ".python-version": "python", ".ruby-version": "ruby" };
  const value = text.trim();
  const name = names[file]!;
  const fixed = value.length > 0 && !/\s|[$`(){}]/.test(value) && !/^(system|latest|path:|ref:)/.test(value);
  return [row(root, source, { ecosystem: name, kind: "runtime", dependency_role: null, origin: "version-file", name, requested: value || null, locked: null, locator: null, status: fixed ? "observed" : "unresolved", detail: fixed ? null : "The file does not contain one fixed version." })];
}

function object(value: unknown): Record<string, unknown> | null { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
export function packageJsonRows(root: string, source: string, text: string): Row[] {
  const document = object(JSON.parse(text));
  if (document === null) throw new Error("package.json must contain a JSON object");
  const rows: Row[] = [];
  const engines = object(document.engines);
  if (document.engines !== undefined && engines === null) rows.push(diagnostic(root, source, "error", "engines must be an object.", "/engines"));
  for (const [name, value] of Object.entries(engines ?? {})) {
    rows.push(row(root, source, { ecosystem: name, kind: "engine", dependency_role: null, origin: "manifest", name, requested: typeof value === "string" ? value : null, locked: null, locator: `/engines/${jsonPointer(name)}`, status: typeof value === "string" ? "observed" : "unresolved", detail: typeof value === "string" ? null : "The engine request is not a string." }));
  }
  const roles = { dependencies: "runtime", devDependencies: "development", optionalDependencies: "optional", peerDependencies: "peer" } as const;
  for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const) {
    const values = object(document[section]);
    if (document[section] !== undefined && values === null) { rows.push(diagnostic(root, source, "error", `${section} must be an object.`, `/${section}`)); continue; }
    for (const [name, value] of Object.entries(values ?? {})) {
      const requested = typeof value === "string" ? value : null;
      const dynamic = requested === null || /^(workspace:|file:|link:|git(?:\+|:)|https?:|ssh:|github:|npm:|\.\.?\/|\/|~\/)/.test(requested) || requested.includes("/") || /\.tgz(?:#.*)?$/.test(requested);
      rows.push(row(root, source, { ecosystem: "npm", kind: "dependency", dependency_role: roles[section], origin: "manifest", name, requested, locked: null, locator: `/${section}/${jsonPointer(name)}`, status: dynamic ? "unresolved" : "observed", detail: dynamic ? "The request uses a reference that the static reader does not identify as a registry package request." : null }));
    }
  }
  return rows;
}

function npmNameAt(location: string): string | null {
  const marker = "node_modules/";
  const at = location.lastIndexOf(marker);
  if (at < 0) return null;
  const parts = location.slice(at + marker.length).split("/");
  return parts[0]!.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
}
export function packageLockRows(root: string, source: string, text: string): Row[] {
  const document = object(JSON.parse(text));
  if (document === null) throw new Error("package-lock.json must contain a JSON object");
  if (document.lockfileVersion !== 2 && document.lockfileVersion !== 3) return [diagnostic(root, source, "unsupported", `npm lockfile version ${String(document.lockfileVersion)} is not supported.`, "/lockfileVersion")];
  const packages = object(document.packages);
  if (packages === null) throw new Error("package-lock.json packages must be an object");
  const rows: Row[] = [];
  for (const [location, value] of Object.entries(packages)) {
    if (location === "") continue;
    const entry = object(value);
    if (entry === null) { rows.push(diagnostic(root, source, "error", "The package entry must be an object.", `/packages/${jsonPointer(location)}`)); continue; }
    const installedName = npmNameAt(location);
    const declaredName = typeof entry.name === "string" ? entry.name : null;
    const name = declaredName ?? installedName;
    if (name === null) { rows.push(diagnostic(root, source, "unresolved", "The workspace lock entry has no package name.", `/packages/${jsonPointer(location)}`)); continue; }
    const version = typeof entry.version === "string" ? entry.version : null;
    const resolved = typeof entry.resolved === "string" ? entry.resolved : "";
    const workspace = installedName === null;
    const alias = installedName !== null && declaredName !== null && installedName !== declaredName;
    const dynamic = workspace || alias || entry.link === true || version === null || /^(file:|link:|git(?:\+|:)|ssh:|github:)/.test(resolved);
    rows.push(row(root, source, { ecosystem: "npm", kind: "dependency", dependency_role: null, origin: "lock", name, requested: null, locked: dynamic ? null : version, locator: `/packages/${jsonPointer(location)}`, status: dynamic ? "unresolved" : "observed", detail: dynamic ? "The lock entry is a workspace, alias, local, linked, Git-based, or non-versioned entry." : null }));
  }
  return rows;
}

function gemfileLockRows(root: string, source: string, text: string): Row[] {
  const rows: Row[] = [];
  let section = "";
  let inSpecs = false;
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (/^[A-Z][A-Z ]+$/.test(line)) { section = line; inSpecs = false; continue; }
    if (/^  specs:$/.test(line)) { inSpecs = true; continue; }
    if (section === "DEPENDENCIES" && /^  \S/.test(line)) {
      const match = /^  ([^\s(!]+)(?: \(([^)]+)\))?!?$/.exec(line);
      if (match) rows.push(row(root, source, { ecosystem: "ruby", kind: "dependency", dependency_role: null, origin: "lock", name: match[1]!, requested: match[2] ?? "*", locked: null, locator: `DEPENDENCIES:line:${index + 1}`, status: "observed", detail: match[2] ? "The dependency request comes from a lock file." : "A bare lock-file dependency is normalized to an unconstrained request." }));
      else rows.push(diagnostic(root, source, "error", "The dependency entry is malformed.", `DEPENDENCIES:line:${index + 1}`));
      continue;
    }
    if (inSpecs && /^    \S/.test(line)) {
      const match = /^    ([^\s(]+) \(([^)]+)\)/.exec(line);
      if (!match || match[0] !== line) { rows.push(diagnostic(root, source, "error", "The spec entry is malformed.", `${section}:specs:line:${index + 1}`)); continue; }
      const staticGem = section === "GEM";
      rows.push(row(root, source, { ecosystem: "ruby", kind: "dependency", dependency_role: null, origin: "lock", name: match[1]!, requested: null, locked: staticGem ? match[2]! : null, locator: `${section}:specs:line:${index + 1}`, status: staticGem ? "observed" : "unresolved", detail: staticGem ? null : `The static reader does not interpret ${section} source versions.` }));
    }
  }
  for (const unsupported of ["GIT", "PATH"]) if (text.split(/\r?\n/).includes(unsupported)) rows.push(diagnostic(root, source, "unsupported", `${unsupported} source details are not interpreted.`, unsupported));
  return rows.length ? rows : [diagnostic(root, source, "error", "Gemfile.lock has no supported dependency entries.")];
}

async function parseSource(root: string, source: string, budget: ReadBudget, cachedText?: string): Promise<Row[]> {
  if (unsupportedFiles.has(basename(source))) return [diagnostic(root, source, "unsupported", "This source format is not supported.")];
  const text = cachedText ?? await readRegularFile(source, budget);
  const format = basename(source);
  const evidence = source.endsWith("package.json") ? packageJsonRows(root, source, text)
    : source.endsWith("package-lock.json") ? packageLockRows(root, source, text)
    : source.endsWith("Gemfile.lock") ? gemfileLockRows(root, source, text)
    : fixedValueRows(root, source, text);
  const ecosystem = format.startsWith("package") ? "npm" : format === "Gemfile.lock" ? "ruby" : "tool";
  return [sourceObserved(root, source, ecosystem, format), ...evidence];
}

export type ScanLimits = { depth: number; entries: number; totalBytes: number; rows: number };
export const defaultLimits: ScanLimits = { depth: MAX_WORKSPACE_DEPTH, entries: MAX_ENTRIES, totalBytes: MAX_TOTAL_BYTES, rows: MAX_ROWS };

const excludedWorkspaceDirectories = new Set([...excludedDirectories, "tmp", "temp"]);
export type WorkspaceDiscovery = { projects: string[]; diagnostics: Row[]; entries: number };

export function workspacePatterns(root: string, source: string, text: string): { patterns: string[]; diagnostics: Row[] } {
  const document = object(JSON.parse(text));
  if (document === null) throw new Error("package.json must contain a JSON object");
  if (document.workspaces === undefined) return { patterns: [], diagnostics: [] };
  const workspaces = Array.isArray(document.workspaces) ? document.workspaces : object(document.workspaces)?.packages;
  if (!Array.isArray(workspaces)) return { patterns: [], diagnostics: [diagnostic(root, source, "error", "workspaces must be an array or an object with a packages array.", "/workspaces")] };
  const patterns: string[] = [];
  const diagnostics: Row[] = [];
  for (const [index, value] of workspaces.entries()) {
    const locator = Array.isArray(document.workspaces) ? `/workspaces/${index}` : `/workspaces/packages/${index}`;
    if (typeof value !== "string" || value === "" || value.includes("\0") || value.startsWith("/") || value.split("/").some((part) => part === "..") || /[!{}[\]()\\]/.test(value) || value.split("/").some((part) => part.includes("**") && part !== "**")) {
      diagnostics.push(diagnostic(root, source, "unsupported", "The workspace pattern uses unsupported or unsafe syntax.", locator));
      continue;
    }
    if (patterns.length >= MAX_WORKSPACE_PATTERNS) {
      diagnostics.push(diagnostic(root, source, "error", `Workspace discovery stopped after ${MAX_WORKSPACE_PATTERNS} patterns.`, "workspace-pattern-limit"));
      break;
    }
    patterns.push(value.replace(/\/+$/, ""));
  }
  return { patterns, diagnostics };
}

function matchesSegment(name: string, pattern: string): boolean {
  let expression = "^";
  for (const character of pattern) {
    if (character === "*") expression += "[^/]*";
    else if (character === "?") expression += "[^/]";
    else expression += character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`${expression}$`).test(name);
}

export async function discoverWorkspaces(root: string, source: string, patterns: readonly string[], limits: ScanLimits): Promise<WorkspaceDiscovery> {
  const projects = new Set<string>();
  const diagnostics: Row[] = [];
  let entries = 0;
  for (const [patternIndex, pattern] of patterns.entries()) {
    const parts = pattern.split("/").filter((part) => part !== "" && part !== ".");
    const states: { directory: string; index: number; depth: number }[] = [{ directory: root, index: 0, depth: 0 }];
    const seen = new Set<string>();
    while (states.length) {
      const state = states.shift()!;
      const stateKey = `${state.directory}\0${state.index}`;
      if (seen.has(stateKey)) continue;
      seen.add(stateKey);
      if (state.index === parts.length) {
        projects.add(state.directory);
        if (projects.size > MAX_PROJECTS) {
          diagnostics.push(diagnostic(root, source, "error", `Workspace discovery stopped after ${MAX_PROJECTS} projects.`, "workspace-project-limit"));
          return { projects: [...projects].slice(0, MAX_PROJECTS), diagnostics, entries };
        }
        continue;
      }
      const part = parts[state.index]!;
      if (part === "**") states.push({ ...state, index: state.index + 1 });
      if (state.depth >= limits.depth) {
        diagnostics.push(diagnostic(root, source, "error", `Workspace discovery stopped at depth ${limits.depth}.`, `workspace:${patternIndex}`));
        continue;
      }
      if (part !== "**" && !/[?*]/.test(part)) {
        if (excludedWorkspaceDirectories.has(part)) continue;
        const next = join(state.directory, part);
        entries += 1;
        if (entries > limits.entries) {
          diagnostics.push(diagnostic(root, source, "error", `Workspace discovery stopped after ${limits.entries} entries.`, "workspace-entry-limit"));
          return { projects: [...projects], diagnostics, entries };
        }
        try {
          const stat = await lstat(next);
          if (stat.isSymbolicLink()) diagnostics.push(diagnostic(root, next, "unsupported", "A symbolic link cannot be a workspace path.", `workspace:${patternIndex}`));
          else if (stat.isDirectory()) states.push({ directory: next, index: state.index + 1, depth: state.depth + 1 });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") diagnostics.push(diagnostic(root, next, "error", `Cannot inspect a workspace path: ${(error as Error).message}`, `workspace:${patternIndex}`));
        }
        continue;
      }
      let directory;
      try { directory = await opendir(state.directory); }
      catch (error) {
        diagnostics.push(diagnostic(root, source, "error", `Cannot read a workspace directory: ${(error as Error).message}`, `workspace:${patternIndex}`));
        continue;
      }
      for await (const entry of directory) {
        entries += 1;
        if (entries > limits.entries) {
          diagnostics.push(diagnostic(root, source, "error", `Workspace discovery stopped after ${limits.entries} entries.`, "workspace-entry-limit"));
          return { projects: [...projects], diagnostics, entries };
        }
        if (excludedWorkspaceDirectories.has(entry.name)) continue;
        const matches = part === "**" || matchesSegment(entry.name, part);
        if (!matches) continue;
        if (entry.isSymbolicLink()) {
          diagnostics.push(diagnostic(root, join(state.directory, entry.name), "unsupported", "A symbolic link cannot be a workspace path.", `workspace:${patternIndex}`));
          continue;
        }
        if (!entry.isDirectory()) continue;
        states.push({ directory: join(state.directory, entry.name), index: part === "**" ? state.index : state.index + 1, depth: state.depth + 1 });
      }
    }
  }
  return { projects: [...projects], diagnostics, entries };
}

export async function scanRepositoryVersions(root: string, limits: ScanLimits = defaultLimits): Promise<{ rows: Row[]; failed: boolean }> {
  const rows: Row[] = [];
  const budget: ReadBudget = { used: 0, limit: limits.totalBytes };
  let failed = false;
  const rootStat = await lstat(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error("repository root must be a real directory");
  const projects = [root];
  const cached = new Map<string, string>();
  const rootPackage = join(root, "package.json");
  try {
    const stat = await lstat(rootPackage);
    if (stat.isFile() && !stat.isSymbolicLink()) {
      const text = await readRegularFile(rootPackage, budget);
      cached.set(rootPackage, text);
      const workspace = workspacePatterns(root, rootPackage, text);
      rows.push(...workspace.diagnostics);
      const discovered = await discoverWorkspaces(root, rootPackage, workspace.patterns, limits);
      projects.push(...discovered.projects.filter((project) => project !== root));
      rows.push(...discovered.diagnostics);
    }
  } catch (error) {
    const failure = error as NodeJS.ErrnoException;
    if (failure.code !== "ENOENT") {
      rows.push(diagnostic(root, rootPackage, "error", failure.message, error instanceof ScanByteLimitError ? "scan-byte-limit" : null));
      failed = true;
      if (error instanceof ScanByteLimitError) return { rows, failed };
    }
  }
  for (const project of [...new Set(projects)]) {
    const names = project === root ? [...supportedFiles, ...unsupportedFiles] : ["package.json", "package-lock.json"];
    let found = false;
    for (const name of names) {
      const path = join(project, name);
      let stat;
      try { stat = await lstat(path); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; rows.push(diagnostic(root, path, "error", (error as Error).message)); failed = true; continue; }
      if (stat.isSymbolicLink() || !stat.isFile()) { rows.push(diagnostic(root, path, "unsupported", "The source is not a regular file and is not read.")); continue; }
      found = true;
      try {
        const parsed = await parseSource(root, path, budget, cached.get(path));
        for (const parsedRow of parsed) {
          if (rows.length >= limits.rows) { rows.push(diagnostic(root, path, "error", `Scan stopped after ${limits.rows} evidence rows.`, "scan-row-limit")); return { rows, failed: true }; }
          rows.push(parsedRow);
          if (parsedRow.status === "error") failed = true;
        }
      } catch (error) {
        rows.push(diagnostic(root, path, "error", (error as Error).message, error instanceof ScanByteLimitError ? "scan-byte-limit" : null));
        failed = true;
        if (error instanceof ScanByteLimitError) return { rows, failed };
      }
    }
    if (!found) rows.push(emptyProject(root, project));
  }
  failed ||= rows.some((entry) => entry.status === "error");
  return { rows, failed };
}

export const repositoryVersionsLoader: Loader = {
  name: "repository_versions", tables: ["repository_versions"], after: [],
  afterForScope: discoveryLoaders,
  async load(ctx: LoadContext) {
    if (ctx.scope === "root" && ctx.roots.length !== 1) throw new Error("repository-versions root scope requires one root");
    const roots = await rootsInScope(ctx);
    let failed = false;
    for (const root of roots) {
      try {
        const result = await scanRepositoryVersions(root);
        const identity = ctx.repo.repositoryIdOf ? await ctx.repo.repositoryIdOf(root) : await repositoryIdentity(root);
        for (const entry of result.rows) entry.repository_id = identity.id;
        if (identity.error !== null) {
          result.rows.push(diagnostic(root, root, "error", identity.error, "repository-identity"));
          result.failed = true;
        }
        const loaded = await ctx.db.run(repositoryVersionCommands.load, { rows: result.rows });
        if (!loaded.ok) throw new Error(`repository_versions: ${loaded.kind}`);
        failed ||= result.failed;
      } catch (error) {
        const loaded = await ctx.db.run(repositoryVersionCommands.load, { rows: [diagnostic(root, root, "error", (error as Error).message, "root")] });
        if (!loaded.ok) throw new Error(`repository_versions: ${loaded.kind}`);
        failed = true;
      }
    }
    if (failed) throw new Error("repository version observation is incomplete; read error rows");
  },
};
