// Provider: skills. It describes skills and installed plugins from agent files.
// Boundary: these tables, their loading commands, and single-provider queries.
import { commands, queries, table } from "solarsql";
import { generated } from "./solarsql.generated.ts";

export const skills = table(`
  create table skills (
    path text primary key not null,
    source text not null,
    agent text not null,
    name text not null,
    description text,
    root text,
    plugin text
  ) strict
`);

export const plugins = table(`
  create table plugins (
    id text primary key not null,
    agent text not null,
    name text not null,
    marketplace text,
    version text,
    path text not null,
    installed_at integer,
    updated_at integer
  ) strict
`);

export const skillsQueries = queries(generated, {
  all: `select path, source, agent, name, description, root, plugin from skills order by agent, source, name`,
  inDir: `select path, source, agent, name, description, root, plugin from skills
    where source in ('claude-user', 'claude-plugin', 'codex-user', 'codex-admin', 'codex-system', 'codex-plugin')
       or (source in ('claude-project', 'codex-project') and root = :root)
    order by agent, name`,
  plugins: `select id, agent, name, marketplace, version, path, installed_at, updated_at from plugins order by agent, name`,
});

export const skillsCommands = commands(generated, {
  loadSkills: { plan: [`insert or ignore into skills (path, source, agent, name, description, root, plugin)
    select value ->> 'path', value ->> 'source', value ->> 'agent', value ->> 'name', value ->> 'description', value ->> 'root', value ->> 'plugin'
    from json_each(:rows)`] },
  loadPlugins: { plan: [`insert or ignore into plugins (id, agent, name, marketplace, version, path, installed_at, updated_at)
    select value ->> 'id', value ->> 'agent', value ->> 'name', value ->> 'marketplace', value ->> 'version', value ->> 'path', value ->> 'installed_at', value ->> 'updated_at'
    from json_each(:rows)`] },
});
