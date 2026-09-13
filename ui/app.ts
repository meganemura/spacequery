// The terminal browser keeps one selection and its latest observation.
// Catalog inspection and CLI execution live in separate modules so navigation
// cannot start providers. Every execution requires an explicit run action.
import { createElement as h, useEffect, useRef, useState } from "react";
import { Box, Text, measureElement, useApp, useInput, usePaste, useStdout, type DOMElement } from "ink";
import { stripVTControlCharacters } from "node:util";
import { scrollbar, scrollbarTarget, type Scrollbar } from "./scrollbar.ts";
import { horizontalLimit, horizontalText } from "./horizontal.ts";
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
  const listPageSize = Math.max(1, bodyHeight - 2);
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
  function scrollHorizontal(direction: number, sources: boolean) {
    if (sources) setSourceColumn((previous) => Math.max(0, Math.min(Math.min(previous, sourceLimit) + direction * 4, sourceLimit)));
    else if (view === "Definition" || expanded) setTextColumn((previous) => Math.max(0, Math.min(Math.min(previous, textLimit) + direction * 4, textLimit)));
    else setColumn((previous) => Math.max(0, Math.min(Math.min(previous, columnLimit) + direction, columnLimit)));
  }
  function handleMouse(event: MouseEvent) {
    if (!mouseEnabled || pending.current || busy || editing || size.width < 60 || size.height < 16) return;
    if (event.kind === "click") {
      if (hit("context", event)) { editFields(["root", "scope", "me"], inputs, false); return; }
      if (hit("search", event)) { setEditing({ kind: "search" }); setDraft(search); return; }
      if (hit("tables", event)) { switchCatalog("table"); return; }
      if (hit("queries", event)) { switchCatalog("query"); return; }
      for (const name of views) if (hit(name, event)) { changeView(name); setFocus("detail"); return; }
      if (hit("sourceLeft", event)) { setFocus("detail"); setSourcesFocused(true); scrollHorizontal(-1, true); return; }
      if (hit("sourceRight", event)) { setFocus("detail"); setSourcesFocused(true); scrollHorizontal(1, true); return; }
      if (hit("scrollLeft", event)) { setFocus("detail"); setSourcesFocused(false); scrollHorizontal(-1, false); return; }
      if (hit("scrollRight", event)) { setFocus("detail"); setSourcesFocused(false); scrollHorizontal(1, false); return; }
      for (const [name, bar] of [["listBar", listBar], ["detailBar", detailBar], ["sourceBar", sourceBar]] as const) {
        const point = hit(name, event);
        if (!point || !bar.end) continue;
        const paged = name === "listBar" || (name === "detailBar" && view === "Results" && !expanded);
        const arrow = bar.glyphs.length > 1 && (point.y === 0 || point.y === bar.glyphs.length - 1);
        const next = paged && arrow ? Math.max(0, Math.min(bar.end, bar.start + (point.y === 0 ? -(name === "listBar" ? listPageSize : pageSize) : (name === "listBar" ? listPageSize : pageSize)))) : scrollbarTarget(bar, point.y);
        if (name === "listBar") { setFocus("list"); select(next); }
        else { setFocus("detail"); setSourcesFocused(name === "sourceBar");
          if (name === "sourceBar") setSourceOffset(next);
          else if (expanded) setDetailOffset(next);
          else setOffset(next);
        }
        return;
      }
      if (hit("run", event)) { void run(); return; }
    }
    const list = hit("list", event);
    if (list && list.x > 0 && list.x < list.width - 1 && list.y > 0 && list.y < list.height - 1) {
      setFocus("list");
      if (event.kind === "scroll" && event.dy) select((previous) => previous + event.dy * 3);
      else if (event.kind === "click") {
        const index = listStart + list.y - 1;
        if (index < filtered.length && list.y - 1 < listPageSize) select(index);
      }
      return;
    }
    const sources = hit("sources", event);
    if (sources) {
      setFocus("detail"); setSourcesFocused(true);
      if (event.dy) setSourceOffset((previous) => Math.max(0, Math.min(Math.min(previous, Math.max(0, sourceLines.length - (sourceHeight - 1))) + event.dy * 3, Math.max(0, sourceLines.length - (sourceHeight - 1)))));
      if (event.dx) scrollHorizontal(event.dx, true);
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
      if (event.dx) scrollHorizontal(event.dx, false);
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
      if (focus === "detail") scrollHorizontal(key.rightArrow ? 1 : -1, sourcesFocused);
      return;
    }
    const scrollPage = focus === "list" ? listPageSize : sourcesFocused ? sourceHeight - 1 : pageSize;
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
  const sourceEntries = observation?.providers.flatMap((provider) => lines(`${provider.ok ? "OK" : "FAILED"} ${provider.name} | ${provider.ms} ms | ${new Date(provider.observed_at).toISOString()}${provider.error ? `\n${provider.error}` : ""}`).map((text) => ({ text, color: provider.ok ? "green" : "redBright" }))) ?? [];
  const sourceLines = !observation ? [busy ? "Waiting for sources..." : "Run to inspect sources."] : (sourceEntries.length ? sourceEntries.map((entry) => entry.text) : ["This call ran no provider."]);
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
  const contentWidth = Math.max(1, size.width - leftWidth - 5);
  const textLimit = horizontalLimit(contentLines, contentWidth);
  const sourceLimit = horizontalLimit(sourceLines, contentWidth);
  const resultKeys = Object.keys(observation?.rows[0] ?? {});
  const shownColumnCount = Math.max(1, Math.floor(rightWidth / 20));
  const columnLimit = Math.max(0, resultKeys.length - shownColumnCount);
  const textStart = Math.min(textColumn, textLimit);
  const sourceTextStart = Math.min(sourceColumn, sourceLimit);
  const columnStart = Math.min(column, columnLimit);
  const horizontalPosition = view === "Definition" || expanded ? textStart : columnStart;
  const horizontalEnd = view === "Definition" || expanded ? textLimit : columnLimit;
  const text = (value: unknown, options: Record<string, unknown> = {}) => h(Text, { wrap: "truncate-end", ...options }, lineText(value));
  const tab = (label: string, active: boolean) => text(label, {
    color: active ? "black" : undefined, backgroundColor: active ? "cyan" : undefined,
    bold: active, dimColor: !active,
  });
  const listStart = Math.floor(selected / listPageSize) * listPageSize;
  const listVisible = listPageSize;
  const listBar = scrollbar(filtered.length, listVisible, listStart, bodyHeight - 2, Math.floor(Math.max(0, filtered.length - 1) / listPageSize) * listPageSize);
  const detailStart = expanded ? detailOffset : view === "Definition" ? offset : Math.floor(offset / pageSize) * pageSize;
  const detailTotal = expanded ? contentLines.length : contentCount;
  const detailEnd = expanded ? Math.max(0, detailTotal - pageSize) : view === "Definition" ? Math.max(0, detailTotal - 1) : Math.floor(Math.max(0, detailTotal - 1) / pageSize) * pageSize;
  const detailBar = scrollbar(detailTotal, pageSize, detailStart, detailHeight, detailEnd);
  const sourceBar = scrollbar(sourceLines.length, sourceHeight - 1, sourceStart, sourceHeight - 1, Math.max(0, sourceLines.length - (sourceHeight - 1)));
  const renderBar = (name: string, bar: Scrollbar) => h(Box, { ref: region(name), flexDirection: "column", width: 1, flexShrink: 0 },
    ...bar.glyphs.map((glyph) => text(glyph, { color: glyph === "│" ? "gray" : "cyan", bold: glyph !== "│" })));
  const failed = observation?.providers.filter((provider) => !provider.ok) ?? [];
  const detail: ReturnType<typeof h>[] = [];
  if (!item) {
    detail.push(text("No matches", { bold: true }));
    if (detailHeight >= 3) detail.push(text(" "), text("Press / or click Search to change the filter.", { dimColor: true }));
  }
  else if (expanded || view === "Definition") {
    if (expanded) detail.push(text(`Row ${offset + 1} / ${observation!.rows.length}  |  Esc closes`, { bold: true }));
    const start = expanded ? detailOffset : offset;
    detail.push(...contentLines.slice(start, start + pageSize).map((line, i) => {
      const row = !expanded ? definitionRows[start + i] : undefined;
      const link = row?.target !== undefined;
      const value = horizontalText(line, textStart);
      return text(link && i === 0 && textStart === 0 ? `> ${value.trimStart()}` : value || " ", { color: row?.heading ? "cyan" : link ? "blueBright" : undefined, bold: row?.heading || (link && i === 0) });
    }));
  } else if (!observation) {
    detail.push(text(busy ? "Fetching rows..." : error && !editing ? "Execution failed" : "No result yet. Press r to run.", { bold: true, color: busy ? "cyan" : error && !editing ? "redBright" : undefined }));
    if (detailHeight >= 3) detail.push(text(" "), text(busy ? "Reading a fresh snapshot of the selected scope." : error ? "Check the error below; press r to retry." : "Review Definition, then press r or click Run.", { dimColor: true }));
  } else if (!observation.rows.length) {
    detail.push(text(failed.length ? "Unknown: a source failed." : "0 rows in this scope.", { bold: true, color: failed.length ? "yellow" : undefined }));
    if (detailHeight >= 3) detail.push(text(" "), text(failed.length ? "Inspect Sources before interpreting this result." : "Press c to review the scope, or e to edit parameters.", { dimColor: true }));
  } else {
    const keys = observation.rows.length ? Object.keys(observation.rows[0]!) : item.columns.map((c) => c.name);
    const shown = keys.slice(columnStart, columnStart + shownColumnCount);
    const width = Math.max(1, Math.floor(rightWidth / Math.max(1, shown.length)));
    const gridRow = (values: unknown[], highlighted: boolean, heading = false) => h(Box, { flexDirection: "row" }, ...values.map((value) => h(Box, { width, paddingRight: 1, backgroundColor: highlighted && !heading && focus === "detail" && !sourcesFocused ? "blue" : undefined }, text(value, { color: heading ? "cyan" : highlighted && focus === "detail" && !sourcesFocused ? "whiteBright" : undefined, bold: highlighted || heading }))));
    detail.push(gridRow(shown, false, true));
    const start = Math.floor(offset / pageSize) * pageSize;
    detail.push(...observation.rows.slice(start, start + pageSize).map((row, i) => gridRow(shown.map((key, col) => `${col === 0 ? (start + i === offset ? "> " : "  ") : ""}${lineText(row[key])}`), start + i === offset)));
  }
  const receiptTime = observation ? new Date(observation.receivedAt).toLocaleTimeString(undefined, { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";
  const resultSummary = observation ? `${observation.rows.length} rows | scope: ${observation.scope} | received ${receiptTime}` : "";
  const compactNameWidth = Math.max(1, size.width - resultSummary.length - 3);
  const compactName = item && item.name.length > compactNameWidth ? `${item.name.slice(0, compactNameWidth - 1)}…` : item?.name ?? "";
  const rawFieldLabel = editing?.kind === "search" ? "Search" : lineText(editing?.name ?? "");
  const labelLimit = Math.max(8, Math.floor(size.width / 3));
  const fieldLabel = Array.from(rawFieldLabel).length > labelLimit ? `${Array.from(rawFieldLabel).slice(0, labelLimit - 1).join("")}…` : rawFieldLabel;
  const rootStart = horizontalLimit([inputs.root], Math.max(1, size.width - 34));
  const rootLabel = `${rootStart ? "…" : ""}${horizontalText(inputs.root, rootStart)}`;
  const fieldValue = editing?.kind === "field" && editing.name === "me" && !editing.changed && inputs.me === undefined ? "(auto)" : draft;
  const inputStart = horizontalLimit([`${fieldValue}█`], Math.max(1, size.width - fieldLabel.length - 4));
  const prompt = `${fieldLabel}: ${inputStart ? "…" : ""}${horizontalText(fieldValue, inputStart)}█`;
  const inputHint = editing?.kind === "search" ? "Enter Apply filter · Ctrl+U Clear · Esc Cancel"
    : `Enter ${editing?.kind === "field" && !editing.remaining.length ? editing.runAfter ? "Run query" : "Save" : "Next"} · Ctrl+U Clear · Esc Cancel${editing?.kind === "field" && editing.remaining.length ? ` · ${editing.remaining.length} remaining` : ""}`;
  const focusHint = focus === "list" ? "Catalog · ↑↓ Select · Enter Inspect · q Quit"
    : sourcesFocused ? "Sources · ↑↓ Lines · ←→ Scroll · s Rows · q Quit"
    : expanded ? "Row detail · ↑↓ Lines · ←→ Scroll · Esc Close · q Quit"
    : view === "Definition" ? "Definition · ↑↓ Lines · ←→ Scroll · Enter Follow · Esc List"
    : "Results · ↑↓ Select row · ←→ Scroll · Enter Open · Esc List";
  if (size.width < 60 || size.height < 16) return h(Box, { flexDirection: "column" }, text("spacequery ui needs at least 60 columns and 16 rows."), text("Resize the terminal, or press q to quit."));
  return h(Box, { flexDirection: "column", width: size.width, height: size.height - 1 },
    h(Box, { flexDirection: "row", height: 1, flexShrink: 0 },
      h(Box, { flexShrink: 0 }, text("spacequery   ", { bold: true })),
      h(Box, { ref: region("tables"), flexShrink: 0 }, tab(kind === "table" ? "[Tables]" : "Tables", kind === "table")), text("  "),
      h(Box, { ref: region("queries"), flexShrink: 0 }, tab(kind === "query" ? "[Queries]" : "Queries", kind === "query")),
      h(Box, { flexShrink: 0 }, text(`  t  m mouse:${mouseEnabled ? "on" : "off"}`, { dimColor: true })),
      text(`   scope: ${inputs.scope}${busy ? "   Loading..." : ""}`, { dimColor: !busy, color: busy ? "yellow" : undefined })),
    h(Box, { ref: region("context"), height: 1 }, text(`root: ${rootLabel}  |  me: ${inputs.me === undefined ? "auto" : inputs.me || "all"}  [c edit]`, { dimColor: true })),
    h(Box, { ref: region("search"), height: 1 }, text(`Search: ${search || "(all)"}   |   ${filtered.length} entries`, { color: editing?.kind === "search" ? "cyan" : undefined, dimColor: editing?.kind !== "search" })),
    h(Box, { flexDirection: "row", height: bodyHeight },
      h(Box, { flexDirection: "column", ref: region("list"), width: leftWidth, borderStyle: "round", borderColor: focus === "list" ? "cyan" : "gray", paddingX: 1 },
        h(Box, { flexDirection: "row", height: bodyHeight - 2 },
          h(Box, { flexDirection: "column", flexGrow: 1, minWidth: 0 },
            ...filtered.slice(listStart, listStart + listVisible).map((entry, i) => h(Box, { backgroundColor: listStart + i === selected && focus === "list" ? "blue" : undefined }, text(`${listStart + i === selected ? ">" : " "} ${entry.name}`, { bold: listStart + i === selected, color: listStart + i === selected ? focus === "list" ? "whiteBright" : "cyan" : undefined })))),
          renderBar("listBar", listBar))),
      h(Box, { flexDirection: "column", flexGrow: 1, borderStyle: "round", borderColor: focus === "detail" ? "cyan" : "gray", paddingX: 1 },
        ...(compactResults ? [] : [h(Text, { wrap: "truncate-end" }, text(item?.name ?? "", { bold: true }), text(`  ${item?.source ?? ""}`, { dimColor: true })),
          text(item?.description ?? "", { dimColor: true })]),
        h(Box, { flexDirection: "row", height: 1, flexShrink: 0 }, ...views.flatMap((name, i) => [
          ...(i ? [text(" ")] : []), h(Box, { ref: region(name), flexShrink: 0 }, tab(`${i + 1}:${name === view ? `[${name}]` : name}`, name === view)),
        ]), text("  "), h(Box, { ref: region("run"), flexShrink: 0 }, text(busy ? "[Wait]" : "[r Run]", { color: busy ? "cyan" : "green", bold: true, dimColor: busy })),
          h(Box, { flexGrow: 1, justifyContent: "flex-end" },
            ...(horizontalPosition > 0 ? [h(Box, { ref: region("scrollLeft"), flexShrink: 0 }, text("←", { color: "yellow", bold: true }))] : []),
            ...(horizontalPosition < horizontalEnd ? [h(Box, { ref: region("scrollRight"), flexShrink: 0 }, text("→", { color: "yellow", bold: true }))] : []))),
        h(Box, { flexDirection: "row", ref: region("content"), height: detailHeight, flexShrink: 0 },
          h(Box, { flexDirection: "column", flexGrow: 1, minWidth: 0 }, ...detail), renderBar("detailBar", detailBar)),
        ...(view === "Results" ? [h(Box, { flexDirection: "column", ref: region("sources"), height: sourceHeight, flexShrink: 0 },
          h(Box, { flexDirection: "row", height: 1, flexShrink: 0 },
            text(`Sources${sourcesFocused && focus === "detail" ? " [focused]" : ""}  ${sourceStart + 1}/${sourceLines.length}  [s focus]`, { bold: true, color: sourcesFocused && focus === "detail" ? "cyan" : "gray" }),
            h(Box, { flexGrow: 1, justifyContent: "flex-end", flexShrink: 0 },
              ...(sourceTextStart > 0 ? [h(Box, { ref: region("sourceLeft"), flexShrink: 0 }, text("←", { bold: true, color: "yellow" }))] : []),
              ...(sourceTextStart < sourceLimit ? [h(Box, { ref: region("sourceRight"), flexShrink: 0 }, text("→", { bold: true, color: "yellow" }))] : []))),
          h(Box, { flexDirection: "row", height: sourceHeight - 1 },
            h(Box, { flexDirection: "column", flexGrow: 1, minWidth: 0 },
              ...sourceLines.slice(sourceStart, sourceStart + sourceHeight - 1).map((line, i) => text(horizontalText(line, sourceTextStart) || " ", { color: sourceEntries[sourceStart + i]?.color }))),
            renderBar("sourceBar", sourceBar)))] : []))),
    text(observation ? compactResults ? `${compactName} | ${resultSummary}` : `${observation.rows.length} rows | scope: ${observation.scope} | ${observation.ms} ms | received ${receiptTime}` : busy ? "Fetching a fresh observation..." : "Press r or click Run to load data.", { dimColor: !busy, color: busy ? "cyan" : undefined }),
    text(error || item?.error || (failed.length ? `Incomplete: ${failed.map((p) => p.name).join(", ")} failed. Press s for source details.` : " "), { color: error || item?.error ? "redBright" : "yellow" }),
    h(Box, { height: 1, backgroundColor: editing ? "blue" : undefined }, text(editing ? prompt : "t Switch / Search Tab Focus 1-2 View r Run e Edit c Context", { bold: !!editing, color: editing ? "whiteBright" : undefined })),
    text(editing ? inputHint : busy ? "Loading · q or Ctrl+C Cancel and quit" : focusHint, { dimColor: true }));
}
