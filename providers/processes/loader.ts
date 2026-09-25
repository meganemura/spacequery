// Fills every process ps lists, for every user, and the caller's own
// listening sockets, from ps and lsof.
// `root` comes from one `ctx.repo.rootOf` call per distinct cwd (ADR 0003).
// Every process gets that same lookup, so a process outside any previously
// discovered root still resolves to its own.
// A process without an observable cwd still gets a row: the lsof cwd call
// can miss a pid, or the process can belong to another user. Its `cwd` and
// `root` stay null there; the rest of the row still loads.
// Boundary: this provider's tables only.
import { basename } from "node:path";
import type { LoadContext, Loader } from "../../core/loader.ts";
import { processCommands } from "./module.ts";
import type { ListenersId } from "./solarsql.generated.ts";

type Ps = { pid: number; ppid: number; pgid: number; uid: number; elapsed_s: number; rss_kb: number; cpu_pct: number; cpu_time_s: number; command: string; executable: string };
type Process = Ps & { cwd: string | null; root: string | null };
type Listener = { id: ListenersId; pid: number; address: string; port: number; cwd: string | null; root: string | null; command: string | null };

export function parseElapsed(value: string): number | null {
  const groups = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(value);
  if (!groups) return null;
  const [, days, hours, minutes, seconds] = groups;
  const parts = [days, hours, minutes, seconds].map((part) => part === undefined ? 0 : Number(part));
  return parts.every(Number.isSafeInteger) && parts[2]! < 60 && parts[3]! < 60 ? parts[0]! * 86400 + parts[1]! * 3600 + parts[2]! * 60 + parts[3]! : null;
}

// macOS ps prints cumulative CPU time as minutes:seconds.hundredths at every
// size; `1320:09.19` is 22 hours of accumulated CPU time, not a clock time.
// The optional day and hour groups in this pattern serve other ps
// implementations that do use them; `parseElapsed` reads etime the same way.
export function parseCpuTime(value: string): number | null {
  const groups = /^(?:(?:(\d+)-)?(\d+):)?(\d+):(\d+)(\.\d+)?$/.exec(value);
  if (!groups) return null;
  const [, days, hours, minutes, seconds, frac] = groups;
  const hasHours = hours !== undefined;
  const parts = [days, hours, minutes, seconds].map((part) => part === undefined ? 0 : Number(part));
  if (!parts.every(Number.isSafeInteger) || parts[3]! >= 60 || (hasHours && parts[2]! >= 60)) return null;
  const whole = parts[0]! * 86400 + parts[1]! * 3600 + parts[2]! * 60 + parts[3]!;
  return frac === undefined ? whole : Number(`${whole}${frac}`);
}

export function parsePs(output: string): Ps[] {
  return output.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\S+)\s+(.+)$/.exec(line);
    if (!match) return [];
    const [, pid, ppid, pgid, uid, etime, ctime, rss, pcpu, command] = match;
    const elapsed_s = parseElapsed(etime!);
    const cpu_time_s = parseCpuTime(ctime!);
    const numbers = [Number(pid), Number(ppid), Number(pgid), Number(uid), Number(rss), Number(pcpu)];
    if (elapsed_s === null || cpu_time_s === null || !numbers.every(Number.isFinite) || !command) return [];
    const executable = basename(command.trim().split(/\s+/, 1)[0]!);
    return [{ pid: numbers[0]!, ppid: numbers[1]!, pgid: numbers[2]!, uid: numbers[3]!, elapsed_s, rss_kb: numbers[4]!, cpu_pct: numbers[5]!, cpu_time_s, command, executable }];
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

function parseListeners(output: string, cwdByPid: ReadonlyMap<number, string[]>, processesByPid: ReadonlyMap<number, Ps>, roots: ReadonlyMap<string, string | null>): Listener[] {
  const result: Listener[] = [];
  for (const [pid, names] of parseLsof(output)) for (const name of names) {
    const match = /^(.*):(\d+)$/.exec(name);
    if (!match) continue;
    const [, address, port] = match;
    const cwd = cwdByPid.get(pid)?.[0] ?? null;
    const root = cwd === null ? null : roots.get(cwd) ?? null;
    result.push({ id: `${pid}:${address}:${port}` as ListenersId, pid, address: address!, port: Number(port), cwd, root, command: processesByPid.get(pid)?.command ?? null });
  }
  return result;
}

export const processesLoader: Loader = {
  name: "processes", tables: ["processes", "listeners"], after: [],
  async load(ctx) {
    const uid = process.getuid?.();
    if (uid === undefined) throw new Error("processes: uid is unavailable");
    const [psOutput, cwdOutput, listeningOutput] = await Promise.all([
      ctx.exec("ps", ["-axo", "pid,ppid,pgid,uid,etime,time,rss,pcpu,command"]),
      ctx.exec("lsof", ["-a", "-d", "cwd", "-u", String(uid), "-Fpn"], undefined, { exitCodes: [1] }),
      // `-a` ands the selectors; without it lsof lists every file of the user
      // next to the listeners, and the parser would take connections for ports.
      ctx.exec("lsof", ["-a", "-nP", "-iTCP", "-sTCP:LISTEN", "-u", String(uid), "-Fpn"], undefined, { exitCodes: [1] }),
    ]);
    const cwdByPid = parseLsof(cwdOutput);
    const ps = parsePs(psOutput).filter((row) => row.pid !== process.pid && row.ppid !== process.pid);
    const byPid = new Map(ps.map((row) => [row.pid, row]));
    // One root lookup per distinct cwd lsof reported, the same pattern the
    // herdr loader uses; a pid outside the user's own lsof call keeps null.
    const cwds = [...new Set([...cwdByPid.values()].flatMap((names) => names[0] !== undefined ? [names[0]] : []))];
    const roots = new Map(await Promise.all(cwds.map(async (cwd) => [cwd, await ctx.repo.rootOf(cwd)] as const)));
    const processes: Process[] = ps.map((row) => {
      const cwd = cwdByPid.get(row.pid)?.[0] ?? null;
      const root = cwd === null ? null : roots.get(cwd) ?? null;
      return { ...row, cwd, root };
    });
    const loadedProcesses = await ctx.db.run(processCommands.loadProcesses, { rows: processes });
    if (!loadedProcesses.ok) throw new Error(`processes: ${loadedProcesses.kind}`);
    const loadedListeners = await ctx.db.run(processCommands.loadListeners, { rows: parseListeners(listeningOutput, cwdByPid, byPid, roots) });
    if (!loadedListeners.ok) throw new Error(`listeners: ${loadedListeners.kind}`);
  },
};
