// Fills search path entries and commands from the caller's PATH.
// It reads directory metadata and starts no process.
// Boundary: this provider's tables only.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { LoadContext, Loader } from "../../core/loader.ts";
import { isExecutableFile, parseSearchPath } from "../../core/search-path.ts";
import { searchPathCommands } from "./module.ts";
import type { PathEntriesId } from "./solarsql.generated.ts";

function isDirectory(path: string): boolean {
  try { return statSync(path).isDirectory(); } catch { return false; }
}

export const searchPathLoader: Loader = {
  name: "search_path", tables: ["path_entries", "path_commands"], after: [],
  async load(ctx: LoadContext) {
    const firstPositions = new Map<string, number>();
    const entries = parseSearchPath(ctx.env["PATH"]).map((dir, position) => {
      const first = firstPositions.get(dir);
      if (first === undefined) firstPositions.set(dir, position);
      return { position, dir, exists: isDirectory(dir) ? 1 as const : 0 as const, duplicate_of: first ?? null };
    });
    const effective = new Set<string>();
    const commands = entries.flatMap((entry) => {
      if (entry.exists === 0) return [];
      return readdirSync(entry.dir).sort().flatMap((name) => {
        if (!isExecutableFile(join(entry.dir, name))) return [];
        const row = { name, dir: entry.dir, position: entry.position, effective: effective.has(name) ? 0 as const : 1 as const };
        effective.add(name);
        return [row];
      });
    });
    const loaded = await ctx.db.run(searchPathCommands.load, {
      entries: entries.map((entry) => ({ ...entry, position: String(entry.position) as PathEntriesId })),
      commands,
    });
    if (!loaded.ok) throw new Error(`search_path: ${loaded.kind}`);
  },
};
