import { useEffect, useMemo, useState } from "react";
import { ThunderboltOutlined } from "@ant-design/icons";
import {
  Button,
  Card,
  Checkbox,
  Descriptions,
  Drawer,
  Input,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from "antd";
import axios from "axios";
import { analyzeWrongQuestion } from "../api";
import SentenceAnalysisView from "./SentenceAnalysisView";
import SolvingAnalysisCard from "./SolvingAnalysisCard";
import type { AiAnalysis, AnswerItem, OptionItem, WrongQuestion } from "../types";
import { extractCandidateSentences } from "../utils/extractSentences";

const { Text, Paragraph } = Typography;
const { TextArea } = Input;

interface Props {
  open: boolean;
  loading: boolean;
  detail: WrongQuestion | null;
  typeMap: Map<number, string>;
  tagMap: Map<number, string>;
  onClose: () => void;
  onDetailChange?: (detail: WrongQuestion) => void;
}

function getApiErrorMessage(error: unknown): string | null {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === "string" && detail.trim()) return detail;
    if (error.response?.status === 401) return "登录已失效，请重新登录";
    if (error.response?.status === 403) return "权限不足（仅管理员可操作）";
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

export default function WrongQuestionDetailDrawer({
  open,
  loading,
  detail,
  typeMap,
  tagMap,
  onClose,
  onDetailChange,
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
      return <Text key={idx}>{option}</Text>;
    }
    return (
      <div key={idx}>
        <Text strong>{`第 ${idx + 1} 组`}</Text>
        <div>
          {option.map((item, innerIdx) => (
            <Text key={`${idx}-${innerIdx}`} style={{ display: "block" }}>
              {item}
            </Text>
          ))}
        </div>
      </div>
    );
  }

  function formatAnswer(answer: AnswerItem): string {
    if (answer === null) return "--";
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
    return `[${answer.map((v, idx) => mapWithOptions(v, idx)).join(" / ")}]`;
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

  return (
    <Drawer
      title={detail ? `错题详情 #${detail.id}` : "错题详情"}
      width={960}
      open={open}
      onClose={onClose}
      extra={
        detail ? (
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            loading={analyzing}
            onClick={handleAnalyze}
          >
            {focusCount > 0
              ? `分析所选句子（${focusCount}）`
              : hasAnalysis
                ? "重新 AI 分析"
                : "AI 分析"}
          </Button>
        ) : null
      }
    >
      {loading ? (
        <Text type="secondary">加载中...</Text>
      ) : detail ? (
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Descriptions column={2} bordered size="small">
            <Descriptions.Item label="题型">
              {typeMap.get(detail.question_type_id) || detail.question_type_id}
            </Descriptions.Item>
            <Descriptions.Item label="录入来源">{detail.ingest_source}</Descriptions.Item>
            <Descriptions.Item label="题目来源">{detail.source || "--"}</Descriptions.Item>
            <Descriptions.Item label="状态">{detail.review_status}</Descriptions.Item>
            <Descriptions.Item label="知识点" span={2}>
              <Space wrap>
                {detail.knowledge_tag_ids.map((id) => (
                  <Tag key={id}>{tagMap.get(id) || id}</Tag>
                ))}
              </Space>
            </Descriptions.Item>
          </Descriptions>

          <Card title="题干">{detail.stem}</Card>

          <Card
            title="选择要分析的句子"
            extra={
              <Text type="secondary" style={{ fontSize: 12 }}>
                最多 3 句；不选则由 AI 自动抽取
              </Text>
            }
          >
            <Paragraph type="secondary" style={{ marginTop: 0 }}>
              长文填空建议先勾选含空/考查点的句子，再点右上角分析。也可在下方粘贴自定义句子（一行一句）。
            </Paragraph>
            {candidates.length > 0 ? (
              <Checkbox.Group
                style={{ width: "100%", display: "flex", flexDirection: "column", gap: 8 }}
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
                  <Checkbox
                    key={`${index}-${sentence.slice(0, 24)}`}
                    value={sentence}
                    style={{
                      marginInlineStart: 0,
                      whiteSpace: "normal",
                      alignItems: "flex-start",
                      lineHeight: 1.6,
                    }}
                  >
                    <Text>{sentence}</Text>
                  </Checkbox>
                ))}
              </Checkbox.Group>
            ) : (
              <Text type="secondary">未能从题干自动拆句，请在下方手动粘贴。</Text>
            )}
            {candidates.length >= 30 ? (
              <Text type="secondary" style={{ display: "block", marginTop: 8 }}>
                候选句较多，仅展示前 30 句；其余请用下方自定义粘贴。
              </Text>
            ) : null}
            <div style={{ marginTop: 12 }}>
              <Text type="secondary" style={{ display: "block", marginBottom: 6 }}>
                自定义句子（可选，一行一句）
              </Text>
              <TextArea
                value={customSentences}
                onChange={(e) => setCustomSentences(e.target.value)}
                rows={3}
                placeholder={"例如：\nHe _____ to school every day.\nShe has lived here since 2010."}
              />
            </div>
          </Card>

          <Card title="选项">
            {detail.options.length === 0 ? (
              <Text type="secondary">--（本题无选项）</Text>
            ) : (
              <Space direction="vertical" style={{ width: "100%" }}>
                {detail.options.map((item, idx) => renderOptionItem(item, idx))}
              </Space>
            )}
          </Card>
          <Card title="答案信息">
            <p>正确答案：{detail.correct_answer.map(formatAnswer).join("，")}</p>
            <p>错误选项：{detail.wrong_answer.map(formatAnswer).join("，")}</p>
            <p>备注：{detail.note || "--"}</p>
          </Card>

          {analyzing ? (
            <Card title="AI 分析">
              <div style={{ textAlign: "center", padding: "24px 0" }}>
                <Spin size="large" />
                <div style={{ marginTop: 12 }}>
                  <Text type="secondary">
                    {focusCount > 0
                      ? `正在分析所选 ${focusCount} 句，请稍候…`
                      : "正在请求 AI 分析，请稍候…"}
                  </Text>
                </div>
              </div>
            </Card>
          ) : null}

          {hasAnalysis && !analyzing ? (
            <>
              <Card
                title="句子成分分析"
                extra={
                  aiAnalysis?.analyzed_at ? (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {new Date(aiAnalysis.analyzed_at).toLocaleString()}
                    </Text>
                  ) : null
                }
              >
                <SentenceAnalysisView
                  analysis={aiAnalysis.sentence_analysis}
                  analyses={aiAnalysis.sentence_analyses}
                />
              </Card>
              <Card title="做题分析">
                <SolvingAnalysisCard analysis={aiAnalysis.solving_analysis} />
              </Card>
            </>
          ) : null}
        </Space>
      ) : (
        <Text type="secondary">暂无详情</Text>
      )}
    </Drawer>
  );
}
