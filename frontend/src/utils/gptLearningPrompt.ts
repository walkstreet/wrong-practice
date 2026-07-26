import type { LearningWeaknessAnalysis } from "../types";

/** 根据短板分析结果生成可粘贴到 ChatGPT / DeepSeek 的学习对话 prompt。 */
export function buildGptLearningPrompt(analysis: LearningWeaknessAnalysis): string {
  const weakLines =
    analysis.weak_areas?.length > 0
      ? analysis.weak_areas
          .map((area, i) => {
            const sev =
              area.severity === "high" ? "高" : area.severity === "low" ? "低" : "中";
            const ids = area.related_question_ids?.length
              ? `（相关错题 ID：${area.related_question_ids.join("、")}）`
              : "";
            const evidence = area.evidence ? `\n   依据：${area.evidence}` : "";
            return `${i + 1}. 【${area.name}】严重度=${sev}${ids}${evidence}`;
          })
          .join("\n")
      : "（暂无结构化短板，请根据总评自行判断）";

  const suggestions =
    analysis.gap_fill_suggestions?.length > 0
      ? analysis.gap_fill_suggestions.map((s, i) => `${i + 1}. ${s}`).join("\n")
      : "（暂无）";

  const methods =
    analysis.study_methods?.length > 0
      ? analysis.study_methods.map((s, i) => `${i + 1}. ${s}`).join("\n")
      : "（暂无）";

  const sampleStems = (analysis.source_items || [])
    .slice(0, 8)
    .map((item, i) => {
      const qid = item.wrong_question_id ?? "?";
      const err =
        typeof item.error_rate === "number"
          ? `${(Number(item.error_rate) * 100).toFixed(0)}%`
          : "--";
      const typeName = item.question_type_name || "未知题型";
      const tags = Array.isArray(item.knowledge_tag_names)
        ? (item.knowledge_tag_names as string[]).join("、") || "未标注"
        : "未标注";
      const stem = String(item.stem || "").replace(/\s+/g, " ").trim();
      const short = stem.length > 120 ? `${stem.slice(0, 120)}…` : stem;
      return `${i + 1}. #${qid} | 错误率 ${err} | ${typeName} | 知识点：${tags}\n   ${short}`;
    })
    .join("\n");

  const who = analysis.username ? `学习者「${analysis.username}」` : "该学习者";
  const scope = analysis.scope_note || "高错误率错题统计";

  return `你是一位耐心、专业的中学英语私教。请根据下面的「错题短板诊断」和我进行多轮对话，帮我把薄弱知识点真正学透，而不是只给笼统建议。

【学习者】${who}
【诊断范围】${scope}
【总评】
${analysis.overall_summary || "（无）"}

【主要短板】
${weakLines}

【已有补全建议】
${suggestions}

【已有学习方法】
${methods}

【部分高错误率题目快照】
${sampleStems || "（无快照）"}

请按以下方式带我学习（请用中文回复，例句用英文）：
1. 先确认你理解的 2～4 个最优先知识点，并问我「今天先攻哪一个」。
2. 针对我选的知识点：用「规则 → 2～3 个正例 → 1 个易错对比 → 1 道即时小测」讲解。
3. 小测后根据我的回答纠错；若我答错，拆解错因并再出 1 道变式题。
4. 每个知识点结束时，给我一张「可背诵的 5 条要点卡片」+「明天复习的 3 个关键词」。
5. 不要一次讲太多；每次只深挖一个知识点，等我回复后再继续。

现在请开始：先列出优先知识点并询问我先学哪一个。`;
}
