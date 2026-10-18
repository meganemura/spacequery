// Runs spacequery from source, the way this repository runs itself, with
// configuration and state directories of its own so the developer's
// providers config and call log never take part.
import { runCommand } from "nukadoko";
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

export async function runSpacequery(args: string[], homes: Homes): Promise<SpacequeryResult> {
  const result = await runCommand(process.execPath, [CLI, ...args], {
    env: { ...process.env, XDG_CONFIG_HOME: homes.configHome, XDG_STATE_HOME: homes.stateHome },
  });
  return { exitCode: result.exitCode ?? 1, stdout: result.stdout };
}
