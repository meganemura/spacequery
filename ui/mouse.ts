// Decode SGR mouse reports after Ink separates terminal input sequences.
// Layout hit testing and browser actions belong to the caller.
export type MouseEvent = { x: number; y: number; kind: "click" | "scroll"; dx: number; dy: number };

export function parseMouse(input: string): MouseEvent | undefined {
  const match = /^\[<(\d{1,3});(\d{1,6});(\d{1,6})M$/.exec(input);
  if (!match) return;
  const button = Number(match[1]);
  const x = Number(match[2]) - 1;
  const y = Number(match[3]) - 1;
  if (x < 0 || y < 0) return;
  // Ignore modifier clicks, motion, releases, and extra buttons.
  if (button === 0) return { x, y, kind: "click", dx: 0, dy: 0 };
  if (button >= 64 && button <= 67) return { x, y, kind: "scroll", dx: button >= 66 ? (button === 66 ? -1 : 1) : 0, dy: button < 66 ? (button === 64 ? -1 : 1) : 0 };
}

export const enableMouse = "\x1b[?1000h\x1b[?1006h";
export const disableMouse = "\x1b[?1000l\x1b[?1006l";
