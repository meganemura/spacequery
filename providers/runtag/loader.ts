// Fills runtag jobs from the XDG jobs directory.
// It reads job files and checks whether a recorded supervisor pid is alive.
// Boundary: this provider's table only. It does not write a job file or start runtag.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Loader } from "../../core/loader.ts";
import { runtagCommands } from "./module.ts";
import type { RuntagJobsId } from "./solarsql.generated.ts";

export type RuntagJob = {
  id: RuntagJobsId;
  status: "running" | "exited";
  exit_code: number | null;
  orphan: 0 | 1;
  repo_root: string | null;
  cwd: string | null;
  supervisor_pid: number | null;
};

const statuses = new Set(["running", "exited"]);

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function optionalInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

// Trailing slashes are not a different directory. The root `/` stays `/`.
export function directoryKey(path: string): string {
  if (path === "/") return "/";
  let end = path.length;
  while (end > 1 && path[end - 1] === "/") end -= 1;
  return path.slice(0, end);
}

// `repo/pkg` matches `repo`. `repo-other` does not: the next character must be a separator.
export function pathMatchesDirectory(path: string | null, directory: string): boolean {
  if (path === null || path === "" || directory === "") return false;
  const base = directoryKey(directory);
  const target = directoryKey(path);
  if (base === "/") return target.startsWith("/");
  return target === base || target.startsWith(`${base}/`);
}

export function jobsDirectory(env: Readonly<Record<string, string | undefined>>): string {
  const configured = env["XDG_DATA_HOME"];
  if (configured !== undefined && configured !== "") {
    if (!configured.startsWith("/")) throw new Error("runtag: XDG_DATA_HOME must be an absolute path");
    return join(configured, "runtag", "jobs");
  }
  const home = env["HOME"];
  if (!home) throw new Error("runtag: HOME is not set");
  return join(home, ".local", "share", "runtag", "jobs");
}

// Signal 0 asks whether the pid exists and does not deliver a signal.
// A non-positive pid is not a process; kill would target a process group.
function supervisorIsAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

// The file's status is kept. A dead supervisor does not become an exit.
export function observeJob(value: unknown, supervisorAlive: (pid: number) => boolean = supervisorIsAlive): RuntagJob {
  const job = object(value);
  const id = job === null ? null : optionalString(job.id);
  const status = job === null ? null : optionalString(job.status);
  if (job === null || id === null || id === "" || status === null || !statuses.has(status)) throw new Error("runtag job is invalid");
  if (job.exit_code !== undefined && job.exit_code !== null && optionalInteger(job.exit_code) === null) throw new Error("runtag job is invalid");
  if (job.supervisor_pid !== undefined && job.supervisor_pid !== null && optionalInteger(job.supervisor_pid) === null) throw new Error("runtag job is invalid");
  if (job.repo_root !== undefined && job.repo_root !== null && optionalString(job.repo_root) === null) throw new Error("runtag job is invalid");
  if (job.cwd !== undefined && job.cwd !== null && optionalString(job.cwd) === null) throw new Error("runtag job is invalid");
  const supervisor_pid = job.supervisor_pid === undefined || job.supervisor_pid === null ? null : optionalInteger(job.supervisor_pid);
  let exit_code = job.exit_code === undefined || job.exit_code === null ? null : optionalInteger(job.exit_code);
  let orphan: 0 | 1 = 0;
  // A non-positive pid is not a live supervisor. Do not ask the checker:
  // a signal to pid 0 or a negative pid selects a process group.
  if (status === "running" && supervisor_pid !== null && (supervisor_pid <= 0 || !supervisorAlive(supervisor_pid))) {
    orphan = 1;
    exit_code = null;
  }
  return {
    id: id as RuntagJobsId,
    status: status as "running" | "exited",
    exit_code,
    orphan,
    repo_root: job.repo_root === undefined || job.repo_root === null ? null : optionalString(job.repo_root),
    cwd: job.cwd === undefined || job.cwd === null ? null : optionalString(job.cwd),
    supervisor_pid,
  };
}

export const runtagLoader: Loader = {
  name: "runtag",
  tables: ["runtag_jobs"],
  after: [],
  async load(ctx) {
    const directory = jobsDirectory(ctx.env);
    let names: string[];
    try {
      const entries = await readdir(directory, { withFileTypes: true });
      names = entries.filter((entry) => entry.name.endsWith(".json") && (entry.isFile() || entry.isSymbolicLink())).map((entry) => entry.name).sort();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return;
      throw new Error(`runtag: cannot read ${directory}: ${code ?? (error instanceof Error ? error.message : String(error))}`);
    }
    const invalid: string[] = [];
    const rows: RuntagJob[] = [];
    for (const name of names) {
      try {
        const text = await readFile(join(directory, name), "utf8");
        const row = observeJob(JSON.parse(text));
        if (`${row.id}.json` !== name) throw new Error("runtag job id does not match the file");
        rows.push(row);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        invalid.push(name);
      }
    }
    const loaded = await ctx.db.run(runtagCommands.loadJobs, { rows });
    if (!loaded.ok) throw new Error(`runtag_jobs: ${loaded.kind}`);
    if (invalid.length > 0) throw new Error(`runtag job did not parse: ${invalid.join(", ")}`);
  },
};
