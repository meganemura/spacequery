// The ad hoc SQL path needs a table list. A named query carries its list in
// generated metadata. The engine authorizer reports every table ad hoc SQL
// reads while it prepares on the empty database, before any loader runs.
// solarsql uses the same probe for its boundary check, and it costs microseconds.
// Boundary: reading the statement only. run.ts orders and runs the loaders.
import { constants, type DatabaseSync } from "node:sqlite";
import { diagnosePrepareError } from "./diagnose.ts";
import type { Loader, Scope } from "./loader.ts";

// A prepare failure carries the fix as `hint`, kept apart from `message` so
// a caller that prints its own message (doctor's `user_queries` rows) does
// not have to split the two back out of a merged string. diagnose.ts always
// has something to say, even for an error it has no rule for.
export class PrepareError extends Error {
  readonly hint: string;
  constructor(message: string, hint: string) {
    super(message);
    this.name = "PrepareError";
    this.hint = hint;
  }
}

// The tables a statement reads, by name, as the engine sees them. On a
// prepare failure, `raw` already has the schema this call's statement was
// checked against (migrations, plus any user-provider tables), so the
// diagnosis is run there rather than on a second, unrelated database.
export function tablesRead(raw: DatabaseSync, sql: string): string[] {
  const out = new Set<string>();
  raw.setAuthorizer((code: number, table: string | null) => {
    if (code === constants.SQLITE_READ && table !== null) out.add(table);
    return constants.SQLITE_OK;
  });
  try {
    raw.prepare(sql);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PrepareError(message, diagnosePrepareError(raw, sql, message));
  } finally {
    raw.setAuthorizer(null);
  }
  return [...out];
}

// A report section names only the providers that own tables it reads.
// Loader dependencies stay out because their status does not describe that
// section's direct observation.
export function directLoadersFor(loaders: readonly Loader[], tables: readonly string[]): Loader[] {
  const read = new Set(tables);
  return loaders.filter((loader) => loader.tables.some((table) => read.has(table)));
}

// The loaders whose tables the statement reads, plus the loaders those run
// after, in an order every `after` is satisfied by. Independent loaders
// keep the order of the configuration. run.ts starts that order concurrently
// once each loader's dependencies have finished (ADR 0044). A table no
// loader declares (the core's own, or sqlite's) needs no loader.
export function loadersFor(loaders: readonly Loader[], tables: readonly string[], scope: Scope = "agents"): Loader[] {
  const byName = new Map(loaders.map((l) => [l.name, l]));
  const owner = new Map<string, Loader>();
  for (const l of loaders) for (const t of l.tables) owner.set(t, l);
  const wanted = new Set<string>();
  const want = (l: Loader, trail: readonly string[]) => {
    if (trail.includes(l.name)) throw new Error(`loader cycle: ${[...trail, l.name].join(" -> ")}`);
    if (wanted.has(l.name)) return;
    wanted.add(l.name);
    for (const dep of [...l.after, ...(l.afterForScope?.(scope) ?? [])]) {
      const d = byName.get(dep);
      if (!d) throw new Error(`loader ${l.name} runs after ${dep}, which is not configured`);
      want(d, [...trail, l.name]);
    }
  };
  for (const t of tables) {
    const l = owner.get(t);
    if (l) want(l, []);
  }
  // A depth-first walk in configuration order: a loader is placed after
  // the loaders it runs after, and otherwise where the configuration put it.
  const placed = new Map<string, Loader>();
  const place = (l: Loader) => {
    if (placed.has(l.name)) return;
    for (const dep of [...l.after, ...(l.afterForScope?.(scope) ?? [])]) place(byName.get(dep)!);
    placed.set(l.name, l);
  };
  for (const l of loaders) if (wanted.has(l.name)) place(l);
  return [...placed.values()];
}
