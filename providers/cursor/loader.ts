// Fills recent Cursor agent conversations from the IDE's local state database.
// The index is one key or one table. Message bubbles stay unread: they are history.
// Boundary: this provider's table only. It starts no process and does not write the database.
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import type { LoadContext, Loader } from "../../core/loader.ts";
import { cursorCommands } from "./module.ts";
import type { CursorAgentsId } from "./solarsql.generated.ts";

// The sidebar index can list every past conversation. Thirty-two is the same
// bound the Codex quota reader uses for recent files, and it caps how many
// composer documents this call parses.
export const recentCursorAgents = 32;
// A Cursor 2.x install keeps the index in each workspace database. The newest
// workspace files are enough to find recent conversations.
export const workspaceScanLimit = 64;

export type CursorHeader = {
  composerId: string;
  name: string | null;
  unifiedMode: string | null;
  workspacePath: string | null;
  isArchived: number | null;
  isSubagent: number | null;
  createdAt: number | null;
  updatedAt: number | null;
};

export type CursorAgentRow = {
  composer_id: CursorAgentsId;
  name: string | null;
  status: string | null;
  unified_mode: string | null;
  model: string | null;
  worktree_path: string | null;
  branch_name: string | null;
  workspace_path: string | null;
  root: string | null;
  is_archived: number | null;
  is_subagent: number | null;
  created_at: number | null;
  updated_at: number | null;
};

type ComposerDetail = {
  name: string | null;
  status: string | null;
  unifiedMode: string | null;
  model: string | null;
  worktreePath: string | null;
  branchName: string | null;
  createdAt: number | null;
  updatedAt: number | null;
};

export function cursorUserDirectory(home: string, platform: NodeJS.Platform): string {
  if (platform === "darwin") return join(home, "Library", "Application Support", "Cursor", "User");
  return join(home, ".config", "Cursor", "User");
}

export function fileUriToPath(uri: string): string | null {
  if (!uri.startsWith("file:")) return null;
  try {
    const path = fileURLToPath(uri);
    return path.startsWith("/") ? path : null;
  } catch {
    return null;
  }
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function flag(value: unknown): number | null {
  if (value === true || value === 1) return 1;
  if (value === false || value === 0) return 0;
  return null;
}

function decodeText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return Buffer.from(value).toString("utf8");
  return null;
}

function workspacePathFrom(value: unknown): string | null {
  const record = object(value);
  if (record === null) return null;
  const uri = object(record.uri) ?? record;
  const fsPath = text(uri.fsPath);
  if (fsPath !== null && fsPath.startsWith("/")) return fsPath;
  const external = text(uri.external);
  return external === null ? null : fileUriToPath(external);
}

function headerFields(record: Record<string, unknown>): Omit<CursorHeader, "composerId"> {
  return {
    name: text(record.name),
    unifiedMode: text(record.unifiedMode),
    workspacePath: workspacePathFrom(record.workspaceIdentifier),
    isArchived: flag(record.isArchived),
    isSubagent: flag(record.isSubagent),
    createdAt: integer(record.createdAt),
    updatedAt: integer(record.lastUpdatedAt) ?? integer(record.updatedAt),
  };
}

function headerFrom(value: unknown): CursorHeader | null {
  const record = object(value);
  const composerId = record === null ? null : text(record.composerId);
  if (record === null || composerId === null) return null;
  return { composerId, ...headerFields(record) };
}

export function headersFromIndex(document: unknown): CursorHeader[] {
  const record = object(document);
  const composers = record === null ? null : record.allComposers;
  if (!Array.isArray(composers)) return [];
  return composers.flatMap((entry) => {
    const header = headerFrom(entry);
    return header === null ? [] : [header];
  });
}

export function detailFromComposer(document: unknown): ComposerDetail {
  const record = object(document);
  const modelConfig = record === null ? null : object(record.modelConfig);
  const worktree = record === null ? null : object(record.gitWorktree);
  const model = text(modelConfig?.modelName);
  return {
    name: record === null ? null : text(record.name),
    status: record === null ? null : text(record.status),
    unifiedMode: record === null ? null : text(record.unifiedMode),
    model,
    worktreePath: worktree === null ? null : text(worktree.worktreePath),
    branchName: worktree === null ? null : text(worktree.branchName),
    createdAt: record === null ? null : integer(record.createdAt),
    updatedAt: record === null ? null : integer(record.lastUpdatedAt) ?? integer(record.updatedAt),
  };
}

// A repeated id keeps the newer timestamp. Null timestamps sort after dated rows.
export function selectRecent(rows: readonly CursorHeader[], limit: number): CursorHeader[] {
  const byId = new Map<string, CursorHeader>();
  for (const row of rows) {
    const current = byId.get(row.composerId);
    if (current === undefined || (row.updatedAt ?? -1) >= (current.updatedAt ?? -1)) byId.set(row.composerId, row);
  }
  return [...byId.values()].sort((left, right) => {
    if (left.updatedAt === null && right.updatedAt === null) return left.composerId < right.composerId ? -1 : left.composerId > right.composerId ? 1 : 0;
    if (left.updatedAt === null) return 1;
    if (right.updatedAt === null) return -1;
    return right.updatedAt - left.updatedAt || (left.composerId < right.composerId ? -1 : left.composerId > right.composerId ? 1 : 0);
  }).slice(0, limit);
}

function tableExists(db: DatabaseSync, name: string): boolean {
  return db.prepare("select 1 as ok from sqlite_master where type = 'table' and name = ?").get(name) !== undefined;
}

function columnNames(db: DatabaseSync, table: string): Set<string> {
  const rows = db.prepare(`select name from pragma_table_info(?)`).all(table) as { name: string }[];
  return new Set(rows.map((row) => row.name));
}

function readItem(db: DatabaseSync, key: string): unknown {
  if (!tableExists(db, "ItemTable")) return undefined;
  const row = db.prepare("select value from ItemTable where key = ?").get(key) as { value: unknown } | undefined;
  return row?.value;
}

function parseJson(value: unknown): unknown {
  const decoded = decodeText(value);
  if (decoded === null) return undefined;
  return JSON.parse(decoded);
}

function headersFromComposerTable(db: DatabaseSync): CursorHeader[] | null {
  if (!tableExists(db, "composerHeaders")) return null;
  const columns = columnNames(db, "composerHeaders");
  if (!columns.has("composerId")) return null;
  const selected = ["composerId", "createdAt", "lastUpdatedAt", "isArchived", "isSubagent", "value"].filter((name) => columns.has(name));
  const rows = db.prepare(`select ${selected.map((name) => `"${name}"`).join(", ")} from composerHeaders`).all() as Record<string, unknown>[];
  return rows.flatMap((row) => {
    // The id lives in the composerId column. The value blob is the same header
    // document and often omits composerId, so its title and workspace still count.
    const parsed = row.value === undefined ? null : object(parseJson(row.value));
    const composerId = text(row.composerId) ?? (parsed === null ? null : text(parsed.composerId));
    if (composerId === null) return [];
    const fields = parsed === null ? null : headerFields(parsed);
    return [{
      composerId,
      name: fields?.name ?? null,
      unifiedMode: fields?.unifiedMode ?? null,
      workspacePath: fields?.workspacePath ?? null,
      isArchived: columns.has("isArchived") ? flag(row.isArchived) : fields?.isArchived ?? null,
      isSubagent: columns.has("isSubagent") ? flag(row.isSubagent) : fields?.isSubagent ?? null,
      createdAt: columns.has("createdAt") ? integer(row.createdAt) ?? fields?.createdAt ?? null : fields?.createdAt ?? null,
      updatedAt: columns.has("lastUpdatedAt") ? integer(row.lastUpdatedAt) ?? fields?.updatedAt ?? null : fields?.updatedAt ?? null,
    }];
  });
}

function headersFromGlobalIndex(db: DatabaseSync): CursorHeader[] {
  const fromTable = headersFromComposerTable(db);
  if (fromTable !== null && fromTable.length > 0) return fromTable;
  const stored = readItem(db, "composer.composerHeaders");
  if (stored === undefined) return [];
  return headersFromIndex(parseJson(stored));
}

async function headersFromWorkspaces(userDirectory: string): Promise<CursorHeader[]> {
  const storage = join(userDirectory, "workspaceStorage");
  let names: string[];
  try {
    names = await readdir(storage);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const databases = (await Promise.all(names.map(async (name) => {
    const path = join(storage, name, "state.vscdb");
    try {
      const info = await stat(path);
      return info.isFile() ? { path, mtimeMs: info.mtimeMs, workspace: join(storage, name, "workspace.json") } : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }))).filter((entry) => entry !== null).sort((left, right) => right.mtimeMs - left.mtimeMs).slice(0, workspaceScanLimit);
  const headers: CursorHeader[] = [];
  for (const entry of databases) {
    const db = new DatabaseSync(entry.path, { readOnly: true });
    try {
      const stored = readItem(db, "composer.composerData");
      if (stored === undefined) continue;
      const folder = await workspaceFolder(entry.workspace);
      for (const header of headersFromIndex(parseJson(stored))) {
        headers.push(folder === null || header.workspacePath !== null ? header : { ...header, workspacePath: folder });
      }
    } finally {
      db.close();
    }
  }
  return headers;
}

async function workspaceFolder(path: string): Promise<string | null> {
  try {
    const document = object(JSON.parse(await readFile(path, "utf8")));
    const folder = document === null ? null : text(document.folder);
    return folder === null ? null : fileUriToPath(folder);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function composerDetail(db: DatabaseSync, composerId: string): ComposerDetail | null {
  if (!tableExists(db, "cursorDiskKV")) return null;
  const row = db.prepare("select value from cursorDiskKV where key = ?").get(`composerData:${composerId}`) as { value: unknown } | undefined;
  if (row === undefined) return null;
  // One unreadable document leaves that agent's model empty. The index still names the agent.
  try {
    return detailFromComposer(parseJson(row.value));
  } catch {
    return null;
  }
}

function rowFrom(header: CursorHeader, detail: ComposerDetail | null, root: string | null): CursorAgentRow {
  const worktreePath = detail?.worktreePath ?? null;
  return {
    composer_id: header.composerId as CursorAgentsId,
    name: detail?.name ?? header.name,
    status: detail?.status ?? null,
    unified_mode: detail?.unifiedMode ?? header.unifiedMode,
    model: detail?.model ?? null,
    worktree_path: worktreePath,
    branch_name: detail?.branchName ?? null,
    workspace_path: header.workspacePath,
    root,
    is_archived: header.isArchived,
    is_subagent: header.isSubagent,
    created_at: detail?.createdAt ?? header.createdAt,
    updated_at: detail?.updatedAt ?? header.updatedAt,
  };
}

async function databaseExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export const cursorLoader: Loader = {
  name: "cursor",
  tables: ["cursor_agents"],
  after: [],
  async load(ctx) {
    const home = ctx.env["HOME"];
    if (!home) throw new Error("cursor: HOME is not set");
    const userDirectory = cursorUserDirectory(home, process.platform);
    const globalDatabase = join(userDirectory, "globalStorage", "state.vscdb");
    let headers: CursorHeader[] = [];
    let detailDatabase: DatabaseSync | null = null;
    try {
      if (await databaseExists(globalDatabase)) {
        detailDatabase = new DatabaseSync(globalDatabase, { readOnly: true });
        headers = headersFromGlobalIndex(detailDatabase);
      }
      if (headers.length === 0) headers = await headersFromWorkspaces(userDirectory);
      const selected = selectRecent(headers, recentCursorAgents);
      const details = new Map(selected.map((header) => [header.composerId, detailDatabase === null ? null : composerDetail(detailDatabase, header.composerId)] as const));
      const paths = [...new Set(selected.flatMap((header) => {
        const path = details.get(header.composerId)?.worktreePath ?? header.workspacePath;
        return path === null || path === undefined ? [] : [path];
      }))];
      const roots = new Map(await Promise.all(paths.map(async (path) => [path, await ctx.repo.rootOf(path)] as const)));
      const rows = selected.map((header) => {
        const detail = details.get(header.composerId) ?? null;
        const located = detail?.worktreePath ?? header.workspacePath;
        return rowFrom(header, detail, located === null ? null : roots.get(located) ?? null);
      });
      const loaded = await ctx.db.run(cursorCommands.loadAgents, { rows });
      if (!loaded.ok) throw new Error(`cursor_agents: ${loaded.kind}`);
    } finally {
      detailDatabase?.close();
    }
  },
};
