# 0035. A user provider is a declared command that fills a declared table.

Date: 2026-09-12

Status: accepted

## Context

A user query can join built-in tables without a build step.
A user cannot add a private data source without adding provider code to this repository.
Some useful data comes from private tools or local scripts that do not belong in spacequery.
A configuration file can declare the table shape and the command that provides its rows.
The declared command determines the observation cost.

## Decision

A user provider is one JSON file in `$XDG_CONFIG_HOME/spacequery/providers`.
The default directory is `~/.config/spacequery/providers`.
The file name without `.json` is the provider name and matches `^[a-z][a-z0-9-]*$`.
A user provider name cannot equal a built-in provider name.
The `tables` object maps each table name to one `create table` statement for that name.
A user table name cannot equal a built-in table name.
The `command` array contains a command name or path followed by literal arguments.
The `scope` value is `call` or `root`.
The optional `description` appears in command help.
A call-scoped command runs once without a process directory.
A root-scoped command runs once for each root in scope and uses that root as its process directory.
The root commands run concurrently, as the git loader's do.
A root that fails names itself in the provider error, and the provider's tables stay empty.
The command prints a JSON object that maps table names to row arrays.
A provider with one table can print its row array directly.
Each row is an object whose keys are declared columns.
The core supplies null for a missing column.
For a root-scoped command, the core supplies the process root when a row lacks a declared `root` column.
The core creates the declared tables after the built-in migration and before loader selection.
The core starts the command through its existing executor without a shell.
Command resolution and trace fields follow ADR 0032 and ADR 0031.
Each provider status row has `source` set to `built-in` or `user`.
Invalid command output fails the user provider and leaves its tables empty.
The call continues after a user provider fails.
User providers run after the built-in loaders selected for the call.
User providers run in file-name order, one at a time.
Root-scoped providers use `rootsInScope`, so the call scope selects their roots.
The core enforces literal arguments, shell-free execution, bounded process directories, empty tables on failure, and trace records.
The user is responsible for the declared command's read behavior.
A user declaration has the same local trust boundary as a user query.

## Consequences

A user can join a private command's rows with built-in tables without changing spacequery.
A malformed declaration produces a warning and does not enter the provider list.
A failed provider stays visible in the call envelope.
The `providers.source` column distinguishes repository code from local declarations.
The providers directory is as sensitive as a shell rc file: a file there makes every call that reads its table start that command.
Only the owner writes to the directory, and the owner reviews every declaration.
