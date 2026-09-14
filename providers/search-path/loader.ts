// Fills search path entries and commands from the caller's PATH.
// It reads directory metadata and starts no process.
// Boundary: this provider's tables only.
import type { LoadContext, Loader } from "../../core/loader.ts";
import { scanSearchPath } from "../../core/search-path.ts";
import { searchPathCommands } from "./module.ts";

export const searchPathLoader: Loader = {
  name: "search_path", tables: ["path_entries", "path_commands"], after: [],
  async load(ctx: LoadContext) {
    const { entries, commands } = scanSearchPath(ctx.env["PATH"]);
    const loaded = await ctx.db.run(searchPathCommands.load, {
      entries,
      commands,
    });
    if (!loaded.ok) throw new Error(`search_path: ${loaded.kind}`);
  },
};
