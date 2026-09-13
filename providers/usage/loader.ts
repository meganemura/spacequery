// Read quota snapshots through a fixed Claude command and local Codex logs.
// These independent sources never perform inference, reset limits, or store a cache.
import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { Loader } from "../../core/loader.ts";
import type { ClaudeUsageId, CodexUsageId } from "./solarsql.generated.ts";
import { usageCommands } from "./module.ts";

type Usage = { id: string; limit_id: string; window_minutes: number | null; used_percent: number; resets_at: number | null; resets_text: string | null; recorded_at: number; source: string };
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const numeric = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;

export function parseClaudeUsage(text: string, recordedAt: number): Usage[] {
  const envelope = object(JSON.parse(text));
  if (envelope?.is_error !== false || envelope.local_command !== "usage" || envelope.num_turns !== 0 || typeof envelope.result !== "string") {
    throw new Error("Claude did not return a successful local usage command");
  }
  const rows: Usage[] = [];
  for (const line of envelope.result.split("\n")) {
    const match = /^([^:\n]+):\s*(\d+(?:\.\d+)?)% used\s*[·•]\s*resets\s+(.+)$/.exec(line.trim());
    if (!match) continue;
    const label = match[1]!;
    const used = Number(match[2]);
    if (used < 0 || used > 100) throw new Error("Claude usage percentage is invalid");
    rows.push({ id: label, limit_id: label, window_minutes: label === "Current session" ? 300 : label.startsWith("Current week") ? 10080 : null,
      used_percent: used, resets_at: null, resets_text: match[3]!, recorded_at: recordedAt, source: "claude /usage" });
  }
  if (!rows.length || new Set(rows.map((row) => row.id)).size !== rows.length) throw new Error("Claude usage output has no unique quota windows");
  return rows;
}

export function parseCodexUsage(line: string, source: string): Usage[] {
  // Most records contain conversation text; only token_count carries this snapshot.
  if (!line.includes('"token_count"')) return [];
  let entry: Record<string, unknown> | null;
  try { entry = object(JSON.parse(line)); } catch { return []; }
  const payload = object(entry?.payload);
  if (entry?.type !== "event_msg" || payload?.type !== "token_count" || typeof entry.timestamp !== "string") return [];
  const recordedAt = Date.parse(entry.timestamp);
  const limits = object(payload.rate_limits);
  if (!Number.isFinite(recordedAt) || !limits) return [];
  const limitId = typeof limits.limit_id === "string" ? limits.limit_id : "codex";
  const rows: Usage[] = [];
  for (const name of ["primary", "secondary"]) {
    const window = object(limits[name]);
    const minutes = numeric(window?.window_minutes);
    const used = numeric(window?.used_percent);
    const resets = numeric(window?.resets_at);
    if (minutes === null || minutes <= 0 || !Number.isInteger(minutes) || used === null || used < 0 || used > 100) continue;
    rows.push({ id: JSON.stringify([limitId, minutes]), limit_id: limitId, window_minutes: minutes, used_percent: used,
      resets_at: resets === null ? null : resets * 1000, resets_text: null, recorded_at: recordedAt, source });
  }
  return rows;
}

async function* logFiles(directory: string): AsyncGenerator<string> {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* logFiles(path);
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) yield path;
  }
}

export const claudeUsageLoader: Loader = {
  name: "claude_usage", tables: ["claude_usage"], after: [],
  async load(ctx) {
    const output = await ctx.exec("claude", ["-p", "/usage", "--output-format", "json", "--no-session-persistence"]);
    const rows = parseClaudeUsage(output, Date.now());
    const result = await ctx.db.run(usageCommands.claude, { rows: rows.map((row) => ({ ...row, id: row.id as ClaudeUsageId })) });
    if (!result.ok) throw new Error(`claude_usage: ${result.kind}`);
  },
};

export const codexUsageLoader: Loader = {
  name: "codex_usage", tables: ["codex_usage"], after: [],
  async load(ctx) {
    const home = ctx.env["CODEX_HOME"] || (ctx.env["HOME"] ? join(ctx.env["HOME"], ".codex") : null);
    if (!home) throw new Error("codex_usage: HOME or CODEX_HOME is required");
    const latest = new Map<string, Usage>();
    for (const directory of ["sessions", "archived_sessions"]) {
      for await (const path of logFiles(join(home, directory))) {
        const input = createReadStream(path, { encoding: "utf8" });
        const lines = createInterface({ input, crlfDelay: Infinity });
        try {
          for await (const line of lines) for (const row of parseCodexUsage(line, path)) {
            const previous = latest.get(row.id);
            if (!previous || row.recorded_at >= previous.recorded_at) latest.set(row.id, row);
          }
        } finally { lines.close(); input.destroy(); }
      }
    }
    const result = await ctx.db.run(usageCommands.codex, { rows: [...latest.values()].map((row) => ({ ...row, id: row.id as CodexUsageId })) });
    if (!result.ok) throw new Error(`codex_usage: ${result.kind}`);
  },
};
