// Provider: search path. It describes the caller's PATH without a process.
// Boundary: this module's tables, loading commands, and queries.
import { commands } from "solarsql";
import { generated } from "./solarsql.generated.ts";

export { searchPathQueries } from "./queries.ts";
export { pathCommands, pathEntries } from "./schema.ts";

export const searchPathCommands = commands(generated, {
  load: { plan: [
    `insert into path_entries (position, dir, "exists", duplicate_of)
     select value ->> 'position', value ->> 'dir', value ->> 'exists', value ->> 'duplicate_of'
     from json_each(:entries)`,
    `insert into path_commands (name, dir, position, effective)
     select value ->> 'name', value ->> 'dir', value ->> 'position', value ->> 'effective'
     from json_each(:commands)`,
  ] },
});
