// Runs spacequery from source, the way this repository runs itself, with
// configuration and state directories of its own so the developer's
// providers config and call log never take part.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../../cli.ts", import.meta.url));

export interface Homes {
  configHome: string;
  stateHome: string;
}

export interface SpacequeryResult {
  exitCode: number;
  stdout: string;
}

export function runSpacequery(args: string[], homes: Homes): SpacequeryResult {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, XDG_CONFIG_HOME: homes.configHome, XDG_STATE_HOME: homes.stateHome },
  });
  if (result.error) throw result.error;
  return { exitCode: result.status ?? 1, stdout: result.stdout };
}
