# Terminal browser

Start the browser with `spacequery ui`.
It accepts `--root DIR`, `--scope root|agents|all`, and `--me PANE`.
It needs a terminal with at least 60 columns and 16 rows.

Tables shows built-in and user provider tables with their column types, nullable columns, and keys.
Queries shows built-in and user queries with descriptions, SQL, parameters, and result columns.
The Related view connects a table to its queries and a query to its tables.
A broken user query keeps its SQL and an error message in the catalog.

## Keys

| Key | Action |
| --- | --- |
| `t` | Toggle between Tables and Queries. |
| `/` | Edit the catalog search; Enter applies it and Esc cancels it. |
| Tab | Move focus between the catalog and the detail pane. |
| Up/Down or `k`/`j` | Select an entry, row, field, or text line in the focused pane. |
| Page Up/Page Down | Move by one page. |
| `1` to `5` | Open Results, SQL, Inputs, Related, or Providers. |
| Left/Right | Change the first visible result column. |
| Enter | Focus the selected entry, open a row, edit an input, or follow a related entry. |
| `r` | Fetch fresh data for the selected entry. |
| Esc | Close a row, cancel an edit, or return to the catalog with its selection and search intact. |
| `q` | Cancel the current execution and quit. |
| Ctrl+C | Cancel the current execution and quit. |

An open row shows all its fields vertically.
Up/Down and Page Up/Page Down scroll long values.
Inputs lets you edit `root`, `me`, and query parameters.
Enter on `scope` cycles through `auto`, `root`, `agents`, and `all`.
An empty `me` keeps all panes; the initial automatic value follows the CLI caller rules.

## Observations

Catalog navigation reads definitions without running providers.
Press `r` to execute a query or read a table.
Each execution uses a fresh CLI process and database.
The browser retains the latest result in memory for navigation and row inspection.
The receipt time identifies that result; Providers shows each provider's observation time and duration.
Editing an input clears the result so old data cannot appear under new parameters.

With `scope: auto`, table inspection binds the selected root and uses root scope.
Named queries follow their usual CLI scope defaults and restrictions.
Some provider tables, such as the caller's PATH, describe machine state regardless of scope.
The result footer shows the effective scope.

A failed provider makes an empty result unknown.
The result footer identifies failed providers, and Providers shows their errors.
Reading the `providers` table alone runs no provider and therefore returns no status rows.
Use the Providers view of an executed table or query to inspect its status.

The browser supports manual execution and query inspection.
Reports remain available through the CLI; SQL editing and automatic refresh are outside this version.
