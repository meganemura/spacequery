// Provider: mise. The loader records installed versions, active root versions,
// and each root's search path. A source file above a repository can select
// the version, so the source path stays with the use.
// Boundary: its tables, loading commands, and single-provider queries.
// Joins with other providers live in the report module.
import { commands, queries, table } from "solarsql";
import { generated } from "./solarsql.generated.ts";

export const tools = table(`
  create table tools (
    id text primary key not null,
    tool text not null,
    version text not null,
    install_path text,
    installed integer not null,
    active integer not null
  ) strict
`);

export const toolUses = table(`
  create table tool_uses (
    id text primary key not null,
    root text not null,
    tool text not null,
    version text not null,
    source text,
    installed integer not null
  ) strict
`);

export const rootPathEntries = table(`
  create table root_path_entries (
    root text not null,
    position integer not null,
    dir text not null,
    "exists" integer not null check ("exists" in (0, 1)),
    duplicate_of integer,
    primary key (root, position)
  ) strict
`);

export const rootPathCommands = table(`
  create table root_path_commands (
    root text not null,
    name text not null,
    dir text not null,
    position integer not null,
    effective integer not null check (effective in (0, 1)),
    primary key (root, position, name)
  ) strict
`);

export const miseQueries = queries(generated, {
  installed: `
    select tool, version, install_path, installed, active from tools order by tool, version`,
  inDir: `
    select tool, version, source, installed from tool_uses where root = :root order by tool`,
  pathEntriesInDir: `
    select root, position, dir, "exists", duplicate_of
    from root_path_entries where root = :root order by position`,
  whichInDir: `
    select root, name, dir, position, effective
    from root_path_commands where root = :root and name = :q order by position`,
  shadowedCommandsInDir: `
    select p.root, p.name, p.dir as effective_dir,
      cast(group_concat(s.dir order by s.position) as text) as shadowed_dirs
    from root_path_commands p join root_path_commands s on s.root = p.root and s.name = p.name
    where p.root = :root and p.effective = 1 and s.dir <> p.dir
      and s.position = (
        select min(candidate.position) from root_path_commands candidate
        where candidate.root = s.root and candidate.name = s.name and candidate.dir = s.dir
      )
    group by p.root, p.name, p.dir
    order by p.name`,
});

export const miseCommands = commands(generated, {
  loadTools: {
    plan: [
      `insert or ignore into tools (id, tool, version, install_path, installed, active)
       select value ->> 'id', value ->> 'tool', value ->> 'version', value ->> 'install_path', value ->> 'installed', value ->> 'active'
       from json_each(:rows)`,
    ],
  },
  loadUses: {
    plan: [
      `insert or ignore into tool_uses (id, root, tool, version, source, installed)
       select value ->> 'id', value ->> 'root', value ->> 'tool', value ->> 'version', value ->> 'source', value ->> 'installed'
       from json_each(:rows)`,
    ],
  },
  loadRootPaths: {
    plan: [
      `insert into root_path_entries (root, position, dir, "exists", duplicate_of)
       select value ->> 'root', value ->> 'position', value ->> 'dir', value ->> 'exists', value ->> 'duplicate_of'
       from json_each(:entries)`,
      `insert into root_path_commands (root, name, dir, position, effective)
       select value ->> 'root', value ->> 'name', value ->> 'dir', value ->> 'position', value ->> 'effective'
       from json_each(:commands)`,
    ],
  },
});
