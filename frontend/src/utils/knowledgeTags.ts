import type { DefaultOptionType } from "antd/es/select";
import type { KnowledgeTag } from "../types";

/** 知识点一级大类展示顺序（与 seed 体系对齐） */
const ROOT_ORDER = ["语法", "词汇", "构词法", "完形填空", "阅读理解", "写作", "听力", "翻译"];

function buildTagPath(tag: KnowledgeTag, byId: Map<number, KnowledgeTag>): string[] {
  const parts = [tag.name];
  let current: KnowledgeTag | undefined = tag;
  const guard = new Set<number>([tag.id]);
  while (current?.parent_id != null) {
    if (guard.has(current.parent_id)) break;
    const parent = byId.get(current.parent_id);
    if (!parent) break;
    parts.unshift(parent.name);
    guard.add(parent.id);
    current = parent;
  }
  return parts;
}

export function getKnowledgeTagPathLabel(tag: KnowledgeTag, tags: KnowledgeTag[]): string {
  const byId = new Map(tags.map((item) => [item.id, item]));
  return buildTagPath(tag, byId).join(" / ");
}

export function buildKnowledgeTagSelectOptions(
  tags: KnowledgeTag[],
  options?: { includeInactive?: boolean },
): DefaultOptionType[] {
  const includeInactive = options?.includeInactive === true;
  const visible = tags.filter((tag) => includeInactive || tag.status === "active");
  const byId = new Map(visible.map((item) => [item.id, item]));

  const groups = new Map<string, { tag: KnowledgeTag; path: string[]; label: string }[]>();
  for (const tag of visible) {
    const path = buildTagPath(tag, byId);
    const root = path[0] || "其他";
    const label = path.length <= 1 ? tag.name : path.slice(1).join(" / ");
    const list = groups.get(root) || [];
    list.push({ tag, path, label });
    groups.set(root, list);
  }

  const orderedRoots = [
    ...ROOT_ORDER.filter((name) => groups.has(name)),
    ...[...groups.keys()].filter((name) => !ROOT_ORDER.includes(name)).sort(),
  ];

  return orderedRoots.map((root) => {
    const items = (groups.get(root) || []).slice().sort((a, b) => {
      const pathA = a.path.join("\0");
      const pathB = b.path.join("\0");
      return pathA.localeCompare(pathB, "zh-CN") || a.tag.id - b.tag.id;
    });
    return {
      label: root,
      options: items.map((item) => ({
        label: item.label,
        value: item.tag.id,
        title: item.path.join(" / "),
      })),
    };
  });
}

export function buildKnowledgeTagNameMap(tags: KnowledgeTag[]): Map<number, string> {
  const byId = new Map(tags.map((item) => [item.id, item]));
  return new Map(
    tags.map((tag) => [tag.id, buildTagPath(tag, byId).join(" / ")]),
  );
}
