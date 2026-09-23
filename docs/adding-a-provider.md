# Adding a provider

A provider is one module under `providers/<name>/` (ADR 0004). It fills its own tables at query time from one external tool, and named queries join those tables. This document lists the rules that every provider keeps, and why. The core enforces some of them; the review enforces the rest.

## The rules that keep spacequery from becoming a command runner

spacequery starts child processes. The rules below make every process a fixed, read-only observation. Check each one when you add or change a loader.

1. **The command name is a literal in the loader.** It never comes from a parameter, an environment variable, a query, or a database row. `grep -rn 'ctx.exec(' providers` must show a quoted string as the first argument in every built-in call. A user provider takes the name from its declaration. The core resolves that name to an absolute path once per call and starts the process by that path (ADR 0032); a loader never resolves a path itself.

2. **The argument list is a literal list.** The core runs `execFile` with an argument array and no shell (`core/run.ts`). The only variable elements allowed in the array are:
   - a root from the scope, as a path after a fixed flag (`bd -C <root>`), or as `cwd`;
   - identifiers that the same provider read from an earlier call of the same tool, in the same run (`docker container inspect <ids>` after `docker container ls`);
   - the user id from the process (`lsof -u <uid>`).
   No element is built from a query parameter such as `--q`, and no element is built by string concatenation that a shell reads.
   A user provider takes every argument from its declaration.

3. **When a machine-read value enters a query language, it is quoted or bound.** Owner and name from an origin URL go into the GraphQL text through `JSON.stringify`. A value that goes into SQL is bound as a parameter through solarsql. No value is spliced into a text that another program parses.

4. **Only read verbs.** `list`, `status`, `inspect`, `ls`, `api` reads, `search`. No verb that changes provider state (ADR 0005). git runs with `--no-optional-locks` so that even the index is untouched. If a tool has no read-only verb for the fact you need, read the file the tool writes instead (sessions, headsign, skills, repository files do this).

5. **cwd is a root in scope, or nothing.** The scope comes from the core (`rootsInScope`): the explicit `--root`, the roots herdr reports, or the ghq roots under `--scope all`. A loader does not walk outside those roots.

6. **The environment is read by name.** `HOME`, `HERDR_PANE_ID`, `CLAUDE_CODE_SESSION_ID`, and the mise configuration variables. A loader does not pass the environment through to a child or read variables it does not name.

7. **Failure is an empty table and a `providers` row.** stderr is dropped; the exit code decides. A non-zero exit that means "nothing found" is listed in `exitCodes` (`lsof` exits 1). Any other failure throws, and the core records the message. A loader never retries with a different command.

8. **A query cannot add a process.** The core picks loaders from the tables a query reads (`core/resolve.ts`). A user query is a SQL file; `--sql` goes through the read-only authorizer. A new process comes from a reviewed loader change or a declaration that the user put in the configuration directory.

9. **Tests inject `exec`.** Unit tests use an injected `exec` and assert each command, argument list, and process directory; one user provider integration test starts a controlled temporary script. This is also where rule 1 and rule 2 are checked mechanically: the fake `exec` sees the literal command name and the literal arguments.

10. **Order and bursts.** Declare `after` for tables this loader reads while it loads. A loader that only calls `rootsInScope` uses `discoveryLoaders` as `afterForScope`, so a root-bound call does not start herdr or ghq and `--scope agents` does not start ghq. Independent loaders run together (ADR 0044). The core starts each command by absolute path (ADR 0032).

The core applies the command, argument, shell, directory, failure, and trace rules to user providers.
The user reviews whether each declared command only reads external state.

## Steps

1. Write the ADR first: `docs/adr/00NN-<what-is-observed-through-what>.md`, with the command, its cost measured on this machine, and what is out of scope. Add the row to `docs/README.md`.
2. `providers/<name>/schema.ts` and `queries.ts` with solarsql; `module.ts`; `loader.ts` with a header comment that states the responsibility and the boundary.
3. `npm run build`, then regenerate `migrations/` (delete it, `npx solarsql build spacequery.config.ts`, `npx solarsql migration initial spacequery.config.ts`).
4. Register the loader in `spacequery.config.ts` and the queries in `catalog.ts`.
5. Tests: `test/<name>-loader.test.ts` with an injected `exec`, example tests plus a hegel property test where a property exists.
6. Documentation in the same commit: `skills/spacequery/references/providers.md`, `queries.md`, `tables.md`; `CHANGELOG.md`.
7. Review against the ten rules above before the commit.

## Review checklist

- `grep -rn 'ctx.exec(' providers/<name>` shows literal command names and literal argument lists.
- No `--q` or other query parameter reaches `exec`.
- The verbs are read-only, and git has `--no-optional-locks`.
- The loader test asserts the command and arguments.
- The ADR names the cost and the scope.
