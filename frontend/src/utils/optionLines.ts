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
