// These tests prove that declared commands fill user tables through the public run interface.
// They use temporary configuration and scripts, so no local user provider can affect them.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { runSql } from "../core/run.ts";
import { loadUserProviders } from "../core/user-providers.ts";
import { loadUserQueries } from "../core/user-queries.ts";
import { loaders } from "../spacequery.config.ts";
import { fakeExec, fixtureRepo, paths } from "./fixture.ts";

const execFileAsync = promisify(execFile);

async function withProvider<R>(declaration: Record<string, unknown>, output: unknown, run: (configHome: string, script: string) => Promise<R>): Promise<R> {
  const scratch = mkdtempSync(join(tmpdir(), "spacequery-user-providers-"));
  const configHome = join(scratch, "config");
  const directory = join(configHome, "spacequery", "providers");
  const script = join(scratch, "provider.mjs");
  mkdirSync(directory, { recursive: true });
  writeFileSync(script, `process.stdout.write(${JSON.stringify(JSON.stringify(output))});\n`);
  writeFileSync(join(directory, "tickets.json"), JSON.stringify({ command: [process.execPath, script], ...declaration }));
  try {
    return await run(configHome, script);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function captureWarnings(run: () => void): string {
  let warning = "";
  const write = process.stderr.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    warning += String(chunk);
    return true;
  }) as typeof process.stderr.write;
  try {
    run();
  } finally {
    process.stderr.write = write;
  }
  return warning;
}

test("a declared command fills its table", async () => {
  await withProvider({
    tables: {
      user_tickets: "create table user_tickets (id text primary key not null, title text, priority integer) strict",
    },
    command: ["ticket-list", "--json"],
    scope: "call",
    description: "Tickets from one local command.",
  }, [
    { id: "T-2", title: "Second", priority: 2 },
    { id: "T-1", title: "First" },
  ], async (configHome) => {
    const userProviders = loadUserProviders({ XDG_CONFIG_HOME: configHome }, []);
    const exec = async (command: string, args: readonly string[], cwd?: string) => {
      assert.equal(command, "ticket-list");
      assert.deepEqual(args, ["--json"]);
      assert.equal(cwd, undefined);
      return JSON.stringify([
        { id: "T-2", title: "Second", priority: 2 },
        { id: "T-1", title: "First" },
      ]);
    };
    const result = await runSql("select id, title, priority from user_tickets order by id", {
      loaders: [], userProviders, exec, env: { PATH: process.env.PATH }, params: {},
    });

    assert.deepEqual(result.rows, [
      { id: "T-1", title: "First", priority: null },
      { id: "T-2", title: "Second", priority: 2 },
    ]);
    assert.equal(result.trace.length, 1);
    assert.equal(result.trace[0]!.provider, "tickets");
    assert.equal(result.trace[0]!.command, "ticket-list");
    assert.deepEqual(result.trace[0]!.args, ["--json"]);
    assert.equal(result.trace[0]!.cwd, null);
    assert.equal(result.providers[0]!.source, "user");
  });
});

test("an object result fills each declared table", async () => {
  await withProvider({
    tables: {
      user_projects: "create table user_projects (id text primary key not null, name text not null) strict",
      user_items: "create table user_items (id text primary key not null, project_id text not null) strict",
    },
    command: ["project-list", "--json"],
    scope: "call",
  }, {
    user_projects: [{ id: "P-1", name: "Alpha" }],
    user_items: [{ id: "I-1", project_id: "P-1" }],
  }, async (configHome) => {
    const userProviders = loadUserProviders({ XDG_CONFIG_HOME: configHome }, []);
    const exec = async (command: string, args: readonly string[], cwd?: string) => {
      assert.equal(command, "project-list");
      assert.deepEqual(args, ["--json"]);
      assert.equal(cwd, undefined);
      return JSON.stringify({
        user_projects: [{ id: "P-1", name: "Alpha" }],
        user_items: [{ id: "I-1", project_id: "P-1" }],
      });
    };
    const result = await runSql(
      "select p.name, i.id from user_projects p join user_items i on i.project_id = p.id",
      { loaders: [], userProviders, exec, env: { PATH: process.env.PATH }, params: {} },
    );

    assert.deepEqual(result.rows, [{ name: "Alpha", id: "I-1" }]);
  });
});

test("a user query joins a declared table with repositories", async () => {
  await withProvider({
    tables: {
      user_tickets: "create table user_tickets (id text primary key not null, root text not null) strict",
    },
    command: ["ticket-list", "--json"],
    scope: "call",
  }, [], async (configHome) => {
    const queryDirectory = join(configHome, "spacequery", "queries");
    mkdirSync(queryDirectory, { recursive: true });
    writeFileSync(join(queryDirectory, "ticket-repositories.sql"), "select r.name, t.id from repos r join user_tickets t on t.root = r.path order by t.id");
    const userProviders = loadUserProviders({ XDG_CONFIG_HOME: configHome }, loaders);
    const userQuery = loadUserQueries({ XDG_CONFIG_HOME: configHome })[0]!;
    const builtInExec = fakeExec();
    const exec = async (command: string, args: readonly string[], cwd?: string) => {
      if (command === "ticket-list") {
        assert.deepEqual(args, ["--json"]);
        assert.equal(cwd, undefined);
        return JSON.stringify([{ id: "T-1", root: paths.alpha }]);
      }
      return builtInExec(command, args, cwd);
    };
    const result = await runSql(
      userQuery.sql,
      { loaders, userProviders, exec, repo: fixtureRepo, env: {}, scope: "all", params: {} },
    );

    assert.deepEqual(result.rows, [{ name: "alpha", id: "T-1" }]);
    assert.deepEqual(result.trace.map((row) => row.provider), ["repos", "tickets"]);
  });
});

test("a root-scoped provider fills a missing root column", async () => {
  await withProvider({
    tables: {
      user_tasks: "create table user_tasks (id text primary key not null, root text not null) strict",
    },
    command: ["task-list", "--json"],
    scope: "root",
  }, [], async (configHome) => {
    const userProviders = loadUserProviders({ XDG_CONFIG_HOME: configHome }, []);
    const exec = async (command: string, args: readonly string[], cwd?: string) => {
      assert.equal(command, "task-list");
      assert.deepEqual(args, ["--json"]);
      assert.equal(cwd, paths.alpha);
      return JSON.stringify([{ id: "task-1" }]);
    };
    const result = await runSql("select id, root from user_tasks", {
      loaders: [], userProviders, exec, scope: "root", params: { root: paths.alpha },
    });

    assert.deepEqual(result.rows, [{ id: "task-1", root: paths.alpha }]);
  });
});

test("all scope runs a root-scoped provider in every repository", async () => {
  await withProvider({
    tables: {
      user_roots: "create table user_roots (root text primary key not null, value text not null) strict",
    },
    command: ["root-value"],
    scope: "root",
  }, [], async (configHome) => {
    const userProviders = loadUserProviders({ XDG_CONFIG_HOME: configHome }, loaders);
    const builtInExec = fakeExec();
    const seen: string[] = [];
    const exec = async (command: string, args: readonly string[], cwd?: string) => {
      if (command === "root-value") {
        assert.deepEqual(args, []);
        seen.push(cwd!);
        return JSON.stringify([{ value: "present" }]);
      }
      return builtInExec(command, args, cwd);
    };
    const result = await runSql("select root, value from user_roots order by root", {
      loaders, userProviders, exec, repo: fixtureRepo, env: {}, scope: "all", params: {},
    });

    assert.deepEqual(result.rows, [
      { root: paths.alpha, value: "present" },
      { root: paths.beta, value: "present" },
      { root: paths.gamma, value: "present" },
    ]);
    assert.deepEqual(seen, [paths.alpha, paths.beta, paths.gamma]);
  });
});

test("a failed root names itself in the error and empties every table", async () => {
  await withProvider({
    tables: {
      user_tasks: "create table user_tasks (id text primary key not null, root text not null) strict",
      user_notes: "create table user_notes (id text primary key not null, root text not null) strict",
    },
    command: ["task-list", "--json"],
    scope: "root",
  }, [], async (configHome) => {
    const userProviders = loadUserProviders({ XDG_CONFIG_HOME: configHome }, loaders);
    const builtInExec = fakeExec();
    const seen: string[] = [];
    const exec = async (command: string, args: readonly string[], cwd?: string) => {
      if (command === "task-list") {
        assert.deepEqual(args, ["--json"]);
        seen.push(cwd!);
        if (cwd === paths.beta) throw new Error("no such command");
        return JSON.stringify({
          user_tasks: [{ id: "task-1" }],
          user_notes: [{ id: "note-1" }],
        });
      }
      return builtInExec(command, args, cwd);
    };
    const result = await runSql(
      "select id from user_tasks union all select id from user_notes",
      { loaders, userProviders, exec, repo: fixtureRepo, env: {}, params: {} },
    );

    assert.deepEqual(seen, [paths.alpha, paths.beta]);
    assert.deepEqual(result.rows, []);
    const provider = result.providers.find(({ name }) => name === "tickets")!;
    assert.equal(provider.ok, 0);
    assert.equal(provider.error, `tickets in ${paths.beta}: no such command`);
  });
});

test("invalid JSON fails one user provider and keeps repository rows", async () => {
  await withProvider({
    tables: {
      user_bad: "create table user_bad (id text primary key not null, root text) strict",
    },
    command: ["broken-list"],
    scope: "call",
  }, [], async (configHome) => {
    const userProviders = loadUserProviders({ XDG_CONFIG_HOME: configHome }, loaders);
    const builtInExec = fakeExec();
    const exec = async (command: string, args: readonly string[], cwd?: string) => {
      if (command === "broken-list") {
        assert.deepEqual(args, []);
        assert.equal(cwd, undefined);
        return "not json";
      }
      return builtInExec(command, args, cwd);
    };
    const result = await runSql(
      "select r.path, u.id from repos r left join user_bad u on u.root = r.path order by r.path",
      { loaders, userProviders, exec, repo: fixtureRepo, env: {}, scope: "all", params: {} },
    );

    assert.deepEqual(result.rows, [
      { path: paths.alpha, id: null },
      { path: paths.beta, id: null },
      { path: paths.gamma, id: null },
    ]);
    assert.deepEqual(result.providers.map(({ name, ok, source }) => ({ name, ok, source })), [
      { name: "repos", ok: 1, source: "built-in" },
      { name: "tickets", ok: 0, source: "user" },
    ]);
  });
});

test("a declaration that names a built-in table is skipped with a warning", async () => {
  await withProvider({
    tables: {
      agents: "create table agents (id text primary key not null) strict",
    },
    scope: "call",
  }, [], async (configHome) => {
    const warning = captureWarnings(() => {
      assert.deepEqual(loadUserProviders({ XDG_CONFIG_HOME: configHome }, loaders), []);
    });
    assert.match(warning, /table agents is built in/);
  });
});

test("a declaration whose statement creates another table is skipped", async () => {
  await withProvider({
    tables: {
      user_expected: "create table user_actual (id text primary key not null) strict",
    },
    scope: "call",
  }, [], async (configHome) => {
    const warning = captureWarnings(() => {
      assert.deepEqual(loadUserProviders({ XDG_CONFIG_HOME: configHome }, loaders), []);
    });
    assert.match(warning, /one create table statement for its name/);
  });
});

test("a declaration cannot seed its table", async () => {
  await withProvider({
    tables: {
      user_seeded: "create table user_seeded as select 'seed' as id",
    },
    scope: "call",
  }, [], async (configHome) => {
    const warning = captureWarnings(() => {
      assert.deepEqual(loadUserProviders({ XDG_CONFIG_HOME: configHome }, []), []);
    });
    assert.match(warning, /must be empty after creation/);
  });
});

test("an unknown row column fails the provider and leaves its table empty", async () => {
  await withProvider({
    tables: {
      user_tickets: "create table user_tickets (id text primary key not null) strict",
    },
    command: ["ticket-list"],
    scope: "call",
  }, [], async (configHome) => {
    const userProviders = loadUserProviders({ XDG_CONFIG_HOME: configHome }, []);
    const exec = async (command: string, args: readonly string[], cwd?: string) => {
      assert.equal(command, "ticket-list");
      assert.deepEqual(args, []);
      assert.equal(cwd, undefined);
      return JSON.stringify([{ id: "T-1", extra: true }]);
    };
    const result = await runSql("select id from user_tickets", {
      loaders: [], userProviders, exec, params: {},
    });

    assert.deepEqual(result.rows, []);
    assert.equal(result.providers[0]!.ok, 0);
    assert.match(result.providers[0]!.error!, /unknown column extra/);
  });
});

test("a rejected row rolls back earlier rows from the provider", async () => {
  await withProvider({
    tables: {
      user_tickets: "create table user_tickets (id text primary key not null, priority integer not null) strict",
    },
    command: ["ticket-list"],
    scope: "call",
  }, [], async (configHome) => {
    const userProviders = loadUserProviders({ XDG_CONFIG_HOME: configHome }, []);
    const exec = async (command: string, args: readonly string[], cwd?: string) => {
      assert.equal(command, "ticket-list");
      assert.deepEqual(args, []);
      assert.equal(cwd, undefined);
      return JSON.stringify([
        { id: "T-1", priority: 1 },
        { id: "T-2", priority: "urgent" },
      ]);
    };
    const result = await runSql("select id from user_tickets", {
      loaders: [], userProviders, exec, params: {},
    });

    assert.deepEqual(result.rows, []);
    assert.equal(result.providers[0]!.ok, 0);
  });
});

test("a conflict policy cannot discard an output row", async () => {
  for (const policy of ["ignore", "replace"]) {
    await withProvider({
      tables: {
        user_tickets: `create table user_tickets (id text unique on conflict ${policy}) strict`,
      },
      command: ["ticket-list"],
      scope: "call",
    }, [], async (configHome) => {
      const userProviders = loadUserProviders({ XDG_CONFIG_HOME: configHome }, []);
      const exec = async (command: string, args: readonly string[], cwd?: string) => {
        assert.equal(command, "ticket-list");
        assert.deepEqual(args, []);
        assert.equal(cwd, undefined);
        return JSON.stringify([{ id: "T-1" }, { id: "T-1" }]);
      };
      const result = await runSql("select id from user_tickets", {
        loaders: [], userProviders, exec, params: {},
      });

      assert.deepEqual(result.rows, []);
      assert.equal(result.providers[0]!.ok, 0);
    });
  }
});

test("help lists user providers below user queries", async () => {
  await withProvider({
    tables: {
      user_tickets: "create table user_tickets (id text primary key not null) strict",
    },
    scope: "call",
    description: "Tickets from one local command.",
  }, [{ id: "T-1" }], async (configHome, script) => {
    const queries = join(configHome, "spacequery", "queries");
    mkdirSync(queries, { recursive: true });
    writeFileSync(join(queries, "local-tickets.sql"), "-- Local tickets.\nselect id from user_tickets");
    const { stdout } = await execFileAsync(process.execPath, ["cli.ts", "--help"], {
      cwd: process.cwd(), encoding: "utf8", env: { ...process.env, XDG_CONFIG_HOME: configHome },
    });

    const queryAt = stdout.indexOf(`user queries (${queries}):`);
    const providerAt = stdout.indexOf(`user providers (${join(configHome, "spacequery", "providers")}):`);
    assert.ok(queryAt >= 0);
    assert.ok(providerAt > queryAt);
    assert.match(stdout, /tickets\s+user_tickets\s+Tickets from one local command\./);
    const { stdout: queryOutput } = await execFileAsync(process.execPath, ["cli.ts", "local-tickets", "--json", "--trace"], {
      cwd: process.cwd(), encoding: "utf8", env: { ...process.env, XDG_CONFIG_HOME: configHome },
    });
    const result = JSON.parse(queryOutput);
    assert.deepEqual(result.rows, [{ id: "T-1" }]);
    assert.deepEqual(result.providers.map(({ name, source }: { name: string; source: string }) => ({ name, source })), [
      { name: "tickets", source: "user" },
    ]);
    assert.equal(result.trace.length, 1);
    assert.equal(result.trace[0].provider, "tickets");
    assert.equal(result.trace[0].command, process.execPath);
    assert.equal(result.trace[0].path, process.execPath);
    assert.deepEqual(result.trace[0].args, [script]);
    assert.equal(result.trace[0].cwd, null);
  });
});

test("a declared table stores every generated row", () => hegel.testAsync(async (tc) => {
  const rows = tc.draw(gs.arrays(gs.record({
    id: gs.fromRegex("T-[a-z0-9]{1,8}"),
    title: gs.text({ maxSize: 24 }),
    priority: gs.integers({ minValue: -100, maxValue: 100 }),
  }), { maxSize: 20, unique: true }));
  await withProvider({
    tables: {
      generated_rows: "create table generated_rows (id text not null, title text not null, priority integer not null) strict",
    },
    command: ["generated-rows"],
    scope: "call",
  }, [], async (configHome) => {
    const userProviders = loadUserProviders({ XDG_CONFIG_HOME: configHome }, []);
    const exec = async (command: string, args: readonly string[], cwd?: string) => {
      assert.equal(command, "generated-rows");
      assert.deepEqual(args, []);
      assert.equal(cwd, undefined);
      return JSON.stringify(rows);
    };
    const result = await runSql("select cast(count(*) as integer) as row_count from generated_rows", {
      loaders: [], userProviders, exec, params: {},
    });
    assert.deepEqual(result.rows, [{ row_count: rows.length }]);
  });
}));
