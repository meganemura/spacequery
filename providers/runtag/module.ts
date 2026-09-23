// Provider: runtag. It describes detached jobs from runtag's job files.
// Boundary: this table, its loading command, and single-provider queries.
import { commands, queries, table } from "solarsql";
import { generated } from "./solarsql.generated.ts";

export const runtagJobs = table(`
  create table runtag_jobs (
    id text primary key not null,
    status text not null check (status in ('running', 'exited')),
    exit_code integer,
    orphan integer not null check (orphan in (0, 1)),
    repo_root text,
    cwd text,
    supervisor_pid integer
  ) strict
`);

// A directory match is a path boundary, not a string prefix. `LIKE` would
// treat `_` in a repository path as a wildcard, so the comparison is `substr`.
export const runtagQueries = queries(generated, {
  inDir: `
    select id, status, exit_code, orphan, repo_root, cwd, supervisor_pid
    from runtag_jobs
    where exists (
      select 1
      from (select cast(case when rtrim(:root, '/') = '' then '/' else rtrim(:root, '/') end as text) as dir) bound
      where (
        repo_root is not null and repo_root <> '' and (
          (case when rtrim(repo_root, '/') = '' then '/' else rtrim(repo_root, '/') end) = bound.dir
          or (
            bound.dir <> '/'
            and substr(case when rtrim(repo_root, '/') = '' then '/' else rtrim(repo_root, '/') end, 1, length(bound.dir) + 1) = bound.dir || '/'
          )
          or (bound.dir = '/' and substr(repo_root, 1, 1) = '/')
        )
      ) or (
        cwd is not null and cwd <> '' and (
          (case when rtrim(cwd, '/') = '' then '/' else rtrim(cwd, '/') end) = bound.dir
          or (
            bound.dir <> '/'
            and substr(case when rtrim(cwd, '/') = '' then '/' else rtrim(cwd, '/') end, 1, length(bound.dir) + 1) = bound.dir || '/'
          )
          or (bound.dir = '/' and substr(cwd, 1, 1) = '/')
        )
      )
    )
    order by id`,
});

export const runtagCommands = commands(generated, {
  loadJobs: { plan: [`insert or replace into runtag_jobs (id, status, exit_code, orphan, repo_root, cwd, supervisor_pid)
    select value ->> 'id', value ->> 'status', value ->> 'exit_code', value ->> 'orphan', value ->> 'repo_root', value ->> 'cwd', value ->> 'supervisor_pid'
    from json_each(:rows)`] },
});
