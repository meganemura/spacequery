// Text for one report's sections, in the order the definition gives.
// The browser scrolls these lines. It does not choose a different set of sections.
// Boundary: formatting rows the CLI already returned.
export function sectionLines(
  order: readonly string[],
  sections: Readonly<Record<string, readonly Record<string, unknown>[] | undefined>>,
): string[] {
  const lines: string[] = [];
  for (const name of order) {
    if (lines.length > 0) lines.push("");
    lines.push(`# ${name}`);
    const rows = sections[name] ?? [];
    if (rows.length === 0) {
      lines.push("(empty)");
      continue;
    }
    const keys = Object.keys(rows[0]!);
    lines.push(keys.join("  "));
    for (const row of rows) {
      lines.push(keys.map((key) => {
        const value = row[key];
        return value === null || value === undefined ? "" : String(value).replace(/[\t\n\r]/g, " ");
      }).join("  "));
    }
  }
  return lines;
}
