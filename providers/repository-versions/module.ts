// Provider: repository versions. It records static version evidence from roots
// in scope. It does not resolve declarations or inspect runtimes.
// Boundary: this table, its loading command, and its evidence queries.
import { commands, queries, table } from "solarsql";
import { generated } from "./solarsql.generated.ts";

export const repositoryVersions = table(`
  create table repository_versions (
    id text primary key not null,
    root text not null,
    repository_id text,
    project_path text not null,
    ecosystem text not null,
    kind text not null,
    dependency_role text check (dependency_role in ('runtime', 'development', 'optional', 'peer')),
    origin text not null check (origin in ('manifest', 'lock', 'version-file', 'source')),
    name text not null,
    requested text,
    locked text,
    source text not null,
    locator text,
    status text not null check (status in ('observed', 'unresolved', 'unsupported', 'error')),
    detail text
  ) strict
`);

export const repositoryVersionQueries = queries(generated, {
  inDir: `select project_path, ecosystem, kind, dependency_role, origin, name, requested, locked, source, locator, status, detail
    from repository_versions where root = :root
    order by project_path, ecosystem, kind, name, source, locator, locked`,
  sources: `select root, project_path, ecosystem, kind, dependency_role, origin, name, requested, locked,
      source, locator, status, detail
    from repository_versions where kind = 'source' or status <> 'observed'
    order by root, project_path, source, locator, kind, name`,
  coverage: `select root, project_path, source,
      cast(sum(kind = 'source' and status = 'observed') as integer) as observed_sources,
      cast(sum(kind = 'source' and status = 'unsupported') as integer) as unsupported_sources,
      cast(sum(status = 'unresolved') as integer) as unresolved_evidence,
      cast(sum(status = 'error') as integer) as error_evidence,
      cast(sum(kind <> 'source' and status = 'observed') as integer) as observed_evidence
    from repository_versions group by root, project_path, source
    order by root, project_path, source`,
  sharedDependencies: `with declarations as (
      select * from repository_versions
      where ecosystem = 'npm' and kind = 'dependency' and origin = 'manifest'
        and status = 'observed' and requested is not null and repository_id is not null
    ), shared as (
      select ecosystem, name,
        cast(count(distinct repository_id) as integer) as repository_count,
        cast(count(distinct root) as integer) as checkout_count,
        cast(count(distinct root || char(0) || project_path) as integer) as project_count,
        cast(count(*) as integer) as declaration_count,
        cast(count(distinct requested) as integer) as request_string_count,
        cast((select json_group_array(requested) from (
          select distinct requested from declarations d2
          where d2.ecosystem = declarations.ecosystem and d2.name = declarations.name order by requested
        )) as text) as requested_versions,
        cast((select json_group_array(dependency_role) from (
          select distinct dependency_role from declarations d3
          where d3.ecosystem = declarations.ecosystem and d3.name = declarations.name order by dependency_role
        )) as text) as roles
      from declarations
      group by ecosystem, name having count(distinct repository_id) > 1
    ) select ecosystem, name, repository_count, checkout_count, project_count, declaration_count,
        request_string_count, requested_versions, roles
      from shared order by repository_count desc, project_count desc, ecosystem, name`,
  sharedDependencyDetails: `with declarations as (
      select * from repository_versions
      where ecosystem = 'npm' and kind = 'dependency' and origin = 'manifest'
        and status = 'observed' and requested is not null and repository_id is not null
    ), shared as (
      select ecosystem, name,
        cast(count(distinct repository_id) as integer) as repository_count,
        cast(count(distinct root) as integer) as checkout_count,
        cast(count(distinct root || char(0) || project_path) as integer) as project_count,
        cast(count(*) as integer) as declaration_count,
        cast(count(distinct requested) as integer) as request_string_count
      from declarations
      group by ecosystem, name having count(distinct repository_id) > 1
    ) select d.ecosystem, d.name, d.root, d.project_path, d.dependency_role, d.requested,
        d.source, d.locator, s.repository_count, s.checkout_count, s.project_count, s.declaration_count,
        s.request_string_count
      from declarations d join shared s on s.ecosystem = d.ecosystem and s.name = d.name
      order by d.ecosystem, d.name, d.root, d.project_path, d.dependency_role, d.source, d.locator`,
});

export const repositoryVersionCommands = commands(generated, {
  load: { plan: [`insert or ignore into repository_versions
    (id, root, repository_id, project_path, ecosystem, kind, dependency_role, origin, name, requested, locked, source, locator, status, detail)
    select value ->> 'id', value ->> 'root', value ->> 'repository_id', value ->> 'project_path', value ->> 'ecosystem', value ->> 'kind',
      value ->> 'dependency_role', value ->> 'origin', value ->> 'name', value ->> 'requested', value ->> 'locked', value ->> 'source', value ->> 'locator',
      value ->> 'status', value ->> 'detail'
    from json_each(:rows)`] },
});
