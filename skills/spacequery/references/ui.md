# Terminal browser

Start the browser with `spacequery ui`.
It accepts `--root DIR`, `--scope root|agents|all`, and `--me PANE`.
It needs a terminal with at least 60 columns and 16 rows.

Tables shows built-in and user provider tables with their column types, nullable columns, and keys.
Queries shows built-in and user queries with descriptions, SQL, parameters, and result columns.
Definition opens when an entry is selected or the catalog is switched.
It combines SQL, column types, and links between tables and queries.
Execution opens Results, which contains observed values with column headings and source status.
Column definitions stay in Definition; an unexecuted Results view shows an execution hint.
A broken user query keeps its SQL and an error message in the catalog.

## Keys

| Key | Action |
| --- | --- |
| `t` | Toggle between Tables and Queries. |
| `/` | Edit the catalog search; Enter applies it and Esc cancels it. |
| Tab | Move focus between the catalog and the detail pane. |
| Up/Down or `k`/`j` | Select an entry, row, or text line in the focused pane. |
| Page Up/Page Down | Move by one page. |
| `1`, `2` | Open Definition or Results. |
| `e` | Edit query parameters in sequence. |
| `c` | Edit root, scope, and caller context in sequence. |
| `s` | Jump between result rows and their source status in Results. |
| Left/Right | Scroll result columns or long text lines horizontally. |
| Enter | Focus the selected entry, open a row, accept an input, or follow a related entry. |
| `r` | Prompt for missing parameters, then execute the selected entry. |
| Esc | Close a row, cancel an edit, or return to the catalog with its selection and search intact. |
| `q` | Cancel the current execution and quit. |
| Ctrl+C | Cancel the current execution and quit. |

An open row shows all its fields vertically.
Up/Down and Page Up/Page Down scroll text lines.
Left/Right scrolls long lines; SQL keeps its original line breaks.
In Definition, select a related entry with Up/Down and press Enter to open it.
The header shows root, scope, and caller context.
Press `c` to edit these values or `e` to edit the selected query's parameters.
Enter accepts a value and advances to the next field; Ctrl+U clears the field and Esc cancels the remaining prompts.
When `r` requests missing parameters, accepting the last value starts execution.
Context and parameter edits with `c` or `e` do not execute a query.
Scope accepts `auto`, `root`, `agents`, or `all`.
The initial automatic `me` follows the CLI caller rules; accepting it unchanged preserves automatic detection.
Clear `me` with Ctrl+U to keep all panes.

## Observations

Catalog navigation reads definitions without running providers.
Press `r` to execute a query or read a table.
Each execution uses a fresh CLI process and database.
The browser retains the latest result in memory for navigation and row inspection.
The receipt time identifies that result; the Sources section in Results shows each provider's observation time and duration.
Editing an input clears the result so old data cannot appear under new parameters.

With `scope: auto`, table inspection binds the selected root and uses root scope.
Named queries follow their usual CLI scope defaults and restrictions.
Some provider tables, such as the caller's PATH, describe machine state regardless of scope.
The result footer shows the effective scope.

A failed provider makes an empty result unknown.
The result footer identifies failed providers, and the Sources section shows their errors.
Reading the `providers` table alone runs no provider and therefore returns no status rows.
Press `s` after execution to inspect source status within Results.

The browser supports manual execution and query inspection.
Reports remain available through the CLI; SQL editing and automatic refresh are outside this version.
