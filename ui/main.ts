// The UI entry point validates terminal options before it loads Ink.
// This keeps ordinary CLI calls independent of terminal rendering.
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { fsRepo } from "../core/repo.ts";
import { loadUserQueries } from "../core/user-queries.ts";
import { loadUserProviders } from "../core/user-providers.ts";
import { loaders } from "../spacequery.config.ts";
import { browserCatalog } from "./catalog.ts";

export async function startUi(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    root: { type: "string" }, scope: { type: "string" }, me: { type: "string" }, help: { type: "boolean", short: "h" },
  } });
  if (values.help) {
    console.log("usage: spacequery ui [--root DIR] [--scope root|agents|all] [--me PANE]\n\nBrowse tables, query SQL, parameters, results, and provider status.\nData loads only when you press r. Use t/g for Tables/Queries and 1-5 for views.");
    return;
  }
  if (positionals.length) throw new Error("spacequery ui takes options only");
  if (values.scope !== undefined && !["root", "agents", "all"].includes(values.scope)) throw new Error("--scope is root, agents, or all");
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("spacequery ui needs an interactive terminal; use --help or a named query for piped output");
  const directory = resolve(values.root ?? process.cwd());
  const root = await fsRepo.rootOf(directory) ?? directory;
  const items = browserCatalog(loadUserQueries(process.env), loadUserProviders(process.env, loaders));
  const [{ createElement }, { render }, { Browser }] = await Promise.all([import("react"), import("ink"), import("./app.ts")]);
  const app = render(createElement(Browser, { items, initial: { root, scope: values.scope as "root" | "agents" | "all" | undefined ?? "auto", me: values.me, params: {} } }), { alternateScreen: true, exitOnCtrlC: false });
  await app.waitUntilExit();
}
