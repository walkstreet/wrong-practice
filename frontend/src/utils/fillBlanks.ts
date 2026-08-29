/** Split a cloze stem into text and blank markers like ___[1]___ or ______. */
const BLANK_RE = /_{2,}\[\d+\]_{2,}|_{3,}/g;

export type StemPart = { type: "text"; value: string } | { type: "blank" };

export function splitStemBlanks(stem: string): StemPart[] {
  const parts: StemPart[] = [];
  let last = 0;
  for (const match of stem.matchAll(BLANK_RE)) {
    const start = match.index ?? 0;
    if (start > last) {
      parts.push({ type: "text", value: stem.slice(last, start) });
    }
    parts.push({ type: "blank" });
    last = start + match[0].length;
  }
  if (last < stem.length) {
    parts.push({ type: "text", value: stem.slice(last) });
  }
  return parts.length ? parts : [{ type: "text", value: stem }];
}

export function countStemBlanks(stem: string): number {
  return splitStemBlanks(stem).filter((part) => part.type === "blank").length;
}

export function slotLabel(value: unknown): string {
  if (value === null || value === undefined || value === "") return "空";
  if (Array.isArray(value)) {
    const parts = value.filter((item) => typeof item === "string" && item.trim());
    return parts.length ? parts.join(" / ") : "空";
  }
  return String(value);
}
