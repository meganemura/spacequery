// Inventories recognized repository configuration files at the root and in
// root-declared npm workspaces. It reads only root package.json for discovery.
// Boundary: this provider's table only.
import { lstat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type { LoadContext, Loader } from "../../core/loader.ts";
import { discoveryLoaders, rootsInScope } from "../../core/scope.ts";
import {
  defaultLimits, discoverWorkspaces, readRegularFile, repositorySourceDefinitions, workspacePatterns,
  type ReadBudget,
} from "../repository-versions/public.ts";
import { repositoryConfigFileCommands } from "./module.ts";
import type { RepositoryConfigFilesId } from "./solarsql.generated.ts";

type InventoryRow = {
  id: RepositoryConfigFilesId;
  root: string;
  project_path: string;
  path: string | null;
  format: string | null;
  category: "manifest" | "lock" | "version-file" | "tool-config" | null;
  parse_support: "supported" | "unsupported" | null;
  observation_kind: "file" | "discovery";
  status: "observed" | "skipped" | "incomplete" | "error";
  detail: string | null;
};

function projectPath(root: string, path: string): string { return relative(root, dirname(path)) || "."; }
function discoveryRow(root: string, relatedPath: string, status: "incomplete" | "error", detail: string, key: string): InventoryRow {
  return {
    id: `${root}\0discovery\0${key}\0${relatedPath}` as RepositoryConfigFilesId,
    root, project_path: ".", path: relatedPath, format: null, category: null, parse_support: null,
    observation_kind: "discovery", status, detail,
  };
}

export async function scanRepositoryConfigFiles(root: string): Promise<{ rows: InventoryRow[]; failed: boolean }> {
  const rootStat = await lstat(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error("repository root must be a real directory");
  const rows: InventoryRow[] = [];
  const projects = [root];
  const rootPackage = join(root, "package.json");
  const budget: ReadBudget = { used: 0, limit: defaultLimits.totalBytes };
  try {
    const stat = await lstat(rootPackage);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      rows.push(discoveryRow(root, rootPackage, "incomplete", "Root package.json is not a regular file, so workspace discovery skipped it.", "root-package"));
    } else {
      const text = await readRegularFile(rootPackage, budget);
      const patterns = workspacePatterns(root, rootPackage, text);
      rows.push(...patterns.diagnostics.map((entry) => discoveryRow(root, entry.source,
        entry.status === "error" ? "error" : "incomplete", entry.detail ?? "Workspace discovery is incomplete.", entry.locator ?? "workspace")));
      const discovered = await discoverWorkspaces(root, rootPackage, patterns.patterns, defaultLimits);
      projects.push(...discovered.projects.filter((project) => project !== root));
      rows.push(...discovered.diagnostics.map((entry) => discoveryRow(root, entry.source,
        entry.status === "error" ? "error" : "incomplete", entry.detail ?? "Workspace discovery is incomplete.", entry.locator ?? "workspace")));
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") rows.push(discoveryRow(root, rootPackage, "error",
      error instanceof SyntaxError ? "Root package.json is not valid JSON." : (error as Error).message, "root-package"));
  }

  for (const project of [...new Set(projects)]) {
    for (const definition of repositorySourceDefinitions) {
      const path = join(project, definition.name);
      let stat;
      try { stat = await lstat(path); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        rows.push({
          id: `${path}\0file\0error` as RepositoryConfigFilesId, root, project_path: projectPath(root, path), path,
          format: definition.format, category: definition.category, parse_support: definition.parseSupport,
          observation_kind: "file", status: "error", detail: (error as Error).message,
        });
        continue;
      }
      const regular = stat.isFile() && !stat.isSymbolicLink();
      rows.push({
        id: `${path}\0file` as RepositoryConfigFilesId, root, project_path: projectPath(root, path), path,
        format: definition.format, category: definition.category, parse_support: definition.parseSupport,
        observation_kind: "file", status: regular ? "observed" : "skipped",
        detail: regular ? null : "The path is not a regular file and was not opened.",
      });
    }
  }
  return { rows, failed: rows.some((entry) => entry.status === "error" || entry.status === "incomplete") };
}

export const repositoryConfigFilesLoader: Loader = {
  name: "repository_config_files", tables: ["repository_config_files"], after: [],
  afterForScope: discoveryLoaders,
  async load(ctx: LoadContext) {
    if (ctx.scope === "root" && ctx.roots.length !== 1) throw new Error("repository-config-files root scope requires one root");
    let failed = false;
    for (const root of await rootsInScope(ctx)) {
      try {
        const result = await scanRepositoryConfigFiles(root);
        const loaded = await ctx.db.run(repositoryConfigFileCommands.load, { rows: result.rows });
        if (!loaded.ok) throw new Error(`repository_config_files: ${loaded.kind}`);
        failed ||= result.failed;
      } catch (error) {
        const row = discoveryRow(root, root, "error", (error as Error).message, "root");
        const loaded = await ctx.db.run(repositoryConfigFileCommands.load, { rows: [row] });
        if (!loaded.ok) throw new Error(`repository_config_files: ${loaded.kind}`);
        failed = true;
      }
    }
    if (failed) throw new Error("repository configuration file inventory is incomplete; read diagnostic rows");
  },
};
