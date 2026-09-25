// Provider: herdr, the terminal multiplexer that hosts the coding agents.
// The loader fills `agents` from `herdr api snapshot` at query time.
// `root` is the git toplevel of `cwd`, resolved by the loader, so a join on
// a repository does not depend on cwd being the root (ADR 0003).
// Boundary: these tables, their loading commands, and single-table queries.
// Joins with other providers live in the report module.
import { commands, queries, table } from "solarsql";
import { generated } from "./solarsql.generated.ts";

export const agents = table(`
  create table agents (
    pane_id text primary key not null,
    session_id text,
    name text,
    agent text not null,
    agent_status text not null,
    focused integer not null default 0,
    cwd text not null,
    foreground_cwd text,
    root text,
    workspace_id text,
    tab_id text,
    title text
  ) strict
`);

export const panes = table(`
  create table panes (
    pane_id text primary key not null,
    workspace_id text,
    workspace_label text,
    tab_id text,
    cwd text not null,
    agent text,
    title text,
    shell_pid integer
  ) strict
`);

export const herdrQueries = queries(generated, {
  // Every agent. `:me` excludes the caller; null keeps everyone.
  all: `
    select pane_id, name, agent, agent_status, cwd, root, workspace_id, title
    from agents where (:me is null or pane_id <> :me) order by pane_id`,
  // Agents in one repository, by its root.
  inDir: `
    select pane_id, name, agent, agent_status, cwd, title
    from agents where root = :root and (:me is null or pane_id <> :me) order by pane_id`,
  // Agents that work right now.
  working: `
    select pane_id, name, agent, agent_status, root, cwd, title
    from agents where agent_status = 'working' and (:me is null or pane_id <> :me) order by pane_id`,
  // Which workspace holds agents of which repository.
  workspaces: `
    select workspace_id, root, cast(count(*) as integer) as agents,
           cast(sum(agent_status = 'working') as integer) as working
    from agents group by workspace_id, root order by workspace_id, root`,
  // The distinct roots the agents sit in. The git loader reads this.
  roots: `select distinct root from agents where root is not null`,
  // The caller, by the session id its environment carries.
  bySession: `select pane_id from agents where session_id = :session_id`,
  // The caller, by the pane herdr has in focus.
  focused: `select pane_id from agents where focused = 1 limit 1`,
});

export const herdrCommands = commands(generated, {
  load: {
    plan: [
      `insert into agents (pane_id, session_id, name, agent, agent_status, focused, cwd, foreground_cwd, root, workspace_id, tab_id, title)
       select value ->> 'pane_id', value ->> 'session_id', value ->> 'name', value ->> 'agent', value ->> 'agent_status', value ->> 'focused',
              value ->> 'cwd', value ->> 'foreground_cwd', value ->> 'root', value ->> 'workspace_id', value ->> 'tab_id', value ->> 'title'
       from json_each(:rows)`,
    ],
  },
  loadPanes: {
    plan: [
      `insert into panes (pane_id, workspace_id, workspace_label, tab_id, cwd, agent, title, shell_pid)
       select value ->> 'pane_id', value ->> 'workspace_id', value ->> 'workspace_label', value ->> 'tab_id',
              value ->> 'cwd', value ->> 'agent', value ->> 'title', value ->> 'shell_pid'
       from json_each(:rows)`,
    ],
  },
});
