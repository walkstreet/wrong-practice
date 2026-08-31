import type { AnswerItem, OptionItem } from "../types";

/** 表单多行文本 → 展示字符串（二维选项用 ` | ` 连接） */
export function listToLines(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((item) => {
      if (Array.isArray(item)) return item.join(" | ");
      if (item == null) return "";
      return String(item);
    })
    .join("\n");
}

/** 选项：每行一组；行内用 `|` 分隔多项 → 二维多组 */
export function linesToOptions(raw: string | undefined): OptionItem[] {
  if (!raw?.trim()) return [];
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      if (!line.includes("|")) return line;
      const parts = line.split("|").map((s) => s.trim()).filter(Boolean);
      return parts.length > 1 ? parts : parts[0] || line;
    });
}

/**
 * 答案：每行对应一个空位/小题。
 * 空行 → null（占位）；行内 `|` → 多可接受答案。
 */
export function linesToAnswers(raw: string | undefined): AnswerItem[] {
  if (raw == null || raw === "") return [];
  // 保留末尾空行语义较难，这里按「有内容的行 + 中间空行」处理：
  // 整段 trim 后按行拆，中间空行记为 null，首尾空行忽略
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (!lines.length) return [];

  return lines.map((line) => {
    const t = line.trim();
    if (!t) return null;
    if (!t.includes("|")) return t;
    const parts = t.split("|").map((s) => s.trim()).filter(Boolean);
    return parts.length > 1 ? parts : parts[0] || null;
  });
}

const OPTION_HEAD_RE = /^[（(]?\s*[A-Da-d]\s*[)）]?[.．、:：)）]\s*/;

function optionBody(text: string): string {
  return text.trim().replace(OPTION_HEAD_RE, "").replace(/\s+/g, " ").toLowerCase();
}

/** 识别结果里题干误带的 A/B/C/D 行从题干中去掉（选项已在 options 里）。 */
export function stripOptionsFromStem(stem: string, options: (string | string[])[]): string {
  let text = (stem || "").replace(/\r\n/g, "\n").trim();
  const flat = options
    .flatMap((item) => (Array.isArray(item) ? item : [item]))
    .map((item) => String(item).trim())
    .filter(Boolean);
  if (!text || !flat.length) return text;

  const exact = new Set(flat.map((item) => item.toLowerCase().replace(/\s+/g, " ")));
  const bodies = new Set(flat.map(optionBody).filter(Boolean));

  const isOptionLine = (line: string) => {
    const compact = line.trim().toLowerCase().replace(/\s+/g, " ");
    if (!compact) return false;
    if (exact.has(compact)) return true;
    const body = optionBody(line);
    return Boolean(body && bodies.has(body));
  };

  const lines = text.split("\n");
  while (lines.length && (!lines[lines.length - 1].trim() || isOptionLine(lines[lines.length - 1]))) {
    lines.pop();
  }
  text = lines.join("\n").trimEnd();

  const first = flat[0];
  if (first && flat.length >= 2) {
    const idx = text.toLowerCase().lastIndexOf(first.toLowerCase());
    if (idx > 0) {
      const tail = text.slice(idx).toLowerCase();
      const found = flat.filter((item) => {
        const body = optionBody(item);
        return body ? tail.includes(body) : tail.includes(item.toLowerCase());
      }).length;
      if (found >= Math.max(2, flat.length - 1)) {
        text = text.slice(0, idx).replace(/[ \t\n;；,，]+$/, "");
      }
    }
  }
  return text;
}
