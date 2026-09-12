// User provider declarations become runtime tables and loaders for one call.
// Boundary: this module reads declaration files and inserts command output;
// the core schedules loaders and the CLI selects the configuration directory.
import { readdirSync, readFileSync, type Dirent } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { LoadContext, Loader, Scope } from "./loader.ts";
import { rootsInScope } from "./scope.ts";

type UserTable = { name: string; sql: string };
type UserScope = "call" | "root";
type UserProviderDeclaration = {
  tables: UserTable[];
  command: [string, ...string[]];
  scope: UserScope;
  description: string;
};

export type UserProvider = Loader & {
  description: string;
  path: string;
  tableDeclarations: readonly UserTable[];
};

const namePattern = /^[a-z][a-z0-9-]*$/;
const suffix = ".json";

export function userProvidersDirectory(env: Readonly<Record<string, string | undefined>>): string {
  const configHome = env["XDG_CONFIG_HOME"] || join(env["HOME"] || homedir(), ".config");
  return join(configHome, "spacequery", "providers");
}

export function loadUserProviders(env: Readonly<Record<string, string | undefined>>, builtInLoaders: readonly Loader[]): UserProvider[] {
  const directory = userProvidersDirectory(env);
  let entries: Dirent[];
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    warn(`cannot read user provider directory ${directory}: ${message(error)}`);
    return [];
  }

  const builtInNames = new Set(builtInLoaders.map((loader) => loader.name));
  const reservedTables = new Set(["providers", "solarsql_assert", ...builtInLoaders.flatMap((loader) => loader.tables)].map((name) => name.toLowerCase()));
  const claimedTables = new Set<string>();
  const providers: UserProvider[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile()) continue;
    const path = join(directory, entry.name);
    const name = entry.name.endsWith(suffix) ? entry.name.slice(0, -suffix.length) : "";
    if (!namePattern.test(name)) {
      warn(`${path} is not a provider file named [a-z][a-z0-9-]*.json`);
      continue;
    }
    if (builtInNames.has(name)) {
      warn(`${path} names the built-in provider ${name}; the file is skipped`);
      continue;
    }

    try {
      const declaration = parseDeclaration(readFileSync(path, "utf8"));
      const declarationTables = new Set<string>();
      for (const table of declaration.tables) {
        const normalized = table.name.toLowerCase();
        if (reservedTables.has(normalized)) throw new Error(`table ${table.name} is built in`);
        if (claimedTables.has(normalized)) throw new Error(`table ${table.name} belongs to another user provider`);
        if (declarationTables.has(normalized)) throw new Error(`table ${table.name} is declared more than once`);
        declarationTables.add(normalized);
        validateTable(table);
      }
      const provider = makeProvider(name, path, declaration);
      providers.push(provider);
      for (const table of declaration.tables) claimedTables.add(table.name.toLowerCase());
    } catch (error) {
      warn(`cannot load user provider ${path}: ${message(error)}`);
    }
  }
  return providers;
}

function parseDeclaration(text: string): UserProviderDeclaration {
  const value = recordOrNull(JSON.parse(text));
  if (value === null) throw new Error("the declaration must be an object");
  const tablesValue = recordOrNull(value.tables);
  if (tablesValue === null || Object.keys(tablesValue).length === 0) throw new Error("tables must be a non-empty object");
  const tables = Object.entries(tablesValue).map(([name, sql]) => {
    if (typeof sql !== "string") throw new Error(`table ${name} must have a create table statement`);
    return { name, sql };
  });
  if (!Array.isArray(value.command) || value.command.length === 0 || value.command[0] === "" || !value.command.every((part) => typeof part === "string")) {
    throw new Error("command must be a non-empty array of strings");
  }
  if (value.scope !== "call" && value.scope !== "root") throw new Error("scope must be call or root");
  if (value.description !== undefined && typeof value.description !== "string") throw new Error("description must be a string");
  return {
    tables,
    command: value.command as [string, ...string[]],
    scope: value.scope,
    description: value.description ?? "",
  };
}

function validateTable(table: UserTable): void {
  const raw = new DatabaseSync(":memory:");
  try {
    const statement = raw.prepare(table.sql);
    if (!isSqlTrivia(table.sql.slice(statement.sourceSQL.length))) throw new Error(`table ${table.name} must have one create table statement`);
    raw.exec(statement.sourceSQL);
    const rows = raw.prepare("select name, type from sqlite_schema where name not like 'sqlite_%'").all();
    if (rows.length !== 1 || rows[0]!.type !== "table" || rows[0]!.name !== table.name) {
      throw new Error(`table ${table.name} must have one create table statement for its name`);
    }
    const initialRows = raw.prepare(`select count(*) as count from ${quoteIdentifier(table.name)}`).get();
    if (initialRows!.count !== 0) throw new Error(`table ${table.name} must be empty after creation`);
  } finally {
    raw.close();
  }
}

function isSqlTrivia(text: string): boolean {
  return /^(?:\s|--[^\r\n]*(?:\r?\n|$)|\/\*[\s\S]*?\*\/)*$/.test(text);
}

function makeProvider(name: string, path: string, declaration: UserProviderDeclaration): UserProvider {
  return {
    name,
    description: declaration.description,
    path,
    tables: declaration.tables.map((table) => table.name),
    tableDeclarations: declaration.tables,
    after: [],
    afterForScope(scope: Scope) {
      if (declaration.scope !== "root" || scope === "root") return [];
      return scope === "all" ? ["repos", "herdr"] : ["herdr"];
    },
    async load(ctx: LoadContext) {
      const roots = declaration.scope === "call" ? [undefined] : await rootsInScope(ctx);
      const columns = new Map(declaration.tables.map((table) => [table.name, tableColumns(ctx.raw, table.name)]));
      const rows = new Map(declaration.tables.map((table) => [table.name, [] as Record<string, unknown>[]]));
      for (const root of roots) {
        const output = await ctx.exec(declaration.command[0], declaration.command.slice(1), root);
        collectRows(JSON.parse(output), declaration.tables, columns, rows, root);
      }
      insertRows(ctx.raw, declaration.tables, columns, rows);
    },
  };
}

function tableColumns(raw: DatabaseSync, table: string): string[] {
  return raw.prepare("select name from pragma_table_info(?) order by cid").all(table).map((row) => String(row.name));
}

function collectRows(output: unknown, tables: readonly UserTable[], columns: ReadonlyMap<string, readonly string[]>, rows: Map<string, Record<string, unknown>[]>, root: string | undefined): void {
  const byTable = Array.isArray(output) && tables.length === 1 ? { [tables[0]!.name]: output } : recordOrNull(output);
  if (byTable === null) throw new Error("the command output must be a table object or one row array");
  const declared = new Set(tables.map((table) => table.name));
  for (const name of Object.keys(byTable)) if (!declared.has(name)) throw new Error(`command output names unknown table ${name}`);
  for (const table of tables) {
    const values = byTable[table.name];
    if (!Array.isArray(values)) throw new Error(`command output for ${table.name} must be an array`);
    const allowed = new Set(columns.get(table.name)!);
    for (const value of values) {
      const row = recordOrNull(value);
      if (row === null) throw new Error(`a row for ${table.name} must be an object`);
      for (const key of Object.keys(row)) if (!allowed.has(key)) throw new Error(`row for ${table.name} has unknown column ${key}`);
      if (root !== undefined && allowed.has("root") && !Object.hasOwn(row, "root")) row.root = root;
      rows.get(table.name)!.push(row);
    }
  }
}

function insertRows(raw: DatabaseSync, tables: readonly UserTable[], columns: ReadonlyMap<string, readonly string[]>, rows: ReadonlyMap<string, readonly Record<string, unknown>[]>): void {
  raw.exec("begin");
  try {
    for (const table of tables) {
      const names = columns.get(table.name)!;
      const insert = raw.prepare(`insert into ${quoteIdentifier(table.name)} (${names.map(quoteIdentifier).join(", ")}) values (${names.map(() => "?").join(", ")})`);
      const expected = rows.get(table.name)!;
      for (const row of expected) {
        const result = insert.run(...names.map((column) => Object.hasOwn(row, column) ? row[column] as never : null));
        if (result.changes !== 1) throw new Error(`a row for ${table.name} was not inserted`);
      }
      const stored = raw.prepare(`select count(*) as count from ${quoteIdentifier(table.name)}`).get();
      if (stored!.count !== expected.length) throw new Error(`some rows for ${table.name} replaced earlier rows`);
    }
    raw.exec("commit");
  } catch (error) {
    try { raw.exec("rollback"); } catch { /* A user table can select conflict rollback. */ }
    throw error;
  }
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function warn(text: string): void {
  process.stderr.write(`spacequery: ${text}\n`);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
