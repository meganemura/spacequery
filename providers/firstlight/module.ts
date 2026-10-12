// Provider: firstlight, the parallel check runner. It describes firstlight
// runs and their checks from the state files firstlight writes.
// Boundary: these two tables, their loading command, and single-provider
// queries. Joins with git and other providers live in the report module.
import { commands, queries, table } from "solarsql";
import { generated } from "./solarsql.generated.ts";

// `current` is 1 for the run the repository's `current` file names.
// `supervisor_alive` is 1 only while the run has no outcome and its
// supervisor pid is a live process; once the outcome is written the
// supervisor exits, so a pid that answers later belongs to someone else.
export const firstlightRuns = table(`
  create table firstlight_runs (
    id text primary key not null,
    repo_key text not null,
    root text not null,
    started_at text not null,
    supervisor_pid integer,
    outcome text check (outcome in ('done', 'cancelled')),
    current integer not null check (current in (0, 1)),
    supervisor_alive integer not null check (supervisor_alive in (0, 1))
  ) strict
`);

// `run` is the check's command, under the name run.json gives it (ADR 0024).
// `unknown` is never written by firstlight: like firstlight's own reader,
// spacequery derives it for a check that never settled in a run whose
// supervisor is gone without an outcome, and marks that row `orphan` 1.
// `position` keeps run.json's order, which is the order firstlight reports.
export const firstlightChecks = table(`
  create table firstlight_checks (
    run_id text not null references firstlight_runs(id),
    position integer not null,
    name text not null,
    run text not null,
    status text not null check (status in ('pending', 'running', 'passed', 'failed', 'timed_out', 'cancelled', 'skipped', 'unknown')),
    orphan integer not null check (orphan in (0, 1)),
    exit_code integer,
    started_at text,
    elapsed_ms integer,
    pid integer,
    cached_from text,
    log text not null,
    primary key (run_id, name)
  ) strict
`);

export const firstlightQueries = queries(generated, {
  // The run the `current` file names. When that file is missing or names a
  // run that is gone, the newest kept run stands in: run ids sort by time.
  // The buckets are firstlight's own: `failed` holds failed, timed_out,
  // skipped, and unknown, and `running` holds pending and running.
  latest: `
    select r.root, r.id as run_id, r.started_at, r.outcome, r.supervisor_pid, r.supervisor_alive, r.current,
      cast(count(c.name) as integer) as checks,
      cast(coalesce(sum(c.status = 'passed'), 0) as integer) as passed,
      cast(coalesce(sum(c.status in ('failed', 'timed_out', 'skipped', 'unknown')), 0) as integer) as failed,
      cast(coalesce(sum(c.status in ('pending', 'running')), 0) as integer) as running,
      cast(coalesce(sum(c.status = 'cancelled'), 0) as integer) as cancelled
    from firstlight_runs r left join firstlight_checks c on c.run_id = r.id
    where r.id = coalesce(
      (select x.id from firstlight_runs x where x.repo_key = r.repo_key and x.current = 1),
      (select max(x.id) from firstlight_runs x where x.repo_key = r.repo_key)
    )
    group by r.id order by r.root`,
});

export const firstlightCommands = commands(generated, {
  loadRuns: {
    plan: [
      `insert into firstlight_runs (id, repo_key, root, started_at, supervisor_pid, outcome, current, supervisor_alive)
       select value ->> 'id', value ->> 'repo_key', value ->> 'root', value ->> 'started_at', value ->> 'supervisor_pid',
              value ->> 'outcome', value ->> 'current', value ->> 'supervisor_alive'
       from json_each(:runs)`,
      `insert into firstlight_checks (run_id, position, name, run, status, orphan, exit_code, started_at, elapsed_ms, pid, cached_from, log)
       select value ->> 'run_id', value ->> 'position', value ->> 'name', value ->> 'run', value ->> 'status', value ->> 'orphan',
              value ->> 'exit_code', value ->> 'started_at', value ->> 'elapsed_ms', value ->> 'pid', value ->> 'cached_from', value ->> 'log'
       from json_each(:checks)`,
    ],
  },
});
