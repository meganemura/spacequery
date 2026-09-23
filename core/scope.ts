// The roots a repository-scoped loader may inspect. This is the single place
// where a call combines observed roots with an explicit root parameter.
// Boundary: choosing roots only. Each provider decides what it reads there.
import type { LoadContext, Scope } from "./loader.ts";
import { herdrQueries } from "../providers/herdr/public.ts";
import { repoQueries } from "../providers/repos/public.ts";

// rootsInScope reads herdr when the call is wider than one root, and repos
// only for `--scope all`. A loader that discovers roots through it waits for
// those tables and does not start the other one.
export function discoveryLoaders(scope: Scope): readonly string[] {
  if (scope === "root") return [];
  if (scope === "agents") return ["herdr"];
  return ["herdr", "repos"];
}

export async function rootsInScope(ctx: LoadContext): Promise<string[]> {
  if (ctx.scope === "root") return [...ctx.roots];
  const roots = new Set(ctx.roots);
  for (const row of await ctx.db.all(herdrQueries.roots)) if (row.root !== null) roots.add(row.root);
  if (ctx.scope === "all") for (const row of await ctx.db.all(repoQueries.paths)) roots.add(row.path);
  return [...roots];
}
