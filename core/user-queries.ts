// User-defined named queries: find and read configuration files without
// executing their SQL. Boundary: cli.ts selects a query; run.ts prepares it.
import { readdirSync, readFileSync, type Dirent } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { catalog, reports } from "../catalog.ts";
import { sqlParameterNames } from "./run.ts";

export type UserQuery = {
  name: string;
  description: string;
  sql: string;
  path: string;
  params: string[];
};

const namePattern = /^[a-z][a-z0-9-]*$/;
const suffix = ".sql";

export function userQueriesDirectory(env: Readonly<Record<string, string | undefined>>): string {
  const configHome = env["XDG_CONFIG_HOME"] || join(env["HOME"] || homedir(), ".config");
  return join(configHome, "spacequery", "queries");
}

export function loadUserQueries(env: Readonly<Record<string, string | undefined>>): UserQuery[] {
  const directory = userQueriesDirectory(env);
  let entries: Dirent[];
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    warn(`cannot read user query directory ${directory}: ${message(error)}`);
    return [];
  }

  const queries: UserQuery[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile()) continue;
    const path = join(directory, entry.name);
    const name = entry.name.endsWith(suffix) ? entry.name.slice(0, -suffix.length) : "";
    if (!namePattern.test(name)) {
      warn(`${path} is not a query file named [a-z][a-z0-9-]*.sql`);
      continue;
    }
    if (name === "ui") {
      warn(`${path} uses the reserved terminal browser name ui`);
      continue;
    }
    if (Object.hasOwn(catalog, name)) {
      warn(`${path} shadows the built-in query ${name}; the built-in wins`);
      continue;
    }
    if (Object.hasOwn(reports, name)) {
      warn(`${path} shadows the built-in report ${name}; the report wins`);
      continue;
    }

    let sql: string;
    try {
      sql = readFileSync(path, "utf8");
    } catch (error) {
      warn(`cannot read user query ${path}: ${message(error)}`);
      continue;
    }
    const firstLine = sql.split(/\r?\n/, 1)[0] ?? "";
    queries.push({
      name,
      description: firstLine.startsWith("-- ") ? firstLine.slice(3) : "",
      sql,
      path,
      params: sqlParameterNames(sql),
    });
  }
  return queries;
}

function warn(text: string): void {
  process.stderr.write(`spacequery: ${text}\n`);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
