// Re-runs one query until the current rows match a predicate.
// Each tick is a separate observation: the caller opens a fresh database and
// this module keeps none. The fingerprint is how a repeated snapshot stays
// off the output; it is not a cache of provider state.
// Boundary: the predicate, the fingerprint, and the poll loop. Running a
// query and printing a snapshot stay with the caller.
import type { ProviderRow } from "./run.ts";

export const defaultWatchIntervalMs = 2000;
export const defaultWatchTimeoutSec = 300;

export type Until =
  | { kind: "empty" }
  | { kind: "nonempty" }
  | { kind: "column"; column: string; values: readonly string[] };

export type WatchSnapshot = {
  rows: readonly Record<string, unknown>[];
  providers: readonly Pick<ProviderRow, "name" | "ok" | "error">[];
  // A report watch fingerprints every section, not only the rows `--until` reads.
  sections?: Readonly<Record<string, readonly Record<string, unknown>[]>>;
};

export type WatchStop = "matched" | "timeout" | "aborted" | "incomplete";

// `empty` and `nonempty` look at the row count. A column predicate lists
// values separated by `|`. The column name is an identifier, so a value
// cannot contain `=` or `|`.
export function parseUntil(text: string): Until {
  const predicate = text.trim();
  if (predicate === "empty") return { kind: "empty" };
  if (predicate === "nonempty") return { kind: "nonempty" };
  const match = /^([A-Za-z_][A-Za-z0-9_]*)=([^|=]+(?:\|[^|=]+)*)$/.exec(predicate);
  if (!match) throw new Error(`--until is empty, nonempty, or <column>=<value>[|<value>...], not ${text}`);
  return { kind: "column", column: match[1]!, values: match[2]!.split("|") };
}

// A column predicate matches when every current row carries one of the
// values. Zero rows do not match: that observation is `empty`. Null does
// not equal a listed value.
export function untilMatches(rows: readonly Record<string, unknown>[], until: Until): boolean {
  if (until.kind === "empty") return rows.length === 0;
  if (until.kind === "nonempty") return rows.length > 0;
  if (rows.length === 0) return false;
  return rows.every((row) => {
    if (!Object.hasOwn(row, until.column)) return false;
    const value = row[until.column];
    if (value === null || value === undefined) return false;
    return until.values.includes(String(value));
  });
}

// Key order is not part of the observation. Sequence columns such as
// `state_change_seq` or `revision` count when they appear on the row; they
// are not stored anywhere else.
export function rowFingerprint(rows: readonly Record<string, unknown>[]): string {
  return JSON.stringify(stable(rows));
}

// Provider duration and observed_at change on every tick, so they are not
// part of the fingerprint. ok and error are: an incomplete observation is
// a different observation from the same rows with every provider answered.
export function observationFingerprint(snapshot: WatchSnapshot): string {
  const providers = snapshot.providers.map((provider) => ({ name: provider.name, ok: provider.ok, error: provider.error }));
  providers.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return JSON.stringify(stable({
    rows: snapshot.rows,
    providers,
    ...(snapshot.sections === undefined ? {} : { sections: snapshot.sections }),
  }));
}

export function observationIncomplete(snapshot: WatchSnapshot): boolean {
  return snapshot.providers.some((provider) => provider.ok === 0);
}

export function parseWatchTiming(intervalText: string | undefined, timeoutText: string | undefined): { intervalMs: number; timeoutMs: number | null } | { error: string } {
  const intervalMs = intervalText === undefined ? defaultWatchIntervalMs : wholeNumber(intervalText);
  if (intervalMs === undefined || intervalMs < 1) return { error: "--interval needs a positive integer number of milliseconds" };
  if (timeoutText === undefined) return { intervalMs, timeoutMs: defaultWatchTimeoutSec * 1000 };
  const timeoutSec = wholeNumber(timeoutText);
  if (timeoutSec === undefined) return { error: "--timeout needs a non-negative integer number of seconds" };
  return { intervalMs, timeoutMs: timeoutSec === 0 ? null : timeoutSec * 1000 };
}

export type WatchControl = {
  // Omitted for a refresh loop that stops on the deadline or a signal.
  until?: Until;
  intervalMs: number;
  timeoutMs: number | null;
  // `--strict`: stop on the first incomplete observation instead of waiting.
  stopWhenIncomplete: boolean;
  signal?: AbortSignal;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  observe: () => Promise<WatchSnapshot>;
  // Called for the first snapshot and whenever the fingerprint changes.
  // A later match whose rows match the previous complete snapshot still
  // fires, so the satisfying observation is printed once.
  onSnapshot: (snapshot: WatchSnapshot) => void;
};

export async function watchUntil(control: WatchControl): Promise<WatchStop> {
  if (control.intervalMs < 1) throw new Error("--interval needs a positive integer number of milliseconds");
  const now = control.now ?? (() => performance.now());
  const signal = control.signal ?? new AbortController().signal;
  const sleep = control.sleep ?? delay;
  const started = now();
  let previous: string | undefined;
  while (!signal.aborted) {
    const snapshot = await control.observe();
    const fingerprint = observationFingerprint(snapshot);
    const changed = fingerprint !== previous;
    previous = fingerprint;
    const incomplete = observationIncomplete(snapshot);
    // Incomplete rows are not "none" and not a status match. The predicate
    // runs only on a complete observation.
    const matched = control.until !== undefined && !incomplete && untilMatches(snapshot.rows, control.until);
    const incompleteStop = incomplete && control.stopWhenIncomplete;
    if (changed || matched || incompleteStop) control.onSnapshot(snapshot);
    if (incompleteStop) return "incomplete";
    if (matched) return "matched";
    if (signal.aborted) return "aborted";
    const elapsed = now() - started;
    if (control.timeoutMs !== null && elapsed >= control.timeoutMs) return "timeout";
    const remaining = control.timeoutMs === null ? control.intervalMs : Math.min(control.intervalMs, control.timeoutMs - elapsed);
    if (remaining <= 0) return "timeout";
    await sleep(remaining, signal);
  }
  return "aborted";
}

function wholeNumber(text: string): number | undefined {
  if (!/^[0-9]+$/.test(text)) return undefined;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : undefined;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => stable(entry));
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const sorted: Record<string, unknown> = {};
    for (const [key, entry] of entries) sorted[key] = stable(entry);
    return sorted;
  }
  return value;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(finish, ms);
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }
    signal.addEventListener("abort", finish, { once: true });
  });
}
