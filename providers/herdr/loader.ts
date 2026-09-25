// Fills `agents` from `herdr api snapshot`. One filesystem root lookup per
// distinct cwd gives `root`; a cwd outside a
// repository gets null and stays in the table, because "agents outside any
// repository" is a question too.
// Boundary: this provider's tables only.
import type { Loader, LoadContext } from "../../core/loader.ts";
import { herdrCommands, herdrQueries } from "./module.ts";
import type { AgentsId, PanesId } from "./solarsql.generated.ts";

type SnapshotAgent = {
  pane_id: string;
  agent: string;
  agent_status: string;
  agent_session?: { value?: string } | null;
  name?: string | null;
  focused?: boolean;
  cwd: string;
  foreground_cwd?: string | null;
  workspace_id?: string | null;
  tab_id?: string | null;
  terminal_title_stripped?: string | null;
};

export const herdrLoader: Loader = {
  name: "herdr",
  tables: ["agents"],
  after: [],
  async load(ctx) {
    const out = await ctx.exec("herdr", ["api", "snapshot"]);
    const agents = JSON.parse(out).result.snapshot.agents as SnapshotAgent[];
    const cwds = [...new Set(agents.map((a) => a.cwd))];
    const roots = new Map(await Promise.all(cwds.map(async (cwd) => [cwd, await ctx.repo.rootOf(cwd)] as const)));
    const rows = agents.map((a) => ({
      pane_id: a.pane_id as AgentsId,
      session_id: a.agent_session?.value ?? null,
      name: a.name ?? null,
      agent: a.agent,
      agent_status: a.agent_status,
      focused: a.focused ? 1 : 0,
      cwd: a.cwd,
      foreground_cwd: a.foreground_cwd ?? null,
      root: roots.get(a.cwd) ?? null,
      workspace_id: a.workspace_id ?? null,
      tab_id: a.tab_id ?? null,
      title: a.terminal_title_stripped ?? null,
    }));
    const r = await ctx.db.run(herdrCommands.load, { rows });
    if (!r.ok) throw new Error(`agents: ${r.kind}`);
  },
  // The pane herdr gave this process, then the session id Claude Code gave
  // it, then whatever herdr has in focus. A plain shell matches none and
  // gets null.
  async self(ctx) {
    const pane = ctx.env["HERDR_PANE_ID"];
    if (pane) return pane;
    const session = ctx.env["CLAUDE_CODE_SESSION_ID"];
    if (session) {
      const row = await ctx.db.first(herdrQueries.bySession, { session_id: session });
      if (row) return row.pane_id;
    }
    return (await ctx.db.first(herdrQueries.focused))?.pane_id ?? null;
  },
};

type SnapshotPane = {
  pane_id: string;
  workspace_id?: string | null;
  tab_id?: string | null;
  cwd: string;
  agent?: string | null;
  terminal_title_stripped?: string | null;
};

type SnapshotWorkspace = {
  workspace_id: string;
  label?: string | null;
};

function processInfoShellPid(value: string): number | null {
  const shellPid = JSON.parse(value)?.result?.process_info?.shell_pid;
  return typeof shellPid === "number" ? shellPid : null;
}

// A second loader, separate from `herdrLoader`.
// `tables` decides which loader a query starts, so a query that reads only
// `agents` skips these per-pane `process-info` calls.
// A failing `process-info` call throws. The whole load fails: an empty
// table, and a provider row that names the error (rule 7,
// docs/adding-a-provider.md).
// A per-pane failure that the loader instead swallowed would leave that
// pane with a null `shell_pid`. `pane-load` would then show it with zero
// processes and the provider `ok: 1`, the same shape as a pane that really
// has no processes. The caller could not tell the two apart.
export const herdrPanesLoader: Loader = {
  name: "herdr_panes",
  tables: ["panes"],
  after: [],
  async load(ctx) {
    const out = await ctx.exec("herdr", ["api", "snapshot"]);
    const snapshot = JSON.parse(out).result.snapshot;
    const panes = snapshot.panes as SnapshotPane[];
    const workspaces = (snapshot.workspaces ?? []) as SnapshotWorkspace[];
    const labelByWorkspace = new Map(workspaces.map((w) => [w.workspace_id, w.label ?? null]));
    const shellPidByPane = new Map(await Promise.all(panes.map(async (pane) =>
      [pane.pane_id, processInfoShellPid(await ctx.exec("herdr", ["pane", "process-info", "--pane", pane.pane_id]))] as const)));
    const rows = panes.map((pane) => ({
      pane_id: pane.pane_id as PanesId,
      workspace_id: pane.workspace_id ?? null,
      workspace_label: pane.workspace_id ? labelByWorkspace.get(pane.workspace_id) ?? null : null,
      tab_id: pane.tab_id ?? null,
      cwd: pane.cwd,
      agent: pane.agent ?? null,
      title: pane.terminal_title_stripped ?? null,
      shell_pid: shellPidByPane.get(pane.pane_id) ?? null,
    }));
    const r = await ctx.db.run(herdrCommands.loadPanes, { rows });
    if (!r.ok) throw new Error(`panes: ${r.kind}`);
  },
};
