// The terminal browser keeps one selection and its latest observation.
// Catalog inspection and CLI execution live in separate modules so navigation
// cannot start providers. Every execution requires an explicit run action.
import { createElement as h, useEffect, useRef, useState } from "react";
import { Box, Text, measureElement, useApp, useInput, usePaste, useStdout, type DOMElement } from "ink";
import { stripVTControlCharacters } from "node:util";
import { parseMouse, enableMouse, disableMouse, type MouseEvent } from "./mouse.ts";
import type { Item } from "./catalog.ts";
import { observe, type Inputs, type Observation } from "./execute.ts";

type View = "Definition" | "Results";
const views: View[] = ["Definition", "Results"];
export const safeText = (value: unknown): string => stripVTControlCharacters(value === null ? "NULL" : String(value ?? "")).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
const lineText = (value: unknown): string => safeText(value).replace(/[\n\r\t]/g, " ");

export function Browser({ items, initial, execute = observe, mouse = true }: { items: Item[]; initial: Inputs; execute?: typeof observe; mouse?: boolean }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [mouseEnabled, setMouseEnabled] = useState(mouse);
  const regions = useRef<Record<string, DOMElement | null>>({});
  const region = (name: string) => (element: DOMElement | null) => { regions.current[name] = element; };
  useEffect(() => {
    if (!mouseEnabled) return;
    stdout.write(enableMouse);
    const stop = () => { stdout.write(disableMouse); };
    process.once("exit", stop);
    return () => { stop(); process.off("exit", stop); };
  }, [mouseEnabled, stdout]);
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

  function select(next: number | ((previous: number) => number)) {
    setSelected((previous) => Math.max(0, Math.min(typeof next === "function" ? next(previous) : next, filtered.length - 1)));
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

  function switchCatalog(next: Item["kind"]) {
    if (next === kind) return;
    setKind(next); setSearch(""); select(0); changeView("Definition"); setFocus("list");
  }
  function follow(target: Item) {
    setKind(target.kind); setSearch(""); setSelected(items.filter((i) => i.kind === target.kind).indexOf(target));
    setColumn(0); setError(""); changeView("Definition"); setFocus("detail");
  }
  function hit(name: string, event: MouseEvent) {
    const element = regions.current[name];
    if (!element) return;
    // The alternate screen places the live layout at the terminal origin.
    const box = measureElement(element);
    if (event.x >= box.x && event.x < box.x + box.width && event.y >= box.y && event.y < box.y + box.height) return { x: event.x - box.x, y: event.y - box.y, width: box.width, height: box.height };
  }
  function handleMouse(event: MouseEvent) {
    if (!mouseEnabled || pending.current || busy || editing || size.width < 60 || size.height < 16) return;
    if (event.kind === "click") {
      if (hit("tables", event)) { switchCatalog("table"); return; }
      if (hit("queries", event)) { switchCatalog("query"); return; }
      for (const name of views) if (hit(name, event)) { changeView(name); setFocus("detail"); return; }
      if (hit("run", event)) { void run(); return; }
    }
    const list = hit("list", event);
    if (list && list.x > 0 && list.x < list.width - 1 && list.y > 0 && list.y < list.height - 1) {
      setFocus("list");
      if (event.kind === "scroll" && event.dy) select((previous) => previous + event.dy * 3);
      else if (event.kind === "click") {
        const index = listStart + list.y - 1;
        if (index < filtered.length && list.y - 1 < pageSize + 2) select(index);
      }
      return;
    }
    const sources = hit("sources", event);
    if (sources) {
      setFocus("detail"); setSourcesFocused(true);
      if (event.dy) setSourceOffset((previous) => Math.max(0, Math.min(Math.min(previous, Math.max(0, sourceLines.length - (sourceHeight - 1))) + event.dy * 3, Math.max(0, sourceLines.length - (sourceHeight - 1)))));
      if (event.dx) setSourceColumn((previous) => Math.max(0, Math.min(previous + event.dx * 4, Math.max(0, ...sourceLines.map((line) => Array.from(line).length - 1)))));
      return;
    }
    const content = hit("content", event);
    if (!content) return;
    setFocus("detail"); setSourcesFocused(false);
    if (event.kind === "scroll") {
      if (event.dy) {
        if (expanded) setDetailOffset((previous) => Math.max(0, Math.min(previous + event.dy * 3, Math.max(0, contentLines.length - pageSize))));
        else setOffset((previous) => Math.max(0, Math.min(previous + event.dy * 3, Math.max(0, contentCount - 1))));
      }
      if (event.dx) {
        if (view === "Definition" || expanded) setTextColumn((previous) => Math.max(0, Math.min(previous + event.dx * 4, Math.max(0, ...contentLines.map((line) => Array.from(line).length - 1)))));
        else setColumn((previous) => Math.max(0, Math.min(previous + event.dx, Math.max(0, Object.keys(observation?.rows[0] ?? {}).length - 1))));
      }
    } else if (view === "Definition") {
      if (content.y >= pageSize) return;
      const row = definitionRows[offset + content.y];
      if (row?.target) follow(row.target);
    } else if (!expanded && observation && content.y > 0 && content.y <= pageSize) {
      const index = Math.floor(offset / pageSize) * pageSize + content.y - 1;
      if (index < observation.rows.length) { setOffset(index); setExpanded(true); setDetailOffset(0); setTextColumn(0); }
    }
  }
  usePaste((value) => {
    if (!editing) return;
    setDraft((text) => text + lineText(value));
    if (editing.kind === "field") setEditing({ ...editing, changed: true });
  });
  useInput((input, key) => {
    if (input.startsWith("[<")) { const event = parseMouse(input); if (event) handleMouse(event); return; }
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
    if (input === "m") { setMouseEnabled(!mouseEnabled); return; }
    if (input === "/") { setEditing({ kind: "search" }); setDraft(search); return; }
    if (input === "t") {
      switchCatalog(kind === "query" ? "table" : "query"); return;
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
      if (target) follow(target);
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
    h(Box, { flexDirection: "row", height: 1, flexShrink: 0 },
      h(Box, { flexShrink: 0 }, text("spacequery   ", { bold: true })),
      h(Box, { ref: region("tables"), flexShrink: 0 }, tab(kind === "table" ? "[Tables]" : "Tables", kind === "table")), text("  "),
      h(Box, { ref: region("queries"), flexShrink: 0 }, tab(kind === "query" ? "[Queries]" : "Queries", kind === "query")),
      h(Box, { flexShrink: 0 }, text(`  t  m mouse:${mouseEnabled ? "on" : "off"}`, { dimColor: true })),
      text(`   scope: ${inputs.scope}${busy ? "   Loading..." : ""}`, { dimColor: !busy, color: busy ? "yellow" : undefined })),
    text(`root: ${inputs.root}  |  me: ${inputs.me === undefined ? "auto" : inputs.me || "all"}  [c edit]`, { dimColor: true }),
    text(`Search: ${search || "(all)"}   |   ${filtered.length} entries`, { dimColor: true }),
    h(Box, { flexDirection: "row", height: bodyHeight },
      h(Box, { flexDirection: "column", ref: region("list"), width: leftWidth, borderStyle: "round", borderColor: focus === "list" ? "cyan" : "gray", paddingX: 1 },
        ...filtered.slice(listStart, listStart + pageSize + 2).map((entry, i) => text(`${listStart + i === selected ? ">" : " "} ${entry.name}`, { color: listStart + i === selected ? "cyan" : undefined }))),
      h(Box, { flexDirection: "column", flexGrow: 1, borderStyle: "round", borderColor: focus === "detail" ? "cyan" : "gray", paddingX: 1 },
        ...(compactResults ? [] : [text(`${item?.name ?? ""}  ${item?.source ?? ""}`, { bold: true }),
          text(item?.description ?? "", { dimColor: true })]),
        h(Box, { flexDirection: "row", height: 1, flexShrink: 0 }, ...views.flatMap((name, i) => [
          ...(i ? [text(" ")] : []), h(Box, { ref: region(name), flexShrink: 0 }, tab(`${i + 1}:${name === view ? `[${name}]` : name}`, name === view)),
        ]), text("  "), h(Box, { ref: region("run"), flexShrink: 0 }, text("[r Run]", { color: "green", bold: true }))),
        h(Box, { flexDirection: "column", ref: region("content"), height: detailHeight, flexShrink: 0 }, ...detail),
        ...(view === "Results" ? [h(Box, { flexDirection: "column", ref: region("sources"), height: sourceHeight, flexShrink: 0 },
          text(`Sources${sourcesFocused && focus === "detail" ? " [focused]" : ""}  ${sourceStart + 1}/${sourceLines.length}  [s focus]`, { bold: true, color: sourcesFocused && focus === "detail" ? "cyan" : "gray" }),
          ...sourceLines.slice(sourceStart, sourceStart + sourceHeight - 1).map((line) => text(Array.from(line).slice(sourceColumn).join(""))))] : []))),
    text(observation ? `${observation.rows.length} rows | scope: ${observation.scope} | ${observation.ms} ms | received ${new Date(observation.receivedAt).toLocaleTimeString()}` : busy ? "Fetching a fresh observation..." : "Press r or click Run to load data."),
    text(error || item?.error || (failed.length ? `Incomplete: ${failed.map((p) => p.name).join(", ")} failed. Press s for source details.` : ""), { color: "yellow" }),
    text(editing !== null ? `${editing.kind === "search" ? "Search" : editing.name}: ${editing.kind === "field" && editing.name === "me" && !editing.changed && inputs.me === undefined ? "(auto)" : draft}█  (Enter next, Ctrl+U clear, Esc cancel)` : "t Switch / Search Tab Focus 1-2 View r Run e Edit c Context"),
    text("↑↓ Move ←→ Scroll Enter Open Esc Back s Sources q Quit", { dimColor: true }));
}
