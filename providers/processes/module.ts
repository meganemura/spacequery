// Provider: processes. It records every process ps lists, for every user,
// because the process that runs away can belong to any user, including the
// system. It also records every listening TCP socket, because a port
// matters even outside a repository.
// `root` is the git toplevel of `cwd` (ADR 0003), looked up once per
// distinct cwd. A process gets a root whenever its cwd resolves to one,
// independent of `--scope`.
// A row keeps its place when `cwd` stays unresolved. The lsof call can miss
// the pid, or the process can belong to another user. `cwd` and `root` go
// null there; the process itself remains a fact worth reporting.
// Boundary: these tables, their loading commands, and single-table queries.
// Joins with other providers live in the report module.
import { commands, queries, table } from "solarsql";
import { generated } from "./solarsql.generated.ts";

export const processes = table(`
  create table processes (
    pid integer primary key not null,
    ppid integer not null,
    pgid integer not null,
    uid integer not null,
    cwd text,
    root text,
    command text not null,
    executable text not null,
    elapsed_s integer not null,
    rss_kb integer not null,
    cpu_pct real not null,
    cpu_time_s real not null
  ) strict
`);

export const listeners = table(`
  create table listeners (
    id text primary key not null,
    pid integer not null,
    address text not null,
    port integer not null,
    cwd text,
    root text,
    command text
  ) strict
`);

export const processQueries = queries(generated, {
  inDir: `
    select pid, ppid, executable, command, cwd, elapsed_s, rss_kb, cpu_pct, cpu_time_s
    from processes where root = :root order by elapsed_s desc`,
  listening: `
    select pid, address, port, cwd, root, command
    from listeners order by port`,
  // `union` (not `union all`) keeps a repeated path or a ppid cycle from
  // adding a duplicate row; the report module's sessionProcesses uses the
  // same `union`.
  descendants: `
    with recursive process_descendants as (
      select pid, ppid, command, executable, elapsed_s, cpu_pct, cpu_time_s, rss_kb, root
      from processes where ppid = cast(:q as integer)
      union
      select p.pid, p.ppid, p.command, p.executable, p.elapsed_s, p.cpu_pct, p.cpu_time_s, p.rss_kb, p.root
      from processes p join process_descendants d on p.ppid = d.pid
    )
    select d.pid, d.ppid, d.command, d.executable, d.elapsed_s, d.cpu_pct, d.cpu_time_s, d.rss_kb, d.root
    from process_descendants d order by d.pid`,
});

export const processCommands = commands(generated, {
  loadProcesses: { plan: [`insert or ignore into processes (pid, ppid, pgid, uid, cwd, root, command, executable, elapsed_s, rss_kb, cpu_pct, cpu_time_s)
    select value ->> 'pid', value ->> 'ppid', value ->> 'pgid', value ->> 'uid', value ->> 'cwd', value ->> 'root', value ->> 'command', value ->> 'executable', value ->> 'elapsed_s', value ->> 'rss_kb', value ->> 'cpu_pct', value ->> 'cpu_time_s' from json_each(:rows)`] },
  loadListeners: { plan: [`insert or ignore into listeners (id, pid, address, port, cwd, root, command)
    select value ->> 'id', value ->> 'pid', value ->> 'address', value ->> 'port', value ->> 'cwd', value ->> 'root', value ->> 'command' from json_each(:rows)`] },
});
