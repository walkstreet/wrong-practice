/** 英语错题 1–5 难度口径。与 `app/services/llm.py` 识别提示词保持一致。 */

export const DIFFICULTY_LEVELS = [
  {
    value: 1,
    name: "入门",
    summary: "一眼能做",
    criteria: "课标最常用词；单一考点；选项区分明显；几乎不需要上下文。",
    examples: "be / is / are；in / on / at 的基础时间用法。",
  },
  {
    value: 2,
    name: "基础",
    summary: "读完题干即可",
    criteria: "核心词汇或常见搭配；一个主要考点；干扰项较弱；不需深层推理。",
    examples: "一般时态对照；常见固定搭配；基础代词/冠词。",
  },
  {
    value: 3,
    name: "中等",
    summary: "要看句意或短上下文",
    criteria: "需结合句意；干扰有一定迷惑；可能含从句、非谓语入门或短完形语境。",
    examples: "时态在语境中的选择；完形局部填空；简单推理。",
  },
  {
    value: 4,
    name: "较难",
    summary: "复合考点或强干扰",
    criteria: "两个以上考点叠加，或材料较长；近义/形近干扰强；需要排除或推断。",
    examples: "语态+时态叠加；阅读细节推断；形近词辨析。",
  },
  {
    value: 5,
    name: "挑战",
    summary: "多步推理或隐蔽易错",
    criteria: "篇章主旨/态度、长难句、生僻搭配或非常隐蔽的干扰；压轴题常见。",
    examples: "阅读主旨题；续写逻辑；细微语气/态度差别。",
  },
] as const;

export const DIFFICULTY_METHOD_STEPS = [
  "先看材料长度与题型：单句选择通常低于短文完形/阅读。",
  "再看考点：单一语法或词汇为低档，复合考点上调。",
  "再看干扰：选项能否一眼排除；近义、形近、以偏概全则上调。",
  "介于两档时就低不就高，避免虚高。",
  "学生做错不能作为提高难度的理由。",
];

export const DIFFICULTY_TOOLTIP = "1 入门 · 2 基础 · 3 中等 · 4 较难 · 5 挑战。点击查看完整标准";

export const DIFFICULTY_HELP_PATH = "/help#difficulty";

export function difficultyLabel(value: number | null | undefined): string {
  if (value == null) return "未评级";
  const level = DIFFICULTY_LEVELS.find((item) => item.value === value);
  return level ? `${level.value} ${level.name}` : String(value);
}

export const DIFFICULTY_SELECT_OPTIONS = DIFFICULTY_LEVELS.map((item) => ({
  value: item.value,
  label: `${item.value} ${item.name}`,
}));
