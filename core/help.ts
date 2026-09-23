// The short help list and the provider filter for text help, JSON help, and
// the terminal browser. Curated entries come from the catalog. The call log
// only ranks, and only fills seats the curated set left open.
// Boundary: choosing and describing entries. cli.ts prints; run.ts executes.
import type { Loader } from "./loader.ts";
import { callCounts } from "./calls.ts";
import { disabledProviderNames, isProviderEnabled, type LoadedConfig } from "./config.ts";
import { catalog, reportParams, reports, type Report } from "../catalog.ts";
import type { UserQuery } from "./user-queries.ts";

// Enough to show the curated set on a fresh machine and a handful of queries
// this machine actually calls. Curated entries stay when they exceed it.
export const shortHelpLimit = 25;

export type HelpSource = "built-in" | "user" | "report";

export type HelpEntry = {
  name: string;
  description: string;
  purpose: string;
  group: string;
  default: boolean;
  enabled: boolean;
  requires: readonly string[];
  params: readonly string[];
  source: HelpSource;
  sections?: readonly (readonly [string, string])[];
  // Set when the report declares a scope for an omitted --scope.
  default_scope?: "root" | "agents" | "all";
  // Set when the report is a dashboard an agent can extend.
  refresh?: string;
};

export type HelpDocument = {
  mode: "short" | "all";
  config: string;
  disabled_providers: string[];
  queries: HelpEntry[];
  reports: HelpEntry[];
};

type Ranked = { name: string; default: boolean };

// `entries` are already the ones a list may show. Short mode keeps every
// curated entry, then the most-called remainder up to the limit. A query
// nobody has called does not fill a spare seat: the fresh list is the curated set.
export function selectHelpEntries<T extends Ranked>(
  entries: readonly T[],
  counts: ReadonlyMap<string, number>,
  mode: "short" | "all",
  limit = shortHelpLimit,
): T[] {
  const ranked = (rows: readonly T[]): T[] => rows
    .map((entry, index) => ({ entry, index, count: counts.get(entry.name) ?? 0 }))
    .sort((a, b) => b.count - a.count || a.index - b.index)
    .map(({ entry }) => entry);
  if (mode === "all") return ranked(entries);
  const curated = entries.filter((entry) => entry.default);
  const room = Math.max(0, limit - curated.length);
  const extra = ranked(entries.filter((entry) => !entry.default && (counts.get(entry.name) ?? 0) > 0)).slice(0, room);
  const chosen = new Set([...curated, ...extra].map((entry) => entry.name));
  return ranked(entries.filter((entry) => chosen.has(entry.name)));
}

export function providersForReads(tables: readonly string[], loaders: readonly Pick<Loader, "name" | "tables">[]): string[] {
  const owner = new Map<string, string>();
  for (const loader of loaders) for (const table of loader.tables) owner.set(table, loader.name);
  return [...new Set(tables.flatMap((table) => {
    const name = owner.get(table);
    return name === undefined ? [] : [name];
  }))].sort();
}

export function helpDocument(options: {
  userQueries: readonly UserQuery[];
  env: Readonly<Record<string, string | undefined>>;
  mode: "short" | "all";
  loaders: readonly Pick<Loader, "name" | "tables">[];
  config: LoadedConfig;
}): HelpDocument {
  const counts = callCounts(options.env);
  const enabled = (requires: readonly string[]) => requires.every((name) => isProviderEnabled(name, options.config));
  const builtIn = Object.entries(catalog).map(([name, query]): HelpEntry => {
    const requires = providersForReads(query.query.meta.reads, options.loaders);
    return {
      name,
      description: query.description,
      purpose: query.purpose,
      group: query.group,
      default: query.default,
      enabled: enabled(requires),
      requires,
      params: query.params,
      source: "built-in",
    };
  }).filter((query) => query.enabled);
  const user = options.userQueries.map((query): HelpEntry => ({
    name: query.name,
    description: query.description,
    purpose: query.description || "A SQL file in the user query directory.",
    group: "User",
    default: true,
    enabled: true,
    requires: [],
    params: query.params,
    source: "user",
  }));
  const reportEntries = Object.entries(reports).map(([name, report]): HelpEntry => {
    const entry: Report = report;
    const requires = providersForReads(entry.sections.flatMap(([, query]) => catalog[query]!.query.meta.reads), options.loaders);
    const gate = entry.sections.find(([section]) => section === entry.gateSection);
    const gateRequires = gate === undefined ? [] : providersForReads(catalog[gate[1]]!.query.meta.reads, options.loaders);
    return {
      name,
      description: entry.description,
      purpose: entry.purpose,
      group: entry.group,
      default: entry.default,
      enabled: enabled(gateRequires),
      requires,
      params: reportParams(entry),
      sections: entry.sections,
      ...(entry.defaultScope === undefined ? {} : { default_scope: entry.defaultScope }),
      ...(entry.refresh === undefined ? {} : { refresh: entry.refresh }),
      source: "report",
    };
  }).filter((report) => report.enabled);
  return {
    mode: options.mode,
    config: options.config.path,
    disabled_providers: disabledProviderNames(options.loaders.map((loader) => loader.name), options.config),
    queries: [...selectHelpEntries(builtIn, counts, options.mode), ...selectHelpEntries(user, counts, "all")],
    reports: selectHelpEntries(reportEntries, counts, options.mode),
  };
}

export function helpLines(entries: readonly HelpEntry[]): string[] {
  if (entries.length === 0) return [];
  const nameWidth = Math.max(...entries.map((entry) => entry.name.length));
  const groupWidth = Math.max(...entries.map((entry) => entry.group.length));
  return entries.map((entry) => {
    const params = entry.params.length ? `  (--${entry.params.join(", --")})` : "";
    return `  ${entry.name.padEnd(nameWidth)}  ${entry.group.padEnd(groupWidth)}  ${entry.purpose}${params}`;
  });
}

export function helpFooter(document: HelpDocument, callsFile: string): string[] {
  const listed = document.queries.filter((query) => query.source === "built-in").length;
  const lines = [
    document.mode === "short"
      ? `${listed} queries, most used first. spacequery --help --all lists every enabled query.`
      : "Every enabled query, most used first. spacequery --help shows the short list.",
    `The order comes from ${callsFile}.`,
  ];
  if (document.disabled_providers.length > 0) {
    lines.push(`Off in lists until enabled in ${document.config}: ${document.disabled_providers.join(", ")}.`);
    lines.push("A named query still runs when its provider is off in this list. --sql does too.");
  }
  return lines;
}
