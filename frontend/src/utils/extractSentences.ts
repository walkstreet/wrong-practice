/** 真实填空标记（下划线/横线空），不含纯省略号 ... */
const BLANK_MARK_RE = /_{2,}|—{2,}|–{2,}|\[_+\d*_+\]|___+/;

function isMeaningfulSentence(text: string): boolean {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return false;

  // 纯省略号 / 纯标点，不是可选分析句
  if (/^[.…·•\s]+$/.test(cleaned)) return false;
  if (/^\.{2,}$/.test(cleaned) || cleaned === "…") return false;

  const letters = cleaned.replace(/[^A-Za-z\u4e00-\u9fff]/g, "");
  const hasBlank = BLANK_MARK_RE.test(cleaned);

  // 含填空的短句保留；普通句至少有一定字母量
  if (hasBlank) return cleaned.length >= 3;
  return letters.length >= 8;
}

/**
 * 从题干中拆出可供勾选的候选句子。
 * 只按 . ! ? 。！？ 分句；数字后的句号（如 1. / 3.14）不拆。
 */
export function extractCandidateSentences(stem: string, maxCount = 30): string[] {
  // 换行先收成空格，避免「逗号后换行」被误拆成两句
  const text = stem.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return [];

  // (?<!\d)\. ：排除小数/序号里的句号；! ? 。！？ 仍正常分句
  const parts = text.split(/(?:(?<=(?<!\d)\.)|(?<=[!?。！？]))\s+/);
  const sentences: string[] = [];

  for (const part of parts) {
    const cleaned = part.replace(/\s+/g, " ").trim();
    if (!isMeaningfulSentence(cleaned)) continue;
    if (!sentences.includes(cleaned)) sentences.push(cleaned);
  }

  // 若拆不出句子，退回整段（短题干 / 无句末标点）
  if (!sentences.length && isMeaningfulSentence(text)) {
    sentences.push(text);
  }

  return sentences.slice(0, maxCount);
}
