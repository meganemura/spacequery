# Terminal browser

Start the browser with `spacequery ui`.
It accepts `--root DIR`, `--scope root|agents|all`, and `--me PANE`.
It needs a terminal with at least 60 columns and 16 rows.

Tables shows built-in and user provider tables with their column types, nullable columns, and keys.
Queries shows built-in and user queries with descriptions, SQL, parameters, and result columns.
Definition combines SQL, columns, and links between tables and queries.
Results includes the source status after the result rows.
A broken user query keeps its SQL and an error message in the catalog.

## Keys

| Key | Action |
| --- | --- |
| `t` | Toggle between Tables and Queries. |
| `/` | Edit the catalog search; Enter applies it and Esc cancels it. |
| Tab | Move focus between the catalog and the detail pane. |
| Up/Down or `k`/`j` | Select an entry, row, field, or text line in the focused pane. |
| Page Up/Page Down | Move by one page. |
| `1` to `3` | Open Results, Definition, or Inputs. |
| `s` | Jump between result rows and their source status in Results. |
| Left/Right | Scroll result columns or long text lines horizontally. |
| Enter | Focus the selected entry, open a row, edit an input, or follow a related entry. |
| `r` | Fetch fresh data for the selected entry. |
| Esc | Close a row, cancel an edit, or return to the catalog with its selection and search intact. |
| `q` | Cancel the current execution and quit. |
| Ctrl+C | Cancel the current execution and quit. |

An open row shows all its fields vertically.
Up/Down and Page Up/Page Down scroll text lines.
Left/Right scrolls long lines; SQL keeps its original line breaks.
In Definition, select a related entry with Up/Down and press Enter to open it.
Inputs lets you edit `root`, `me`, and query parameters.
Enter on `scope` cycles through `auto`, `root`, `agents`, and `all`.
An empty `me` keeps all panes; the initial automatic value follows the CLI caller rules.

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
