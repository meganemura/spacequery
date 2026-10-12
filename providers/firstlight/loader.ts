// Fills firstlight runs and checks from firstlight's state directory.
// It reads run.json, events.jsonl, and the `current` file of every
// repository firstlight has recorded, folds the events through firstlight's
// own transition table, and asks whether a recorded supervisor pid is alive.
// Boundary: this provider's tables only. It starts no process, does not
// write, rename, or prune a state file, and never signals a check.
import { readdir, readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Loader } from "../../core/loader.ts";
import { firstlightCommands } from "./module.ts";
import type { FirstlightRunsId } from "./solarsql.generated.ts";

// The state format is firstlight's. These copies of its run id shape, its
// transition table, and its log naming keep this reader byte-compatible
// without importing firstlight, which spacequery does not depend on.
const RUN_ID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const REPO_KEY_RE = /^[0-9a-f]{16}$/;

export type CheckStatus = "pending" | "running" | "passed" | "failed" | "timed_out" | "cancelled" | "skipped";
export type ReportedStatus = CheckStatus | "unknown";
export type RunOutcome = "done" | "cancelled";

const TRANSITIONS: Record<CheckStatus, readonly CheckStatus[]> = {
  pending: ["running", "skipped", "cancelled"],
  running: ["passed", "failed", "timed_out", "cancelled"],
  passed: [],
  failed: [],
  timed_out: [],
  cancelled: [],
  skipped: [],
};
const CHECK_STATUSES = Object.keys(TRANSITIONS) as CheckStatus[];

export function isTerminal(status: CheckStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

export type CheckSpec = { name: string; run: string };
export type RunRecord = { id: string; root: string; supervisor_pid: number | null; started_at: string; checks: CheckSpec[] };

export type CheckEvent = {
  type: "check";
  check: string;
  status: CheckStatus;
  pid?: number;
  exit_code?: number | null;
  at: string;
  elapsed_ms?: number;
  cached_from?: string;
};
export type RunEvent = { type: "run"; status: RunOutcome; at: string };
export type RunEventLine = CheckEvent | RunEvent;

export type CheckState = {
  name: string;
  status: CheckStatus;
  pid: number | null;
  exit_code: number | null;
  started_at: string | null;
  elapsed_ms: number | null;
  cached_from: string | null;
};
export type FoldedRun = { checks: CheckState[]; outcome: RunOutcome | null };

export type FirstlightRun = {
  id: FirstlightRunsId;
  repo_key: string;
  root: string;
  started_at: string;
  supervisor_pid: number | null;
  outcome: RunOutcome | null;
  current: 0 | 1;
  supervisor_alive: 0 | 1;
};

export type FirstlightCheck = {
  run_id: FirstlightRunsId;
  position: number;
  name: string;
  run: string;
  status: ReportedStatus;
  orphan: 0 | 1;
  exit_code: number | null;
  started_at: string | null;
  elapsed_ms: number | null;
  pid: number | null;
  cached_from: string | null;
  log: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

// firstlight resolves XDG_STATE_HOME against its own working directory.
// spacequery runs from a different one, so a relative value cannot name the
// same directory; it fails the provider instead of reading the wrong place.
export function stateDirectory(env: Readonly<Record<string, string | undefined>>): string {
  const configured = env["XDG_STATE_HOME"]?.trim();
  if (configured !== undefined && configured !== "") {
    if (!configured.startsWith("/")) throw new Error("firstlight: XDG_STATE_HOME must be an absolute path");
    return join(configured, "firstlight");
  }
  const home = env["HOME"];
  if (!home) throw new Error("firstlight: HOME is not set");
  return join(home, ".local", "state", "firstlight");
}

// The same acceptance as firstlight's run reader: a record it would refuse
// is refused here too, so the two never disagree about which runs exist.
export function parseRunRecord(value: unknown): RunRecord {
  const run = record(value);
  if (run === null || typeof run.id !== "string" || typeof run.root !== "string" || typeof run.started_at !== "string") throw new Error("run.json is invalid");
  if (!(run.supervisor_pid === null || Number.isInteger(run.supervisor_pid))) throw new Error("run.json is invalid");
  if (!Array.isArray(run.checks)) throw new Error("run.json is invalid");
  const checks: CheckSpec[] = [];
  for (const entry of run.checks) {
    const check = record(entry);
    if (check === null || typeof check.name !== "string" || typeof check.run !== "string" || !Array.isArray(check.after) || typeof check.timeoutSec !== "number") {
      throw new Error("run.json is invalid");
    }
    checks.push({ name: check.name, run: check.run });
  }
  // firstlight keys its fold by name, so a repeated name would be one check
  // reported twice. A run with that shape is not one firstlight writes.
  if (new Set(checks.map((check) => check.name)).size !== checks.length) throw new Error("run.json repeats a check name");
  return { id: run.id, root: run.root, supervisor_pid: run.supervisor_pid as number | null, started_at: run.started_at, checks };
}

function isEvent(value: unknown): value is RunEventLine {
  const event = record(value);
  if (event === null || typeof event.at !== "string") return false;
  if (event.type === "run") return event.status === "done" || event.status === "cancelled";
  return (
    event.type === "check" &&
    typeof event.check === "string" &&
    CHECK_STATUSES.includes(event.status as CheckStatus) &&
    (event.cached_from === undefined || typeof event.cached_from === "string")
  );
}

// The supervisor appends one line per write. A last line without its
// newline may still be in the middle of that write, so it is not read yet.
export function parseEvents(text: string): RunEventLine[] {
  const lines = text.split("\n");
  lines.pop();
  const events: RunEventLine[] = [];
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      throw new Error("events.jsonl has an unreadable line");
    }
    if (!isEvent(raw)) throw new Error("events.jsonl has an unexpected event");
    events.push(raw);
  }
  return events;
}

// A reused pass is the one step outside the table: `passed` straight from
// `pending`, and only on an event that names the run it came from.
function canApply(from: CheckStatus, event: CheckEvent): boolean {
  if (event.cached_from !== undefined) return from === "pending" && event.status === "passed";
  return TRANSITIONS[from].includes(event.status);
}

function initialState(name: string): CheckState {
  return { name, status: "pending", pid: null, exit_code: null, started_at: null, elapsed_ms: null, cached_from: null };
}

// firstlight's fold, step for step. A transition the table does not allow
// means the file is not one firstlight's supervisor wrote, so it throws.
export function foldEvents(names: readonly string[], events: readonly RunEventLine[]): FoldedRun {
  const states = new Map(names.map((name) => [name, initialState(name)]));
  let outcome: RunOutcome | null = null;
  for (const event of events) {
    if (event.type === "run") {
      outcome = event.status;
      continue;
    }
    const current = states.get(event.check);
    if (current === undefined || !canApply(current.status, event)) {
      throw new Error(`events.jsonl moves check ${event.check} from ${current?.status ?? "pending"} to ${event.status}`);
    }
    states.set(event.check, {
      name: current.name,
      status: event.status,
      pid: event.pid ?? current.pid,
      exit_code: event.exit_code !== undefined ? event.exit_code : current.exit_code,
      started_at: event.status === "running" ? event.at : current.started_at,
      elapsed_ms: event.elapsed_ms ?? current.elapsed_ms,
      cached_from: event.cached_from ?? current.cached_from,
    });
  }
  return { checks: names.map((name) => states.get(name)!), outcome };
}

// firstlight's presentation rule: a check that never reached a terminal
// status, in a run with no outcome whose supervisor is gone, is `unknown`.
export function presentChecks(run: FoldedRun, supervisorAlive: boolean): { state: CheckState; status: ReportedStatus; orphan: 0 | 1 }[] {
  const orphaned = run.outcome === null && !supervisorAlive;
  return run.checks.map((state) => {
    const orphan = orphaned && !isTerminal(state.status);
    return { state, status: orphan ? "unknown" : state.status, orphan: orphan ? 1 : 0 };
  });
}

// The supervisor writes its own stderr to supervisor.log beside the check logs.
const RESERVED_LOG_BASES = ["supervisor"];
const MAX_LOG_BASE = 100;

export function logBase(name: string): string {
  const base = name.replace(/[^A-Za-z0-9._-]/gu, "_").slice(0, MAX_LOG_BASE);
  return base.length === 0 ? "_" : base;
}

// firstlight derives each log file name from the run's check list instead
// of storing it, so this reader derives it the same way: a name that is
// already a safe base claims first, and a later collision gets `-2`, `-3`,
// compared without case because some file systems ignore it.
export function logFileNames(names: readonly string[]): Map<string, string> {
  const files = new Map<string, string>();
  const taken = new Set(RESERVED_LOG_BASES);
  const claim = (name: string): void => {
    if (files.has(name)) return;
    const base = logBase(name);
    let file = base;
    for (let n = 2; taken.has(file.toLowerCase()); n += 1) file = `${base}-${n}`;
    taken.add(file.toLowerCase());
    files.set(name, `${file}.log`);
  };
  for (const name of names) if (logBase(name) === name) claim(name);
  for (const name of names) claim(name);
  return new Map(names.map((name) => [name, files.get(name)!]));
}

// Signal 0 asks whether the pid exists and delivers nothing. EPERM means it
// exists under another user. A zombie answers signal 0 but is not running;
// Linux shows that in /proc, and elsewhere signal 0 alone decides, as it
// does in firstlight.
export function supervisorIsAlive(pid: number | null): boolean {
  if (pid === null || !Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EPERM") return false;
  }
  let stat: string;
  try {
    stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch {
    return true;
  }
  const state = stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3);
  return state !== "Z" && state !== "X";
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function listOptional(path: string): Promise<string[]> {
  try {
    return (await readdir(path)).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export type ObservedRun = { run: FirstlightRun; checks: FirstlightCheck[] };

// One run directory. Null means the run is not there to read: run.json is
// written after the directory exists, and a prune can remove it mid-read.
export async function observeRun(
  repoDir: string,
  repoKey: string,
  id: string,
  currentId: string | null,
  alive: (pid: number | null) => boolean = supervisorIsAlive,
): Promise<ObservedRun | null> {
  const runDir = join(repoDir, "runs", id);
  const text = await readOptional(join(runDir, "run.json"));
  if (text === null) return null;
  const spec = parseRunRecord(JSON.parse(text));
  if (spec.id !== id) throw new Error("run.json id does not match its directory");
  const names = spec.checks.map((check) => check.name);
  const fold = async () => foldEvents(names, parseEvents((await readOptional(join(runDir, "events.jsonl"))) ?? ""));
  let folded = await fold();
  let supervisorAlive = false;
  if (folded.outcome === null) {
    supervisorAlive = alive(spec.supervisor_pid);
    // The supervisor writes its final event and then exits. Reading again
    // keeps that order from looking like an orphan, as firstlight does.
    if (!supervisorAlive) folded = await fold();
  }
  const logs = logFileNames(names);
  const runId = id as FirstlightRunsId;
  const checks = presentChecks(folded, supervisorAlive).map(({ state, status, orphan }, position): FirstlightCheck => ({
    run_id: runId,
    position,
    name: state.name,
    run: spec.checks[position]!.run,
    status,
    orphan,
    exit_code: state.exit_code,
    started_at: state.started_at,
    elapsed_ms: state.elapsed_ms,
    pid: state.pid,
    cached_from: state.cached_from,
    log: join(runDir, logs.get(state.name)!),
  }));
  return {
    run: {
      id: runId,
      repo_key: repoKey,
      root: spec.root,
      started_at: spec.started_at,
      supervisor_pid: spec.supervisor_pid,
      outcome: folded.outcome,
      current: id === currentId ? 1 : 0,
      supervisor_alive: folded.outcome === null && supervisorAlive ? 1 : 0,
    },
    checks,
  };
}

function reason(error: unknown): string {
  return (error as NodeJS.ErrnoException).code ?? (error instanceof Error ? error.message : String(error));
}

export const firstlightLoader: Loader = {
  name: "firstlight",
  tables: ["firstlight_runs", "firstlight_checks"],
  after: [],
  async load(ctx) {
    const base = stateDirectory(ctx.env);
    let keys: string[];
    try {
      const entries = await readdir(base, { withFileTypes: true });
      keys = entries.filter((entry) => entry.isDirectory() && REPO_KEY_RE.test(entry.name)).map((entry) => entry.name).sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw new Error(`firstlight: cannot read ${base}: ${reason(error)}`);
    }
    const invalid: string[] = [];
    const runs: FirstlightRun[] = [];
    const checks: FirstlightCheck[] = [];
    for (const key of keys) {
      const repoDir = join(base, key);
      let currentId: string | null = null;
      let ids: string[];
      try {
        const current = (await readOptional(join(repoDir, "current")))?.trim() ?? null;
        currentId = current !== null && RUN_ID_RE.test(current) ? current : null;
        ids = (await listOptional(join(repoDir, "runs"))).filter((name) => RUN_ID_RE.test(name));
      } catch (error) {
        invalid.push(`${key}: ${reason(error)}`);
        continue;
      }
      for (const id of ids) {
        try {
          const observed = await observeRun(repoDir, key, id, currentId);
          if (observed === null) continue;
          runs.push(observed.run);
          checks.push(...observed.checks);
        } catch (error) {
          invalid.push(`${key}/runs/${id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    const loaded = await ctx.db.run(firstlightCommands.loadRuns, { runs, checks });
    if (!loaded.ok) throw new Error(`firstlight: ${loaded.kind}`);
    if (invalid.length > 0) throw new Error(`firstlight: a run did not read: ${invalid.join("; ")}`);
  },
};
