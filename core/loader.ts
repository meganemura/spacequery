// The contract between the core and a provider. The core knows a loader by
// this shape only: its name, the tables it fills, the loaders it runs
// after, and how to fill them. What a loader runs and how it parses the
// answer stays in the provider.
// Boundary: types only. run.ts schedules; a provider's loader.ts loads.
import type { DatabaseSync } from "node:sqlite";
import type { Database } from "solarsql";
import type { Repo } from "./repo.ts";

export type Scope = "root" | "agents" | "all";

// Runs one child process and resolves with its stdout. Injectable so a
// test can make one provider fail without stopping the real tool.
// `exitCodes` names the exit codes that still carry an answer. lsof exits 1
// when one of the files it was asked about is open by nobody, which is the
// normal case for a lock directory, and its stdout is the answer anyway.
export type ExecOptions = { exitCodes?: readonly number[] };
export type Exec = (command: string, args: readonly string[], cwd?: string, options?: ExecOptions) => Promise<string>;

export type LoadContext = {
  // Runtime declarations have no generated Solarsql command, so their
  // loaders use the raw engine for bounded inserts into declared tables.
  raw: DatabaseSync;
  db: Database;
  exec: Exec;
  scope: Scope;
  // A root-bound statement defaults to this one root, which avoids loading
  // unrelated repositories. An explicit wider scope can include it too.
  roots: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  repo: Repo;
};

export type Loader = {
  name: string;
  // The tables this loader fills. The core maps a query's reads to loaders
  // through this list.
  tables: readonly string[];
  // Loaders whose tables this one reads while it loads.
  after: readonly string[];
  // Some providers need discovery only for a wider scope. Root-bound static
  // readers can therefore keep their no-process path.
  afterForScope?(scope: Scope): readonly string[];
  load(ctx: LoadContext): Promise<void>;
  // The caller's own row, when this provider can tell. The core binds it
  // as `:me` to a query that names that parameter.
  self?(ctx: LoadContext): Promise<string | null>;
};
