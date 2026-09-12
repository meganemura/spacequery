// The `providers` table: one row per provider that a run asked for. The
// core writes it after the loaders ran, so a query can tell a provider that
// answered nothing from one that did not answer (ADR 0002). A provider that
// failed keeps its tables empty and gets ok = 0 with the error text.
// Boundary: the table and its loading command. No provider writes here.
import { commands, queries, table } from "solarsql";
import { generated } from "./solarsql.generated.ts";

export const providers = table(`
  create table providers (
    name text primary key not null,
    source text not null check (source in ('built-in', 'user')),
    ok integer not null,
    observed_at integer not null,
    ms real not null,
    error text
  ) strict
`);

export const providerQueries = queries(generated, {
  all: `select name, source, ok, observed_at, ms, error from providers order by name`,
});

export const providerCommands = commands(generated, {
  record: {
    plan: [
      `insert into providers (name, source, ok, observed_at, ms, error)
       select value ->> 'name', value ->> 'source', value ->> 'ok', value ->> 'observed_at', value ->> 'ms', value ->> 'error' from json_each(:rows)`,
    ],
  },
});
