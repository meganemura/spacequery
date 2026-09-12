// The search path schema records PATH entries and executable names.
// Boundary: table declarations only.
import { table } from "solarsql";

export const pathEntries = table(`
  create table path_entries (
    position integer primary key not null,
    dir text not null,
    "exists" integer not null check ("exists" in (0, 1)),
    duplicate_of integer
  ) strict
`);

export const pathCommands = table(`
  create table path_commands (
    name text not null,
    dir text not null,
    position integer not null,
    effective integer not null check (effective in (0, 1)),
    primary key (position, name)
  ) strict
`);
