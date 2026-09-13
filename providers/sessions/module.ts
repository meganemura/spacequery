// Provider: sessions. It records sessions that the Claude Code registry and
// Codex lock directory say are alive now. Transcript tails add recent context
// without turning this provider into a history search.
// Boundary: these tables, their loading commands, and single-table queries. Joins
// with agents live in the report module.
import { commands, queries, table } from "solarsql";
import { generated } from "./solarsql.generated.ts";

export const sessions = table(`
  create table sessions (
    session_id text primary key not null,
    agent text not null,
    pid integer,
    cwd text not null,
    root text,
    name text,
    started_at integer,
    updated_at integer,
    last_turn_at integer,
    last_branch text
  ) strict
`);

export const claudeSessions = table(`
  create table claude_sessions (
    session_id text primary key not null references sessions(session_id),
    model text,
    effort text,
    per_turn_effort text,
    metadata_at integer,
    kind text,
    entrypoint text,
    status text,
    status_updated_at integer,
    name_source text,
    version text,
    pid_domain text,
    peer_protocol integer
  ) strict
`);

export const codexSessions = table(`
  create table codex_sessions (
    session_id text primary key not null references sessions(session_id),
    source text,
    thread_source text,
    model text,
    model_provider text,
    reasoning_effort text,
    cli_version text,
    sandbox_policy text,
    approval_mode text,
    git_branch text,
    git_origin_url text,
    title text,
    tokens_used integer not null default 0,
    archived integer not null default 0
  ) strict
`);

export const sessionQueries = queries(generated, {
  all: `
    select session_id, agent, pid, cwd, root, name, started_at, updated_at, last_turn_at, last_branch
    from sessions order by agent, started_at`,
  idle: `
    select session_id, agent, pid, cwd, root, name, started_at, updated_at, last_turn_at, last_branch,
           cast((unixepoch('subsec') * 1000 - updated_at) / 60000 as integer) as idle_minutes
    from sessions order by updated_at asc`,
  claude: `
    select c.session_id, s.cwd, s.root, s.name, s.updated_at, c.model, c.effort, c.per_turn_effort, c.metadata_at, c.kind, c.entrypoint, c.status, c.status_updated_at, c.name_source, c.version, c.pid_domain, c.peer_protocol
    from claude_sessions c join sessions s on s.session_id = c.session_id
    order by s.updated_at desc`,
  codex: `
    select x.session_id, s.cwd, s.root, s.name, s.updated_at, x.model, x.reasoning_effort, x.source, x.thread_source, x.model_provider, x.cli_version, x.sandbox_policy, x.approval_mode, x.git_branch, x.git_origin_url, x.title, x.tokens_used, x.archived
    from codex_sessions x join sessions s on s.session_id = x.session_id
    order by s.updated_at desc`,
});

export const sessionCommands = commands(generated, {
  load: {
    plan: [
      `insert or ignore into sessions (session_id, agent, pid, cwd, root, name, started_at, updated_at, last_turn_at, last_branch)
       select value ->> 'session_id', value ->> 'agent', value ->> 'pid', value ->> 'cwd', value ->> 'root', value ->> 'name', value ->> 'started_at', value ->> 'updated_at', value ->> 'last_turn_at', value ->> 'last_branch'
       from json_each(:rows)`,
    ],
  },
  loadClaude: {
    plan: [
      `insert or ignore into claude_sessions (session_id, model, effort, per_turn_effort, metadata_at, kind, entrypoint, status, status_updated_at, name_source, version, pid_domain, peer_protocol)
       select value ->> 'session_id', value ->> 'model', value ->> 'effort', value ->> 'per_turn_effort', value ->> 'metadata_at', value ->> 'kind', value ->> 'entrypoint', value ->> 'status', value ->> 'status_updated_at', value ->> 'name_source', value ->> 'version', value ->> 'pid_domain', value ->> 'peer_protocol'
       from json_each(:rows)`,
    ],
  },
  loadCodex: {
    plan: [
      `insert or ignore into codex_sessions (session_id, source, thread_source, model, model_provider, reasoning_effort, cli_version, sandbox_policy, approval_mode, git_branch, git_origin_url, title, tokens_used, archived)
       select value ->> 'session_id', value ->> 'source', value ->> 'thread_source', value ->> 'model', value ->> 'model_provider', value ->> 'reasoning_effort', value ->> 'cli_version', value ->> 'sandbox_policy', value ->> 'approval_mode', value ->> 'git_branch', value ->> 'git_origin_url', value ->> 'title', value ->> 'tokens_used', value ->> 'archived'
       from json_each(:rows)`,
    ],
  },
});
