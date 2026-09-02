import { CopyOutlined, EyeOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { Button, Input, Spin, Table, Tooltip, message } from "antd";
import { useEffect, useMemo, useState } from "react";

import {
  analyzeLearningWeaknesses,
  getLatestLearningWeaknessAnalysis,
  getLearningWeaknessAnalysis,
  listLearningWeaknessAnalyses,
} from "../api";
import type { LearningWeaknessAnalysis, LearningWeaknessAnalysisListItem } from "../types";
import { formatDateTimeLocal } from "../utils/datetime";
import { buildGptLearningPrompt } from "../utils/gptLearningPrompt";
import { userLabel } from "../utils/userLabel";
import WeakAreaLessonPanel from "./WeakAreaLessonPanel";

function getApiErrorDetail(error: unknown): string | null {
  if (error && typeof error === "object" && "response" in error) {
    const detail = (error as { response?: { data?: { detail?: string } } }).response?.data?.detail;
    return typeof detail === "string" ? detail : null;
  }
  return null;
}

export default function WeaknessAnalysisPanel({
  username,
  displayName,
  onUpdated,
}: {
  username: string;
  displayName?: string | null;
  onUpdated?: () => void;
}) {
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<LearningWeaknessAnalysis | null>(null);
  const [historyItems, setHistoryItems] = useState<LearningWeaknessAnalysisListItem[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [detailLoadingId, setDetailLoadingId] = useState<number | null>(null);
  const [gptPrompt, setGptPrompt] = useState("");

  const shownName = userLabel({ display_name: displayName, username });
  const generatedGptPrompt = useMemo(
    () => (result ? buildGptLearningPrompt(result, shownName) : ""),
    [result, shownName],
  );

  useEffect(() => {
    setGptPrompt(generatedGptPrompt);
  }, [generatedGptPrompt]);

  async function loadHistory(page = 1) {
    setHistoryLoading(true);
    try {
      const data = await listLearningWeaknessAnalyses({ page, page_size: 10, username });
      setHistoryItems(data.items);
      setHistoryTotal(data.total);
      setHistoryPage(page);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function loadLatest() {
    const latest = await getLatestLearningWeaknessAnalysis(username);
    setResult(latest);
  }

  useEffect(() => {
    setResult(null);
    Promise.allSettled([loadHistory(1), loadLatest()]).then(([historyResult, latestResult]) => {
      if (historyResult.status === "rejected") message.error("加载短板分析历史失败");
      if (latestResult.status === "rejected") message.error("加载短板总评失败");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  async function handleAnalyze(force: boolean) {
    setAnalyzing(true);
    try {
      if (!force) {
        await loadHistory(1).catch(() => undefined);
        const latest = await getLatestLearningWeaknessAnalysis(username);
        if (latest) {
          setResult(latest);
          message.success("已回显上次短板分析");
          return;
        }
      }
      const data = await analyzeLearningWeaknesses(50, username);
      setResult(data);
      await loadHistory(1);
      onUpdated?.();
      message.success(force ? "已重新分析并保存" : "短板分析完成，已保存");
    } catch (error) {
      message.error(getApiErrorDetail(error) || "AI 短板分析失败，请稍后重试");
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleLoadHistoryDetail(id: number) {
    setDetailLoadingId(id);
    try {
      const data = await getLearningWeaknessAnalysis(id);
      setResult(data);
    } catch {
      message.error("加载分析详情失败");
    } finally {
      setDetailLoadingId(null);
    }
  }

  async function handleCopyGptPrompt() {
    const text = gptPrompt.trim();
    if (!text) {
      message.warning("暂无可用 prompt");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      message.success("已复制，可粘贴到 ChatGPT / DeepSeek 开始对话");
    } catch {
      message.error("复制失败，请手动全选复制");
    }
  }

  return (
    <div className="portrait-analysis">
      <div className="practice-block">
        <div className="practice-block-kicker">分析历史</div>
        <p className="entry-hint">只保存该学生本人的短板总评，不含全班混合结果。</p>
        <Table
          rowKey="id"
          size="small"
          loading={historyLoading}
          dataSource={historyItems}
          pagination={{
            current: historyPage,
            pageSize: 10,
            total: historyTotal,
            size: "small",
            onChange: (page) => {
              loadHistory(page).catch(() => message.error("加载历史失败"));
            },
          }}
          scroll={{ x: 320 }}
          columns={[
            { title: "时间", dataIndex: "analyzed_at", width: 168, render: (v: string) => formatDateTimeLocal(v) },
            { title: "题数", dataIndex: "analyzed_count", width: 64 },
            {
              title: "操作",
              width: 64,
              fixed: "right",
              render: (_, row) => (
                <Tooltip title="查看">
                  <button
                    type="button"
                    className="list-icon-action"
                    aria-label="查看"
                    disabled={detailLoadingId === row.id}
                    onClick={() => {
                      handleLoadHistoryDetail(row.id).catch(() => undefined);
                    }}
                  >
                    <EyeOutlined />
                  </button>
                </Tooltip>
              ),
            },
          ]}
          locale={{ emptyText: "还没有该学生的短板分析" }}
        />
      </div>

      {analyzing && !result ? (
        <div className="entry-empty">
          <Spin />
          <p>正在根据高错误率题目分析短板…</p>
        </div>
      ) : result ? (
        <>
          <div className="practice-block">
            <div className="practice-block-kicker">AI 总评</div>
            <p>
              覆盖 {result.analyzed_count} 题 · {formatDateTimeLocal(result.analyzed_at)}
            </p>
            <p>{result.overall_summary}</p>
          </div>
          <div className="practice-block">
            <div className="practice-block-kicker">主要短板</div>
            {result.weak_areas.length ? (
              result.weak_areas.map((area) => (
                <WeakAreaLessonPanel
                  key={`${result.id ?? "x"}-${area.name}-${area.severity}`}
                  area={area}
                  overallSummary={result.overall_summary}
                  weaknessAnalysisId={result.id ?? null}
                />
              ))
            ) : (
              <p>暂无短板项</p>
            )}
          </div>
          <div className="practice-block">
            <div className="practice-block-kicker">补全建议</div>
            {result.gap_fill_suggestions.length ? (
              <ol className="practice-list">
                {result.gap_fill_suggestions.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ol>
            ) : (
              <p>暂无建议</p>
            )}
          </div>
          <div className="practice-block">
            <div className="practice-block-kicker">学习方法</div>
            {result.study_methods.length ? (
              <ol className="practice-list">
                {result.study_methods.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ol>
            ) : (
              <p>暂无方法</p>
            )}
          </div>
          <div className="practice-block">
            <div className="practice-block-kicker">轻量周计划</div>
            {result.weekly_plan.length ? (
              <ol className="practice-list">
                {result.weekly_plan.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ol>
            ) : (
              <p>暂无计划</p>
            )}
          </div>
          <details className="practice-fold">
            <summary>复制学习 Prompt</summary>
            <p className="entry-hint">根据本次短板分析生成，可粘贴到 ChatGPT / DeepSeek 继续讲解。</p>
            <Input.TextArea value={gptPrompt} onChange={(event) => setGptPrompt(event.target.value)} rows={10} />
            <div className="practice-fold-actions">
              <Button size="small" onClick={() => setGptPrompt(generatedGptPrompt)} disabled={!generatedGptPrompt}>
                重置
              </Button>
              <Button
                size="small"
                type="primary"
                icon={<CopyOutlined />}
                onClick={() => {
                  handleCopyGptPrompt().catch(() => undefined);
                }}
              >
                复制
              </Button>
            </div>
          </details>
        </>
      ) : (
        <p className="entry-hint">还没有总评。有作答数据后，可以生成该学生的短板分析。</p>
      )}

      <div className="portrait-analysis-bar">
        <div className="entry-bar-meta">学生 {shownName}</div>
        <Button
          type="primary"
          icon={<ThunderboltOutlined />}
          loading={analyzing}
          onClick={() => {
            handleAnalyze(Boolean(result)).catch(() => undefined);
          }}
        >
          {result ? "重新分析并保存" : "生成短板分析"}
        </Button>
      </div>
    </div>
  );
}
