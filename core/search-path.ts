// Parse the process search path, identify executable files, and resolve commands.
// Boundary: this module reads file metadata but starts no process and owns no table.
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, resolve } from "node:path";

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
