// Each browser execution uses the installed CLI entry point in a child process.
// This preserves CLI scope rules and bounds database lifetime to one execution.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Scope } from "../core/loader.ts";
import type { RunResult } from "../core/run.ts";
import type { Item } from "./catalog.ts";

export type Inputs = { root: string; scope: Scope | "auto"; me?: string; params: Record<string, string> };
export type Observation = RunResult<Record<string, unknown>> & { receivedAt: number };

export function executionArgs(item: Item, inputs: Inputs): string[] {
  // Binding root makes a table inspection local by default. The predicate
  // retains every row while giving the core the root needed by its loaders.
  const args = item.kind === "table"
    ? ["--sql", `${item.sql} where :root is not null`]
    : [item.name];
  args.push("--json", "--root", inputs.root);
  if (inputs.scope !== "auto") args.push("--scope", inputs.scope);
  if (inputs.me !== undefined) args.push("--me", inputs.me);
  for (const name of item.params) {
    if (name === "root" || name === "me") continue;
    if (name === "scope") {
      if (inputs.scope === "auto") throw new Error("Choose an explicit scope in Inputs.");
      continue;
    }
    const value = inputs.params[name];
    if (!Object.hasOwn(inputs.params, name) || value === undefined) throw new Error(`Enter a value for ${name} in Inputs.`);
    args.push(`--${name}`, value);
  }
  return args;
}

export function observe(item: Item, inputs: Inputs, signal?: AbortSignal): Promise<Observation> {
  if (signal?.aborted) return Promise.reject(new Error("Execution cancelled."));
  const args = [fileURLToPath(new URL("../cli.ts", import.meta.url)), ...executionArgs(item, inputs)];
  return new Promise((resolve, reject) => {
    // A separate process group lets cancellation stop this observation's
    // provider commands along with the CLI, without touching other calls.
    const child = spawn(process.execPath, args, {
      stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32",
    });
    let stdout = "";
    let stderr = "";
    let bytes = 0;
    let failure: Error | undefined;
    function cancel() {
      if (child.pid === undefined) return;
      try {
        if (process.platform === "win32") child.kill();
        else process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") child.kill();
      }
    }
    const append = (chunk: string, channel: "stdout" | "stderr") => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 64 * 1024 * 1024) { failure = new Error("Observation exceeds the 64 MiB output limit."); cancel(); return; }
      if (channel === "stdout") stdout += chunk; else stderr += chunk;
    };
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => append(chunk, "stdout"));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => append(chunk, "stderr"));
    child.once("error", (error) => { failure = error; });
    child.once("close", (code) => {
      signal?.removeEventListener("abort", cancel);
      if (signal?.aborted) { reject(new Error("Execution cancelled.")); return; }
      if (failure) { reject(failure); return; }
      if (code !== 0) { reject(new Error(stderr.trim() || `Query process exited with code ${code}.`)); return; }
      try { resolve({ ...JSON.parse(stdout), receivedAt: Date.now() } as Observation); }
      catch (error) { reject(error); }
    });
    signal?.addEventListener("abort", cancel, { once: true });
  });
}
