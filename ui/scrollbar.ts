// Describe a vertical scrollbar and map its clicks to viewport positions.
// The browser owns selection, scrolling, and terminal rendering.
export type Scrollbar = { glyphs: string[]; start: number; end: number };

export function scrollbar(total: number, visible: number, start: number, height: number, end: number): Scrollbar {
  const position = Math.max(0, Math.min(start, end));
  const glyphs = Array<string>(Math.max(0, height)).fill(" ");
  if (total <= visible && position === 0) return { glyphs, start: position, end: 0 };
  if (height === 1) glyphs[0] = position === 0 ? "↓" : position >= end ? "↑" : "↕";
  else if (height > 1) {
    glyphs[0] = position > 0 ? "↑" : " ";
    glyphs[height - 1] = position < end ? "↓" : " ";
    const track = height - 2;
    const thumb = Math.min(track, Math.max(1, Math.round(track * Math.min(visible, total) / Math.max(1, total))));
    const top = end ? Math.round(position / end * (track - thumb)) : 0;
    for (let i = 0; i < track; i++) glyphs[i + 1] = i >= top && i < top + thumb ? "┃" : "│";
  }
  return { glyphs, start: position, end };
}

export function scrollbarTarget(bar: Scrollbar, row: number): number {
  const height = bar.glyphs.length;
  if (height === 1) return bar.start >= bar.end ? 0 : bar.end;
  if (row === 0) return Math.max(0, bar.start - 1);
  if (row === height - 1) return Math.min(bar.end, bar.start + 1);
  return Math.round((row - 1) / Math.max(1, height - 3) * bar.end);
}
