# Your own queries

A question asked more than once becomes a named query without a change to spacequery.

Put one SQL file per query in `$XDG_CONFIG_HOME/spacequery/queries/` (`~/.config/spacequery/queries/` when the variable is unset):

```sql
-- Agents in one repository with the ruby version mise gives them.
select a.pane_id, a.name, u.version
from agents a join tool_uses u on u.root = a.root
where a.root = :root and u.tool = 'ruby' and (:me is null or a.pane_id <> :me)
order by a.pane_id
```

| Rule | |
| --- | --- |
| Name | The file name without `.sql`, matching `[a-z][a-z0-9-]*`. A built-in name wins and the file is skipped with a note on standard error. |
| Description | The first line when it starts with `-- `. It appears in `--help`. |
| Parameters | Every `:name` in the statement. `--name VALUE` binds it as text. `:root` and `:me` keep their defaults. A parameter with no flag is an error. |
| Providers | The tables the statement reads decide which providers run. |
| Types | None ahead of time. A wrong name fails to prepare, naming the close columns and a fix to try; a comparison the schema makes impossible to ever match (the wrong type, a value outside a CHECK enum, `= null`) warns without failing. Details: [output.md](output.md#errors-that-name-the-fix). |

The tables and their columns: [tables.md](tables.md).
When the required data has no table, declare a [user provider](user-providers.md) first.

`spacequery doctor` prepares every query file the same way a call would and reports each one in `user_queries`, so a table change that breaks a file shows up before someone calls it. Doctor does not run the query.

An agent may call a user query like a built-in one and reads its description from `--help`.
An agent does not write query files on its own; it asks the user, with the statement it wants.

The name `ui` is reserved for the terminal browser.
A file named `ui.sql` is skipped with a warning.
