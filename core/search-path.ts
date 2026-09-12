// Parse the process search path, identify executable files, and resolve commands.
// Boundary: this module reads file metadata but starts no process and owns no table.
import { accessSync, constants, readdirSync, statSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";

type SearchPathEntry = { position: number; dir: string; exists: 0 | 1; duplicate_of: number | null };
type SearchPathCommand = { name: string; dir: string; position: number; effective: 0 | 1 };
export type ScannedSearchPath = { entries: SearchPathEntry[]; commands: SearchPathCommand[] };

export function parseSearchPath(value: string | undefined): string[] {
  if (value === undefined) return [];
  return value.split(delimiter).map((directory) => directory || ".");
}

export function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function isDirectory(path: string): boolean {
  try { return statSync(path).isDirectory(); } catch { return false; }
}

export function scanSearchPath(value: string | undefined, baseDirectory: string = "."): ScannedSearchPath {
  const firstPositions = new Map<string, number>();
  const entries = parseSearchPath(value).map((dir, position) => {
    const first = firstPositions.get(dir);
    if (first === undefined) firstPositions.set(dir, position);
    return { position, dir, exists: isDirectory(resolve(baseDirectory, dir)) ? 1 as const : 0 as const, duplicate_of: first ?? null };
  });
  const effective = new Set<string>();
  const commands = entries.flatMap((entry) => {
    if (entry.exists === 0) return [];
    const directory = resolve(baseDirectory, entry.dir);
    return readdirSync(directory).sort().flatMap((name) => {
      if (!isExecutableFile(join(directory, name))) return [];
      const row = { name, dir: entry.dir, position: entry.position, effective: effective.has(name) ? 0 as const : 1 as const };
      effective.add(name);
      return [row];
    });
  });
  return { entries, commands };
}

export function resolveCommandName(command: string, pathValue: string | undefined): string | null {
  for (const directory of parseSearchPath(pathValue)) {
    const candidate = resolve(directory, command);
    if (isExecutableFile(candidate)) return candidate;
  }
  return null;
}

export function givenCommandPath(command: string, cwd: string | undefined): string | null {
  const candidate = resolve(cwd ?? process.cwd(), command);
  return isExecutableFile(candidate) ? candidate : null;
}
