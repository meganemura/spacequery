// Turns a prepare failure of ad hoc SQL into a message with the fix, and
// flags a comparison the schema makes impossible before the loaders run.
// `--sql` and a user query file are typed by nothing until they run, so a
// renamed column fails with SQLite's own line alone, a value outside a
// CHECK enum returns zero rows in silence, and a comparison against the
// wrong type does too.
// Boundary: reads the schema of the database this call already opened (the
// migrations, plus any user-provider tables) and the statement text. It
// starts no loader. When a fix is certain, this module calls `raw.prepare`
// on the candidate to confirm it, which stays inside prepare-only reading;
// it never calls `.run` or `.all`, so the candidate never executes.
import type { DatabaseSync } from "node:sqlite";

// The line every diagnostic ends with. One form, used everywhere, so an
// agent that has seen one hint has seen the shape of the next. A warning
// (decision 2) is not a prepare failure, but reuses the same line so the
// CLI can print it once after the warnings, not once per warning.
export const columnsHelp = "columns of a table: spacequery --sql \"select name, type from pragma_table_info('<table>')\"";

const maxEditDistance = 3;

type ColumnDef = { table: string; name: string; type: string; nullable: boolean; enumValues: string[] | undefined };

// -------------------------------------------------------------------------
// Schema reading
// -------------------------------------------------------------------------

// The tables and providers own no data of their own; sqlite's and solarsql's
// bookkeeping tables are not tables a statement is meant to read.
function tableNames(raw: DatabaseSync): string[] {
  const rows = raw.prepare("select name from sqlite_schema where type = 'table' and name not like 'sqlite_%' and name not like 'solarsql_%' order by name").all() as { name: string }[];
  return rows.map((row) => row.name);
}

function tableCreateSql(raw: DatabaseSync, table: string): string | undefined {
  const row = raw.prepare("select sql from sqlite_schema where type = 'table' and name = ?").get(table) as { sql: string } | undefined;
  return row?.sql;
}

// A column's allowed values, when its table declares `check (col in (...))`.
// This is a text scan of the table's own CREATE statement, not a parser: the
// declared schema is small and its shape is regular enough that this reads
// every enum spacequery's own tables and a user provider's tables declare.
function enumValuesFor(createSql: string | undefined, column: string): string[] | undefined {
  if (createSql === undefined) return undefined;
  const namePattern = '(?:"((?:[^"]|"")+)"|`((?:[^`]|``)+)`|\\[([^\\]]+)\\]|(\\w+))';
  const checkPattern = new RegExp(`check\\s*\\(\\s*${namePattern}\\s+in\\s*\\(([^)]*)\\)\\s*\\)`, "gi");
  for (const match of createSql.matchAll(checkPattern)) {
    const name = (match[1] ?? match[2] ?? match[3] ?? match[4] ?? "").replace(/""/g, '"').replace(/``/g, "`");
    if (name.toLowerCase() !== column.toLowerCase()) continue;
    return parseValueList(match[5] ?? "");
  }
  return undefined;
}

// A comma-separated list of quoted text or bare numbers, as CHECK and `in`
// write them. Not a general expression parser: anything else in the list
// (a function call, a sub-select) means this is not the shape it reads.
function parseValueList(text: string): string[] {
  const values: string[] = [];
  const itemPattern = /'(?:[^']|'')*'|-?\d+(?:\.\d+)?/g;
  for (const match of text.matchAll(itemPattern)) {
    const raw = match[0];
    values.push(raw.startsWith("'") ? raw.slice(1, -1).replace(/''/g, "'") : raw);
  }
  return values;
}

function columnsOf(raw: DatabaseSync, table: string): ColumnDef[] {
  const rows = raw.prepare('select name, type, "notnull", pk from pragma_table_info(?)').all(table) as { name: string; type: string; notnull: number; pk: number }[];
  const createSql = tableCreateSql(raw, table);
  return rows.map((row) => ({
    table,
    name: row.name,
    type: row.type.toLowerCase(),
    nullable: row.notnull === 0 && row.pk === 0,
    enumValues: enumValuesFor(createSql, row.name),
  }));
}

function quoteEnumValue(column: ColumnDef, value: string): string {
  return column.type === "text" ? `'${value}'` : value;
}

// `pid integer`, `cwd text?` (nullable), `status text in ('observed', 'skipped')`.
function formatColumn(column: ColumnDef): string {
  const base = column.enumValues !== undefined
    ? `${column.type} in (${column.enumValues.map((v) => quoteEnumValue(column, v)).join(", ")})`
    : column.type;
  return `${column.name} ${base}${column.nullable ? "?" : ""}`;
}

function columnsLine(raw: DatabaseSync, table: string): string {
  return `columns of ${table}: ${columnsOf(raw, table).map(formatColumn).join(", ")}`;
}

// A light scan for the table names the statement names as literal words.
// It is not the authorizer: a name inside a string or comment does not
// count, and this runs precisely when the authorizer could not (prepare
// already failed).
function tablesNamedIn(sql: string, knownTables: readonly string[]): string[] {
  const words = new Set(tokenize(sql).filter((t) => t.kind === "word").map((t) => t.value.toLowerCase()));
  return knownTables.filter((table) => words.has(table.toLowerCase()));
}

// -------------------------------------------------------------------------
// Names: edit distance and prefix/suffix ranking
// -------------------------------------------------------------------------

function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i++) d[i]![0] = i;
  for (let j = 0; j < cols; j++) d[0]![j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
    }
  }
  return d[rows - 1]![cols - 1]!;
}

function isPrefixOrSuffix(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x === y) return false;
  return y.startsWith(x) || y.endsWith(x) || x.startsWith(y) || x.endsWith(y);
}

// Prefix or suffix beats a mere edit distance: `cpu` -> `cpu_pct` reads as
// the intended rename, not a typo of `cwd`. Returns undefined on a tie,
// because a tie is not a fix a caller should run without looking.
function closestColumn(missing: string, candidates: readonly ColumnDef[]): ColumnDef | undefined {
  const scored = candidates.map((column) => ({
    column,
    prefixed: isPrefixOrSuffix(missing, column.name),
    distance: levenshtein(missing.toLowerCase(), column.name.toLowerCase()),
  }));
  const eligible = scored.filter((entry) => entry.prefixed || entry.distance <= maxEditDistance);
  if (eligible.length === 0) return undefined;
  const prefixed = eligible.filter((entry) => entry.prefixed);
  const pool = prefixed.length > 0 ? prefixed : eligible;
  pool.sort((a, b) => a.distance - b.distance);
  if (pool.length > 1 && pool[0]!.distance === pool[1]!.distance) return undefined;
  return pool[0]!.column;
}

function closestTables(missing: string, knownTables: readonly string[], limit: number): string[] {
  const ranked = knownTables
    .map((table) => ({ table, distance: levenshtein(missing.toLowerCase(), table.toLowerCase()) }))
    .sort((a, b) => a.distance - b.distance || a.table.localeCompare(b.table));
  return ranked.filter((entry) => entry.distance <= maxEditDistance).slice(0, limit).map((entry) => entry.table);
}

// -------------------------------------------------------------------------
// Tokens, shared by the alias scan, the value scan, and the 1b rules.
// -------------------------------------------------------------------------

type Token = { kind: "word" | "string" | "op" | "punct"; value: string; start: number; end: number };

const tokenPattern = /--[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^']|'')*'|"(?:[^"]|"")*"|`(?:[^`]|``)*`|\[[^\]]*\]|:[A-Za-z_][A-Za-z0-9_]*|<>|<=|>=|!=|==|=|[A-Za-z_][A-Za-z0-9_]*|[^\s]/g;

// Comments and strings are read as text, not code, so a name or a value
// inside either does not feed the diagnosis. Quoted identifiers become
// words, unescaped only for their own doubled quote character. Everything
// else that is not a known operator is one punctuation character, which is
// enough to find `.` between an alias and a column, and `(` and `)` around
// an `in` list. `start`/`end` are the source offsets, for the syntax-error
// caret and for building a `try:` by literal replacement.
function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  for (const match of sql.matchAll(tokenPattern)) {
    const text = match[0];
    const start = match.index;
    const end = start + text.length;
    if (text.startsWith("--") || text.startsWith("/*")) continue;
    if (text.startsWith("'")) {
      tokens.push({ kind: "string", value: text.slice(1, -1).replace(/''/g, "'"), start, end });
    } else if (text.startsWith('"')) {
      tokens.push({ kind: "word", value: text.slice(1, -1).replace(/""/g, '"'), start, end });
    } else if (text.startsWith("`")) {
      tokens.push({ kind: "word", value: text.slice(1, -1).replace(/``/g, "`"), start, end });
    } else if (text.startsWith("[")) {
      tokens.push({ kind: "word", value: text.slice(1, -1), start, end });
    } else if (text.startsWith(":")) {
      tokens.push({ kind: "punct", value: text, start, end });
    } else if (/^[A-Za-z_]/.test(text)) {
      tokens.push({ kind: "word", value: text, start, end });
    } else if (["<>", "<=", ">=", "!=", "==", "="].includes(text)) {
      tokens.push({ kind: "op", value: text, start, end });
    } else {
      tokens.push({ kind: "punct", value: text, start, end });
    }
  }
  return tokens;
}

const clauseKeywords = new Set([
  "where", "join", "left", "right", "inner", "outer", "cross", "natural", "using", "on",
  "group", "order", "limit", "set", "values", "select", "union", "intersect", "except",
  "offset", "having", "window", "as", "and", "or",
]);

// `from t alias` and `from t as alias` both name an alias; a keyword in
// alias position means there was none. A derived table (`from (select ...)`)
// is left unmapped: this is a name scan, not a parser for subqueries.
function aliasesInStatement(sql: string, knownTables: readonly string[]): Map<string, string> {
  const known = new Set(knownTables.map((t) => t.toLowerCase()));
  const tokens = tokenize(sql);
  const aliases = new Map<string, string>();
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token.kind !== "word" || !["from", "join"].includes(token.value.toLowerCase())) continue;
    const nameToken = tokens[i + 1];
    if (nameToken === undefined || nameToken.kind !== "word" || !known.has(nameToken.value.toLowerCase())) continue;
    const table = knownTables.find((t) => t.toLowerCase() === nameToken.value.toLowerCase())!;
    aliases.set(nameToken.value.toLowerCase(), table);
    let next = i + 2;
    if (tokens[next]?.kind === "word" && tokens[next]!.value.toLowerCase() === "as") next += 1;
    const aliasToken = tokens[next];
    if (aliasToken !== undefined && aliasToken.kind === "word" && !clauseKeywords.has(aliasToken.value.toLowerCase())) {
      aliases.set(aliasToken.value.toLowerCase(), table);
    }
  }
  return aliases;
}

// -------------------------------------------------------------------------
// Joins between two tables, for the "column lives in the other table" hint.
// -------------------------------------------------------------------------

// Ordered so a narrow, usually-unique key wins over `root`, which many
// tables share and which alone would multiply rows across a join.
const joinKeyPriority = ["pane_id", "pid", "session_id", "path", "root"];

function sharedKey(raw: DatabaseSync, a: string, b: string): string | undefined {
  const columnsA = new Set(columnsOf(raw, a).map((c) => c.name.toLowerCase()));
  const columnsB = new Set(columnsOf(raw, b).map((c) => c.name.toLowerCase()));
  return joinKeyPriority.find((key) => columnsA.has(key) && columnsB.has(key));
}

// A short alias for `table` that does not collide with `taken`. `panes` and
// `processes` both start with `p`, so this grows the alias until it is free.
function freshAlias(table: string, taken: ReadonlySet<string>): string {
  for (let length = 1; length <= table.length; length++) {
    const candidate = table.slice(0, length).toLowerCase();
    if (!taken.has(candidate)) return candidate;
  }
  return table;
}

// Once a statement gives a table an alias, the alias is what a column
// reference must use; the table's own name is no longer a valid qualifier.
// Prefer a human alias over the table's own name in the alias map, which
// `aliasesInStatement` also records so a query with no alias still resolves.
function qualifierFor(aliases: ReadonlyMap<string, string>, table: string): string {
  const names = [...aliases.entries()].filter(([, t]) => t === table).map(([alias]) => alias);
  return names.find((alias) => alias !== table.toLowerCase()) ?? table;
}

function verifiedTry(raw: DatabaseSync, sql: string): string | undefined {
  try {
    raw.prepare(sql);
    return sql;
  } catch {
    return undefined;
  }
}

// -------------------------------------------------------------------------
// `no such column: X`
// -------------------------------------------------------------------------

type ColumnDiagnosis = { lines: string[]; try?: string };

function diagnoseNoSuchColumn(raw: DatabaseSync, sql: string, missing: string): ColumnDiagnosis {
  const knownTables = tableNames(raw);
  const aliases = aliasesInStatement(sql, knownTables);
  const dot = missing.lastIndexOf(".");
  const qualifier = dot === -1 ? undefined : missing.slice(0, dot);
  const bare = dot === -1 ? missing : missing.slice(dot + 1);
  const namedTables = tablesNamedIn(sql, knownTables);

  // 1. A qualifier that names a real table, which lacks the column, while
  // exactly one other aliased table in the statement has it: the alias is
  // wrong, not the column.
  if (qualifier !== undefined) {
    const qualifierTable = aliases.get(qualifier.toLowerCase());
    if (qualifierTable !== undefined) {
      const otherTables = [...new Set([...aliases.values()].filter((table) => table !== qualifierTable && columnsOf(raw, table).some((c) => c.name.toLowerCase() === bare.toLowerCase())))];
      const uniqueOther = otherTables.length === 1 ? { table: otherTables[0]!, alias: qualifierFor(aliases, otherTables[0]!) } : undefined;
      if (uniqueOther !== undefined) {
        const rewritten = replaceToken(sql, missing, `${uniqueOther.alias}.${bare}`);
        return {
          lines: [`did you mean ${uniqueOther.alias}.${bare}? (${uniqueOther.table})`, columnsLine(raw, uniqueOther.table)],
          try: rewritten === undefined ? undefined : verifiedTry(raw, rewritten),
        };
      }
    }
  }

  // 2. The column exists, exactly once, in a table the statement does not
  // already name: point at it and how it joins the table that was meant.
  if (namedTables.length === 1) {
    const [t1] = namedTables as [string];
    const elsewhere = knownTables.filter((t) => t !== t1 && columnsOf(raw, t).some((c) => c.name.toLowerCase() === bare.toLowerCase()));
    if (elsewhere.length === 1) {
      const t2 = elsewhere[0]!;
      const column = columnsOf(raw, t2).find((c) => c.name.toLowerCase() === bare.toLowerCase())!;
      const key = sharedKey(raw, t1, t2);
      const joinNote = key === undefined ? "" : `; ${t2} joins ${t1} on ${key}`;
      const lines = [`${column.name} is in ${t2}, not ${t1}${joinNote}`, columnsLine(raw, t2)];
      const attempt = key === undefined ? undefined : tryJoinRewrite(raw, sql, t1, t2, key, missing, bare);
      return { lines, try: attempt };
    }
  }

  // 3. A close match within a table the statement already names.
  const tables = namedTables.length > 0 ? namedTables : knownTables;
  const candidates: ColumnDef[] = tables.flatMap((table) => columnsOf(raw, table));
  const best = closestColumn(bare, candidates);
  const lines: string[] = [];
  if (best !== undefined) lines.push(`did you mean ${best.name}? (${best.table})`);
  for (const table of tables) lines.push(columnsLine(raw, table));
  const attempt = best === undefined ? undefined : (() => {
    const rewritten = replaceToken(sql, missing, qualifier === undefined ? best.name : `${qualifier}.${best.name}`);
    return rewritten === undefined ? undefined : verifiedTry(raw, rewritten);
  })();
  return { lines, try: attempt };
}

// Only the plain `select ... from T1 [where ...]` shape, so the join clause
// has one place to go and the rewrite cannot silently drop a join the
// statement already had.
function tryJoinRewrite(raw: DatabaseSync, sql: string, t1: string, t2: string, key: string, missingToken: string, bareColumn: string): string | undefined {
  const shape = /^(\s*select\s+)([\s\S]+?)(\s+from\s+)([A-Za-z_][A-Za-z0-9_]*)(\s*)((?:where\s+[\s\S]+)?)$/i.exec(sql.trim());
  if (shape === null) return undefined;
  const [, selectKw, selectList, fromKw, table, , whereClause] = shape;
  if (table!.toLowerCase() !== t1.toLowerCase()) return undefined;
  const existingAliases = new Set(aliasesInStatement(sql, tableNames(raw)).keys());
  const alias = freshAlias(t2, existingAliases);
  const replacement = `${alias}.${bareColumn}`;
  const newSelect = replaceToken(selectList!, missingToken, replacement) ?? selectList!.split(missingToken).join(replacement);
  const newWhere = whereClause === undefined || whereClause === "" ? "" : ` ${replaceToken(whereClause, missingToken, replacement) ?? whereClause.split(missingToken).join(replacement)}`;
  const candidate = `${selectKw}${newSelect}${fromKw}${t1} join ${t2} as ${alias} on ${alias}.${key} = ${t1}.${key}${newWhere}`;
  return verifiedTry(raw, candidate);
}

// A literal, word-boundary replacement of the exact identifier text SQLite
// named (bare, or `qualifier.column`), used only to build a `try:` that is
// then verified by preparing it. Returns undefined when the token does not
// appear as its own word, so a rewrite is never guessed at silently.
function replaceToken(text: string, token: string, replacement: string): string | undefined {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\b${escaped}\\b`);
  if (!pattern.test(text)) return undefined;
  return text.replace(pattern, replacement);
}

// -------------------------------------------------------------------------
// `no such table: X`
// -------------------------------------------------------------------------

function diagnoseNoSuchTable(raw: DatabaseSync, sql: string, missing: string): ColumnDiagnosis {
  const knownTables = tableNames(raw);
  const close = closestTables(missing, knownTables, 3);
  const lines: string[] = [];
  if (close.length > 0) lines.push(`did you mean ${close.join(", ")}?`);
  else lines.push(`tables: ${knownTables.join(", ")}`);
  const attempt = close.length === 1
    ? (() => {
        const rewritten = replaceToken(sql, missing, close[0]!);
        return rewritten === undefined ? undefined : verifiedTry(raw, rewritten);
      })()
    : undefined;
  return { lines, try: attempt };
}

// -------------------------------------------------------------------------
// 1b: the rest of the prepare errors an agent commonly makes.
// -------------------------------------------------------------------------

// A fixed list, not a query against the engine: SQLite has no catalog of
// its own function names to read at prepare time.
const knownFunctions = [
  "abs", "avg", "coalesce", "count", "glob", "group_concat", "hex", "ifnull", "iif", "instr", "length",
  "like", "likelihood", "lower", "ltrim", "max", "min", "nullif", "printf", "quote", "random", "randomblob",
  "replace", "round", "rtrim", "sign", "soundex", "sqlite_version", "substr", "substring", "sum", "total",
  "totype", "trim", "typeof", "unhex", "unicode", "unlikely", "upper", "zeroblob",
  "date", "time", "datetime", "julianday", "unixepoch", "strftime",
  "json", "json_array", "json_array_length", "json_extract", "json_insert", "json_object", "json_patch",
  "json_quote", "json_remove", "json_replace", "json_set", "json_type", "json_valid",
];

function ruleFor(raw: DatabaseSync, sql: string, message: string): ColumnDiagnosis | undefined {
  // SQLite's own message for a double-quoted value already names the fix.
  // This is a shape of `no such column` and must be tried first, or the
  // generic column rule below would swallow its whole sentence as a name.
  const doubleQuoted = /^no such column: "((?:[^"]|"")+)" - should this be a string literal in single-quotes\?$/.exec(message);
  if (doubleQuoted) {
    const value = doubleQuoted[1]!.replace(/""/g, '"');
    const rewritten = sql.replace(`"${doubleQuoted[1]}"`, `'${value.replace(/'/g, "''")}'`);
    return {
      lines: [`double-quoted values are for identifiers in SQLite; use single quotes for '${value}'`],
      try: verifiedTry(raw, rewritten),
    };
  }

  const noSuchColumn = /^no such column: (.+)$/.exec(message);
  if (noSuchColumn) return diagnoseNoSuchColumn(raw, sql, noSuchColumn[1]!);

  const noSuchTable = /^no such table: (.+)$/.exec(message);
  if (noSuchTable) return diagnoseNoSuchTable(raw, sql, noSuchTable[1]!);

  const ambiguous = /^ambiguous column name: (.+)$/.exec(message);
  if (ambiguous) {
    const column = ambiguous[1]!;
    const knownTables = tableNames(raw);
    const named = tablesNamedIn(sql, knownTables);
    const owners = named.filter((table) => columnsOf(raw, table).some((c) => c.name.toLowerCase() === column.toLowerCase()));
    const aliases = aliasesInStatement(sql, knownTables);
    const qualifiers = owners.map((table) => [...aliases.entries()].find(([, t]) => t === table)?.[0] ?? table);
    return { lines: [`${column} is in ${owners.join(" and ")}; qualify it as ${qualifiers.map((q) => `${q}.${column}`).join(" or ")}`] };
  }

  const aggregateMisuse = /^misuse of aggregate function (.+)$/.exec(message);
  if (aggregateMisuse) {
    return { lines: [`${aggregateMisuse[1]} only works over rows already grouped; move the condition to having, or drop it from where`] };
  }

  const noSuchFunction = /^no such function: (.+)$/.exec(message);
  if (noSuchFunction) {
    const name = noSuchFunction[1]!;
    const ranked = knownFunctions
      .map((candidate) => ({ candidate, distance: levenshtein(name.toLowerCase(), candidate.toLowerCase()) }))
      .sort((a, b) => a.distance - b.distance);
    const close = ranked.filter((entry) => entry.distance <= maxEditDistance).slice(0, 3).map((entry) => entry.candidate);
    const lines = close.length > 0 ? [`did you mean ${close.join(", ")}?`] : [`sqlite has no function named ${name}; core, date, and json functions are documented at sqlite.org`];
    const attempt = close.length === 1 ? verifiedTry(raw, replaceToken(sql, name, close[0]!) ?? "") : undefined;
    return { lines, try: attempt };
  }

  const unrecognizedToken = /^unrecognized token: "(.+)"$/.exec(message);
  if (unrecognizedToken && unrecognizedToken[1] === ":" && /::\s*[A-Za-z_]\w*/.test(sql)) {
    const cast = /(\S+)\s*::\s*([A-Za-z_]\w*)/.exec(sql);
    const rewritten = cast === null ? undefined : sql.replace(cast[0], `cast(${cast[1]} as ${cast[2]})`);
    return {
      lines: ["SQLite has no :: cast operator; use cast(expr as type)"],
      try: rewritten === undefined ? undefined : verifiedTry(raw, rewritten),
    };
  }

  if (message === "incomplete input") {
    const last = /(\S+)\s*;?\s*$/.exec(sql)?.[1];
    return { lines: [`the statement ends inside a clause${last === undefined ? "" : ` after "${last}"`}; finish or remove that clause`] };
  }

  const nearSyntaxError = /^near "(.*?)": syntax error$/.exec(message);
  if (nearSyntaxError) return diagnoseSyntaxError(raw, sql, nearSyntaxError[1]!);

  return undefined;
}

const sqliteKeywords = new Set(["order", "group", "select", "where", "from", "table", "index", "limit", "offset", "join", "on", "as", "and", "or", "not", "null", "primary", "key", "check", "default", "references"]);

function diagnoseSyntaxError(raw: DatabaseSync, sql: string, near: string): ColumnDiagnosis {
  const offset = sql.indexOf(near);
  const lines = [`syntax error near "${near}"`];
  if (offset !== -1) {
    // The caret goes under the rejected token on that token's own line, so a
    // multi-line statement still points at the right place.
    const start = sql.lastIndexOf("\n", offset - 1) + 1;
    const end = sql.indexOf("\n", offset);
    lines.push(sql.slice(start, end === -1 ? undefined : end), `${" ".repeat(offset - start)}${"^".repeat(near.length || 1)}`);
  }
  const lowerNear = near.toLowerCase();
  // A trailing comma makes SQLite reject the next keyword, which then looks
  // like a reserved-word problem, so the comma is checked first.
  const trailingComma = /,(\s*)(from|where|group|order|limit)\b/i.exec(sql);
  if (trailingComma && trailingComma[2]!.toLowerCase() === lowerNear) {
    lines.push(`remove the trailing comma before ${near}`);
    return { lines, try: verifiedTry(raw, sql.replace(trailingComma[0], `${trailingComma[1]}${trailingComma[2]}`)) };
  }
  if (/^ilike$/i.test(near)) {
    const rewritten = sql.replace(/ilike/i, "like");
    lines.push("SQLite's like already ignores ASCII case; use like");
    return { lines, try: verifiedTry(raw, rewritten) };
  }
  if (sqliteKeywords.has(lowerNear)) {
    lines.push(`${near} is a reserved word here; quote it as "${near}" to use it as a name`);
    const rewritten = replaceToken(sql, near, `"${near}"`);
    return { lines, try: rewritten === undefined ? undefined : verifiedTry(raw, rewritten) };
  }
  return { lines };
}

// -------------------------------------------------------------------------
// Entry point for a prepare failure
// -------------------------------------------------------------------------

// Always returns a hint: a matched rule's lines, or the columns of whatever
// tables the statement names, so an error this module does not have a rule
// for still leaves an agent with the schema instead of nothing.
export function diagnosePrepareError(raw: DatabaseSync, sql: string, message: string): string {
  const rule = ruleFor(raw, sql, message);
  const lines = rule?.lines ?? fallbackLines(raw, sql);
  const tryLine = rule?.try !== undefined && rule.try !== sql ? [`try: ${rule.try}`] : [];
  // A columns line already names the columns; the generic command is only
  // for a hint that lists no table.
  const help = lines.some((line) => line.startsWith("columns of ")) ? [] : [columnsHelp];
  return [...lines, ...tryLine, ...help].map((line) => `  ${line}`).join("\n");
}

function fallbackLines(raw: DatabaseSync, sql: string): string[] {
  const named = tablesNamedIn(sql, tableNames(raw));
  return named.map((table) => columnsLine(raw, table));
}

// -------------------------------------------------------------------------
// Decision 2 (and 1a's enum and null extensions): a comparison the schema
// makes impossible to ever match, found after a successful prepare.
// -------------------------------------------------------------------------

// Heuristic: it reads the statement's tokens once and misses whatever it
// misses. A column it cannot resolve to exactly one table, or an operator
// it does not recognize, is left alone rather than guessed at.
export function neverMatchWarnings(raw: DatabaseSync, sql: string, tablesRead: readonly string[]): string[] {
  const tokens = tokenize(sql);
  const aliases = aliasesInStatement(sql, tablesRead);
  const columnsByTable = new Map(tablesRead.map((table) => [table, columnsOf(raw, table)]));
  const resolve = (alias: string | undefined, name: string): ColumnDef | undefined => {
    if (alias !== undefined) {
      const table = aliases.get(alias.toLowerCase());
      if (table === undefined) return undefined;
      return columnsByTable.get(table)?.find((c) => c.name.toLowerCase() === name.toLowerCase());
    }
    const matches = tablesRead.flatMap((table) => (columnsByTable.get(table) ?? []).filter((c) => c.name.toLowerCase() === name.toLowerCase()));
    return matches.length === 1 ? matches[0] : undefined;
  };
  // A column reference at `i`: `word`, or `word . word`. Returns the token
  // index just past it, so the caller can look for an operator there. The
  // word right after a `.` is the tail of a qualified name already tried
  // from the alias one token back, not a second, bare reference of its own.
  const columnRefAt = (i: number): { column: ColumnDef | undefined; next: number } | undefined => {
    const token = tokens[i];
    if (token === undefined || token.kind !== "word" || clauseKeywords.has(token.value.toLowerCase())) return undefined;
    if (tokens[i - 1]?.kind === "punct" && tokens[i - 1]!.value === ".") return undefined;
    if (tokens[i + 1]?.kind === "punct" && tokens[i + 1]!.value === "." && tokens[i + 2]?.kind === "word") {
      return { column: resolve(token.value, tokens[i + 2]!.value), next: i + 3 };
    }
    return { column: resolve(undefined, token.value), next: i + 1 };
  };
  const messages = new Set<string>();
  const equalityOps = new Set(["=", "==", "<>", "!="]);
  for (let i = 0; i < tokens.length; i++) {
    const ref = columnRefAt(i);
    if (ref !== undefined && ref.column !== undefined) {
      const op = tokens[ref.next];
      if (op?.kind === "op" && equalityOps.has(op.value)) {
        const next = tokens[ref.next + 1];
        if (next?.kind === "string") addLiteralWarning(messages, ref.column, [next.value]);
        if (next?.kind === "word" && next.value.toLowerCase() === "null") addNullWarning(messages, ref.column, op.value);
      }
      if (op?.kind === "word" && op.value.toLowerCase() === "in" && tokens[ref.next + 1]?.value === "(") {
        const literals = literalsInParens(tokens, ref.next + 2);
        if (literals !== undefined) addLiteralWarning(messages, ref.column, literals);
      }
      if (op?.kind === "word" && op.value.toLowerCase() === "is") {
        const notIndex = tokens[ref.next + 1]?.value.toLowerCase() === "not" ? ref.next + 1 : ref.next;
        const isNot = notIndex !== ref.next;
        if (tokens[notIndex + 1]?.value.toLowerCase() === "null" && !isNot && !ref.column.nullable) {
          messages.add(`${ref.column.table}.${ref.column.name} is not null; is null never matches it`);
        }
      }
    }
    // `'text' = column` and `'text' = alias.column`.
    if (tokens[i]!.kind === "string" && tokens[i + 1]?.kind === "op" && equalityOps.has(tokens[i + 1]!.value)) {
      const reversed = columnRefAt(i + 2);
      if (reversed?.column !== undefined) addLiteralWarning(messages, reversed.column, [tokens[i]!.value]);
    }
    // `null = column` and `null <> column`.
    if (tokens[i]!.kind === "word" && tokens[i]!.value.toLowerCase() === "null" && tokens[i + 1]?.kind === "op" && equalityOps.has(tokens[i + 1]!.value)) {
      const reversed = columnRefAt(i + 2);
      if (reversed?.column !== undefined) addNullWarning(messages, reversed.column, tokens[i + 1]!.value);
    }
  }
  return [...messages];
}

// A literal list inside `in (...)`. Accepted only when every item up to the
// closing paren is a string, a number, or a comma: the first bare word (a
// column, a function, `select`) means this is not a value list, and the
// scan backs out rather than misreading a subquery as one.
function literalsInParens(tokens: readonly Token[], start: number): string[] | undefined {
  const literals: string[] = [];
  let depth = 0;
  for (let j = start; j < tokens.length; j++) {
    const token = tokens[j]!;
    if (token.kind === "punct" && token.value === "(") { depth += 1; continue; }
    if (token.kind === "punct" && token.value === ")") { if (depth === 0) return literals; depth -= 1; continue; }
    if (token.kind === "punct" && token.value === ",") continue;
    if (token.kind === "string") { literals.push(token.value); continue; }
    if (token.kind === "op" && /^-?$/.test(token.value)) continue;
    if (/^-?\d+(\.\d+)?$/.test(token.value)) continue;
    return undefined;
  }
  return literals;
}

const numberPattern = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

function isNumericText(text: string): boolean {
  return numberPattern.test(text.trim());
}

function addLiteralWarning(messages: Set<string>, column: ColumnDef, literals: readonly string[]): void {
  if (column.enumValues !== undefined) {
    const allowed = new Set(column.enumValues.map((v) => v.toLowerCase()));
    const bad = literals.filter((text) => !allowed.has(text.toLowerCase()));
    if (bad.length === 0) return;
    const allowedText = column.enumValues.map((v) => quoteEnumValue(column, v)).join(", ");
    messages.add(`${column.table}.${column.name} only takes ${allowedText}; ${bad.map((text) => `'${text}'`).join(", ")} can never equal it`);
    return;
  }
  if (column.type !== "integer" && column.type !== "real") return;
  const bad = literals.filter((text) => !isNumericText(text));
  if (bad.length === 0) return;
  messages.add(`${column.table}.${column.name} is ${column.type}; ${bad.map((text) => `'${text}'`).join(", ")} can never equal it`);
}

// `= null`/`== null` and `<> null`/`!= null` are always unknown in SQL,
// regardless of the column's declared nullability; `is [not] null` is the fix.
function addNullWarning(messages: Set<string>, column: ColumnDef, op: string): void {
  const fix = op === "<>" || op === "!=" ? "is not null" : "is null";
  messages.add(`${column.table}.${column.name} ${op} null is always unknown; try: ${column.name} ${fix}`);
}
