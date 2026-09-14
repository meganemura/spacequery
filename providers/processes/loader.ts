// Fills repository processes and listening sockets from ps and lsof.
// A process without an observable cwd cannot safely join a repository.
// Boundary: this provider's tables only.
import { basename } from "node:path";
import type { LoadContext, Loader } from "../../core/loader.ts";
import { rootsInScope } from "../../core/scope.ts";
import { processCommands } from "./module.ts";
import type { ListenersId } from "./solarsql.generated.ts";

type Ps = { pid: number; ppid: number; pgid: number; elapsed_s: number; rss_kb: number; cpu: number; command: string; executable: string };
type Process = Ps & { cwd: string; root: string };
type Listener = { id: ListenersId; pid: number; address: string; port: number; cwd: string | null; root: string | null; command: string | null };

export function parseElapsed(value: string): number | null {
  const groups = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(value);
  if (!groups) return null;
  const [, days, hours, minutes, seconds] = groups;
  const parts = [days, hours, minutes, seconds].map((part) => part === undefined ? 0 : Number(part));
  return parts.every(Number.isSafeInteger) && parts[2]! < 60 && parts[3]! < 60 ? parts[0]! * 86400 + parts[1]! * 3600 + parts[2]! * 60 + parts[3]! : null;
}

export function parsePs(output: string): Ps[] {
  return output.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(\S+)\s+(.+)$/.exec(line);
    if (!match) return [];
    const [, pid, ppid, pgid, elapsed, rss, cpu, command] = match;
    const elapsed_s = parseElapsed(elapsed!);
    const numbers = [Number(pid), Number(ppid), Number(pgid), Number(rss), Number(cpu)];
    if (elapsed_s === null || !numbers.every(Number.isFinite) || !command) return [];
    const executable = basename(command.trim().split(/\s+/, 1)[0]!);
    return [{ pid: numbers[0]!, ppid: numbers[1]!, pgid: numbers[2]!, elapsed_s, rss_kb: numbers[3]!, cpu: numbers[4]!, command, executable }];
  });
}

export function parseLsof(output: string): Map<number, string[]> {
  const values = new Map<number, string[]>();
  let pid: number | null = null;
  for (const line of output.split("\n")) {
    if (line.startsWith("p")) { const value = Number(line.slice(1)); pid = Number.isSafeInteger(value) ? value : null; }
    if (line.startsWith("n") && pid !== null) values.set(pid, [...(values.get(pid) ?? []), line.slice(1)]);
  }
  return values;
}

function rootFor(cwd: string, roots: readonly string[]): string | null {
  return roots.find((root) => cwd === root || cwd.startsWith(`${root}/`)) ?? null;
}

function parseListeners(output: string, cwdByPid: ReadonlyMap<number, string[]>, processesByPid: ReadonlyMap<number, Ps>, roots: readonly string[]): Listener[] {
  const result: Listener[] = [];
  for (const [pid, names] of parseLsof(output)) for (const name of names) {
    const match = /^(.*):(\d+)$/.exec(name);
    if (!match) continue;
    const [, address, port] = match;
    const cwd = cwdByPid.get(pid)?.[0] ?? null;
    const root = cwd === null ? null : rootFor(cwd, roots);
    result.push({ id: `${pid}:${address}:${port}` as ListenersId, pid, address: address!, port: Number(port), cwd, root, command: processesByPid.get(pid)?.command ?? null });
  }
  return result;
}

export const processesLoader: Loader = {
  name: "processes", tables: ["processes", "listeners"], after: ["herdr", "repos"],
  async load(ctx) {
    const uid = process.getuid?.();
    if (uid === undefined) throw new Error("processes: uid is unavailable");
    const [psOutput, cwdOutput, listeningOutput, roots] = await Promise.all([
      ctx.exec("ps", ["-axo", "pid,ppid,pgid,etime,rss,pcpu,command"]),
      ctx.exec("lsof", ["-a", "-d", "cwd", "-u", String(uid), "-Fpn"], undefined, { exitCodes: [1] }),
      // `-a` ands the selectors; without it lsof lists every file of the user
      // next to the listeners, and the parser would take connections for ports.
      ctx.exec("lsof", ["-a", "-nP", "-iTCP", "-sTCP:LISTEN", "-u", String(uid), "-Fpn"], undefined, { exitCodes: [1] }),
      rootsInScope(ctx).then((roots) => roots.sort((left, right) => right.length - left.length)),
    ]);
    const cwdByPid = parseLsof(cwdOutput);
    const ps = parsePs(psOutput).filter((row) => row.pid !== process.pid && row.ppid !== process.pid);
    const byPid = new Map(ps.map((row) => [row.pid, row]));
    const processes: Process[] = ps.flatMap((row) => {
      const cwd = cwdByPid.get(row.pid)?.[0];
      const root = cwd === undefined ? null : rootFor(cwd, roots);
      return cwd === undefined || root === null ? [] : [{ ...row, cwd, root }];
    });
    const loadedProcesses = await ctx.db.run(processCommands.loadProcesses, { rows: processes });
    if (!loadedProcesses.ok) throw new Error(`processes: ${loadedProcesses.kind}`);
    const loadedListeners = await ctx.db.run(processCommands.loadListeners, { rows: parseListeners(listeningOutput, cwdByPid, byPid, roots) });
    if (!loadedListeners.ok) throw new Error(`listeners: ${loadedListeners.kind}`);
  },
};
