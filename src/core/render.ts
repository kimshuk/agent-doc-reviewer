export function lineCount(text: string): number {
  return text.split("\n").length;
}
export function renderLineNumbered(text: string): string {
  const lines = text.split("\n");
  const width = Math.max(3, String(lines.length).length);
  return lines.map((l, i) => `L${String(i + 1).padStart(width, "0")} | ${l}`).join("\n");
}
