import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ThunderboltOutlined } from "@ant-design/icons";
import { Button, Checkbox, Drawer, Input, Spin, message } from "antd";
import axios from "axios";
import { analyzeWrongQuestion } from "../api";
import SentenceAnalysisView from "./SentenceAnalysisView";
import SolvingAnalysisCard from "./SolvingAnalysisCard";
import type { AiAnalysis, AnswerItem, OptionItem, WrongQuestion } from "../types";
import { difficultyLabel } from "../utils/difficulty";
import { extractCandidateSentences } from "../utils/extractSentences";
import { ingestSourceLabel, reviewStatusLabel } from "../utils/labels";
import { listToLines } from "../utils/optionLines";

const { TextArea } = Input;

interface Props {
  open: boolean;
  loading: boolean;
  detail: WrongQuestion | null;
  typeMap: Map<number, string>;
  tagMap: Map<number, string>;
  onClose: () => void;
  onDetailChange?: (detail: WrongQuestion) => void;
  canAnalyze?: boolean;
}

function getApiErrorMessage(error: unknown): string | null {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === "string" && detail.trim()) return detail;
    if (error.response?.status === 401) return "登录已失效，请重新登录";
    if (error.response?.status === 403) return "权限不足";
    if (error.response?.status === 503) return "未配置 DeepSeek API Key，请在 .env 中设置 DEEPSEEK_API_KEY";
  }
  return null;
}

function buildAiAnalysisFromResponse(
  result: Awaited<ReturnType<typeof analyzeWrongQuestion>>,
): AiAnalysis {
  const analyses =
    result.sentence_analyses && result.sentence_analyses.length > 0
      ? result.sentence_analyses
      : [result.sentence_analysis];
  return {
    sentence_analysis: analyses[0],
    sentence_analyses: analyses,
    solving_analysis: result.solving_analysis,
    analyzed_at: result.analyzed_at,
    model: result.model,
  };
}

function parseCustomSentences(raw: string): string[] {
  return raw
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function formatDateTime(value?: string | null): string {
  if (!value) return "未填";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未填";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`entry-view-field${className ? ` ${className}` : ""}`}>
      <div className="entry-view-label">{label}</div>
      <div className="entry-view-value">{children}</div>
    </div>
  );
}

export default function WrongQuestionDetailDrawer({
  open,
  loading,
  detail,
  typeMap,
  tagMap,
  onClose,
  onDetailChange,
  canAnalyze = false,
}: Props) {
  const [analyzing, setAnalyzing] = useState(false);
  const [selectedSentences, setSelectedSentences] = useState<string[]>([]);
  const [customSentences, setCustomSentences] = useState("");

  const candidates = useMemo(
    () => (detail?.stem ? extractCandidateSentences(detail.stem) : []),
    [detail?.stem],
  );

  useEffect(() => {
    if (!open) return;
    setSelectedSentences([]);
    setCustomSentences("");
  }, [open, detail?.id]);

  function renderOptionItem(option: OptionItem, idx: number) {
    if (typeof option === "string") {
      return (
        <div key={idx} className="entry-view-option">
          {option}
        </div>
      );
    }
    return (
      <div key={idx} className="entry-view-option-group">
        <div className="entry-view-option-kicker">第 {idx + 1} 组</div>
        {option.map((item, innerIdx) => (
          <div key={`${idx}-${innerIdx}`} className="entry-view-option">
            {item}
          </div>
        ))}
      </div>
    );
  }

  function formatAnswer(answer: AnswerItem): string {
    if (answer === null) return "未填";
    const toReal = (value: string, candidatesOpts: string[]) => {
      const raw = value.trim();
      const upper = raw.toUpperCase();
      for (const item of candidatesOpts) {
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
    };
    const mapWithOptions = (value: string, idx?: number) => {
      if (!detail?.options?.length) return value;
      if (typeof idx === "number" && Array.isArray(detail.options[idx])) {
        return toReal(value, detail.options[idx] as string[]);
      }
      if (detail.options.every((opt) => typeof opt === "string")) {
        return toReal(value, detail.options as string[]);
      }
      return value;
    };
    if (typeof answer === "string") return mapWithOptions(answer);
    return answer.map((v, idx) => mapWithOptions(v, idx)).join(" / ");
  }

  function collectFocusSentences(): string[] {
    const custom = parseCustomSentences(customSentences);
    const merged: string[] = [];
    for (const sentence of [...selectedSentences, ...custom]) {
      if (!merged.includes(sentence)) merged.push(sentence);
    }
    return merged.slice(0, 3);
  }

  async function handleAnalyze() {
    if (!detail) return;
    const focus = collectFocusSentences();
    if (focus.length > 3) {
      message.warning("最多分析 3 句，已自动取前 3 句");
    }
    setAnalyzing(true);
    try {
      const result = await analyzeWrongQuestion(detail.id, focus.length ? focus : undefined);
      const aiAnalysis = buildAiAnalysisFromResponse(result);
      const updated: WrongQuestion = {
        ...detail,
        ai_analysis: aiAnalysis,
        ai_analyzed_at: result.analyzed_at,
        ai_model: result.model,
      };
      onDetailChange?.(updated);
      message.success(focus.length ? `已按所选 ${focus.length} 句完成分析` : "AI 分析完成（自动抽句）");
    } catch (error) {
      message.error(getApiErrorMessage(error) || "AI 分析失败，请稍后重试");
    } finally {
      setAnalyzing(false);
    }
  }

  const aiAnalysis = detail?.ai_analysis ?? null;
  const hasAnalysis = !!aiAnalysis;
  const focusCount = collectFocusSentences().length;
  const analyzeLabel =
    focusCount > 0 ? `分析所选句子（${focusCount}）` : hasAnalysis ? "重新 AI 分析" : "AI 分析";

  return (
    <Drawer
      className="entry-drawer"
      title={detail ? `查看 #${detail.id}` : "查看"}
      size={880}
      open={open}
      onClose={onClose}
      styles={{ body: { padding: 0 } }}
    >
      <div className="entry-drawer-panel">
        <div className="entry-body">
          {loading ? (
            <div className="entry-empty">加载中…</div>
          ) : detail ? (
            <>
              <Field label="题干" className="is-stem">
                {detail.stem}
              </Field>
              <div className="entry-view-row">
                <Field label="题型">{typeMap.get(detail.question_type_id) || "未填"}</Field>
                <Field label="知识点">
                  {detail.knowledge_tag_ids.length ? (
                    <span className="list-tags">
                      {detail.knowledge_tag_ids.map((id) => (
                        <span key={id} className="list-chip">
                          {tagMap.get(id) || id}
                        </span>
                      ))}
                    </span>
                  ) : (
                    "未填"
                  )}
                </Field>
              </div>
              <Field label="选项">
                {detail.options.length === 0 ? (
                  <span className="entry-view-muted">本题无选项</span>
                ) : detail.options.every((item) => typeof item === "string") ? (
                  <pre className="entry-view-pre">{listToLines(detail.options)}</pre>
                ) : (
                  <div className="entry-view-options">{detail.options.map(renderOptionItem)}</div>
                )}
              </Field>
              <div className="entry-view-row">
                <Field label="正确答案">
                  {detail.correct_answer.length
                    ? detail.correct_answer.map(formatAnswer).join("，")
                    : "未填"}
                </Field>
                <Field label="学生错答">
                  {detail.wrong_answer.length ? detail.wrong_answer.map(formatAnswer).join("，") : "未填"}
                </Field>
              </div>

              <div className="entry-view-more">更多信息</div>
              <div className="entry-view-row is-3">
                <Field label="复习状态">
                  <span className={`list-status is-${detail.review_status}`}>
                    {reviewStatusLabel(detail.review_status)}
                  </span>
                </Field>
                <Field label="难度">{difficultyLabel(detail.difficulty)}</Field>
                <Field label="做错时间">{formatDateTime(detail.wrong_at)}</Field>
              </div>
              <div className="entry-view-row is-3">
                <Field label="题目来源">{detail.source || "未填"}</Field>
                <Field label="录入来源">{ingestSourceLabel(detail.ingest_source)}</Field>
                <Field label="录入人">{detail.created_by_username || "未归属"}</Field>
              </div>
              <Field label="备注">{detail.note || "未填"}</Field>

              {canAnalyze ? (
                <article className="entry-qcard entry-view-card">
                  <div className="entry-qcard-head">
                    <span className="entry-qcard-title">选择要分析的句子</span>
                    <span className="entry-view-muted">最多 3 句；不选则由 AI 自动抽取</span>
                  </div>
                  <p className="entry-hint">
                    长文填空建议先勾选含空/考查点的句子。也可在下方粘贴自定义句子（一行一句）。
                  </p>
                  {candidates.length > 0 ? (
                    <Checkbox.Group
                      className="entry-view-sentences"
                      value={selectedSentences}
                      onChange={(values) => {
                        const next = values.map(String);
                        if (next.length > 3) {
                          message.warning("最多选择 3 句");
                          setSelectedSentences(next.slice(0, 3));
                          return;
                        }
                        setSelectedSentences(next);
                      }}
                    >
                      {candidates.map((sentence, index) => (
                        <Checkbox key={`${index}-${sentence.slice(0, 24)}`} value={sentence}>
                          {sentence}
                        </Checkbox>
                      ))}
                    </Checkbox.Group>
                  ) : (
                    <p className="entry-view-muted">未能从题干自动拆句，请在下方手动粘贴。</p>
                  )}
                  {candidates.length >= 30 ? (
                    <p className="entry-view-muted">候选句较多，仅展示前 30 句；其余请用下方自定义粘贴。</p>
                  ) : null}
                  <div className="entry-view-custom">
                    <div className="entry-view-label">自定义句子（可选，一行一句）</div>
                    <TextArea
                      value={customSentences}
                      onChange={(e) => setCustomSentences(e.target.value)}
                      rows={3}
                      placeholder={"例如：\nHe _____ to school every day.\nShe has lived here since 2010."}
                    />
                  </div>
                </article>
              ) : null}

              {analyzing ? (
                <article className="entry-qcard entry-view-card">
                  <div className="entry-qcard-head">
                    <span className="entry-qcard-title">AI 分析</span>
                  </div>
                  <div className="entry-empty">
                    <Spin />
                    <div>
                      {focusCount > 0
                        ? `正在分析所选 ${focusCount} 句，请稍候…`
                        : "正在请求 AI 分析，请稍候…"}
                    </div>
                  </div>
                </article>
              ) : null}

              {hasAnalysis && !analyzing ? (
                <>
                  <article className="entry-qcard entry-view-card">
                    <div className="entry-qcard-head">
                      <span className="entry-qcard-title">句子成分分析</span>
                      {aiAnalysis?.analyzed_at ? (
                        <span className="entry-view-muted">{formatDateTime(aiAnalysis.analyzed_at)}</span>
                      ) : null}
                    </div>
                    <SentenceAnalysisView
                      analysis={aiAnalysis.sentence_analysis}
                      analyses={aiAnalysis.sentence_analyses}
                    />
                  </article>
                  <article className="entry-qcard entry-view-card">
                    <div className="entry-qcard-head">
                      <span className="entry-qcard-title">做题分析</span>
                    </div>
                    <SolvingAnalysisCard analysis={aiAnalysis.solving_analysis} />
                  </article>
                </>
              ) : null}
            </>
          ) : (
            <div className="entry-empty">暂无详情</div>
          )}
        </div>
        {detail && canAnalyze ? (
          <div className="entry-bar">
            <div className="entry-bar-meta">分析题目结构和错因，不改题目本身。</div>
            <div className="entry-bar-actions">
              <Button type="primary" icon={<ThunderboltOutlined />} loading={analyzing} onClick={handleAnalyze}>
                {analyzeLabel}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </Drawer>
  );
}
