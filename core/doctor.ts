// Reports whether the observation stack can answer, for one root.
// It schedules the built-in loaders through the query path and does not
// install tools, edit configuration, or start user-provider commands.
// Boundary: the doctor report. core/run.ts loads providers; the CLI prints.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { diagnosePrepareError } from "./diagnose.ts";
import type { Exec, Loader } from "./loader.ts";
import type { Repo } from "./repo.ts";
import { disabledProviderNames, isProviderEnabled, loadConfig } from "./config.ts";
import { observeProviders, openObservationDatabase, type PathHealth, type ProviderRow, type TraceRow } from "./run.ts";
import { loadUserProviders, userProvidersDirectory } from "./user-providers.ts";
import { loadUserQueries, type UserQuery } from "./user-queries.ts";

export type UserProviderDirectory = { directory: string; present: 0 | 1; error: string | null };

export type UserQueryStatus = { name: string; path: string; ok: 0 | 1; error: string | null; hint: string | null };

export type DoctorReport = {
  command: "doctor";
  ok: 0 | 1;
  version: string;
  package: string;
  root: string;
  scope: "root";
  ms: number;
  providers: ProviderRow[];
  path: PathHealth | null;
  user_providers: UserProviderDirectory;
  user_queries: UserQueryStatus[];
  disabled_providers: string[];
  config: string;
  trace?: TraceRow[];
};

export type DoctorGuidance = { error: string; do: string };

export const doctorDo = "spacequery doctor [--json] [--root DIR] [--trace]";

export type DoctorOptions = {
  loaders: readonly Loader[];
  root: string;
  env?: Readonly<Record<string, string | undefined>>;
  exec?: Exec;
  repo?: Repo;
  trace?: boolean;
};

// A directory that exists but cannot be listed hides user providers.
// Absence is not a failure: the directory is optional.
export function userProviderDirectory(env: Readonly<Record<string, string | undefined>>): UserProviderDirectory {
  const directory = userProvidersDirectory(env);
  let info;
  try {
    info = statSync(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { directory, present: 0, error: null };
    return { directory, present: 0, error: message(error) };
  }
  if (!info.isDirectory()) return { directory, present: 0, error: `${directory} is not a directory` };
  try {
    readdirSync(directory);
  } catch (error) {
    return { directory, present: 1, error: message(error) };
  }
  return { directory, present: 1, error: null };
}

export function doctorGuidance(error: string): DoctorGuidance {
  return { error, do: doctorDo };
}

// Scope stays root so each repository-scoped loader runs on one checkout.
// Widening to every repository would repeat the same toolchain check.
export async function runDoctor(options: DoctorOptions): Promise<DoctorReport> {
  const identity = packageIdentity();
  const env = options.env ?? process.env;
  const preferences = loadConfig(env);
  const user_providers = userProviderDirectory(env);
  // A provider that is off is not a failed observation. Doctor names it and moves on.
  const active = options.loaders.filter((loader) => isProviderEnabled(loader.name, preferences));
  const observed = await observeProviders({
    loaders: active,
    scope: "root",
    params: { root: options.root },
    env,
    exec: options.exec,
    repo: options.repo,
  });
  const user_queries = checkUserQueries(env, options.loaders);
  const answered = observed.providers.every((provider) => provider.ok === 1)
    && user_providers.error === null
    && user_queries.every((query) => query.ok === 1);
  return {
    command: "doctor",
    ok: answered ? 1 : 0,
    version: identity.version,
    package: identity.package,
    root: options.root,
    scope: "root",
    ms: observed.ms,
    providers: observed.providers,
    path: observed.path,
    user_providers,
    user_queries,
    disabled_providers: disabledProviderNames(options.loaders.map((loader) => loader.name), preferences),
    config: preferences.path,
    ...(options.trace ? { trace: observed.trace } : {}),
  };
}

// A user query file is typed by nothing until it runs. Doctor prepares it
// on the same empty schema a call would, so a table or column rename that
// breaks the file surfaces here instead of the next time someone calls it.
function checkUserQueries(env: Readonly<Record<string, string | undefined>>, builtInLoaders: readonly Loader[]): UserQueryStatus[] {
  const userProviders = loadUserProviders(env, builtInLoaders);
  const queries: UserQuery[] = loadUserQueries(env);
  if (queries.length === 0) return [];
  const raw = openObservationDatabase(userProviders);
  try {
    return queries.map((query) => {
      try {
        raw.prepare(query.sql);
        return { name: query.name, path: query.path, ok: 1, error: null, hint: null };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { name: query.name, path: query.path, ok: 0, error: message, hint: diagnosePrepareError(raw, query.sql, message) ?? null };
      }
    });
  } finally {
    raw.close();
  }
}

function packageIdentity(): { version: string; package: string } {
  const packageJson = fileURLToPath(new URL("../package.json", import.meta.url));
  const parsed: unknown = JSON.parse(readFileSync(packageJson, "utf8"));
  const version = parsed !== null && typeof parsed === "object" && "version" in parsed ? parsed.version : undefined;
  if (typeof version !== "string" || version === "") throw new Error("package.json has no version");
  return { version, package: dirname(packageJson) };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
