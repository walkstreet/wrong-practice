import type { AnswerItem } from "../types";

const TASK_BODY_RE = /Task\s*1\b|complete the tasks|根据短文内容完成任务/i;
const TASK2_RE = /(?:^|\n)\s*Task\s*2\b|Write a short continuation|续写|读后续写/i;

export function looksLikeTaskReading(stem?: string | null): boolean {
  return TASK_BODY_RE.test(stem || "") || TASK2_RE.test(stem || "");
}

const NUMBERED_RE = /(?:^|\n)\s*(?:\(?\s*)(\d{1,2})\s*[.．、:：)）]\s+\S/g;

function numberedItems(text: string): number[] {
  const nums: number[] = [];
  const re = new RegExp(NUMBERED_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text || ""))) {
    nums.push(Number(match[1]));
  }
  return nums;
}

function taskBody(stem: string): string {
  const match = TASK_BODY_RE.exec(stem || "");
  return match ? (stem || "").slice(match.index) : stem || "";
}

function filledAnswerCount(answers?: AnswerItem[]): number {
  return (answers || []).filter((item) => {
    if (item == null) return false;
    if (typeof item === "string") return Boolean(item.trim());
    return item.some((part) => part.trim());
  }).length;
}

export function inferTaskSlotKinds(
  stem: string,
  answers?: AnswerItem[],
  typeName?: string | null,
): Array<"short" | "writing"> {
  const body = taskBody(stem || "");
  const task2 = TASK2_RE.exec(body);
  const before = task2 ? body.slice(0, task2.index) : body;
  const after = task2 ? body.slice(task2.index) : "";
  const beforeNums = numberedItems(before);
  const afterNums = numberedItems(after);
  const hasWriting = Boolean(task2) || (typeName || "").includes("任务型");
  const shortFromStem = beforeNums.length ? Math.max(...beforeNums) : 0;
  const writingFromStem = afterNums.length ? new Set(afterNums).size : hasWriting && shortFromStem ? 1 : 0;
  const stemCount = shortFromStem + writingFromStem;
  const slotCount = Math.max(stemCount, filledAnswerCount(answers), answers?.length || 0, 1);
  if (!hasWriting) return Array.from({ length: slotCount }, () => "short");
  if (shortFromStem && shortFromStem < slotCount) {
    return [...Array.from({ length: shortFromStem }, () => "short" as const), ...Array.from({ length: slotCount - shortFromStem }, () => "writing" as const)];
  }
  if (writingFromStem) {
    const shortCount = Math.max(slotCount - writingFromStem, 0);
    return [...Array.from({ length: shortCount }, () => "short" as const), ...Array.from({ length: slotCount - shortCount }, () => "writing" as const)];
  }
  if (slotCount > 1) {
    return [...Array.from({ length: slotCount - 1 }, () => "short" as const), "writing"];
  }
  return ["writing"];
}
