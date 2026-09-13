// Describe subscription quota observations; token accounting stays with session logs.
// Boundary: the two tables, their queries, and loading commands.
import { commands, queries, table } from "solarsql";
import { generated } from "./solarsql.generated.ts";

export const claudeUsage = table(`create table claude_usage (
  id text primary key not null,
  limit_id text not null,
  window_minutes integer,
  used_percent real not null,
  resets_at integer,
  resets_text text,
  recorded_at integer not null,
  source text not null
) strict`);

export const codexUsage = table(`create table codex_usage (
  id text primary key not null,
  limit_id text not null,
  window_minutes integer,
  used_percent real not null,
  resets_at integer,
  resets_text text,
  recorded_at integer not null,
  source text not null
) strict`);

export const usageQueries = queries(generated, {
  claude: "select id, limit_id, window_minutes, used_percent, resets_at, resets_text, recorded_at, source from claude_usage order by limit_id, window_minutes",
  codex: "select id, limit_id, window_minutes, used_percent, resets_at, resets_text, recorded_at, source from codex_usage order by limit_id, window_minutes",
});

export const usageCommands = commands(generated, {
  claude: { plan: [`insert into claude_usage (id, limit_id, window_minutes, used_percent, resets_at, resets_text, recorded_at, source)
    select value ->> 'id', value ->> 'limit_id', value ->> 'window_minutes', value ->> 'used_percent', value ->> 'resets_at', value ->> 'resets_text', value ->> 'recorded_at', value ->> 'source' from json_each(:rows)`] },
  codex: { plan: [`insert into codex_usage (id, limit_id, window_minutes, used_percent, resets_at, resets_text, recorded_at, source)
    select value ->> 'id', value ->> 'limit_id', value ->> 'window_minutes', value ->> 'used_percent', value ->> 'resets_at', value ->> 'resets_text', value ->> 'recorded_at', value ->> 'source' from json_each(:rows)`] },
});
