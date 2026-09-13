// Fills sessions from live Claude Code processes and held Codex thread locks.
// Each source can fail independently because they are separate tools behind
// one provider; rows from a working source remain useful and the provider row
// reports the failed source.
// Boundary: this provider's tables only.
import { open, readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { LoadContext, Loader } from "../../core/loader.ts";
import { sessionCommands } from "./module.ts";
import type { ClaudeSessionsId, CodexSessionsId, SessionsId } from "./solarsql.generated.ts";

const tailBytes = 8 * 1024;

type SessionRow = {
  session_id: SessionsId;
  agent: "claude" | "codex";
  pid: number | null;
  cwd: string;
  root: string | null;
  name: string | null;
  started_at: number | null;
  updated_at: number | null;
  last_turn_at: number | null;
  last_branch: string | null;
};

type ClaudeSessionRow = {
  session_id: ClaudeSessionsId;
  model: string | null;
  effort: string | null;
  per_turn_effort: string | null;
  metadata_at: number | null;
  kind: string | null;
  entrypoint: string | null;
  status: string | null;
  status_updated_at: number | null;
  name_source: string | null;
  version: string | null;
  pid_domain: string | null;
  peer_protocol: number | null;
};

type CodexSessionRow = {
  session_id: CodexSessionsId;
  source: string | null;
  thread_source: string | null;
  model: string | null;
  model_provider: string | null;
  reasoning_effort: string | null;
  cli_version: string | null;
  sandbox_policy: string | null;
  approval_mode: string | null;
  git_branch: string | null;
  git_origin_url: string | null;
  title: string | null;
  tokens_used: number;
  archived: number;
};

type LoadedSource = { session: SessionRow; claude?: ClaudeSessionRow; codex?: CodexSessionRow };

type TranscriptTail = { timestamp: number | null; gitBranch: string | null };
type ClaudeMetadata = { model: string | null; effort: string | null; per_turn_effort: string | null; metadata_at: number | null };
const emptyMetadata: ClaudeMetadata = { model: null, effort: null, per_turn_effort: null, metadata_at: null };

// Keep one response's fields together: an older effort must not be assigned
// to a newer model. Synthetic responses do not describe an inference request.
export function parseClaudeMetadata(chunk: string, startsAtZero: boolean, sessionId: string): ClaudeMetadata {
  const lines = chunk.split("\n");
  const complete = startsAtZero ? lines : lines.slice(1);
  for (let index = complete.length - 1; index >= 0; index -= 1) {
    try {
      const entry = object(JSON.parse(complete[index]!));
      if (entry?.type !== "assistant" || entry.isSidechain === true || entry.sessionId !== sessionId) continue;
      const model = string(object(entry.message)?.model);
      if (model === null || model === "" || model === "<synthetic>") continue;
      return { model, effort: string(entry.effort), per_turn_effort: string(entry.perTurnEffort), metadata_at: milliseconds(entry.timestamp) };
    } catch {
      // Concurrent appends and truncated lines can leave incomplete JSON.
    }
  }
  return { ...emptyMetadata };
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function milliseconds(value: unknown): number | null {
  const date = string(value);
  if (date === null) return null;
  const result = Date.parse(date);
  return Number.isFinite(result) ? result : null;
}

// The first chunk can start in the middle of a JSON line. Skip that fragment,
// then read backward so a damaged final record cannot hide an earlier answer.
export function parseTranscriptTail(chunk: string, startsAtZero: boolean): TranscriptTail {
  const lines = chunk.split("\n");
  const complete = startsAtZero ? lines : lines.slice(1);
  for (let index = complete.length - 1; index >= 0; index -= 1) {
    try {
      const entry = object(JSON.parse(complete[index]!));
      if (entry === null) continue;
      const timestamp = milliseconds(entry.timestamp);
      if (timestamp !== null) return { timestamp, gitBranch: string(entry.gitBranch) };
    } catch {
      // A partial or non-JSON line cannot describe a completed turn.
    }
  }
  return { timestamp: null, gitBranch: null };
}

async function tailOf(path: string, sessionId?: string): Promise<TranscriptTail & ClaudeMetadata> {
  const handle = await open(path, "r");
  try {
    const size = (await handle.stat()).size;
    const length = Math.min(size, tailBytes);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, Math.max(0, size - length));
    const chunk = buffer.toString("utf8");
    return { ...parseTranscriptTail(chunk, size <= tailBytes), ...(sessionId === undefined ? emptyMetadata : parseClaudeMetadata(chunk, size <= tailBytes, sessionId)) };
  } finally {
    await handle.close();
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function claudeSlug(cwd: string): string {
  return cwd.replace(/[/.]/g, "-");
}

async function loadClaude(home: string): Promise<LoadedSource[]> {
  const directory = join(home, ".claude", "sessions");
  const names = (await readdir(directory)).filter((name) => name.endsWith(".json"));
  const projects = join(home, ".claude", "projects");
  let projectDirectories: Promise<string[]> | undefined;
  // A resumed session can change cwd while its transcript stays in the original
  // project. Probe only the live session's filename; never read historical logs.
  async function transcriptTail(cwd: string, sessionId: string): Promise<TranscriptTail & ClaudeMetadata> {
    const missing = { timestamp: null, gitBranch: null, ...emptyMetadata };
    if (basename(sessionId) !== sessionId) return missing;
    const expected = join(projects, claudeSlug(cwd), `${sessionId}.jsonl`);
    try {
      return await tailOf(expected, sessionId);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    projectDirectories ??= readdir(projects, { withFileTypes: true }).then((entries) => entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    const candidates = await Promise.all((await projectDirectories).map(async (directory) => {
      const path = join(projects, directory, `${sessionId}.jsonl`);
      try {
        return (await stat(path)).isFile() ? path : null;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    }));
    const found = candidates.filter((path) => path !== null);
    if (found.length !== 1) return missing;
    return tailOf(found[0]!, sessionId).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return missing;
      throw error;
    });
  }
  const rows = await Promise.all(names.map(async (name) => {
    const record = object(JSON.parse(await readFile(join(directory, name), "utf8")));
    if (record === null) throw new Error(`Claude registry ${name} is not an object`);
    const pid = number(record.pid);
    const sessionId = string(record.sessionId);
    const cwd = string(record.cwd);
    if (pid === null || sessionId === null || cwd === null) throw new Error(`Claude registry ${name} is invalid`);
    if (!isAlive(pid)) return null;
    const tail = await transcriptTail(cwd, sessionId);
    return {
      session: { session_id: sessionId as SessionsId, agent: "claude" as const, pid, cwd, root: null, name: string(record.name), started_at: number(record.startedAt), updated_at: number(record.updatedAt), last_turn_at: tail.timestamp, last_branch: tail.gitBranch },
      claude: {
        session_id: sessionId as ClaudeSessionsId,
        model: tail.model,
        effort: tail.effort,
        per_turn_effort: tail.per_turn_effort,
        metadata_at: tail.metadata_at,
        kind: string(record.kind),
        entrypoint: string(record.entrypoint),
        status: string(record.status),
        status_updated_at: number(record.statusUpdatedAt),
        name_source: string(record.nameSource),
        version: string(record.version),
        pid_domain: string(record.pidDomain),
        peer_protocol: number(record.peerProtocol),
      },
    };
  }));
  return rows.filter((row) => row !== null);
}

function lockedThreads(output: string, locks: string): Map<string, number> {
  const result = new Map<string, number>();
  let pid: number | null = null;
  for (const line of output.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    if (!line.startsWith("n") || pid === null || !Number.isSafeInteger(pid)) continue;
    const path = line.slice(1);
    if (!path.startsWith(`${locks}/`) || !path.endsWith(".lock")) continue;
    result.set(basename(path, ".lock"), pid);
  }
  return result;
}

// The threads table already names the rollout file, the cwd, the source, and
// the CLI version, so the rollout is read for its tail only. Its first line
// holds the base instructions and runs past any fixed head size.
async function loadCodex(ctx: LoadContext, home: string): Promise<LoadedSource[]> {
  const locks = join(home, ".codex", "thread-writer-locks");
  const held = lockedThreads(await ctx.exec("lsof", ["-F", "pn", "+D", locks], undefined, { exitCodes: [1] }), locks);
  if (held.size === 0) return [];
  const database = new DatabaseSync(join(home, ".codex", "state_5.sqlite"), { readOnly: true });
  type Thread = { id: string; cwd: string; rollout_path: string | null; source: string | null; thread_source: string | null; model: string | null; model_provider: string | null; reasoning_effort: string | null; cli_version: string | null; sandbox_policy: string | null; approval_mode: string | null; git_branch: string | null; git_origin_url: string | null; title: string | null; tokens_used: number; archived: number; name: string | null; created_at_ms: number; updated_at_ms: number };
  let threads: Thread[];
  try {
    const placeholders = [...held.keys()].map(() => "?").join(", ");
    threads = database.prepare(`select id, cwd, rollout_path, source, thread_source, model, model_provider, reasoning_effort, cli_version, sandbox_policy, approval_mode, git_branch, git_origin_url, title, tokens_used, archived, name, created_at_ms, updated_at_ms from threads where id in (${placeholders})`).all(...held.keys()) as Thread[];
  } finally {
    database.close();
  }
  return Promise.all(threads.map(async (thread) => {
    const tail = thread.rollout_path === null ? { timestamp: null, gitBranch: null } : await tailOf(thread.rollout_path).catch(() => ({ timestamp: null, gitBranch: null }));
    return {
      session: { session_id: thread.id as SessionsId, agent: "codex" as const, pid: held.get(thread.id) ?? null, cwd: thread.cwd, root: null, name: thread.name === "" ? null : thread.name, started_at: thread.created_at_ms, updated_at: thread.updated_at_ms, last_turn_at: tail.timestamp, last_branch: tail.gitBranch },
      codex: {
        session_id: thread.id as CodexSessionsId,
        source: thread.source,
        thread_source: thread.thread_source,
        model: thread.model,
        model_provider: thread.model_provider,
        reasoning_effort: thread.reasoning_effort,
        cli_version: thread.cli_version,
        sandbox_policy: thread.sandbox_policy,
        approval_mode: thread.approval_mode,
        git_branch: thread.git_branch,
        git_origin_url: thread.git_origin_url,
        title: thread.title,
        tokens_used: thread.tokens_used,
        archived: thread.archived,
      },
    };
  }));
}

export const sessionsLoader: Loader = {
  name: "sessions",
  tables: ["sessions", "claude_sessions", "codex_sessions"],
  after: [],
  async load(ctx) {
    const home = ctx.env["HOME"];
    if (!home) throw new Error("sessions: HOME is not set");
    const [claude, codex] = await Promise.allSettled([loadClaude(home), loadCodex(ctx, home)]);
    const loaded = [claude, codex].flatMap((result) => result.status === "fulfilled" ? result.value : []);
    const rows = loaded.map((row) => row.session);
    const roots = new Map(await Promise.all([...new Set(rows.map((row) => row.cwd))].map(async (cwd) => [cwd, await ctx.repo.rootOf(cwd)] as const)));
    for (const row of rows) row.root = roots.get(row.cwd) ?? null;
    const inserted = await ctx.db.run(sessionCommands.load, { rows });
    if (!inserted.ok) throw new Error(`sessions: ${inserted.kind}`);
    const insertedClaude = await ctx.db.run(sessionCommands.loadClaude, { rows: loaded.flatMap((row) => row.claude ?? []) });
    if (!insertedClaude.ok) throw new Error(`claude_sessions: ${insertedClaude.kind}`);
    const insertedCodex = await ctx.db.run(sessionCommands.loadCodex, { rows: loaded.flatMap((row) => row.codex ?? []) });
    if (!insertedCodex.ok) throw new Error(`codex_sessions: ${insertedCodex.kind}`);
    const failures = [["claude", claude], ["codex", codex]] as const;
    const messages = failures.flatMap(([name, result]) => result.status === "rejected"
      ? [`${name}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`]
      : []);
    if (messages.length > 0) throw new Error(messages.join("; "));
  },
};
