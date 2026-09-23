// Provider: cursor. It describes recent Cursor agent conversations from the
// local IDE database. Cloud agents are a different store and are not here.
// Boundary: this table, its loading command, and single-provider queries.
import { commands, queries, table } from "solarsql";
import { generated } from "./solarsql.generated.ts";

export const cursorAgents = table(`
  create table cursor_agents (
    composer_id text primary key not null,
    name text,
    status text,
    unified_mode text,
    model text,
    worktree_path text,
    branch_name text,
    workspace_path text,
    root text,
    is_archived integer,
    is_subagent integer,
    created_at integer,
    updated_at integer
  ) strict
`);

export const cursorQueries = queries(generated, {
  recent: `select composer_id, name, status, unified_mode, model, worktree_path, branch_name, workspace_path, root, is_archived, is_subagent, created_at, updated_at
    from cursor_agents order by cast(coalesce(updated_at, -1) as integer) desc, composer_id`,
});

export const cursorCommands = commands(generated, {
  loadAgents: { plan: [`insert or ignore into cursor_agents (composer_id, name, status, unified_mode, model, worktree_path, branch_name, workspace_path, root, is_archived, is_subagent, created_at, updated_at)
    select value ->> 'composer_id', value ->> 'name', value ->> 'status', value ->> 'unified_mode', value ->> 'model', value ->> 'worktree_path', value ->> 'branch_name', value ->> 'workspace_path', value ->> 'root', value ->> 'is_archived', value ->> 'is_subagent', value ->> 'created_at', value ->> 'updated_at'
    from json_each(:rows)`] },
});
