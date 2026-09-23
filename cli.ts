#!/usr/bin/env node
// The command line: spacequery <query|report> [--root DIR] [--scope root|agents|all] [--me PANE] [--json|--tsv] [--trace] [--expect-empty] [--strict]
//                   spacequery --sql <text> [--root DIR] [--me PANE] [--scope root|agents|all] [--json|--tsv] [--trace] [--expect-empty] [--strict]
//                   spacequery watch <query|--sql text> [query flags] --until <predicate> [--interval MS] [--timeout SEC]
//                   spacequery --help
// The JSON envelope carries the call time, rows, and provider status.
// A requested trace lists child processes. TSV keeps stdout for result rows.
// Watch prints one compact envelope per line and reuses the same query path.
// Boundary: parsing arguments and printing. core/run.ts does the work.
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, type ParseArgsOptionsConfig } from "node:util";
import { catalog, reportParams, reports } from "./catalog.ts";
import { callCounts, callsPath, recordCall } from "./core/calls.ts";
import type { Scope } from "./core/loader.ts";
import { runQuery, runReport, runSql, type ProviderRow, type ReportResult, type RunResult, type TraceRow } from "./core/run.ts";
import { defaultWatchIntervalMs, defaultWatchTimeoutSec, parseUntil, parseWatchTiming, watchUntil, type WatchStop } from "./core/watch.ts";
import { fsRepo } from "./core/repo.ts";
import { loadUserProviders, type UserProvider } from "./core/user-providers.ts";
import { loadUserQueries, type UserQuery } from "./core/user-queries.ts";
import { loaders } from "./spacequery.config.ts";

const commandOptions = new Set(["root", "scope", "me", "sql", "json", "tsv", "trace", "help", "expect-empty", "strict", "until", "interval", "timeout"]);
const watchOnlyOptions = new Set(["until", "interval", "timeout"]);

type HelpQuery = { name: string; description: string; params: readonly string[]; source: "built-in" | "user" };
type HelpReport = { name: string; description: string; params: readonly string[]; sections: readonly (readonly [string, string])[]; source: "report" };

function queriesForHelp(userQueries: readonly UserQuery[], env: Readonly<Record<string, string | undefined>>): HelpQuery[] {
  const counts = callCounts(env);
  const byUse = <T extends { name: string }>(queries: readonly T[]): T[] => queries
    .map((query, index) => ({ query, index }))
    .sort((a, b) => (counts.get(b.query.name) ?? 0) - (counts.get(a.query.name) ?? 0) || a.index - b.index)
    .map(({ query }) => query);
  const builtIn = Object.entries(catalog).map(([name, query]) => ({ name, description: query.description, params: query.params, source: "built-in" as const }));
  const user = userQueries.map((query) => ({ name: query.name, description: query.description, params: query.params, source: "user" as const }));
  return [...byUse(builtIn), ...byUse(user)];
}

function reportsForHelp(): HelpReport[] {
  return Object.entries(reports).map(([name, report]) => ({
    name,
    description: report.description,
    params: reportParams(report),
    sections: report.sections,
    source: "report",
  }));
}

function usage(userQueries: readonly UserQuery[], userProviders: readonly UserProvider[], env: Readonly<Record<string, string | undefined>>): string {
  const queries = queriesForHelp(userQueries, env);
  const reportEntries = reportsForHelp();
  const width = Math.max(...[...queries, ...reportEntries].map((query) => query.name.length));
  const lines = queries.filter((query) => query.source === "built-in").map((query) => queryLine(query.name, query.description, query.params, width));
  const userLines = queries.filter((query) => query.source === "user").map((query) => queryLine(query.name, query.description, query.params, width));
  const reportLines = reportEntries.map((report) => queryLine(report.name, report.description, report.params, width));
  const providerNameWidth = Math.max(0, ...userProviders.map((provider) => provider.name.length));
  const providerTablesWidth = Math.max(0, ...userProviders.map((provider) => provider.tables.join(", ").length));
  const providerLines = userProviders.map((provider) => `  ${provider.name.padEnd(providerNameWidth)}  ${provider.tables.join(", ").padEnd(providerTablesWidth)}  ${provider.description}`);
  return [
    "usage: spacequery <query|report> [--root DIR] [--scope root|agents|all] [--me PANE] [--json|--tsv] [--trace] [--expect-empty] [--strict]",
    "       spacequery --sql <text> [--root DIR] [--me PANE] [--scope root|agents|all] [--json|--tsv] [--trace] [--expect-empty] [--strict]",
    "       spacequery watch <query> [--root DIR] [--scope root|agents|all] [--me PANE] [--json|--tsv] [--trace] [--expect-empty] [--strict] --until <predicate> [--interval MS] [--timeout SEC]",
    "       spacequery watch --sql <text> [--root DIR] [--me PANE] [--scope root|agents|all] [--json|--tsv] [--trace] [--expect-empty] [--strict] --until <predicate> [--interval MS] [--timeout SEC]",
    "",
    "terminal browser: spacequery ui [--root DIR] [--scope root|agents|all] [--me PANE]",
    "",
    "queries:",
    ...lines,
    ...(userQueries.length === 0 ? [] : ["", `user queries (${dirname(userQueries[0]!.path)}):`, ...userLines]),
    ...(userProviders.length === 0 ? [] : ["", `user providers (${dirname(userProviders[0]!.path)}):`, ...providerLines]),
    "",
    "reports:",
    ...reportLines,
    "",
    "A root-bound query defaults to --scope root. --scope agents uses roots with an agent; --scope all also uses every ghq root.",
    "--root defaults to the git toplevel of the current directory.",
    "--me excludes one pane; by default the caller's own pane, found from the environment.",
    "--trace lists every child process of the call, with its provider, start offset, and duration.",
    "--expect-empty exits 3 after it prints rows when the query returned rows.",
    "--strict exits 4 after it prints rows when a provider did not answer.",
    `queries are listed by how often you called them (the count is in ${callsPath(env)})`,
    "",
    "watch re-runs one query until --until matches. --until is required. Each tick is a new observation.",
    "--until empty matches zero rows. --until nonempty matches one or more rows.",
    "--until <column>=<value>[|<value>...] matches when every row has that column set to one of the values. Zero rows do not match.",
    "An incomplete observation (a provider with ok 0) does not match. Empty rows beside a failed provider stay unknown.",
    `--interval defaults to ${defaultWatchIntervalMs} milliseconds. --timeout defaults to ${defaultWatchTimeoutSec} seconds; 0 waits until the predicate or a signal.`,
    "The first snapshot prints immediately. Later snapshots print only when the observation changes.",
    "JSON watch output is one envelope per line. One-shot JSON stays indented.",
    "in-dir, working, and agents use agent_status (working, idle, blocked, unknown). working lists only agents that are working, so wait with --until empty.",
    "claude-sessions uses status. workflow uses status.",
    "  spacequery watch in-dir --until empty",
    "  spacequery watch working --until empty",
    "  spacequery watch in-dir --until agent_status=idle|blocked",
    "  spacequery watch claude-sessions --until status=idle",
    "Exit 0 when --until matches, 5 on timeout, 130 on SIGINT or SIGTERM.",
  ].join("\n");
}

function queryLine(name: string, description: string, params: readonly string[], width: number): string {
  return `  ${name.padEnd(width)}  ${description}${params.length ? `  (--${params.join(", --")})` : ""}`;
}

function optionsFor(userQueries: readonly UserQuery[]): ParseArgsOptionsConfig {
  // SQL permits parameter names that also name inherited JavaScript properties.
  const options: ParseArgsOptionsConfig = Object.create(null);
  options["root"] = { type: "string" };
  options["scope"] = { type: "string" };
  options["me"] = { type: "string" };
  options["sql"] = { type: "string" };
  options["json"] = { type: "boolean" };
  options["tsv"] = { type: "boolean" };
  options["trace"] = { type: "boolean" };
  options["help"] = { type: "boolean", short: "h" };
  options["expect-empty"] = { type: "boolean" };
  options["strict"] = { type: "boolean" };
  options["until"] = { type: "string" };
  options["interval"] = { type: "string" };
  options["timeout"] = { type: "string" };
  for (const query of [...Object.values(catalog), ...Object.values(reports).map((report) => ({ params: reportParams(report) })), ...userQueries]) {
    for (const parameter of query.params) {
      if (!Object.hasOwn(options, parameter)) options[parameter] = { type: "string" };
    }
  }
  return options;
}

function textOption(values: Record<string, unknown>, name: string): string | undefined {
  const value = values[name];
  if (value === undefined) return undefined;
  if (typeof value === "string") return value;
  throw new Error(`--${name} needs a value`);
}

function isScope(value: string | undefined): value is Scope | undefined {
  return value === undefined || value === "root" || value === "agents" || value === "all";
}

function validateQueryOptions(values: Record<string, unknown>, userQueries: readonly UserQuery[], parameters: readonly string[], name: string): void {
  const accepted = new Set(parameters);
  const discovered = new Set([...Object.values(catalog), ...Object.values(reports).map((report) => ({ params: reportParams(report) })), ...userQueries].flatMap((query) => query.params));
  for (const parameter of discovered) {
    if (!commandOptions.has(parameter) && values[parameter] !== undefined && !accepted.has(parameter)) {
      throw new Error(`query ${name} does not take --${parameter}`);
    }
  }
}

// The toplevel of a directory, or the directory itself when git refuses.
function toplevel(dir: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return dir;
  }
}

// Static repository inspection must not start Git before it reads files.
// This special path keeps all other query root behavior unchanged.
async function staticToplevel(dir: string): Promise<string> {
  const absolute = resolve(dir);
  return await fsRepo.rootOf(absolute) ?? absolute;
}

function tsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const keys = Object.keys(rows[0]!);
  const cell = (v: unknown) => (v === null || v === undefined ? "" : String(v).replace(/[\t\n]/g, " "));
  return [keys.join("\t"), ...rows.map((r) => keys.map((k) => cell(r[k])).join("\t"))].join("\n") + "\n";
}

function reportTsv(sections: Record<string, Record<string, unknown>[]>): string {
  return Object.entries(sections).map(([name, rows]) => rows.length === 0
    ? `# ${name}\n`
    : `# ${name}\n${tsv(rows)}\n`).join("");
}

function traceTsv(trace: readonly TraceRow[]): string {
  return tsv(trace.map((row) => ({ ...row, args: JSON.stringify(row.args) })));
}

function warn(providers: ProviderRow[]): void {
  for (const p of providers) if (!p.ok) process.stderr.write(`spacequery: provider ${p.name} failed: ${p.error}\n`);
}

function callJson(result: Pick<RunResult<unknown>, "ms" | "trace">, includeTrace: boolean): Record<string, unknown> {
  return { ms: result.ms, ...(includeTrace ? { trace: result.trace } : {}) };
}

export function queryJson(name: string, result: RunResult<Record<string, unknown>>, includeTrace = false): Record<string, unknown> {
  return {
    query: name,
    scope: result.scope,
    me: result.me,
    params: result.params,
    ...callJson(result, includeTrace),
    row_count: result.rows.length,
    rows: result.rows,
    providers: result.providers,
  };
}

export function reportJson(name: string, result: ReportResult, includeTrace = false): Record<string, unknown> {
  return {
    report: name,
    root: result.params["root"],
    scope: result.scope,
    me: result.me,
    params: result.params,
    ...callJson(result, includeTrace),
    sections: result.sections,
    section_status: result.sectionStatus,
    providers: result.providers,
  };
}

export type ExitFlags = { expectEmpty: boolean; strict: boolean };

// A failed provider makes every negative gate result unknown, so it wins.
export function exitCodeFor(result: Pick<RunResult<unknown>, "rows" | "providers">, flags: ExitFlags): 0 | 3 | 4 {
  if (flags.strict && result.providers.some((provider) => provider.ok === 0)) return 4;
  if (flags.expectEmpty && result.rows.length > 0) return 3;
  return 0;
}

// Timeout stays 5 so a caller can tell it from a gate. `--strict` uses the
// incomplete outcome before the deadline, which is exit 4.
export function watchExitCode(outcome: WatchStop, result: Pick<RunResult<unknown>, "rows" | "providers">, flags: ExitFlags): 0 | 3 | 4 | 5 | 130 {
  if (outcome === "aborted") return 130;
  if (outcome === "incomplete") return 4;
  if (outcome === "timeout") return 5;
  return exitCodeFor(result, flags);
}

async function main(argv: string[]): Promise<number> {
  if (argv[0] === "ui") {
    const { startUi } = await import("./ui/main.ts");
    await startUi(argv.slice(1));
    return 0;
  }
  const userQueries = loadUserQueries(process.env);
  const userProviders = loadUserProviders(process.env, loaders);
  const { values, positionals } = parseArgs({
    args: argv,
    options: optionsFor(userQueries),
    allowPositionals: true,
  });
  const sql = textOption(values, "sql");
  const root = textOption(values, "root");
  const scope = textOption(values, "scope");
  const me = textOption(values, "me");
  const help = values["help"] === true;
  const includeTrace = values["trace"] === true;
  const watching = positionals[0] === "watch";
  const requestedName = watching ? positionals[1] : positionals[0];
  const report = sql === undefined && requestedName !== undefined && Object.hasOwn(reports, requestedName)
    ? reports[requestedName as keyof typeof reports]
    : undefined;
  const named = report === undefined && sql === undefined && requestedName !== undefined && Object.hasOwn(catalog, requestedName)
    ? catalog[requestedName]
    : undefined;
  const userQuery = report === undefined && sql === undefined && requestedName !== undefined
    ? userQueries.find((query) => query.name === requestedName)
    : undefined;
  validateQueryOptions(values, userQueries, report === undefined ? named?.params ?? userQuery?.params ?? [] : reportParams(report), requestedName ?? "sql");
  if (help || (!watching && positionals.length === 0 && sql === undefined)) {
    if (help && values["json"] === true) console.log(JSON.stringify([...queriesForHelp(userQueries, process.env), ...reportsForHelp()]));
    else console.log(usage(userQueries, userProviders, process.env));
    return help ? 0 : 2;
  }
  if (watching && positionals.length > 2) {
    console.error(`spacequery: watch takes one query\n\n${usage(userQueries, userProviders, process.env)}`);
    return 2;
  }
  if (!isScope(scope)) {
    console.error(`spacequery: --scope is root, agents, or all, not ${scope}`);
    return 2;
  }
  const rootOnlyRepositoryQueries = new Set([catalog["repository-versions"], catalog["repository-config-files"]]);
  if (named !== undefined && rootOnlyRepositoryQueries.has(named) && scope !== undefined && scope !== "root") {
    console.error(`spacequery: ${requestedName} only supports --scope root`);
    return 2;
  }
  const wideRepositoryQueries = new Set([
    catalog["repository-version-sources"], catalog["shared-dependencies"],
    catalog["shared-dependency-details"], catalog["dependency-coverage"],
    catalog["repository-config-files-in-scope"],
  ]);
  if (scope === "root" && (report === reports["dependency-report"] || (named !== undefined && wideRepositoryQueries.has(named)))) {
    console.error(`spacequery: ${requestedName} supports --scope agents or all`);
    return 2;
  }
  // Keep the same parameter names intact when the CLI passes them to SQLite.
  const params: Record<string, unknown> = Object.create(null);
  if (me !== undefined) params["me"] = me === "" ? null : me;
  const flags: ExitFlags = { expectEmpty: values["expect-empty"] === true, strict: values["strict"] === true };
  const parameters = report !== undefined ? reportParams(report) : named?.params ?? userQuery?.params ?? [];

  let name: string;
  let runOnce: () => Promise<RunResult<Record<string, unknown>>>;
  if (sql !== undefined) {
    if (watching && requestedName !== undefined) {
      console.error("spacequery: watch takes a query or --sql, not both");
      return 2;
    }
    name = "sql";
    // The two flags are the two parameters a statement can name. Any other
    // `:name` is an error from the core.
    if (/:root\b/.test(sql)) params["root"] = toplevel(root ?? process.cwd());
    runOnce = () => runSql(sql, { loaders, userProviders, scope, params });
  } else if (requestedName === undefined) {
    console.error(`spacequery: watch needs a query and --until\n\n${usage(userQueries, userProviders, process.env)}`);
    return 2;
  } else if (!report && !named && !userQuery) {
    console.error(`spacequery: no query named ${requestedName}\n\n${usage(userQueries, userProviders, process.env)}`);
    return 2;
  } else if (report) {
    name = requestedName;
    if (parameters.includes("root")) params["root"] = toplevel(root ?? process.cwd());
    bindQueryParams(parameters, values, params, watching);
    runOnce = () => Promise.reject(new Error("a report is not watched"));
  } else if (userQuery) {
    name = requestedName;
    if (userQuery.params.includes("root")) params["root"] = toplevel(root ?? process.cwd());
    bindQueryParams(parameters, values, params, watching);
    const userSql = userQuery.sql;
    runOnce = () => runSql(userSql, { loaders, userProviders, scope, params });
  } else if (named) {
    name = requestedName;
    if (named.params.includes("root")) params["root"] = rootOnlyRepositoryQueries.has(named)
      ? await staticToplevel(root ?? process.cwd())
      : toplevel(root ?? process.cwd());
    bindQueryParams(parameters, values, params, watching);
    const query = named.query;
    runOnce = () => runQuery(query, { loaders, userProviders, scope, params });
  } else {
    throw new Error(`no query named ${requestedName}`);
  }

  const watchFlag = watchFlagMisuse(watching, sql !== undefined ? ["root", "me"] : parameters, values);
  if (watchFlag !== undefined) {
    console.error(`spacequery: ${watchFlag}`);
    return 2;
  }
  if (!watching) {
    if (report) {
      const reportResult = await runReport(report.sections.map(([section, query]) => [section, catalog[query]!.query] as const), { loaders, userProviders, scope, params });
      recordCall(process.env, name);
      if (values["tsv"] === true) {
        process.stdout.write(reportTsv(reportResult.sections));
        if (includeTrace) process.stderr.write(traceTsv(reportResult.trace));
      } else console.log(JSON.stringify(reportJson(name, reportResult, includeTrace), null, 2));
      warn(reportResult.providers);
      return exitCodeFor({ rows: reportResult.sections[report.gateSection] ?? [], providers: reportResult.providers }, flags);
    }
    const result = await runOnce();
    recordCall(process.env, name);
    printQuery(name, result, values["tsv"] === true, includeTrace, false);
    return exitCodeFor(result, flags);
  }
  if (report) {
    console.error(`spacequery: watch runs a query, not the report ${requestedName}`);
    return 2;
  }
  const untilText = textOption(values, "until");
  if (untilText === undefined) {
    console.error("spacequery: watch requires --until");
    return 2;
  }
  let until: ReturnType<typeof parseUntil>;
  try {
    until = parseUntil(untilText);
  } catch (e) {
    console.error(`spacequery: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
  const timing = parseWatchTiming(textOption(values, "interval"), textOption(values, "timeout"));
  if ("error" in timing) {
    console.error(`spacequery: ${timing.error}`);
    return 2;
  }
  return watchQuery(name, runOnce, until, timing.intervalMs, timing.timeoutMs, values["tsv"] === true, includeTrace, flags);
}

// A watch flag on a one-shot call is a usage error unless that name is a
// parameter of the query. Ad hoc SQL only binds root and me.
function watchFlagMisuse(watching: boolean, parameters: readonly string[], values: Record<string, unknown>): string | undefined {
  if (watching) return undefined;
  const accepted = new Set(parameters);
  for (const flag of watchOnlyOptions) {
    if (values[flag] !== undefined && !accepted.has(flag)) return `--${flag} is a watch flag; use spacequery watch <query> --until <predicate>`;
  }
  return undefined;
}

function bindQueryParams(parameters: readonly string[], values: Record<string, unknown>, params: Record<string, unknown>, watching: boolean): void {
  for (const parameter of parameters) {
    if (parameter === "root" || parameter === "me") continue;
    // While watching, these names are the loop controls, not statement bindings.
    if (watching && watchOnlyOptions.has(parameter)) continue;
    const value = textOption(values, parameter);
    if (value !== undefined) params[parameter] = value;
  }
}

function printQuery(name: string, result: RunResult<Record<string, unknown>>, asTsv: boolean, includeTrace: boolean, ndjson: boolean): void {
  if (asTsv) {
    process.stdout.write(tsv(result.rows));
    if (includeTrace) process.stderr.write(traceTsv(result.trace));
  } else if (ndjson) {
    process.stdout.write(`${JSON.stringify(queryJson(name, result, includeTrace))}\n`);
  } else {
    console.log(JSON.stringify(queryJson(name, result, includeTrace), null, 2));
  }
  warn(result.providers);
}

// One call-log line per watch. A line per tick would crowd --help with the
// query someone left running (ADR 0023).
async function watchQuery(
  name: string,
  runOnce: () => Promise<RunResult<Record<string, unknown>>>,
  until: ReturnType<typeof parseUntil>,
  intervalMs: number,
  timeoutMs: number | null,
  asTsv: boolean,
  includeTrace: boolean,
  flags: ExitFlags,
): Promise<number> {
  const signals = abortOnSignal();
  let recorded = false;
  let printed = false;
  let last: RunResult<Record<string, unknown>> | undefined;
  try {
    const outcome = await watchUntil({
      until,
      intervalMs,
      timeoutMs,
      stopWhenIncomplete: flags.strict,
      signal: signals.signal,
      observe: async () => {
        last = await runOnce();
        if (!recorded) {
          recordCall(process.env, name);
          recorded = true;
        }
        return { rows: last.rows, providers: last.providers };
      },
      onSnapshot: () => {
        if (last === undefined) return;
        if (asTsv && printed) process.stdout.write("\n");
        printQuery(name, last, asTsv, includeTrace, true);
        printed = true;
      },
    });
    if (outcome === "timeout") process.stderr.write("spacequery: timed out before --until matched\n");
    if (last === undefined) return outcome === "aborted" ? 130 : 1;
    return watchExitCode(outcome, last, flags);
  } finally {
    signals.stop();
  }
}

function abortOnSignal(): { signal: AbortSignal; stop: () => void } {
  const controller = new AbortController();
  const onSignal = () => controller.abort();
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  return {
    signal: controller.signal,
    stop: () => {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
    },
  };
}

// A reader that stops early (`spacequery agents | head`) closes the pipe; that
// is the reader's choice, not a failure of spacequery.
process.stdout.on("error", (e: NodeJS.ErrnoException) => {
  if (e.code === "EPIPE") process.exit(0);
  throw e;
});

// npm installs the bin as a symlink (npm link, npm install -g), so argv[1]
// is the link path while import.meta.url is the real file. Resolve argv[1]
// to its real path before the comparison. A missing path fails the guard.
function isMainModule(argv1: string | undefined): boolean {
  if (argv1 === undefined) return false;
  try {
    return realpathSync(resolve(argv1)) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMainModule(process.argv[1])) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (e) {
    // A statement that does not prepare, or a parameter with no flag. The
    // message is the whole story; a stack would point into the core.
    process.stderr.write(`spacequery: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  }
}
