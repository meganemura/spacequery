// The search path queries expose entry order and command resolution.
// Boundary: read statements only.
import { queries } from "solarsql";
import { generated } from "./solarsql.generated.ts";

export const searchPathQueries = queries(generated, {
  pathEntries: `select position, dir, "exists", duplicate_of from path_entries order by position`,
  which: `select name, dir, position, effective from path_commands where name = :q order by position`,
  shadowedCommands: `select p.name, p.dir as effective_dir,
    cast(group_concat(s.dir order by s.position) as text) as shadowed_dirs
    from path_commands p join path_commands s on s.name = p.name
    where p.effective = 1 and s.dir <> p.dir
      and s.position = (
        select min(candidate.position) from path_commands candidate
        where candidate.name = s.name and candidate.dir = s.dir
      )
    group by p.name, p.dir
    order by p.name`,
});
