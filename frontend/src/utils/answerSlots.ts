import type { AnswerItem, OptionItem } from "../types";
import { isTaskReadingType } from "./questionTypes";
import { inferTaskSlotKinds, looksLikeTaskReading } from "./taskReading";

export type AnswerSlotKind = "choice" | "blank" | "short" | "writing";

export interface AnswerSlotSpec {
  kind: AnswerSlotKind;
  label: string;
  rows: number;
  placeholder: string;
}

export interface AnswerLayout {
  extra: string;
  hideOptions: boolean;
  allowAdd: boolean;
  addLabel: string;
  slots: AnswerSlotSpec[];
}

function isGroupedOptions(options?: OptionItem[] | null): options is string[][] {
  return Boolean(
    options &&
      options.length > 0 &&
      options.every((item) => Array.isArray(item) && item.length > 0),
  );
}

export function hidesOptionsField(typeName?: string | null): boolean {
  return /任务型|语法填空|短文改错|单词拼写|句型转换|完成句子|翻译|书面表达/.test(typeName || "");
}

export function hasAnswerContent(item: AnswerItem | undefined): boolean {
  if (item == null) return false;
  if (typeof item === "string") return Boolean(item.trim());
  return item.some((part) => part.trim());
}

export function slotToText(item: AnswerItem | undefined): string {
  if (item == null) return "";
  if (Array.isArray(item)) return item.join(" | ");
  return String(item);
}

export function textToSlot(text: string, kind: AnswerSlotKind): AnswerItem {
  const raw = kind === "writing" ? text.replace(/^\s+|\s+$/g, "") : text.trim();
  if (!raw) return null;
  if (kind === "writing") return raw;
  if (!raw.includes("|")) return raw;
  const parts = raw.split("|").map((part) => part.trim()).filter(Boolean);
  return parts.length > 1 ? parts : parts[0] || null;
}

function letterToOptionText(value: string, candidates: string[]): string {
  const raw = value.trim();
  const upper = raw.toUpperCase();
  for (const item of candidates) {
    const text = item.trim();
    const matched = text.match(/^([A-Za-z0-9]{1,3})[\.\):、\s]+(.+)$/);
    if (matched) {
      const token = matched[1].toUpperCase();
      const content = matched[2].trim();
      if (upper === token || raw === text || raw === content) return content;
    } else if (raw === text) {
      return text;
    }
  }
  return raw;
}

export function formatAnswerSlot(
  answer: AnswerItem | undefined,
  options?: OptionItem[] | null,
  index?: number,
): string {
  if (!hasAnswerContent(answer)) return "未填";
  const mapOne = (value: string) => {
    if (!options?.length) return value;
    if (typeof index === "number" && Array.isArray(options[index])) {
      return letterToOptionText(value, options[index] as string[]);
    }
    if (options.every((item) => typeof item === "string")) {
      return letterToOptionText(value, options as string[]);
    }
    return value;
  };
  if (typeof answer === "string") return mapOne(answer);
  return (answer || []).map(mapOne).join(" / ");
}

export function previewAnswerSummary(
  answers?: AnswerItem[] | null,
  typeName?: string | null,
): string {
  const list = answers || [];
  const filled = list.filter(hasAnswerContent);
  if (!filled.length) return "未填";
  if (isTaskReadingType(typeName) || /书面表达/.test(typeName || "")) {
    const writing = isTaskReadingType(typeName) ? "（含续写）" : "";
    return `${Math.max(list.length, filled.length)} 小题${writing}`;
  }
  if (filled.length === 1) {
    const text = formatAnswerSlot(filled[0]);
    return text.length > 42 ? `${text.slice(0, 42)}…` : text;
  }
  return filled
    .map((item, index) => {
      const text = formatAnswerSlot(item);
      const short = text.length > 16 ? `${text.slice(0, 16)}…` : text;
      return `${index + 1}. ${short}`;
    })
    .join("；");
}

export function buildAnswerLayout(params: {
  typeName?: string | null;
  stem?: string | null;
  options?: OptionItem[] | null;
  answers?: AnswerItem[] | null;
}): AnswerLayout {
  const name = params.typeName || "";
  const answers = params.answers || [];
  const options = params.options || [];

  if (isTaskReadingType(name) || looksLikeTaskReading(params.stem)) {
    const kinds = inferTaskSlotKinds(params.stem || "", answers, name);
    return {
      extra: "每问一格。同一问多种说法用 | 分隔。续写格写范文或评分要点，可换行。",
      hideOptions: true,
      allowAdd: true,
      addLabel: "添加一问",
      slots: kinds.map((kind, index) => ({
        kind,
        label: kind === "writing" ? `续写 · 第 ${index + 1} 题` : `第 ${index + 1} 题`,
        rows: kind === "writing" ? 6 : 3,
        placeholder:
          kind === "writing"
            ? "范文或评分要点，写在这一格里"
            : "根据短文作答，多种说法用 | 分隔",
      })),
    };
  }

  if (/书面表达/.test(name)) {
    return {
      extra: "填写范文或评分要点，不必和学生原文一字不差。",
      hideOptions: true,
      allowAdd: false,
      addLabel: "添加一段",
      slots: [
        {
          kind: "writing",
          label: "范文 / 要点",
          rows: 8,
          placeholder: "写作范文或评分要点",
        },
      ],
    };
  }

  if (/完形|阅读理解|七选五/.test(name)) {
    const count = isGroupedOptions(options) ? options.length : Math.max(answers.length, 1);
    return {
      extra: "每小题单独填答案，通常是 A/B/C/D。",
      hideOptions: false,
      allowAdd: !isGroupedOptions(options),
      addLabel: "添加一小题",
      slots: Array.from({ length: count }, (_, index) => ({
        kind: "choice" as const,
        label: `第 ${index + 1} 小题`,
        rows: 1,
        placeholder: "如 B",
      })),
    };
  }

  if (/单项选择/.test(name)) {
    return {
      extra: "填选项字母，或直接写选项全文。",
      hideOptions: false,
      allowAdd: false,
      addLabel: "添加一项",
      slots: [{ kind: "choice", label: "答案", rows: 1, placeholder: "如 B" }],
    };
  }

  if (/语法填空|单词拼写|短文改错/.test(name)) {
    const count = Math.max(answers.length, 1);
    return {
      extra: "一空一格。同一空可接受多种形式时用 | 分隔。",
      hideOptions: true,
      allowAdd: true,
      addLabel: "添加一空",
      slots: Array.from({ length: count }, (_, index) => ({
        kind: "blank" as const,
        label: `第 ${index + 1} 空`,
        rows: 1,
        placeholder: "如 has been | have been",
      })),
    };
  }

  if (/翻译|句型转换|完成句子/.test(name)) {
    const count = Math.max(answers.length, 1);
    return {
      extra: count > 1 ? "每句一格。" : "填写参考答案。",
      hideOptions: true,
      allowAdd: true,
      addLabel: "添加一句",
      slots: Array.from({ length: count }, (_, index) => ({
        kind: "short" as const,
        label: count > 1 ? `第 ${index + 1} 句` : "参考答案",
        rows: 3,
        placeholder: "参考答案",
      })),
    };
  }

  const grouped = isGroupedOptions(options);
  const count = grouped ? options.length : Math.max(answers.length, 1);
  return {
    extra: grouped ? "每小题单独填答案。" : "按空或按问分格填写，多种说法用 | 分隔。",
    hideOptions: false,
    allowAdd: !grouped,
    addLabel: "添加一格",
    slots: Array.from({ length: count }, (_, index) => ({
      kind: grouped ? "choice" : "short",
      label: count > 1 ? `第 ${index + 1} 格` : "答案",
      rows: grouped ? 1 : 2,
      placeholder: grouped ? "如 B" : "正确答案",
    })),
  };
}

export function answersHaveContent(answers?: AnswerItem[] | null): boolean {
  return Boolean(answers?.some(hasAnswerContent));
}

export function compactAnswers(answers: AnswerItem[]): AnswerItem[] {
  const next = answers.map((item) => {
    if (item == null) return null;
    if (typeof item === "string") return item.trim() ? item : null;
    const parts = item.map((part) => part.trim()).filter(Boolean);
    return parts.length > 1 ? parts : parts[0] || null;
  });
  while (next.length && !hasAnswerContent(next[next.length - 1])) next.pop();
  return next;
}
