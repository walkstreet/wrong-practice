import type { DefaultOptionType } from "antd/es/select";
import type { QuestionType } from "../types";

/** 题型大类展示顺序 */
const CATEGORY_ORDER = ["听力", "选择类", "语篇阅读", "语言运用", "表达与改写", "其他"];

export function buildQuestionTypeSelectOptions(types: QuestionType[]): DefaultOptionType[] {
  const active = types.filter((t) => t.status === "active");
  const groups = new Map<string, QuestionType[]>();

  for (const item of active) {
    const category = item.category?.trim() || "其他";
    const list = groups.get(category) || [];
    list.push(item);
    groups.set(category, list);
  }

  const orderedCategories = [
    ...CATEGORY_ORDER.filter((name) => groups.has(name)),
    ...[...groups.keys()].filter((name) => !CATEGORY_ORDER.includes(name)).sort(),
  ];

  return orderedCategories.map((category) => ({
    label: category,
    options: (groups.get(category) || [])
      .slice()
      .sort((a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100) || a.id - b.id)
      .map((item) => ({
        label: item.name,
        value: item.id,
        title: item.description || item.name,
      })),
  }));
}
