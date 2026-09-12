// The terminal browser keeps one selection and its latest observation.
// Catalog inspection and CLI execution live in separate modules so navigation
// cannot start providers. Every execution requires an explicit key press.
import { createElement as h, useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import { stripVTControlCharacters } from "node:util";
import type { Item } from "./catalog.ts";
import { observe, type Inputs, type Observation } from "./execute.ts";

type View = "Results" | "SQL" | "Inputs" | "Related" | "Providers";
const views: View[] = ["Results", "SQL", "Inputs", "Related", "Providers"];
export const safeText = (value: unknown): string => stripVTControlCharacters(value === null ? "NULL" : String(value ?? "")).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
const lineText = (value: unknown): string => safeText(value).replace(/[\n\r\t]/g, " ");

export function Browser({ items, initial, execute = observe }: { items: Item[]; initial: Inputs; execute?: typeof observe }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [size, setSize] = useState({ width: stdout.columns || 100, height: stdout.rows || 30 });
  useEffect(() => {
    const resize = () => setSize({ width: stdout.columns || 100, height: stdout.rows || 30 });
    stdout.on("resize", resize);
    return () => { stdout.off("resize", resize); };
  }, [stdout]);
  const [kind, setKind] = useState<Item["kind"]>("query");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<{ kind: "search" } | { kind: "field"; name: string } | null>(null);
  const [draft, setDraft] = useState("");
  const [selected, setSelected] = useState(0);
  const [focus, setFocus] = useState<"list" | "detail">("list");
  const [view, setView] = useState<View>("Results");
  const [offset, setOffset] = useState(0);
  const [column, setColumn] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [detailOffset, setDetailOffset] = useState(0);
  const [inputs, setInputs] = useState<Inputs>(initial);
  const [result, setResult] = useState<{ item: Item; observation: Observation } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { controller.current?.abort(); }, []);
  const filtered = items.filter((item) => item.kind === kind && `${item.name} ${item.description} ${item.source}`.toLowerCase().includes(search.toLowerCase()));
  const item = filtered[Math.min(selected, Math.max(0, filtered.length - 1))];
  const observation = result !== null && result.item === item ? result.observation : undefined;
  const related = item ? items.filter((candidate) => candidate.kind !== item.kind && (item.kind === "table" ? candidate.tables.includes(item.name) : item.tables.includes(candidate.name))) : [];
  const fields = item ? ["root", "scope", "me", ...item.params.filter((p) => p !== "root" && p !== "me" && p !== "scope")] : [];
  const bodyHeight = Math.max(3, size.height - 8);
  const pageSize = Math.max(1, bodyHeight - 6);
  const leftWidth = Math.max(20, Math.min(34, Math.floor(size.width * 0.29)));
  const rightWidth = Math.max(15, size.width - leftWidth - 5);

  function select(next: number) {
    setSelected(Math.max(0, Math.min(next, filtered.length - 1)));
    setOffset(0); setColumn(0); setExpanded(false); setDetailOffset(0); setError("");
  }
  function changeView(next: View) { setView(next); setOffset(0); setExpanded(false); setDetailOffset(0); }
  function invalidate() { setResult(null); setError(""); setExpanded(false); }
  async function run() {
    if (!item || pending.current) return;
    const missing = item.params.find((p) => p !== "root" && p !== "me" && (p === "scope" ? inputs.scope === "auto" : !Object.hasOwn(inputs.params, p)));
    if (missing) { changeView("Inputs"); setFocus("detail"); setOffset(fields.indexOf(missing)); setError(`Enter ${missing}, then press r to run.`); return; }
    controller.current = new AbortController();
    pending.current = true; setBusy(true); setResult(null); setError(""); changeView("Results");
    try { setResult({ item, observation: await execute(item, inputs, controller.current.signal) }); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { pending.current = false; setBusy(false); }
  }

  useInput((input, key) => {
    if (key.ctrl && input === "c") { controller.current?.abort(); exit(); return; }
    if (editing !== null) {
      if (key.escape) { setEditing(null); return; }
      if (key.return) {
        if (editing.kind === "search") { setSearch(draft); select(0); }
        else {
          const field = editing.name;
          setInputs((previous) => field === "root" ? { ...previous, root: draft || initial.root }
            : field === "me" ? { ...previous, me: draft }
            : { ...previous, params: { ...previous.params, [field]: draft } });
          invalidate();
        }
        setEditing(null); return;
      }
      if (key.backspace || key.delete) setDraft((text) => Array.from(text).slice(0, -1).join(""));
      else if (!key.ctrl && !key.meta && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow && !key.tab) setDraft((text) => text + lineText(input));
      return;
    }
    if (input === "q") { controller.current?.abort(); exit(); return; }
    if (busy) return;
    if (input === "/") { setEditing({ kind: "search" }); setDraft(search); return; }
    if (input === "t") {
      setKind(kind === "query" ? "table" : "query"); setSearch(""); select(0); changeView("Results"); setFocus("list"); return;
    }
    if (key.tab) { setFocus(focus === "list" ? "detail" : "list"); return; }
    if (input === "r") { void run(); return; }
    if (/[1-5]/.test(input) && input.length === 1) { changeView(views[Number(input) - 1]!); setFocus("detail"); return; }
    if (key.escape) {
      if (expanded) { setExpanded(false); setDetailOffset(0); }
      else { setFocus("list"); }
      return;
    }
    if (key.leftArrow || key.rightArrow) {
      if (view === "Results" && focus === "detail" && !expanded) setColumn((n) => Math.max(0, Math.min(n + (key.rightArrow ? 1 : -1), Math.max(0, (observation ? Object.keys(observation.rows[0] ?? {}).length : item?.columns.length ?? 0) - 1))));
      return;
    }
    const direction = key.downArrow || input === "j" ? 1 : key.upArrow || input === "k" ? -1 : key.pageDown ? pageSize : key.pageUp ? -pageSize : 0;
    if (direction) {
      if (focus === "list") select(selected + direction);
      else if (expanded) setDetailOffset((n) => Math.max(0, Math.min(n + direction, Math.max(0, contentLines.length - pageSize))));
      else setOffset((n) => Math.max(0, Math.min(n + direction, Math.max(0, contentCount - 1))));
      return;
    }
    if (!key.return || !item) return;
    if (focus === "list") { setFocus("detail"); return; }
    if (view === "Related") {
      const target = related[offset];
      if (target) {
        setKind(target.kind); setSearch(""); setSelected(items.filter((i) => i.kind === target.kind).indexOf(target));
        setOffset(0); setColumn(0); setExpanded(false); setError(""); changeView("Results");
      }
    } else if (view === "Inputs") {
      const field = fields[offset];
      if (field === "scope") {
        const scopes = ["auto", "root", "agents", "all"] as const;
        setInputs((previous) => ({ ...previous, scope: scopes[(scopes.indexOf(previous.scope) + 1) % scopes.length]! })); invalidate();
      } else if (field) {
        setEditing({ kind: "field", name: field }); setDraft(field === "root" ? inputs.root : field === "me" ? inputs.me ?? "" : Object.hasOwn(inputs.params, field) ? inputs.params[field]! : "");
      }
    } else if (view === "Results" && observation?.rows.length) { setExpanded(!expanded); setDetailOffset(0); }
  });

  const contentLines: string[] = [];
  function addLines(text: string) {
    // Small chunks leave room for wide terminal glyphs, including CJK text.
    for (const line of safeText(text).split("\n")) {
      const chars = Array.from(line.replaceAll("\t", "  "));
      const width = Math.max(1, Math.floor(rightWidth / 2));
      if (!chars.length) contentLines.push("");
      for (let start = 0; start < chars.length; start += width) contentLines.push(chars.slice(start, start + width).join(""));
    }
  }
  if (expanded && observation) {
    for (const [name, value] of Object.entries(observation.rows[offset] ?? {})) addLines(`${name}: ${value === null ? "NULL" : typeof value === "object" ? JSON.stringify(value) : String(value)}`);
  } else if (view === "SQL") addLines(item?.sql.trim() ?? "");
  else if (view === "Providers") {
    if (!observation) addLines("Run with r to inspect provider status.");
    for (const provider of observation?.providers ?? []) addLines(`${provider.ok ? "OK" : "FAILED"} ${provider.name} | ${provider.ms} ms | ${new Date(provider.observed_at).toISOString()}${provider.error ? `\n${provider.error}` : ""}`);
    if (observation?.providers.length === 0) addLines("This call ran no provider.");
  }
  const contentCount = view === "Inputs" ? fields.length : view === "Related" ? related.length : view === "Results" ? observation?.rows.length ?? item?.columns.length ?? 0 : contentLines.length;
  const text = (value: unknown, options: Record<string, unknown> = {}) => h(Text, { wrap: "truncate-end", ...options }, lineText(value));
  const listStart = Math.floor(selected / pageSize) * pageSize;
  const failed = observation?.providers.filter((provider) => !provider.ok) ?? [];
  const detail: ReturnType<typeof h>[] = [];
  if (!item) detail.push(text("No matches. Press / to change the search."));
  else if (expanded || view === "SQL" || view === "Providers") {
    if (expanded) detail.push(text(`Row ${offset + 1} / ${observation!.rows.length}  |  Esc closes`, { bold: true }));
    const start = expanded ? detailOffset : offset;
    detail.push(...contentLines.slice(start, start + pageSize).map((line) => text(line)));
  } else if (view === "Related") {
    detail.push(text(item.kind === "table" ? "Queries that read this table" : "Tables read by this query", { bold: true }));
    const start = Math.floor(offset / pageSize) * pageSize;
    detail.push(...related.slice(start, start + pageSize).map((target, i) => text(`${start + i === offset ? ">" : " "} ${target.name}`, { color: start + i === offset ? "cyan" : undefined })));
    if (!related.length) detail.push(text("No related entries in this catalog."));
  } else if (view === "Inputs") {
    detail.push(text("Enter edits a value. Scope cycles on Enter.", { dimColor: true }));
    const start = Math.floor(offset / pageSize) * pageSize;
    detail.push(...fields.slice(start, start + pageSize).map((field, i) => text(`${start + i === offset ? ">" : " "} ${field}: ${field === "root" ? inputs.root : field === "scope" ? inputs.scope : field === "me" ? inputs.me === undefined ? "(auto; empty keeps all)" : inputs.me || "(all panes)" : Object.hasOwn(inputs.params, field) ? inputs.params[field] : "(required)"}`, { color: start + i === offset ? "cyan" : undefined })));
  } else if (!observation) {
    detail.push(text("Press r to fetch rows.", { color: "yellow" }));
    detail.push(text("Columns", { bold: true }));
    detail.push(...item.columns.slice(offset, offset + pageSize - 1).map((column) => text(`${column.name}  ${column.type}${item.kind === "table" ? `${column.nullable ? "?" : ""}${column.key ? "  KEY" : ""}` : ""}`)));
  } else {
    const keys = observation.rows.length ? Object.keys(observation.rows[0]!) : item.columns.map((c) => c.name);
    const shown = keys.slice(column, column + Math.max(1, Math.floor(rightWidth / 20)));
    const width = Math.max(1, Math.floor(rightWidth / Math.max(1, shown.length)));
    const gridRow = (values: unknown[], highlighted: boolean) => h(Box, { flexDirection: "row" }, ...values.map((value) => h(Box, { width, paddingRight: 1 }, text(value, { color: highlighted ? "cyan" : undefined, bold: highlighted }))));
    detail.push(gridRow(shown, true));
    const start = Math.floor(offset / pageSize) * pageSize;
    detail.push(...observation.rows.slice(start, start + pageSize).map((row, i) => gridRow(shown.map((key, col) => `${col === 0 ? (start + i === offset ? "> " : "  ") : ""}${lineText(row[key])}`), start + i === offset)));
    if (!observation.rows.length) detail.push(text(failed.length ? "Unknown: a provider failed. See Providers." : "0 rows in this scope."));
  }
  if (size.width < 60 || size.height < 16) return h(Box, { flexDirection: "column" }, text("spacequery ui needs at least 60 columns and 16 rows."), text("Resize the terminal, or press q to quit."));
  return h(Box, { flexDirection: "column", width: size.width, height: size.height - 1 },
    text(`spacequery   ${kind === "table" ? "[Tables]  Queries" : "Tables  [Queries]"}   scope: ${inputs.scope}${busy ? "   Loading..." : ""}`, { bold: true, color: "cyan" }),
    text(`Search: ${search || "(all)"}   |   ${filtered.length} entries`, { dimColor: true }),
    h(Box, { flexDirection: "row", height: bodyHeight },
      h(Box, { flexDirection: "column", width: leftWidth, borderStyle: "round", borderColor: focus === "list" ? "cyan" : "gray", paddingX: 1 },
        ...filtered.slice(listStart, listStart + pageSize + 2).map((entry, i) => text(`${listStart + i === selected ? ">" : " "} ${entry.name}`, { color: listStart + i === selected ? "cyan" : undefined }))),
      h(Box, { flexDirection: "column", flexGrow: 1, borderStyle: "round", borderColor: focus === "detail" ? "cyan" : "gray", paddingX: 1 },
        text(`${item?.name ?? ""}  ${item?.source ?? ""}`, { bold: true }),
        text(item?.description ?? "", { dimColor: true }),
        text(views.map((name, i) => `${i + 1}:${name === view ? `[${name}]` : name}`).join(" "), { color: "cyan" }),
        ...detail)),
    text(observation ? `${observation.rows.length} rows | scope: ${observation.scope} | ${observation.ms} ms | received ${new Date(observation.receivedAt).toLocaleTimeString()}` : busy ? "Fetching a fresh observation..." : "Definition only; data loads when you press r."),
    text(error || item?.error || (failed.length ? `Incomplete: ${failed.map((p) => p.name).join(", ")} failed. Press 5 for details.` : ""), { color: "yellow" }),
    text(editing !== null ? `${editing.kind === "search" ? "Search" : editing.name}: ${draft}█  (Enter saves, Esc cancels)` : "t Tables/Queries  / Search  Tab Focus  1-5 View  r Run  q Quit"),
    text("↑↓ Move  ←→ Columns  Enter Open/Edit  PgUp/PgDn Scroll  Esc Back", { dimColor: true }));
}
