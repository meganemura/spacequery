# Terminal browser visual design

The browser supports a repeated task: choose an entry, inspect its definition, run it, and read the observation.
The visual hierarchy keeps the selected entry and the next action easy to find.

## Selection and navigation

Cyan backgrounds identify active tabs. Blue backgrounds identify the focused row or input.
Brackets and row markers preserve selection cues when color is unavailable.
Item names use bold text; source metadata and descriptions use lower emphasis.

The catalog uses its full available height. Its page size is independent of Definition and Results.
Switching a detail view therefore preserves the catalog page and selection.
Each scrollable area retains its own scrollbar and mouse target.

## Definitions and results

Definition presents SQL, Columns, and related entries in that order.
Section headings, indentation, and blank lines separate their roles.
Results uses distinct column headings and a highlighted selected row.
Sources remains fixed below the rows and uses OK or FAILED labels with green or red text.

An unexecuted result, a running query, an empty observation, and an execution failure have distinct messages.
Each message gives the next useful action. Run displays a waiting state during execution.
The error line reserves its space so prompts stay in place when an error appears.

## Inputs and compact screens

The context and search lines are clickable. Their keyboard shortcuts remain available.
Input values occupy a dedicated row; the next row explains acceptance, clearing, and cancellation.
Long values scroll to keep the cursor visible. A final prompt distinguishes saving from running.
Long context paths show their tail while the editor keeps the full value.

Compact results reserve space for row count, effective scope, and receipt time.
The selected entry name uses the remaining space and truncates when necessary.
The bottom help line describes the focused area instead of repeating every command.
