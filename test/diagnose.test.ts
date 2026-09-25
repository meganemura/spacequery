// These tests prove the fix a prepare failure carries, and the warning a
// declared type raises against a value that can never match it.
// They read the migrated schema; they do not run a loader or a provider.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { diagnosePrepareError, neverMatchWarnings } from "../core/diagnose.ts";
import { tablesRead } from "../core/resolve.ts";
import { migrations } from "../migrations/index.ts";
import { migrate } from "solarsql/node";

function migratedDatabase(): DatabaseSync {
  const raw = new DatabaseSync(":memory:");
  migrate(raw, migrations);
  return raw;
}

function prepareFailure(sql: string): string {
  const raw = migratedDatabase();
  try {
    raw.prepare(sql);
    throw new Error(`expected ${sql} not to prepare`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return diagnosePrepareError(raw, sql, message) ?? "";
  }
}

function warningsFor(sql: string): string[] {
  const raw = migratedDatabase();
  const tables = tablesRead(raw, sql);
  return neverMatchWarnings(raw, sql, tables);
}

// The `try:` line, if any, so a test can assert it prepares and does what
// it says without parsing the whole hint block.
function tryLine(hint: string): string | undefined {
  return /^ {2}try: (.+)$/m.exec(hint)?.[1];
}

test("a renamed column names the close match, the table's typed columns, and a verified fix", () => {
  const hint = prepareFailure("select pid, cpu from processes limit 1");
  assert.match(hint, /did you mean cpu_pct\? \(processes\)/);
  assert.match(hint, /columns of processes: pid integer, ppid integer, pgid integer, uid integer, cwd text\?, root text\?, command text, executable text, elapsed_s integer, rss_kb integer, cpu_pct real, cpu_time_s real/);
  assert.match(hint, /try: select pid, cpu_pct from processes limit 1/);
});

test("a column with no close name lists the table's columns and no guess", () => {
  const hint = prepareFailure("select zzznotacolumn from processes");
  assert.doesNotMatch(hint, /did you mean/);
  assert.match(hint, /columns of processes: pid/);
});

test("an alias-qualified column resolves through the statement's own from clause", () => {
  const hint = prepareFailure("select a.pidd from processes a");
  assert.match(hint, /did you mean pid\? \(processes\)/);
});

test("a renamed table names the close tables", () => {
  const hint = prepareFailure("select * from procesess");
  assert.match(hint, /did you mean processes\?/);
});

test("a table with no close name lists every table", () => {
  const hint = prepareFailure("select * from zzznotatable");
  assert.doesNotMatch(hint, /did you mean/);
  assert.match(hint, /tables: .*processes/);
});

test("an equal comparison against an integer column with a non-numeric text warns", () => {
  assert.deepEqual(warningsFor("select count(*) from panes where shell_pid = 'x'"), ["panes.shell_pid is integer; 'x' can never equal it"]);
});

test("the reversed form of the comparison also warns", () => {
  assert.deepEqual(warningsFor("select count(*) from processes p where 'x' = p.pid"), ["processes.pid is integer; 'x' can never equal it"]);
});

test("an in list warns once, naming every non-numeric value", () => {
  assert.deepEqual(warningsFor("select count(*) from processes where pid in ('a', 'b')"), ["processes.pid is integer; 'a', 'b' can never equal it"]);
});

test("a numeric text literal does not warn", () => {
  assert.deepEqual(warningsFor("select count(*) from processes where pid = '1'"), []);
});

test("a text column does not warn", () => {
  assert.deepEqual(warningsFor("select count(*) from processes where root = 'x'"), []);
});

test("a quoted value inside a line comment or another string does not warn", () => {
  assert.deepEqual(warningsFor("select count(*) from processes where pid = '1' -- shell_pid = 'x'"), []);
  assert.deepEqual(warningsFor("select count(*) from processes where command = '-- shell_pid = ''x'''"), []);
});

test("an alias the scan cannot resolve leaves the comparison alone", () => {
  assert.deepEqual(warningsFor("select count(*) from (select pid from processes) as a where a.pid = 'x'"), []);
});

test("a 0/1 check column reads its enum and rejects 'true' by value, not by type", () => {
  // runtag_jobs.orphan is declared integer with check(orphan in (0, 1)); its
  // enum is read from that check, so the message names 0 and 1 themselves.
  assert.deepEqual(warningsFor("select count(*) from runtag_jobs where orphan = 'true'"), ["runtag_jobs.orphan only takes 0, 1; 'true' can never equal it"]);
});

test("a column present in another table names it and the join, with a verified try", () => {
  const hint = prepareFailure("select shell_pid from agents");
  assert.match(hint, /shell_pid is in panes, not agents; panes joins agents on pane_id/);
  const fix = tryLine(hint);
  assert.ok(fix !== undefined);
  const raw = migratedDatabase();
  assert.doesNotThrow(() => raw.prepare(fix!));
});

test("a column reached through the wrong alias names the alias that has it", () => {
  const hint = prepareFailure("select a.shell_pid from agents a join panes p on p.pane_id = a.pane_id");
  assert.match(hint, /did you mean p\.shell_pid\? \(panes\)/);
  assert.equal(tryLine(hint), "select p.shell_pid from agents a join panes p on p.pane_id = a.pane_id");
});

test("an ambiguous column names its tables and a qualifier for each", () => {
  const hint = prepareFailure("select pid from processes, listeners where pid = 1");
  assert.match(hint, /pid is in listeners and processes; qualify it as listeners\.pid or processes\.pid/);
});

test("a value outside a CHECK enum warns with the allowed values", () => {
  assert.deepEqual(
    warningsFor("select count(*) from runtag_jobs where status = 'queued'"),
    ["runtag_jobs.status only takes 'running', 'exited'; 'queued' can never equal it"],
  );
});

test("comparing null with = or <> is always unknown, and names the fix", () => {
  assert.deepEqual(
    warningsFor("select count(*) from processes where command = null"),
    ["processes.command = null is always unknown; try: command is null"],
  );
  assert.deepEqual(
    warningsFor("select count(*) from processes where command <> null"),
    ["processes.command <> null is always unknown; try: command is not null"],
  );
});

test("is null against a NOT NULL column never matches, and warns", () => {
  assert.deepEqual(
    warningsFor("select count(*) from processes where command is null"),
    ["processes.command is not null; is null never matches it"],
  );
});

test("is null against a nullable column does not warn", () => {
  assert.deepEqual(warningsFor("select count(*) from processes where root is null"), []);
});

test("a double-quoted value hints single quotes and gives a verified fix", () => {
  const hint = prepareFailure('select * from processes where command = "claude"');
  assert.match(hint, /double-quoted values are for identifiers in SQLite; use single quotes for 'claude'/);
  assert.equal(tryLine(hint), "select * from processes where command = 'claude'");
});

test("no such function suggests the close core functions", () => {
  const hint = prepareFailure("select nowx()");
  assert.match(hint, /did you mean/);
});

test("a :: cast hints sqlite's cast function", () => {
  const hint = prepareFailure("select pid from processes where pid::text = '1'");
  assert.match(hint, /cast\(expr as type\)/);
});

test("ilike hints that like already ignores case, with a verified fix", () => {
  const hint = prepareFailure("select * from processes where command ilike 'claude'");
  assert.match(hint, /like already ignores ASCII case/);
  assert.equal(tryLine(hint), "select * from processes where command like 'claude'");
});

test("a reserved word used bare as a name hints quoting it", () => {
  const hint = prepareFailure("select order from processes");
  assert.match(hint, /order is a reserved word here/);
});

test("a trailing comma before from names the comma, not a reserved word, and gives a verified fix", () => {
  const hint = prepareFailure("select pid, from processes");
  assert.match(hint, /remove the trailing comma before from/);
  assert.doesNotMatch(hint, /reserved word/);
  assert.match(hint, /\n {2}select pid, from processes\n {14}\^{4}\n/);
  assert.match(hint, /try: select pid from processes$/m);
});

test("incomplete input names the clause the statement ends inside", () => {
  const hint = prepareFailure("select pid from processes group");
  assert.match(hint, /ends inside a clause after "group"/);
});

test("diagnose never throws on a generated identifier-like failure, and a suggestion names a real column", () =>
  hegel.test((tc) => {
    const name = tc.draw(gs.fromRegex("[a-z][a-z0-9_]{0,12}"));
    const table = tc.draw(gs.sampledFrom(["processes", "panes", "agents", "sessions"]));
    const sql = `select ${name} from ${table}`;
    const raw = migratedDatabase();
    let hint: string | undefined;
    try {
      raw.prepare(sql);
      return; // A generated name that happens to be a real column prepares fine.
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      hint = diagnosePrepareError(raw, sql, message);
    }
    if (hint === undefined) return;
    const suggested = /did you mean (\w+)\?/.exec(hint);
    if (suggested !== null) {
      const columns = (raw.prepare("select name from pragma_table_info(?)").all(table) as { name: string }[]).map((row) => row.name);
      assert.ok(columns.includes(suggested[1]!), `${suggested[1]} is not a column of ${table}`);
    }
    const fix = tryLine(hint);
    if (fix !== undefined) assert.doesNotThrow(() => raw.prepare(fix));
  }));
