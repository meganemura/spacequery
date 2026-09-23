// Provider: beads. It describes open issue rows from repository-local state.
// Boundary: this table, its loading command, and single-provider queries.
import { commands, queries, table } from "solarsql";
import { generated } from "./solarsql.generated.ts";

export const issues = table(`
  create table issues (
    id text primary key not null,
    root text not null,
    issue_id text not null,
    title text not null,
    status text not null,
    priority integer,
    issue_type text,
    assignee text,
    labels text,
    created_at integer,
    updated_at integer,
    dependency_count integer not null default 0,
    dependent_count integer not null default 0,
    comment_count integer not null default 0
  ) strict
`);

export const beadsQueries = queries(generated, {
  open: `select id, root, issue_id, title, status, priority, issue_type, assignee, labels, created_at, updated_at, dependency_count, dependent_count, comment_count
    from issues where root = :root order by priority, updated_at desc`,
  // A work list spans every loaded root. Which roots are loaded is the
  // caller's scope; agent presence is not a filter on the rows.
  all: `select id, root, issue_id, title, status, priority, issue_type, assignee, labels, created_at, updated_at, dependency_count, dependent_count, comment_count
    from issues order by root, priority`,
});

export const beadsCommands = commands(generated, {
  loadIssues: { plan: [`insert or ignore into issues (id, root, issue_id, title, status, priority, issue_type, assignee, labels, created_at, updated_at, dependency_count, dependent_count, comment_count)
    select value ->> 'id', value ->> 'root', value ->> 'issue_id', value ->> 'title', value ->> 'status', value ->> 'priority', value ->> 'issue_type', value ->> 'assignee', value ->> 'labels', value ->> 'created_at', value ->> 'updated_at', value ->> 'dependency_count', value ->> 'dependent_count', value ->> 'comment_count'
    from json_each(:rows)`] },
});
