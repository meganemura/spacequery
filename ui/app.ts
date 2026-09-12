// The terminal browser keeps one selection and its latest observation.
// Catalog inspection and CLI execution live in separate modules so navigation
// cannot start providers. Every execution requires an explicit key press.
import { createElement as h, useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import { stripVTControlCharacters } from "node:util";
import type { Item } from "./catalog.ts";
import { observe, type Inputs, type Observation } from "./execute.ts";

type View = "Definition" | "Results";
const views: View[] = ["Definition", "Results"];
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
  const [editing, setEditing] = useState<{ kind: "search" } | { kind: "field"; name: string; remaining: string[]; runAfter: boolean; changed: boolean } | null>(null);
  const [draft, setDraft] = useState("");
  const [selected, setSelected] = useState(0);
  const [focus, setFocus] = useState<"list" | "detail">("list");
  const [view, setView] = useState<View>("Definition");
  const [offset, setOffset] = useState(0);
  const [column, setColumn] = useState(0);
  const [textColumn, setTextColumn] = useState(0);
  const [sourcesFocused, setSourcesFocused] = useState(false);
  const [sourceOffset, setSourceOffset] = useState(0);
  const [sourceColumn, setSourceColumn] = useState(0);
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
  const bodyHeight = Math.max(3, size.height - 9);
  const compactResults = view === "Results" && size.height < 20;
  const sourceHeight = view === "Results" ? Math.min(4, Math.max(2, Math.floor((bodyHeight - 5) / 3))) : 0;
  const detailHeight = bodyHeight - 2 - (compactResults ? 1 : 3) - sourceHeight;
  const pageSize = Math.max(1, detailHeight - 1);
  const leftWidth = Math.max(20, Math.min(34, Math.floor(size.width * 0.29)));
  const rightWidth = Math.max(15, size.width - leftWidth - 5);

  function select(next: number) {
    setSelected(Math.max(0, Math.min(next, filtered.length - 1)));
    setView("Definition"); setSourcesFocused(false); setSourceOffset(0); setSourceColumn(0);
    setOffset(0); setTextColumn(0); setColumn(0); setExpanded(false); setDetailOffset(0); setError("");
  }
  function changeView(next: View) { setView(next); setSourcesFocused(false); setTextColumn(0); setOffset(0); setExpanded(false); setDetailOffset(0); }
  function invalidate() { setSourceOffset(0); setSourceColumn(0); setResult(null); setError(""); changeView("Definition"); }
  function editFields(names: readonly string[], values: Inputs, runAfter: boolean) {
    const [name, ...remaining] = names;
    if (name === undefined) return;
    setEditing({ kind: "field", name, remaining, runAfter, changed: false });
    setDraft(name === "root" ? values.root : name === "scope" ? (runAfter && values.scope === "auto" ? "root" : values.scope)
      : name === "me" ? values.me ?? "" : Object.hasOwn(values.params, name) ? values.params[name]! : "");
  }
  async function run(values: Inputs = inputs) {
    if (!item || pending.current) return;
    const missing = item.params.filter((p) => p !== "root" && p !== "me" && (p === "scope" ? values.scope === "auto" : !Object.hasOwn(values.params, p)));
    if (missing.length) { editFields(missing, values, true); return; }
    controller.current = new AbortController();
    setSourceOffset(0); setSourceColumn(0);
    pending.current = true; setBusy(true); setResult(null); setError(""); changeView("Results"); setFocus("detail");
    try { setResult({ item, observation: await execute(item, values, controller.current.signal) }); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { pending.current = false; setBusy(false); }
  }

  useInput((input, key) => {
    if (key.ctrl && input === "c") { controller.current?.abort(); exit(); return; }
    if (editing !== null) {
      if (key.escape) { setEditing(null); setError(""); return; }
      if (key.return) {
        if (editing.kind === "search") { setSearch(draft); select(0); setEditing(null); }
        else {
          const field = editing.name;
          if (field === "scope" && !["auto", "root", "agents", "all"].includes(draft)) {
            setError("Scope must be auto, root, agents, or all."); return;
          }
          const next: Inputs = field === "root" ? { ...inputs, root: draft || initial.root }
            : field === "scope" ? { ...inputs, scope: draft as Inputs["scope"] }
            : field === "me" ? { ...inputs, me: editing.changed ? draft : inputs.me }
            : { ...inputs, params: { ...inputs.params, [field]: draft } };
          setInputs(next); invalidate();
          if (editing.remaining.length) editFields(editing.remaining, next, editing.runAfter);
          else { setEditing(null); if (editing.runAfter) void run(next); }
        }
        return;
      }
      if ((key.ctrl && input === "u") || key.backspace || key.delete || (!key.ctrl && !key.meta && input.length > 0 && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow && !key.tab)) {
        if (editing.kind === "field") setEditing({ ...editing, changed: true });
      }
      if (key.ctrl && input === "u") { setDraft(""); return; }
      if (key.backspace || key.delete) setDraft((text) => Array.from(text).slice(0, -1).join(""));
      else if (!key.ctrl && !key.meta && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow && !key.tab) setDraft((text) => text + lineText(input));
      return;
    }
    if (input === "q") { controller.current?.abort(); exit(); return; }
    if (busy) return;
    if (input === "/") { setEditing({ kind: "search" }); setDraft(search); return; }
    if (input === "t") {
      setKind(kind === "query" ? "table" : "query"); setSearch(""); select(0); changeView("Definition"); setFocus("list"); return;
    }
    if (key.tab) { setFocus(focus === "list" ? "detail" : "list"); return; }
    if (input === "r") { void run(); return; }
    if (input === "c") { editFields(["root", "scope", "me"], inputs, false); return; }
    if (input === "e" && item) { editFields(item.params, inputs, false); return; }
    if (/[1-2]/.test(input) && input.length === 1) { changeView(views[Number(input) - 1]!); setFocus("detail"); return; }
    if (input === "s" && observation) {
      if (view !== "Results") changeView("Results");
      setFocus("detail"); setSourcesFocused(view !== "Results" || !sourcesFocused);
      return;
    }
    if (key.escape) {
      if (sourcesFocused) { setSourcesFocused(false); }
      else if (expanded) { setExpanded(false); setDetailOffset(0); }
      else { setFocus("list"); }
      return;
    }
    if (key.leftArrow || key.rightArrow) {
      if (focus === "detail" && sourcesFocused) {
        const longest = Math.max(0, ...sourceLines.map((line) => Array.from(line).length));
        setSourceColumn((n) => Math.max(0, Math.min(n + (key.rightArrow ? 4 : -4), Math.max(0, longest - 1))));
      } else if (focus === "detail" && (view === "Definition" || expanded)) {
        const longest = contentLines.reduce((width, line) => Math.max(width, Array.from(line).length), 0);
        setTextColumn((n) => Math.max(0, Math.min(n + (key.rightArrow ? 4 : -4), Math.max(0, longest - 1))));
      } else if (view === "Results" && focus === "detail" && !expanded) setColumn((n) => Math.max(0, Math.min(n + (key.rightArrow ? 1 : -1), Math.max(0, (observation ? Object.keys(observation.rows[0] ?? {}).length : item?.columns.length ?? 0) - 1))));
      return;
    }
    const scrollPage = focus === "detail" && sourcesFocused ? sourceHeight - 1 : pageSize;
    const direction = key.downArrow || input === "j" ? 1 : key.upArrow || input === "k" ? -1 : key.pageDown ? scrollPage : key.pageUp ? -scrollPage : 0;
    if (direction) {
      if (focus === "list") select(selected + direction);
      else if (sourcesFocused) setSourceOffset(() => Math.max(0, Math.min(sourceStart + direction, Math.max(0, sourceLines.length - (sourceHeight - 1)))));
      else if (expanded) setDetailOffset((n) => Math.max(0, Math.min(n + direction, Math.max(0, contentLines.length - pageSize))));
      else setOffset((n) => Math.max(0, Math.min(n + direction, Math.max(0, contentCount - 1))));
      return;
    }
    if (!key.return || !item) return;
    if (focus === "list") { setFocus("detail"); return; }
    if (sourcesFocused) return;
    if (view === "Definition") {
      const target = definitionRows[offset]?.target;
      if (target) {
        setKind(target.kind); setSearch(""); setSelected(items.filter((i) => i.kind === target.kind).indexOf(target));
        setOffset(0); setTextColumn(0); setColumn(0); setExpanded(false); setError(""); changeView("Definition");
      }
    } else if (view === "Results" && observation && offset < observation.rows.length) { setExpanded(!expanded); setDetailOffset(0); setTextColumn(0); }
  });

  // Preserve source lines. Horizontal scrolling exposes long lines without
  // inserting breaks into SQL identifiers or values.
  const lines = (value: string) => safeText(value).replaceAll("\t", "  ").split("\n");
  const sourceLines = !observation ? [busy ? "Waiting for sources..." : "Run to inspect sources."] : (observation.providers.length
    ? observation.providers.flatMap((provider) => lines(`${provider.ok ? "OK" : "FAILED"} ${provider.name} | ${provider.ms} ms | ${new Date(provider.observed_at).toISOString()}${provider.error ? `\n${provider.error}` : ""}`))
    : ["This call ran no provider."]);
  const sourceStart = Math.min(sourceOffset, Math.max(0, sourceLines.length - (sourceHeight - 1)));
  const columnWidth = Math.max(0, ...(item?.columns.map((column) => column.name.length) ?? []));
  const definitionRows: { text: string; heading?: boolean; target?: Item }[] = item ? [
    { text: "SQL", heading: true }, { text: "" },
    ...lines(item.sql.trim()).map((text) => ({ text: `  ${text}` })),
    { text: "" }, { text: "Columns", heading: true }, { text: "" },
    ...item.columns.map((column) => ({ text: `  ${column.name.padEnd(columnWidth)}  ${column.type}${item.kind === "table" ? `${column.nullable ? "?" : ""}${column.key ? "  KEY" : ""}` : ""}` })),
    { text: "" },
    { text: item.kind === "table" ? "Queries using this table" : "Tables used by this query", heading: true },
    { text: "" },
    ...(related.length ? related.map((entry) => ({ text: `  ${entry.name}`, target: entry })) : [{ text: "  (none)" }]),
  ] : [];
  const definitionLines = definitionRows.map((row) => row.text);
  const rowLines = expanded && observation ? Object.entries(observation.rows[offset] ?? {}).flatMap(([name, value]) =>
    lines(`${name}: ${value === null ? "NULL" : typeof value === "object" ? JSON.stringify(value) : String(value)}`)) : [];
  const contentLines = expanded ? rowLines : view === "Definition" ? definitionLines : sourceLines;
  const contentCount = view === "Definition" ? definitionLines.length
    : observation ? observation.rows.length : 0;
  const text = (value: unknown, options: Record<string, unknown> = {}) => h(Text, { wrap: "truncate-end", ...options }, lineText(value));
  const tab = (label: string, active: boolean) => text(label, {
    color: active ? "black" : undefined, backgroundColor: active ? "cyan" : undefined,
    bold: active, dimColor: !active,
  });
  const listStart = Math.floor(selected / pageSize) * pageSize;
  const failed = observation?.providers.filter((provider) => !provider.ok) ?? [];
  const detail: ReturnType<typeof h>[] = [];
  if (!item) detail.push(text("No matches. Press / to change the search."));
  else if (expanded || view === "Definition") {
    if (expanded) detail.push(text(`Row ${offset + 1} / ${observation!.rows.length}  |  Esc closes`, { bold: true }));
    const start = expanded ? detailOffset : offset;
    detail.push(...contentLines.slice(start, start + pageSize).map((line, i) => {
      const row = !expanded ? definitionRows[start + i] : undefined;
      const link = row?.target !== undefined;
      const value = Array.from(line).slice(textColumn).join("");
      return text(link && i === 0 ? `> ${value.trimStart()}` : value || " ", { color: row?.heading ? "cyan" : link ? "blueBright" : undefined, bold: row?.heading || (link && i === 0) });
    }));
  } else if (!observation) {
    detail.push(text(busy ? "Fetching rows..." : "No result yet. Press r to run.", { color: "yellow" }));
  } else if (!observation.rows.length) {
    detail.push(text(failed.length ? "Unknown: a source failed." : "0 rows in this scope."));
  } else {
    const keys = observation.rows.length ? Object.keys(observation.rows[0]!) : item.columns.map((c) => c.name);
    const shown = keys.slice(column, column + Math.max(1, Math.floor(rightWidth / 20)));
    const width = Math.max(1, Math.floor(rightWidth / Math.max(1, shown.length)));
    const gridRow = (values: unknown[], highlighted: boolean) => h(Box, { flexDirection: "row" }, ...values.map((value) => h(Box, { width, paddingRight: 1 }, text(value, { color: highlighted ? "cyan" : undefined, bold: highlighted }))));
    detail.push(gridRow(shown, true));
    const start = Math.floor(offset / pageSize) * pageSize;
    detail.push(...observation.rows.slice(start, start + pageSize).map((row, i) => gridRow(shown.map((key, col) => `${col === 0 ? (start + i === offset ? "> " : "  ") : ""}${lineText(row[key])}`), start + i === offset)));
  }
  if (size.width < 60 || size.height < 16) return h(Box, { flexDirection: "column" }, text("spacequery ui needs at least 60 columns and 16 rows."), text("Resize the terminal, or press q to quit."));
  return h(Box, { flexDirection: "column", width: size.width, height: size.height - 1 },
    h(Text, { wrap: "truncate-end" },
      text("spacequery   ", { bold: true }),
      tab(kind === "table" ? "[Tables]" : "Tables", kind === "table"), text("  "),
      tab(kind === "query" ? "[Queries]" : "Queries", kind === "query"),
      text("  t switch", { dimColor: true }),
      text(`   scope: ${inputs.scope}${busy ? "   Loading..." : ""}`, { dimColor: !busy, color: busy ? "yellow" : undefined })),
    text(`root: ${inputs.root}  |  me: ${inputs.me === undefined ? "auto" : inputs.me || "all"}  [c edit]`, { dimColor: true }),
    text(`Search: ${search || "(all)"}   |   ${filtered.length} entries`, { dimColor: true }),
    h(Box, { flexDirection: "row", height: bodyHeight },
      h(Box, { flexDirection: "column", width: leftWidth, borderStyle: "round", borderColor: focus === "list" ? "cyan" : "gray", paddingX: 1 },
        ...filtered.slice(listStart, listStart + pageSize + 2).map((entry, i) => text(`${listStart + i === selected ? ">" : " "} ${entry.name}`, { color: listStart + i === selected ? "cyan" : undefined }))),
      h(Box, { flexDirection: "column", flexGrow: 1, borderStyle: "round", borderColor: focus === "detail" ? "cyan" : "gray", paddingX: 1 },
        ...(compactResults ? [] : [text(`${item?.name ?? ""}  ${item?.source ?? ""}`, { bold: true }),
          text(item?.description ?? "", { dimColor: true })]),
        h(Text, { wrap: "truncate-end" }, ...views.flatMap((name, i) => [
          ...(i ? [text(" ")] : []), tab(`${i + 1}:${name === view ? `[${name}]` : name}`, name === view),
        ])),
        h(Box, { flexDirection: "column", height: detailHeight, flexShrink: 0 }, ...detail),
        ...(view === "Results" ? [h(Box, { flexDirection: "column", height: sourceHeight, flexShrink: 0 },
          text(`Sources${sourcesFocused && focus === "detail" ? " [focused]" : ""}  ${sourceStart + 1}/${sourceLines.length}  [s focus]`, { bold: true, color: sourcesFocused && focus === "detail" ? "cyan" : "gray" }),
          ...sourceLines.slice(sourceStart, sourceStart + sourceHeight - 1).map((line) => text(Array.from(line).slice(sourceColumn).join(""))))] : []))),
    text(observation ? `${observation.rows.length} rows | scope: ${observation.scope} | ${observation.ms} ms | received ${new Date(observation.receivedAt).toLocaleTimeString()}` : busy ? "Fetching a fresh observation..." : "Definition only; data loads when you press r."),
    text(error || item?.error || (failed.length ? `Incomplete: ${failed.map((p) => p.name).join(", ")} failed. Press s for source details.` : ""), { color: "yellow" }),
    text(editing !== null ? `${editing.kind === "search" ? "Search" : editing.name}: ${editing.kind === "field" && editing.name === "me" && !editing.changed && inputs.me === undefined ? "(auto)" : draft}█  (Enter next, Ctrl+U clear, Esc cancel)` : "t Switch / Search Tab Focus 1-2 View r Run e Edit c Context"),
    text("↑↓ Move ←→ Scroll Enter Open Esc Back s Sources q Quit", { dimColor: true }));
}
