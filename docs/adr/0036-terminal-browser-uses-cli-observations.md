# 0036. The terminal browser uses CLI observations.

Date: 2026-09-12

Status: accepted

## Context

A person needs to discover tables, inspect query SQL, and examine rows without assembling shell commands for each step.
The CLI already binds parameters, selects scope, and reports provider failures.
A terminal browser must preserve those rules across repeated executions.

## Decision

`spacequery ui` opens a terminal browser with Tables and Queries as its two entry points.
The catalog reads the migrated schema and query metadata in an empty database, then closes that database.
Catalog navigation starts no provider.
The Definition view connects table names and query read metadata.
Two detail views separate definitions from observations.
Selection opens Definition with SQL, related entries, and column types.
Execution opens Results with observed values, column headings, and source status.
Required parameters are prompted before execution; context and parameter editing use explicit shortcuts.
Source status follows the result rows, and `s` jumps to that section.
SQL keeps its original line breaks, with horizontal scrolling for long lines.
A fixed character count split identifiers and left half the pane unused for ASCII SQL.

An explicit execution starts the existing CLI in a child process with arguments passed as an array.
The child process owns the observation database and exits after the result.
This keeps the CLI's scope restrictions, parameter binding, and call logging in the execution path.
On POSIX systems, cancellation terminates the observation process group, including its provider commands.
Table inspection binds the selected root and defaults to root scope.
Named queries keep their normal defaults.

The browser retains one result for row inspection and shows its receipt time.
It exposes provider observation times, durations, and errors beside that result.
An input change clears the result to prevent a mismatch between parameters and displayed data.
An empty result with a failed provider is unknown.

The UI uses Ink for terminal layout and input, with React for screen state.
Ink 7.1.1, React 19.2.8, and development types 19.2.18 use exact version pins.
Each version was released more than seven days before adoption.
Ordinary CLI calls load the terminal entry point only when the command is `ui`.
The name `ui` is reserved and a conflicting user query file receives a warning.

## Consequences

Each execution pays process startup cost while retaining the existing CLI behavior.
Manual refresh gives the person control over provider work.
A terminal with at least 60 columns and 16 rows can display the browser.
Wide results expose successive columns and a vertical row detail view.
Reports, SQL editing, and automatic refresh remain future work.
