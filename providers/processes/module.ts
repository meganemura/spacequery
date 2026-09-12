// Provider: processes. It records user processes in repositories in scope and
// every listening TCP socket, because a port matters even outside a repository.
// Boundary: these tables, their loading commands, and single-table queries.
// Joins with other providers live in the report module.
import { commands, queries, table } from "solarsql";
import { generated } from "./solarsql.generated.ts";

export const processes = table(`
  create table processes (
    pid integer primary key not null,
    ppid integer not null,
    pgid integer not null,
    cwd text not null,
    root text not null,
    command text not null,
    executable text not null,
    elapsed_s integer not null,
    rss_kb integer not null,
    cpu real not null
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
    select pid, ppid, executable, command, cwd, elapsed_s, rss_kb, cpu
    from processes where root = :root order by elapsed_s desc`,
  listening: `
    select pid, address, port, cwd, root, command
    from listeners order by port`,
  // `union` (not `union all`) keeps a repeated path or a ppid cycle from
  // adding a duplicate row; the report module's sessionProcesses uses the
  // same `union`.
  descendants: `
    with recursive process_descendants as (
      select pid, ppid, command, executable, elapsed_s, cpu, root
      from processes where ppid = cast(:q as integer)
      union
      select p.pid, p.ppid, p.command, p.executable, p.elapsed_s, p.cpu, p.root
      from processes p join process_descendants d on p.ppid = d.pid
    )
    select d.pid, d.ppid, d.command, d.executable, d.elapsed_s, d.cpu, d.root
    from process_descendants d order by d.pid`,
  busy: `
    select pid, cpu, rss_kb, elapsed_s, root, command
    from processes order by cpu desc, rss_kb desc`,
});

export const processCommands = commands(generated, {
  loadProcesses: { plan: [`insert or ignore into processes (pid, ppid, pgid, cwd, root, command, executable, elapsed_s, rss_kb, cpu)
    select value ->> 'pid', value ->> 'ppid', value ->> 'pgid', value ->> 'cwd', value ->> 'root', value ->> 'command', value ->> 'executable', value ->> 'elapsed_s', value ->> 'rss_kb', value ->> 'cpu' from json_each(:rows)`] },
  loadListeners: { plan: [`insert or ignore into listeners (id, pid, address, port, cwd, root, command)
    select value ->> 'id', value ->> 'pid', value ->> 'address', value ->> 'port', value ->> 'cwd', value ->> 'root', value ->> 'command' from json_each(:rows)`] },
});
