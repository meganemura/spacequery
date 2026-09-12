// Compute horizontal text bounds in terminal cells without splitting graphemes.
// Ambiguous-width characters use one cell, as in the browser's default layout.
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const segments = (text: string) => Array.from(segmenter.segment(text), ({ segment }) => segment);

function scalarCells(code: number): number {
  return code >= 0x1100 && (code <= 0x115f || code === 0x2329 || code === 0x232a
    || (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f)
    || (code >= 0xac00 && code <= 0xd7a3) || (code >= 0xf900 && code <= 0xfaff)
    || (code >= 0xfe10 && code <= 0xfe19) || (code >= 0xfe30 && code <= 0xfe6f)
    || (code >= 0xff00 && code <= 0xff60) || (code >= 0xffe0 && code <= 0xffe6)
    || (code >= 0x16fe0 && code <= 0x18d8f) || (code >= 0x1aff0 && code <= 0x1b2ff)
    || (code >= 0x1f200 && code <= 0x1f2ff) || (code >= 0x20000 && code <= 0x3fffd)) ? 2 : 1;
}

function cells(segment: string): number {
  if (/^\p{RGI_Emoji}$/v.test(segment) || /^[\d#*]\u20e3$/u.test(segment)
    || (segment.includes("\u200d") && (segment.match(/\p{Extended_Pictographic}/gu)?.length ?? 0) >= 2)) return 2;
  const visible = segment.replace(/^[\p{Nonspacing_Mark}\p{Enclosing_Mark}\p{Default_Ignorable_Code_Point}\p{Control}\p{Format}]+/u, "");
  if (!visible) return 0;
  const chars = Array.from(visible);
  let width = scalarCells(chars[0]!.codePointAt(0)!);
  // Halfwidth voiced kana keep their spacing marks in the same grapheme.
  for (const char of chars.slice(1)) {
    const code = char.codePointAt(0)!;
    if (/\p{Spacing_Mark}/u.test(char) || (code >= 0xff00 && code <= 0xffef)) width += scalarCells(code);
  }
  return width;
}

export function horizontalLimit(lines: readonly string[], width: number): number {
  let limit = 0;
  for (const line of lines) {
    const chars = segments(line);
    let used = 0;
    for (let i = chars.length - 1; i >= 0; i--) {
      used += cells(chars[i]!);
      if (used > width) { limit = Math.max(limit, i + 1); break; }
    }
  }
  return limit;
}

export const horizontalText = (line: string, offset: number): string => segments(line).slice(offset).join("");
