// The terminal browser keeps one selection and its latest observation.
// Catalog inspection and CLI execution live in separate modules so navigation
// cannot start providers. Every execution requires an explicit run action.
import { createElement as h, useEffect, useRef, useState } from "react";
import { Box, Text, measureElement, useApp, useInput, usePaste, useStdout, type DOMElement } from "ink";
import { stripVTControlCharacters } from "node:util";
import { scrollbar, scrollbarTarget, type Scrollbar } from "./scrollbar.ts";
import { horizontalLimit, horizontalText } from "./horizontal.ts";
import { parseMouse, enableMouse, disableMouse, type MouseEvent } from "./mouse.ts";
import type { Item, ProviderToggle } from "./catalog.ts";
import { observe, type Inputs, type Observation } from "./execute.ts";
import { sectionLines } from "./sections.ts";

type View = "Definition" | "Results";
const views: View[] = ["Definition", "Results"];
export const safeText = (value: unknown): string => stripVTControlCharacters(value === null ? "NULL" : String(value ?? "")).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
const lineText = (value: unknown): string => safeText(value).replace(/[\n\r\t]/g, " ");

export function Browser({ items, initial, execute = observe, mouse = true, providers, onToggleProvider, notice = "" }: {
  items: Item[];
  initial: Inputs;
  execute?: typeof observe;
  mouse?: boolean;
  providers?: readonly ProviderToggle[];
  onToggleProvider?: (name: string, enabled: boolean) => void;
  notice?: string;
}) {
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
  const [kind, setKind] = useState<Item["kind"] | "provider">("query");
  const [providerRows, setProviderRows] = useState(() => providers ? [...providers] : []);
  const [providerIndex, setProviderIndex] = useState(0);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<{ kind: "search" } | { kind: "field"; name: string; remaining: string[]; runAfter: boolean; changed: boolean } | null>(null);
  const [draft, setDraft] = useState("");
  const [selected, setSelected] = useState(0);
  const [listOffset, setListOffset] = useState(0);
  const [resultOffset, setResultOffset] = useState(0);
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
  const [error, setError] = useState(notice);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { controller.current?.abort(); }, []);
  const listingProviders = kind === "provider";
  // A query stays visible when its provider is off so the toggle has something to reveal.
  // Dimmed text is the hint that help omits it.
  function entryShown(entry: Item): boolean {
    if (providerRows.length === 0) return entry.enabled !== false;
    if (!entry.requires || entry.requires.length === 0) return entry.enabled !== false;
    const on = new Set(providerRows.filter((row) => row.enabled).map((row) => row.name));
    return entry.requires.every((name) => on.has(name));
  }
  const filtered = listingProviders ? [] : items.filter((item) => item.kind === kind && `${item.name} ${item.description} ${item.purpose ?? ""} ${item.group ?? ""} ${item.source}`.toLowerCase().includes(search.toLowerCase()));
  const listCount = listingProviders ? providerRows.length : filtered.length;
  const item = filtered[Math.min(selected, Math.max(0, filtered.length - 1))];
  const observation = result !== null && result.item === item ? result.observation : undefined;
  const reportOrder = item?.sections?.map(([name]) => name) ?? [];
  // Results for a report scroll the definition's sections. They do not invent a layout.
  const reportLines = item?.kind === "report" && observation?.sections ? sectionLines(reportOrder, observation.sections) : undefined;
  const textResults = reportLines !== undefined && view === "Results";
  const related = item ? items.filter((candidate) => candidate.kind !== item.kind && (item.kind === "table" ? candidate.tables.includes(item.name) : item.tables.includes(candidate.name))) : [];
  const bodyHeight = Math.max(3, size.height - 9);
  const compactResults = view === "Results" && size.height < 20;
  const sourceHeight = view === "Results" ? Math.min(4, Math.max(2, Math.floor((bodyHeight - 5) / 3))) : 0;
  const detailHeight = bodyHeight - 2 - (compactResults ? 1 : 3) - sourceHeight;
  const pageSize = Math.max(1, detailHeight - 1);
  const listPageSize = Math.max(1, bodyHeight - 2);
  // Content changes during scrolling must not resize either pane.
  const leftWidth = Math.max(20, Math.min(34, Math.floor(size.width * 0.29)));
  const rightWidth = Math.max(15, size.width - leftWidth - 5);

  function select(next: number | ((previous: number) => number)) {
    const index = Math.max(0, Math.min(typeof next === "function" ? next(selected) : next, filtered.length - 1));
    setSelected(index);
    setListOffset((start) => index < start ? index : index >= start + listPageSize ? index - listPageSize + 1 : start);
    setView("Definition"); setSourcesFocused(false); setSourceOffset(0); setSourceColumn(0);
    setOffset(0); setResultOffset(0); setTextColumn(0); setColumn(0); setExpanded(false); setDetailOffset(0); setError("");
  }
  function changeView(next: View) { setView(next); setSourcesFocused(false); setTextColumn(0); setOffset(0); setResultOffset(0); setExpanded(false); setDetailOffset(0); }
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

  function toggleProvider(index: number) {
    const row = providerRows[index];
    if (!row) return;
    const enabled = !row.enabled;
    try { onToggleProvider?.(row.name, enabled); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); return; }
    setProviderRows((rows) => rows.map((item) => item.name === row.name ? { ...item, enabled } : item));
    setError("");
  }
  function switchCatalog(next: Item["kind"] | "provider") {
    if (next === kind) return;
    setKind(next); setSearch(""); setListOffset(0); select(0); changeView("Definition"); setFocus("list");
  }
  function follow(target: Item) {
    setKind(target.kind); setSearch(""); setSelected(items.filter((i) => i.kind === target.kind).indexOf(target));
    setListOffset(Math.max(0, items.filter((i) => i.kind === target.kind).indexOf(target) - listPageSize + 1));
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
    else if (view === "Definition" || expanded || textResults) setTextColumn((previous) => Math.max(0, Math.min(Math.min(previous, textLimit) + direction * 4, textLimit)));
    else setColumn((previous) => Math.max(0, Math.min(Math.min(previous, columnLimit) + direction, columnLimit)));
  }
  function handleMouse(event: MouseEvent) {
    if (!mouseEnabled || pending.current || busy || editing || size.width < 60 || size.height < 16) return;
    if (event.kind === "click") {
      if (hit("context", event)) { editFields(["root", "scope", "me"], inputs, false); return; }
      if (hit("search", event)) { setEditing({ kind: "search" }); setDraft(search); return; }
      if (hit("tables", event)) { switchCatalog("table"); return; }
      if (hit("queries", event)) { switchCatalog("query"); return; }
      if (hit("reports", event)) { switchCatalog("report"); return; }
      if (hit("providers", event)) { switchCatalog("provider"); return; }
      for (const name of views) if (hit(name, event)) { changeView(name); setFocus("detail"); return; }
      if (hit("sourceLeft", event)) { setFocus("detail"); setSourcesFocused(true); scrollHorizontal(-1, true); return; }
      if (hit("sourceRight", event)) { setFocus("detail"); setSourcesFocused(true); scrollHorizontal(1, true); return; }
      if (hit("scrollLeft", event)) { setFocus("detail"); setSourcesFocused(false); scrollHorizontal(-1, false); return; }
      if (hit("scrollRight", event)) { setFocus("detail"); setSourcesFocused(false); scrollHorizontal(1, false); return; }
      for (const [name, bar] of [["listBar", listBar], ["detailBar", detailBar], ["sourceBar", sourceBar]] as const) {
        const point = hit(name, event);
        if (!point || !bar.end) continue;
        const next = scrollbarTarget(bar, point.y);
        if (name === "listBar") { setFocus("list"); setListOffset(next); }
        else { setFocus("detail"); setSourcesFocused(name === "sourceBar");
          if (name === "sourceBar") setSourceOffset(next);
          else if (expanded) setDetailOffset(next);
          else if (view === "Results") setResultOffset(next);
          else setOffset(next);
        }
        return;
      }
      const horizontal = hit("horizontalBar", event);
      if (horizontal && bottomBar.end) {
        const next = scrollbarTarget(bottomBar, horizontal.x);
        setFocus("detail");
        if (sourcesFocused) setSourceColumn(next);
        else if (view === "Definition" || expanded) setTextColumn(next);
        else setColumn(next);
        return;
      }
      if (hit("run", event)) { void run(); return; }
    }
    const list = hit("list", event);
    if (list && list.x > 0 && list.x < list.width - 1 && list.y > 0 && list.y < list.height - 1) {
      setFocus("list");
      if (event.kind === "scroll" && event.dy) setListOffset((previous) => Math.max(0, Math.min(previous + event.dy * 3, Math.max(0, listCount - listPageSize))));
      else if (event.kind === "click") {
        const index = listStart + list.y - 1;
        if (listingProviders) { if (index < providerRows.length && list.y - 1 < listPageSize) setProviderIndex(index); }
        else if (index < filtered.length && list.y - 1 < listPageSize) select(index);
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
        else if (view === "Results" && !textResults) setResultOffset((previous) => Math.max(0, Math.min(previous + event.dy * 3, Math.max(0, contentCount - pageSize))));
        else setOffset((previous) => Math.max(0, Math.min(previous + event.dy * 3, Math.max(0, contentCount - 1))));
      }
      if (event.dx) scrollHorizontal(event.dx, false);
    } else if (view === "Definition") {
      if (content.y >= pageSize) return;
      const row = definitionRows[offset + content.y];
      if (row?.target) follow(row.target);
    } else if (!expanded && !textResults && observation && content.y > 0 && content.y <= pageSize) {
      const index = resultStart + content.y - 1;
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
        if (editing.kind === "search") { setSearch(draft); setListOffset(0); select(0); setEditing(null); }
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
      const order: (Item["kind"] | "provider")[] = providers ? ["query", "report", "table", "provider"] : ["query", "report", "table"];
      switchCatalog(order[(order.indexOf(kind) + 1) % order.length]!);
      return;
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
      if (focus === "list") {
        if (listingProviders) {
          if (key.pageDown || key.pageUp) setListOffset(Math.max(0, Math.min(listStart + direction, Math.max(0, providerRows.length - listPageSize))));
          else setProviderIndex((index) => Math.max(0, Math.min(index + direction, providerRows.length - 1)));
        } else if (key.pageDown || key.pageUp) setListOffset(Math.max(0, Math.min(listStart + direction, Math.max(0, filtered.length - listPageSize))));
        else select(selected + direction);
      }
      else if (sourcesFocused) setSourceOffset(() => Math.max(0, Math.min(sourceStart + direction, Math.max(0, sourceLines.length - (sourceHeight - 1)))));
      else if (expanded) setDetailOffset((n) => Math.max(0, Math.min(n + direction, Math.max(0, contentLines.length - pageSize))));
      else if (view === "Results" && !textResults) {
        if (key.pageDown || key.pageUp) setResultOffset(Math.max(0, Math.min(resultStart + direction, Math.max(0, contentCount - pageSize))));
        else {
          const next = Math.max(0, Math.min(offset + direction, Math.max(0, contentCount - 1)));
          setOffset(next);
          setResultOffset(next < resultStart ? next : next >= resultStart + pageSize ? next - pageSize + 1 : resultStart);
        }
      } else setOffset((n) => Math.max(0, Math.min(n + direction, Math.max(0, contentCount - 1))));
      return;
    }
    if (key.return && kind === "provider") { toggleProvider(Math.min(providerIndex, Math.max(0, providerRows.length - 1))); return; }
    if (!key.return || !item) return;
    if (focus === "list") { setFocus("detail"); return; }
    if (sourcesFocused) return;
    if (view === "Definition") {
      const target = definitionRows[offset]?.target;
      if (target) follow(target);
    } else if (view === "Results" && !textResults && observation && offset < observation.rows.length) { setExpanded(!expanded); setDetailOffset(0); setTextColumn(0); }
  });

  // Preserve source lines. Horizontal scrolling exposes long lines without
  // inserting breaks into SQL identifiers or values.
  const lines = (value: string) => safeText(value).replaceAll("\t", "  ").split("\n");
  const sourceEntries = observation?.providers.flatMap((provider) => lines(`${provider.ok ? "OK" : "FAILED"} ${provider.name} | ${provider.ms} ms | ${new Date(provider.observed_at).toISOString()}${provider.error ? `\n${provider.error}` : ""}`).map((text) => ({ text, color: provider.ok ? "green" : "redBright" }))) ?? [];
  const sourceLines = !observation ? [busy ? "Waiting for sources..." : "Run to inspect sources."] : (sourceEntries.length ? sourceEntries.map((entry) => entry.text) : ["This call ran no provider."]);
  const sourceStart = Math.min(sourceOffset, Math.max(0, sourceLines.length - (sourceHeight - 1)));
  const columnWidth = Math.max(0, ...(item?.columns.map((column) => column.name.length) ?? []));
  const selectedProvider = providerRows[Math.min(providerIndex, Math.max(0, providerRows.length - 1))];
  const hiddenProviders = item?.requires?.filter((name) => providerRows.find((row) => row.name === name)?.enabled === false) ?? [];
  const definitionRows: { text: string; heading?: boolean; target?: Item }[] = listingProviders && selectedProvider ? [
    { text: "Provider", heading: true }, { text: "" },
    { text: `  ${selectedProvider.name} is ${selectedProvider.enabled ? "on" : "off"}.` },
    { text: "" },
    { text: `  ${selectedProvider.summary}` },
    { text: "" }, { text: "Lists", heading: true }, { text: "" },
    { text: "  Help omits a query while any provider it reads is off." },
    { text: "  This list keeps that query and dims it." },
    { text: "  Enter toggles the provider and writes config.json." },
    { text: "  A named query still runs, and --sql still runs." },
  ] : item?.kind === "report" ? [
    ...(item.purpose ? [{ text: "Purpose", heading: true }, { text: "" }, { text: `  ${item.purpose}` }, { text: "" }] : []),
    ...(item.group ? [{ text: `Group  ${item.group}` }, { text: "" }] : []),
    { text: "Scope", heading: true }, { text: "" },
    { text: item.defaultScope ? `  Omitting --scope uses ${item.defaultScope}.` : "  Scope follows the CLI default for this report." },
    { text: "  Scope auto in this browser omits --scope, so Run uses that default." },
    { text: "" }, { text: "Sections", heading: true }, { text: "" },
    ...(item.sections ?? []).flatMap(([name, query]) => {
      const target = items.find((entry) => entry.kind === "query" && entry.name === query);
      return [
        { text: `  ${name}  ${query}`, ...(target ? { target } : {}) },
        ...(target?.purpose ? [{ text: `    ${target.purpose}` }] : []),
      ];
    }),
    { text: "" }, { text: "Refresh", heading: true }, { text: "" },
    ...(item.refresh ? item.refresh.split(/(?<=\.)\s+/).map((text) => ({ text: `  ${text}` })) : [{ text: "  Re-run the report. Each call is a new observation." }]),
  ] : item ? [
    ...(item.purpose ? [{ text: "Purpose", heading: true }, { text: "" }, { text: `  ${item.purpose}` }, { text: "" }] : []),
    ...(item.group ? [{ text: `Group  ${item.group}` }, { text: "" }] : []),
    ...(hiddenProviders.length ? [{ text: `Hidden from help while off: ${hiddenProviders.join(", ")}` }, { text: "" }] : []),
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
  const contentLines = expanded ? rowLines : view === "Definition" ? definitionLines : textResults ? reportLines : sourceLines;
  const contentCount = view === "Definition" ? definitionLines.length
    : textResults ? reportLines.length
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
  const horizontalPosition = view === "Definition" || expanded || textResults ? textStart : columnStart;
  const horizontalEnd = view === "Definition" || expanded || textResults ? textLimit : columnLimit;
  // The bottom border hosts the bar so short terminals keep their content rows.
  const bottomEnd = sourcesFocused && view === "Results" ? sourceLimit : horizontalEnd;
  const bottomPosition = sourcesFocused && view === "Results" ? sourceTextStart : horizontalPosition;
  const bottomVisible = view === "Results" && !expanded && !sourcesFocused && !textResults ? shownColumnCount : contentWidth;
  const bottomBar = scrollbar(bottomEnd + bottomVisible, bottomVisible, bottomPosition, size.width - leftWidth - 2, bottomEnd);
  const bottomGlyphs = bottomBar.glyphs.map((glyph) => glyph === "↑" ? "←" : glyph === "↓" ? "→" : glyph === "┃" ? "━" : "─");
  const text = (value: unknown, options: Record<string, unknown> = {}) => h(Text, { wrap: "truncate-end", ...options }, lineText(value));
  const tab = (label: string, active: boolean) => text(label, {
    color: active ? "black" : undefined, backgroundColor: active ? "cyan" : undefined,
    bold: active, dimColor: !active,
  });
  const listStart = Math.min(listOffset, Math.max(0, listCount - listPageSize));
  const resultStart = Math.min(resultOffset, Math.max(0, (observation?.rows.length ?? 0) - pageSize));
  const listVisible = listPageSize;
  const listBar = scrollbar(listCount, listVisible, listStart, bodyHeight - 2, Math.max(0, listCount - listPageSize));
  const detailStart = expanded ? detailOffset : view === "Definition" || textResults ? offset : resultStart;
  const detailTotal = expanded ? contentLines.length : contentCount;
  const detailEnd = expanded ? Math.max(0, detailTotal - pageSize) : view === "Definition" || textResults ? Math.max(0, detailTotal - 1) : Math.max(0, detailTotal - pageSize);
  const detailBar = scrollbar(detailTotal, pageSize, detailStart, detailHeight, detailEnd);
  const sourceBar = scrollbar(sourceLines.length, sourceHeight - 1, sourceStart, sourceHeight - 1, Math.max(0, sourceLines.length - (sourceHeight - 1)));
  const renderBar = (name: string, bar: Scrollbar) => h(Box, { ref: region(name), flexDirection: "column", width: 1, flexShrink: 0 },
    ...bar.glyphs.map((glyph) => text(glyph, { color: glyph === "│" ? "gray" : "cyan", bold: glyph !== "│" })));
  const failed = observation?.providers.filter((provider) => !provider.ok) ?? [];
  const detail: ReturnType<typeof h>[] = [];
  if (!listingProviders && !item) {
    detail.push(text("No matches", { bold: true }));
    if (detailHeight >= 3) detail.push(text(" "), text("Press / or click Search to change the filter.", { dimColor: true }));
  }
  else if (expanded || view === "Definition" || textResults) {
    if (expanded) detail.push(text(`Row ${offset + 1} / ${observation!.rows.length}  |  Esc closes`, { bold: true }));
    const start = expanded ? detailOffset : offset;
    detail.push(...contentLines.slice(start, start + pageSize).map((line, i) => {
      const row = !expanded && view === "Definition" ? definitionRows[start + i] : undefined;
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
    const keys = observation.rows.length ? Object.keys(observation.rows[0]!) : (item?.columns ?? []).map((column) => column.name);
    const shown = keys.slice(columnStart, columnStart + shownColumnCount);
    const width = Math.max(1, Math.floor(rightWidth / Math.max(1, shown.length)));
    const gridRow = (values: unknown[], highlighted: boolean, heading = false) => h(Box, { flexDirection: "row" }, ...values.map((value) => h(Box, { width, paddingRight: 1, backgroundColor: highlighted && !heading && focus === "detail" && !sourcesFocused ? "blue" : undefined }, text(value, { color: heading ? "cyan" : highlighted && focus === "detail" && !sourcesFocused ? "whiteBright" : undefined, bold: highlighted || heading }))));
    detail.push(gridRow(shown, false, true));
    const start = resultStart;
    detail.push(...observation.rows.slice(start, start + pageSize).map((row, i) => gridRow(shown.map((key, col) => `${col === 0 ? (start + i === offset ? "> " : "  ") : ""}${lineText(row[key])}`), start + i === offset)));
  }
  const receiptTime = observation ? new Date(observation.receivedAt).toLocaleTimeString(undefined, { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";
  const shownRows = textResults && observation?.sections
    ? reportOrder.reduce((count, name) => count + (observation.sections?.[name]?.length ?? 0), 0)
    : observation?.rows.length ?? 0;
  const resultSummary = observation ? `${shownRows} rows | scope: ${observation.scope} | received ${receiptTime}` : "";
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
  const titleName = listingProviders ? selectedProvider?.name ?? "" : item?.name ?? "";
  const titleMeta = listingProviders ? (selectedProvider?.enabled ? "on" : "off") : item?.source ?? "";
  const titleDetail = listingProviders ? selectedProvider?.summary ?? "" : item?.purpose || item?.description || "";
  const focusHint = listingProviders ? "Providers · ↑↓ Select · Enter Toggle · q Quit"
    : focus === "list" ? "Catalog · ↑↓ Select · Enter Inspect · q Quit"
    : sourcesFocused ? "Sources · ↑↓ Lines · ←→ Scroll · s Rows · q Quit"
    : expanded ? "Row detail · ↑↓ Lines · ←→ Scroll · Esc Close · q Quit"
    : view === "Definition" ? "Definition · ↑↓ Lines · ←→ Scroll · Enter Follow · Esc List"
    : textResults ? "Results · ↑↓ Lines · ←→ Scroll · Esc List"
    : "Results · ↑↓ Select row · ←→ Scroll · Enter Open · Esc List";
  if (size.width < 60 || size.height < 16) return h(Box, { flexDirection: "column" }, text("spacequery ui needs at least 60 columns and 16 rows."), text("Resize the terminal, or press q to quit."));
  return h(Box, { flexDirection: "column", width: size.width, height: size.height - 1 },
    h(Box, { flexDirection: "row", height: 1, flexShrink: 0 },
      h(Box, { flexShrink: 0 }, text("spacequery   ", { bold: true })),
      h(Box, { ref: region("tables"), flexShrink: 0 }, tab(kind === "table" ? "[Tables]" : "Tables", kind === "table")), text("  "),
      h(Box, { ref: region("queries"), flexShrink: 0 }, tab(kind === "query" ? "[Queries]" : "Queries", kind === "query")), text("  "),
      h(Box, { ref: region("reports"), flexShrink: 0 }, tab(kind === "report" ? "[Reports]" : "Reports", kind === "report")),
      ...(providers ? [text("  "), h(Box, { ref: region("providers"), flexShrink: 0 }, tab(kind === "provider" ? "[Providers]" : "Providers", kind === "provider"))] : []),
      h(Box, { flexShrink: 0 }, text(`  t  m mouse:${mouseEnabled ? "on" : "off"}`, { dimColor: true })),
      text(`   scope: ${inputs.scope}${busy ? "   Loading..." : ""}`, { dimColor: !busy, color: busy ? "yellow" : undefined })),
    h(Box, { ref: region("context"), height: 1 }, text(`root: ${rootLabel}  |  me: ${inputs.me === undefined ? "auto" : inputs.me || "all"}  [c edit]`, { dimColor: true })),
    h(Box, { ref: region("search"), height: 1 }, text(`Search: ${search || "(all)"}   |   ${listCount} entries`, { color: editing?.kind === "search" ? "cyan" : undefined, dimColor: editing?.kind !== "search" })),
    h(Box, { flexDirection: "row", height: bodyHeight },
      h(Box, { flexDirection: "column", ref: region("list"), width: leftWidth, flexShrink: 0, borderStyle: "round", borderColor: focus === "list" ? "cyan" : "gray", paddingX: 1 },
        h(Box, { flexDirection: "row", height: bodyHeight - 2 },
          h(Box, { flexDirection: "column", flexGrow: 1, minWidth: 0 },
            ...(listingProviders ? providerRows.slice(listStart, listStart + listVisible).map((entry, i) => {
              const index = listStart + i;
              const active = index === Math.min(providerIndex, providerRows.length - 1);
              return h(Box, { backgroundColor: active && focus === "list" ? "blue" : undefined }, text(`${active ? ">" : " "} ${entry.name}  ${entry.enabled ? "on" : "off"}`, { bold: active, dimColor: !entry.enabled && !active, color: active ? focus === "list" ? "whiteBright" : "cyan" : undefined }));
            }) : filtered.slice(listStart, listStart + listVisible).map((entry, i) => {
              const index = listStart + i;
              const active = index === selected;
              const hidden = !entryShown(entry);
              return h(Box, { backgroundColor: active && focus === "list" ? "blue" : undefined }, text(`${active ? ">" : " "} ${entry.name}${hidden ? "  off" : ""}`, { bold: active, dimColor: hidden && !active, color: active ? focus === "list" ? "whiteBright" : "cyan" : undefined }));
            }))),
          renderBar("listBar", listBar))),
      h(Box, { flexDirection: "column", width: size.width - leftWidth, height: bodyHeight, flexShrink: 0 },
      h(Box, { flexDirection: "column", width: size.width - leftWidth, height: bodyHeight, flexShrink: 0, borderStyle: "round", borderColor: focus === "detail" ? "cyan" : "gray", paddingX: 1 },
        ...(compactResults ? [] : [h(Text, { wrap: "truncate-end" }, text(titleName, { bold: true }), text(`  ${titleMeta}`, { dimColor: true })),
          text(titleDetail, { dimColor: true })]),
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
            renderBar("sourceBar", sourceBar)))] : [])),
        ...(bottomEnd > 0 ? [h(Box, { ref: region("horizontalBar"), position: "absolute", bottom: 0, left: 1, width: size.width - leftWidth - 2, height: 1 },
          text(bottomGlyphs.join(""), { color: "cyan" }))] : []))),
    text(observation ? compactResults ? `${compactName} | ${resultSummary}` : `${shownRows} rows | scope: ${observation.scope} | ${observation.ms} ms | received ${receiptTime}` : busy ? "Fetching a fresh observation..." : "Press r or click Run to load data.", { dimColor: !busy, color: busy ? "cyan" : undefined }),
    text(error || item?.error || (failed.length ? `Incomplete: ${failed.map((p) => p.name).join(", ")} failed. Press s for source details.` : " "), { color: error || item?.error ? "redBright" : "yellow" }),
    h(Box, { height: 1, backgroundColor: editing ? "blue" : undefined }, text(editing ? prompt : "t Switch / Search Tab Focus 1-2 View r Run e Edit c Context", { bold: !!editing, color: editing ? "whiteBright" : undefined })),
    text(editing ? inputHint : busy ? "Loading · q or Ctrl+C Cancel and quit" : focusHint, { dimColor: true }));
}
