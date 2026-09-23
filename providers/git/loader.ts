// Fills `worktrees` and `git_status` for the roots in scope. Agent roots,
// ghq roots under `all`, and an explicit root share the core scope helper,
// so this loader waits only for the discovery providers that scope reads.
// The per-root calls run concurrently: the child processes are the whole
// cost of a run, and git handles the parallelism.
// Boundary: this provider's tables only.
import type { Loader, LoadContext } from "../../core/loader.ts";
import { discoveryLoaders, rootsInScope } from "../../core/scope.ts";
import { gitCommands } from "./module.ts";
import type { GitStatusId, WorktreesId } from "./solarsql.generated.ts";

type Worktree = { path: WorktreesId; repo_root: string; branch: string | null; head: string | null };
type Status = { root: GitStatusId; branch: string | null; upstream: string | null; ahead: number; behind: number; dirty_count: number; untracked_count: number; observed_at: number };

// The first entry of the porcelain list is the main worktree; every entry
// gets it as repo_root so a linked worktree joins back to its repository.
async function worktreesOf(ctx: LoadContext, root: string): Promise<Worktree[]> {
  const out: Worktree[] = [];
  let cur: Worktree | null = null;
  for (const line of (await ctx.exec("git", ["worktree", "list", "--porcelain"], root)).split("\n")) {
    if (line.startsWith("worktree ")) {
      cur = { path: line.slice(9) as WorktreesId, repo_root: root, branch: null, head: null };
      out.push(cur);
    } else if (line.startsWith("HEAD ") && cur) cur.head = line.slice(5);
    else if (line.startsWith("branch ") && cur) cur.branch = line.slice(7).replace("refs/heads/", "");
  }
  const main = out[0]?.path ?? root;
  for (const w of out) w.repo_root = main;
  return out;
}

async function statusOf(ctx: LoadContext, root: string): Promise<Status> {
  const s: Status = { root: root as GitStatusId, branch: null, upstream: null, ahead: 0, behind: 0, dirty_count: 0, untracked_count: 0, observed_at: Date.now() };
  // This flag prevents an index refresh write. The answer is unchanged, and
  // that write belongs to Git rather than spacequery (ADR 0005).
  for (const line of (await ctx.exec("git", ["--no-optional-locks", "status", "--porcelain=2", "--branch"], root)).split("\n")) {
    if (line.startsWith("# branch.head ")) s.branch = line.slice(14);
    else if (line.startsWith("# branch.upstream ")) s.upstream = line.slice(18);
    else if (line.startsWith("# branch.ab ")) {
      const m = /\+(\d+) -(\d+)/.exec(line);
      if (m) {
        s.ahead = Number(m[1]);
        s.behind = Number(m[2]);
      }
    } else if (line.startsWith("? ")) s.untracked_count++;
    else if (/^[12u] /.test(line)) s.dirty_count++;
  }
  return s;
}

export const gitLoader: Loader = {
  name: "git",
  tables: ["worktrees", "git_status"],
  after: [], afterForScope: discoveryLoaders,
  async load(ctx) {
    const list = await rootsInScope(ctx);
    const [worktrees, statuses] = await Promise.all([
      Promise.all(list.map((root) => worktreesOf(ctx, root))),
      Promise.all(list.map((root) => statusOf(ctx, root))),
    ]);
    const w = await ctx.db.run(gitCommands.loadWorktrees, { rows: worktrees.flat() });
    if (!w.ok) throw new Error(`worktrees: ${w.kind}`);
    const s = await ctx.db.run(gitCommands.loadStatus, { rows: statuses });
    if (!s.ok) throw new Error(`git_status: ${s.kind}`);
  },
};
