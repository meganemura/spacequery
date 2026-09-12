# Your own providers

A user provider gives spacequery a local table without changing this repository.
Put one JSON file per provider in `$XDG_CONFIG_HOME/spacequery/providers/`.
The default directory is `~/.config/spacequery/providers/`.

This example runs one ticket command in each repository root:

```json
{
  "description": "Tickets for each repository.",
  "tables": {
    "local_tickets": "create table local_tickets (id text primary key not null, root text not null, title text not null) strict"
  },
  "command": ["ticketctl", "list", "--json"],
  "scope": "root"
}
```

The command can print a bare array because this declaration has one table:

```json
[
  { "id": "T-123", "title": "Repair the release check" }
]
```

The table has a `root` column, so spacequery adds the root when a row omits it.
Save this query as `$XDG_CONFIG_HOME/spacequery/queries/tickets-in-dir.sql`:

```sql
-- Tickets and the current branch of one repository.
select t.id, t.title, g.branch
from local_tickets t join git_status g on g.root = t.root
where t.root = :root
order by t.id
```

Call it like a built-in query:

```sh
spacequery tickets-in-dir --root /workspace/example
```

## Declaration fields

| Field | Meaning |
| --- | --- |
| File name | The provider name is the file name without `.json`. It matches `[a-z][a-z0-9-]*` and differs from every built-in provider name. |
| `description` | Optional text that appears in `--help`. |
| `tables` | An object from table name to one `create table` statement for that name. A user table name differs from every built-in table name. |
| `command` | A non-empty array of strings. The first string is the command name or path. The remaining strings are literal arguments. |
| `scope` | `call` runs the command once. `root` runs it once per root in scope and sets the process directory to that root. |

The command starts through `execFile` without a shell.
The core resolves a command name through `PATH` and includes the command in `--trace` output.
User providers run in file-name order after the built-in providers selected for the query.
spacequery starts a user provider only when a statement reads one of its tables.
`--scope agents` uses roots that have an agent.
`--scope all` also uses every ghq root.

## Command output

A declaration with multiple tables prints an object:

```json
{
  "local_tickets": [
    { "id": "T-123", "root": "/workspace/example", "title": "Repair the release check" }
  ]
}
```

Each object key names a declared table, and its value is an array of row objects.
A provider with one table can print a row array directly.
A missing column becomes null.
An unknown table or column fails the provider.
SQLite also rejects values that do not fit the declared table.

## Failures and trust

A missing directory gives no user providers.
A malformed declaration produces a warning on standard error and is skipped.
A non-zero exit, invalid JSON document, unknown row key, or rejected row sets the provider status to `ok: 0`.
The failed provider leaves all its tables empty, and the query continues.
The provider status has `source: "user"`.

The core uses literal arguments, starts no shell, limits root process directories to the selected scope, and records the trace.
The declaration owner must confirm that the command only reads external state.
