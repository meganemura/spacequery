// The browser catalog comes from the migrated schema and query definitions.
// This module inspects empty tables; provider execution stays with the CLI.
import { DatabaseSync } from "node:sqlite";
import { migrate } from "solarsql/node";
import { catalog } from "../catalog.ts";
import { migrations } from "../migrations/index.ts";
import { loaders } from "../spacequery.config.ts";
import type { UserProvider } from "../core/user-providers.ts";
import type { UserQuery } from "../core/user-queries.ts";
import { tablesRead } from "../core/resolve.ts";

export type Column = { name: string; type: string; nullable: boolean; key: boolean };
export type Item = {
  kind: "table" | "query";
  name: string;
  source: string;
  description: string;
  sql: string;
  params: readonly string[];
  tables: readonly string[];
  columns: Column[];
  error?: string;
};

export function browserCatalog(userQueries: readonly UserQuery[] = [], userProviders: readonly UserProvider[] = []): Item[] {
  const db = new DatabaseSync(":memory:");
  try {
    migrate(db, migrations);
    for (const provider of userProviders) {
      for (const table of provider.tableDeclarations) db.exec(table.sql);
    }
    const allLoaders = [...loaders, ...userProviders];
    const names = [...new Set([...allLoaders.flatMap((loader) => loader.tables), "providers"])].sort();
    const tables: Item[] = names.map((name) => {
      const columns = db.prepare("select name, type, [notnull], pk from pragma_table_info(?)").all(name);
      return {
        kind: "table", name, source: allLoaders.find((loader) => loader.tables.includes(name))?.name ?? "core",
        description: name === "providers"
          ? "Status of providers used by one call. Press s in Results to inspect source status."
          : "Rows supplied by this provider when a statement reads the table.",
        sql: `select * from "${name.replaceAll('"', '""')}"`,
        params: [], tables: [name],
        columns: columns.map((column) => ({ name: String(column.name), type: String(column.type), nullable: !column.notnull, key: Boolean(column.pk) })),
      };
    });
    const queries: Item[] = Object.entries(catalog).map(([name, entry]) => ({
      kind: "query", name, source: "built-in", description: entry.description,
      sql: entry.query.sql, params: entry.params, tables: entry.query.meta.reads,
      columns: [],
    }));
    for (const query of userQueries) {
      const item: Item = { kind: "query", name: query.name, source: "user", description: query.description, sql: query.sql, params: query.params, tables: [], columns: [] };
      try { item.tables = tablesRead(db, query.sql); }
      catch (error) { item.error = error instanceof Error ? error.message : String(error); }
      queries.push(item);
    }
    for (const item of queries) {
      if (item.error) continue;
      try {
        item.columns = db.prepare(item.sql).columns().map((column) => ({ name: column.name, type: column.type ?? "expression", nullable: true, key: false }));
      } catch (error) { item.error = error instanceof Error ? error.message : String(error); }
    }
    return [...tables, ...queries];
  } finally { db.close(); }
}
