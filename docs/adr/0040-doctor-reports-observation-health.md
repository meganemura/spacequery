# 0040. Doctor reports whether the observation stack answered.

Date: 2026-09-23

Status: accepted

## Context

An agent that sees empty rows cannot tell a missing tool from an empty machine.
A query already carries `providers`, but only for the tables that query reads.
The first question, before trusting any of those rows, is whether the toolchain can answer at all.
A resident process, or a command that installed missing tools, would be a second product.
spacequery still has no cache and no write verb.

## Decision

`spacequery doctor` runs every built-in loader once through the same load path as a query.
The scope is `root` for one repository. The default root is the git toplevel of the current directory.
Doctor does not accept `--scope`, so it does not fan out across every repository.
The report is JSON. `--json` selects that same document.
Each provider row is the existing providers row: `name`, `source`, `ok`, `observed_at`, `ms`, and `error`.
When `search_path` answered, the report adds the PATH entry, missing-entry, and duplicate-entry counts that `path-entries` already stores.
Doctor does not suggest package installs.
The user-provider directory is reported as present or absent. Doctor does not run user-provider commands.
Doctor does not write the call log.
When doctor itself cannot run, it prints `{error, do}` and does not print a stack.
A report exits 0 even when some providers did not answer. The report's own `ok` is 0 in that case, as a one-shot query leaves its exit code unchanged and puts the failure in `providers`.

## Consequences

An agent can see a missing binary, a permission error, or an absent user-provider directory before it treats empty rows as none.
Doctor costs one observation of every built-in provider on one root, including tools that contact a service.
A missing optional tool is `ok` 0 in the report. Doctor does not install it.
Doctor is not a daemon and not a fixer.
