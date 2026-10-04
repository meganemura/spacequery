// Owns observed issue records and repository associations; the loader owns external reads.
import { commands, queries, table } from "solarsql";
import { generated } from "./solarsql.generated.ts";

export const projectIssues = table(`
  create table pd_issues (
    id text primary key not null,
    store text not null,
    issue_id text not null,
    tool text not null,
    project text not null,
    body text not null,
    status text not null check (status in ('open', 'in_progress', 'deferred', 'closed')),
    issue_type text not null check (issue_type in ('bug', 'task', 'epic', 'feature', 'chore')),
    priority integer not null check (priority between 0 and 4),
    labels text not null check (json_valid(labels)),
    created_at text not null,
    updated_at text not null
  ) strict
`);

export const issueSources = table(`
  create table pd_issue_sources (
    root text primary key not null,
    store text,
    project text,
    state text not null check (state in ('configured', 'unconfigured')),
    check ((state = 'configured' and store is not null and project is not null)
      or (state = 'unconfigured' and store is null and project is null))
  ) strict
`);

export const polylinedbQueries = queries(generated, {
  inDir: `select i.id, s.root, i.issue_id, i.tool, i.project, i.body, i.status, i.issue_type,
    i.priority, i.labels, i.created_at, i.updated_at
    from pd_issues i join pd_issue_sources s on s.store = i.store and s.project = i.project
    where s.root = :root and i.status <> 'closed' order by i.priority, i.id`,
  all: `select i.id, cast(min(s.root) as text) as root, i.issue_id, i.tool, i.project, i.body, i.status,
    i.issue_type, i.priority, i.labels, i.created_at, i.updated_at
    from pd_issues i join pd_issue_sources s on s.store = i.store and s.project = i.project
    where i.status <> 'closed' group by i.id order by root, i.priority, i.id`,
  open: `select i.id, cast(min(s.root) as text) as root, i.issue_id, i.tool, i.project, i.body, i.status,
    i.issue_type, i.priority, i.labels, i.created_at, i.updated_at
    from pd_issues i join pd_issue_sources s on s.store = i.store and s.project = i.project
    where i.status = 'open' group by i.id order by root, i.priority, i.id`,
  sources: `select root, store, project, state from pd_issue_sources order by root`,
});

export const polylinedbCommands = commands(generated, {
  loadSnapshot: { plan: [`insert into pd_issues (id, store, issue_id, tool, project, body, status, issue_type, priority, labels, created_at, updated_at)
    select value ->> 'id', value ->> 'store', value ->> 'issue_id', value ->> 'tool', value ->> 'project', value ->> 'body', value ->> 'status', value ->> 'issue_type', value ->> 'priority', value ->> 'labels', value ->> 'created_at', value ->> 'updated_at'
    from json_each(:issues)`, `insert into pd_issue_sources (root, store, project, state)
    select value ->> 'root', value ->> 'store', value ->> 'project', value ->> 'state'
    from json_each(:sources)`] },
});
