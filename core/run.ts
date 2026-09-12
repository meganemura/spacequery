// One call of spacequery: a fresh in-memory database, the required loaders,
// the statement, provider status, and the child process trace.
// Each call discards its database after the result returns (ADR 0002).
// Boundary: scheduling and call metadata. Provider behavior and query meaning
// stay in their modules.
import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import type { Database, Entry, Query } from "solarsql";
import { migrate, node } from "solarsql/node";
import { migrations } from "../migrations/index.ts";
import { providerCommands, providerQueries, type ProvidersId } from "./providers/public.ts";
import type { Exec, Loader, Scope } from "./loader.ts";
import { fsRepo, type Repo } from "./repo.ts";
import { directLoadersFor, loadersFor, tablesRead } from "./resolve.ts";

const execFileAsync = promisify(execFile);

function childExecWithEnv(env?: NodeJS.ProcessEnv): Exec {
  return async (command, args, cwd) => {
    const { stdout } = await execFileAsync(command, [...args], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env });
    return stdout;
  };
}

const childExec = childExecWithEnv();

function childExecForPath(pathValue: string | undefined): Exec {
  if (pathValue === process.env.PATH) return childExec;
  return childExecWithEnv({ ...process.env, PATH: pathValue });
}

function isAcceptedExit(e: unknown, options: Parameters<Exec>[3]): e is { code: number; stdout: string } {
  const failure = e as { code?: unknown; stdout?: unknown };
  return typeof failure.code === "number" && options?.exitCodes?.includes(failure.code) === true && typeof failure.stdout === "string";
}

async function executeWithStatus(execute: Exec, command: string, args: readonly string[], cwd: string | undefined, options: Parameters<Exec>[3]): Promise<{ stdout: string; ok: 0 | 1 }> {
  try {
    return { stdout: await execute(command, args, cwd, options), ok: 1 };
  } catch (e) {
    if (isAcceptedExit(e, options)) return { stdout: e.stdout, ok: 0 };
    throw e;
  }
}

// The default runner drops stderr. A permitted non-zero exit still returns
// stdout because some observation tools use it for an empty answer.
export const exec: Exec = async (command, args, cwd, options) => (await executeWithStatus(childExec, command, args, cwd, options)).stdout;

export type ProviderRow = { name: string; ok: number; observed_at: number; ms: number; error: string | null };

export type TraceRow = {
  provider: string;
  command: string;
  path: string | null;
  args: string[];
  cwd: string | null;
  started_ms: number;
  ms: number;
  ok: 0 | 1;
};

export type RunOptions = {
  loaders: readonly Loader[];
  scope?: Scope;
  exec?: Exec;
  env?: Readonly<Record<string, string | undefined>>;
  repo?: Repo;
  // Parameters for the statement. A root-bound statement defaults to the
  // root scope; an explicit scope can widen it. `me` is filled by the core
  // when the statement names it and the caller did not pass it.
  params?: Record<string, unknown>;
};

export type RunResult<R> = {
  rows: R[];
  providers: ProviderRow[];
  ms: number;
  trace: TraceRow[];
  scope: Scope;
  // The caller's own row, when a provider could tell.
  me: string | null;
  // The values bound to the statement. They identify an empty observation.
  params: Record<string, unknown>;
};

export type ReportSection = readonly [name: string, query: Query<string, Entry>];

export type ReportSectionStatus = {
  providers: string[];
  ok: 0 | 1;
  errors: { name: string; error: string }[];
};

export type ReportResult = {
  sections: Record<string, Record<string, unknown>[]>;
  sectionStatus: Record<string, ReportSectionStatus>;
  providers: ProviderRow[];
  ms: number;
  trace: TraceRow[];
  scope: Scope;
  me: string | null;
  params: Record<string, unknown>;
};

// A named query from a catalog.
export async function runQuery<Q extends Query<string, Entry>>(query: Q, options: RunOptions): Promise<RunResult<Record<string, unknown>>> {
  const state = await prepare(query.meta.reads, [...query.meta.params], options);
  const rows = await state.db.all(query, state.params as never);
  return { rows, ...resultMetadata(state, performance.now()) };
}

export function sqlParameterNames(sql: string): string[] {
  return [...new Set([...sql.matchAll(/:([a-zA-Z_][a-zA-Z0-9_]*)/g)].map((match) => match[1]!))];
}

// Ad hoc SQL. Parameters bind by the names the statement uses.
export async function runSql(sql: string, options: RunOptions): Promise<RunResult<Record<string, unknown>>> {
  const names = sqlParameterNames(sql);
  const state = await prepare((raw) => tablesRead(raw, sql), names, options);
  const statement = state.raw.prepare(sql);
  const bound = Object.fromEntries(names.map((name) => [name, state.params[name] ?? null]));
  const rows = statement.all(bound as Record<string, never>).map((row) => ({ ...row })) as Record<string, unknown>[];
  return { rows, ...resultMetadata(state, performance.now()) };
}

// A report composes named queries after one loader pass. Its sections remain
// catalog entries, so the provider cost of each section stays inspectable.
export async function runReport(sections: readonly ReportSection[], options: RunOptions): Promise<ReportResult> {
  const tables = [...new Set(sections.flatMap(([, query]) => query.meta.reads))];
  const params = [...new Set(sections.flatMap(([, query]) => query.meta.params))];
  const state = await prepare(tables, params, options);
  const values: Record<string, Record<string, unknown>[]> = Object.create(null);
  const sectionStatus: Record<string, ReportSectionStatus> = Object.create(null);
  const providerByName = new Map(state.providers.map((provider) => [provider.name, provider]));
  let statementEnded = performance.now();
  for (const [name, query] of sections) {
    values[name] = await state.db.all(query, state.params as never);
    statementEnded = performance.now();
    const direct = directLoadersFor(options.loaders, query.meta.reads);
    const errors = direct.flatMap((loader) => {
      const provider = providerByName.get(loader.name);
      if (!provider) throw new Error(`provider ${loader.name} has no observation status`);
      if (provider.ok !== 0) return [];
      if (provider.error === null) throw new Error(`provider ${loader.name} failed without an error`);
      return [{ name: provider.name, error: provider.error }];
    });
    sectionStatus[name] = {
      providers: direct.map((loader) => loader.name),
      ok: errors.length === 0 ? 1 : 0,
      errors,
    };
  }
  return { sections: values, sectionStatus, ...resultMetadata(state, statementEnded) };
}

type RunState = {
  raw: DatabaseSync;
  db: Database;
  providers: ProviderRow[];
  started: number;
  trace: TraceRow[];
  scope: Scope;
  me: string | null;
  params: Record<string, unknown>;
};

async function prepare(tables: readonly string[] | ((raw: DatabaseSync) => readonly string[]), paramNames: readonly string[], options: RunOptions): Promise<RunState> {
  const started = performance.now();
  const raw = new DatabaseSync(":memory:");
  migrate(raw, migrations);
  const db = node(raw);
  const root = options.params?.["root"];
  const scope = options.scope ?? (typeof root === "string" && paramNames.includes("root") ? "root" : "agents");
  const trace: TraceRow[] = [];
  let currentProvider: string | null = null;
  const env = options.env ?? process.env;
  const searchPath = env.PATH ?? process.env.PATH;
  const commandPaths = new Map<string, string | null>();
  const startsChildProcesses = options.exec === undefined || options.exec === exec;
  const execute = startsChildProcesses ? childExecForPath(searchPath) : options.exec!;
  const tracedExec: Exec = async (command, args, cwd, execOptions) => {
    if (currentProvider === null) throw new Error("a child process started outside a loader");
    const hasSlash = command.includes("/");
    let executablePath = hasSlash ? givenCommandPath(command, cwd) : commandPaths.get(command);
    if (executablePath === undefined) {
      executablePath = resolveCommandName(command, searchPath);
      commandPaths.set(command, executablePath);
    }
    const processStarted = performance.now();
    const row: TraceRow = {
      provider: currentProvider,
      command,
      path: executablePath ?? null,
      args: [...args],
      cwd: cwd ?? null,
      started_ms: round(processStarted - started),
      ms: 0,
      ok: 0,
    };
    trace.push(row);
    try {
      const executable = startsChildProcesses && !hasSlash ? executablePath ?? command : command;
      const result = await executeWithStatus(execute, executable, args, cwd, execOptions);
      row.ok = result.ok;
      return result.stdout;
    } finally {
      row.ms = round(performance.now() - processStarted);
    }
  };
  const ctx = {
    db,
    exec: tracedExec,
    scope,
    roots: typeof root === "string" ? [root] : [],
    env,
    repo: options.repo ?? fsRepo,
  };
  const needed = loadersFor(options.loaders, typeof tables === "function" ? tables(raw) : tables, scope);
  const providers: ProviderRow[] = [];
  // Loaders run in dependency order, one at a time. A failed loader leaves
  // its tables empty; a loader that runs after it sees the empty tables and
  // is not itself a failure.
  for (const loader of needed) {
    currentProvider = loader.name;
    const started = performance.now();
    const observed_at = Date.now();
    try {
      await loader.load(ctx);
      providers.push({ name: loader.name, ok: 1, observed_at, ms: round(performance.now() - started), error: null });
    } catch (e) {
      providers.push({ name: loader.name, ok: 0, observed_at, ms: round(performance.now() - started), error: e instanceof Error ? e.message : String(e) });
    } finally {
      currentProvider = null;
    }
  }
  const recorded = await db.run(providerCommands.record, { rows: providers.map((p) => ({ ...p, name: p.name as ProvidersId })) });
  if (!recorded.ok) throw new Error(`providers: ${recorded.kind}`);
  const params = { ...(options.params ?? {}) };
  let me: string | null = null;
  if (paramNames.includes("me")) {
    if (params["me"] === undefined) {
      for (const loader of needed) {
        if (!loader.self) continue;
        currentProvider = loader.name;
        try {
          me = await loader.self(ctx);
        } finally {
          currentProvider = null;
        }
        if (me !== null) break;
      }
      params["me"] = me;
    } else {
      me = params["me"] as string | null;
    }
  }
  const bound: Record<string, unknown> = {};
  for (const name of paramNames) {
    if (params[name] === undefined) throw new Error(`missing parameter: ${name}`);
    bound[name] = params[name];
  }
  return { raw, db, providers: await db.all(providerQueries.all), started, trace, scope, me, params: bound };
}

function resultMetadata(state: RunState, statementEnded: number): Omit<RunResult<never>, "rows"> {
  return {
    providers: state.providers,
    ms: round(statementEnded - state.started),
    trace: state.trace,
    scope: state.scope,
    me: state.me,
    params: state.params,
  };
}

function round(ms: number): number {
  return Math.round(ms * 10) / 10;
}

function resolveCommandName(command: string, pathValue: string | undefined): string | null {
  if (pathValue === undefined) return null;
  for (const directory of pathValue.split(delimiter)) {
    const candidate = resolve(directory || ".", command);
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}

function givenCommandPath(command: string, cwd: string | undefined): string | null {
  const candidate = resolve(cwd ?? process.cwd(), command);
  return isExecutable(candidate) ? candidate : null;
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
