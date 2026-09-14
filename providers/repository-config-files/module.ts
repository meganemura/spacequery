// Provider: repository configuration files. It inventories a fixed file-name
// catalog. It reads root package.json only for declared workspace discovery.
// It does not parse dependency evidence or read other listed file bodies.
// Boundary: these tables, loading commands, and inventory queries.
import { commands, queries, table } from "solarsql";
import { generated } from "./solarsql.generated.ts";

export const repositoryConfigFiles = table(`
  create table repository_config_files (
    id text primary key not null,
    root text not null,
    project_path text not null,
    path text,
    format text,
    category text check (category in ('manifest', 'lock', 'version-file', 'tool-config')),
    parse_support text check (parse_support in ('supported', 'unsupported')),
    observation_kind text not null check (observation_kind in ('file', 'discovery')),
    status text not null check (status in ('observed', 'skipped', 'incomplete', 'error')),
    detail text
  ) strict
`);

export const repositoryConfigFileQueries = queries(generated, {
  inDir: `select root, project_path, path, format, category, parse_support, observation_kind, status, detail
    from repository_config_files where root = :root
    order by observation_kind, project_path, path, format, detail`,
  inScope: `select root, project_path, path, format, category, parse_support, observation_kind, status, detail
    from repository_config_files
    order by root, observation_kind, project_path, path, format, detail`,
});

export const repositoryConfigFileCommands = commands(generated, {
  load: { plan: [`insert or ignore into repository_config_files
    (id, root, project_path, path, format, category, parse_support, observation_kind, status, detail)
    select value ->> 'id', value ->> 'root', value ->> 'project_path', value ->> 'path', value ->> 'format',
      value ->> 'category', value ->> 'parse_support', value ->> 'observation_kind', value ->> 'status', value ->> 'detail'
    from json_each(:rows)`] },
});
