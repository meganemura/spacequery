# Terminal browser

Start the browser with `spacequery ui`.
It accepts `--root DIR`, `--scope root|agents|all`, `--me PANE`, and `--no-mouse`.
It needs a terminal with at least 60 columns and 16 rows.

Tables shows built-in and user provider tables with their column types, nullable columns, and keys.
Queries shows built-in and user queries with descriptions, SQL, parameters, and result columns.
Definition opens when an entry is selected or the catalog is switched.
It shows SQL first, then Columns, then links to related tables or queries.
Section headings, blank lines, and aligned column types separate these definitions.
Active catalog and view tabs use a cyan background and brackets; inactive tabs use dim text.
The focused selection uses a blue background and a marker. Source metadata uses dim text.
The catalog uses its full height and keeps the same page when the detail view changes.
Sources uses green for successful retrieval and red for failures, with OK and FAILED labels.
Execution opens Results, which contains observed values with column headings and source status.
Column definitions stay in Definition; an unexecuted Results view shows an execution hint.
A broken user query keeps its SQL and an error message in the catalog.

## Keys

| Key | Action |
| --- | --- |
| `m` | Toggle mouse input. |
| `t` | Toggle between Tables and Queries. |
| `/` | Edit the catalog search; Enter applies it and Esc cancels it. |
| Tab | Move focus between the catalog and the detail pane. |
| Up/Down or `k`/`j` | Select an entry, row, or text line in the focused pane. |
| Page Up/Page Down | Move by one page. |
| `1`, `2` | Open Definition or Results. |
| `e` | Edit query parameters in sequence. |
| `c` | Edit root, scope, and caller context in sequence. |
| `s` | Switch focus between result rows and the fixed Sources area. |
| Left/Right | Scroll result columns or long text lines horizontally. |
| Enter | Focus the selected entry, open a row, accept an input, or follow a related entry. |
| `r` | Prompt for missing parameters, then execute the selected entry. |
| Esc | Close a row, cancel an edit, or return to the catalog with its selection and search intact. |
| `q` | Cancel the current execution and quit. |
| Ctrl+C | Cancel the current execution and quit. |

An open row shows all its fields vertically.
Up/Down and Page Up/Page Down scroll text lines.
Left/Right scrolls long lines; SQL keeps its original line breaks.
Yellow arrows at the right edge of the view header show which directions have hidden text or result columns.
These arrows are also clickable. Sources has its own direction indicators.
Arrows disappear at the corresponding edge; content that fits has no arrows.
Vertical scrollbars show the position in the catalog, Definition, Results, open rows, and Sources.
The thumb shows the visible share; top and bottom arrows indicate more content.
Click the track to jump or its arrows to scroll one line.
A one-line area uses a direction marker; clicking it switches between the first and last position.
Scrollbars disappear when the content fits. Dragging is not supported.
In Definition, select a related entry with Up/Down and press Enter to open it.
The header shows root, scope, and caller context.
Long root paths show their tail; the context editor retains the complete value.
Click the context line to edit it, or click Search to edit the filter.
The bottom help line follows the focused area.
Input prompts keep the cursor visible and show instructions on a separate line.
The final prompt says whether Enter saves the value or runs the query.
Press `c` to edit these values or `e` to edit the selected query's parameters.
Enter accepts a value and advances to the next field; Ctrl+U clears the field and Esc cancels the remaining prompts.
When `r` requests missing parameters, accepting the last value starts execution.
Context and parameter edits with `c` or `e` do not execute a query.
Scope accepts `auto`, `root`, `agents`, or `all`.
The initial automatic `me` follows the CLI caller rules; accepting it unchanged preserves automatic detection.
Clear `me` with Ctrl+U to keep all panes.

## Mouse

Mouse input starts enabled. Use `--no-mouse` to start with it disabled, or press `m` to toggle it.
The header shows whether mouse input is on.
Disable it when you want the terminal to handle text selection.
Mouse input requires a terminal that forwards SGR mouse reports; a multiplexer must forward them too.

Click Tables or Queries to switch catalogs, or click Definition or Results to switch views.
Click a catalog entry to select it, a related entry to open its definition, or a result row to open its details.
Click `[r Run]` to execute; missing parameters still require input before execution.
The wheel scrolls the area under the pointer: the catalog, definition, result rows, open row, or Sources.
Catalog and result viewports have positions separate from their selections.
The wheel, scrollbar, and PageUp or PageDown move the viewport without changing the selected query or result row.
Clicks and Up or Down change selection. Keyboard selection brings the selected entry into view.
A selection can remain outside the viewport after scrolling; Enter still opens that selection.
Horizontal wheel events scroll long text or result columns when the terminal provides them.
Mouse actions pause during input prompts and execution.
Right clicks, modified clicks, and drag operations are ignored.
The browser disables mouse reporting when it exits.

## Observations

Catalog navigation reads definitions without running providers.
Press `r` to execute a query or read a table.
Each execution uses a fresh CLI process and database.
The browser retains the latest result in memory for navigation and row inspection.
The receipt time identifies that result; the fixed Sources area in Results shows each provider's observation time and duration.
Editing an input clears the result so old data cannot appear under new parameters.

With `scope: auto`, table inspection binds the selected root and uses root scope.
Named queries follow their usual CLI scope defaults and restrictions.
Some provider tables, such as the caller's PATH, describe machine state regardless of scope.
The result footer shows the effective scope.

A failed provider makes an empty result unknown.
The result footer identifies failed providers, and the Sources section shows their errors.
Reading the `providers` table alone runs no provider and therefore returns no status rows.
Sources stays visible below the rows, including when a row is open.
Press `s` after execution to focus Sources; arrow keys scroll its lines and long text.
Press `s` or Esc to return to the rows.

The browser supports manual execution and query inspection.
Reports remain available through the CLI; SQL editing and automatic refresh are outside this version.
