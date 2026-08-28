import { CopyOutlined, EyeOutlined, ThunderboltOutlined } from "@ant-design/icons";
import {
  Button,
  ConfigProvider,
  Drawer,
  Input,
  InputNumber,
  Pagination,
  Select,
  Spin,
  Table,
  Tooltip,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";

import {
  analyzeLearningWeaknesses,
  getLatestLearningWeaknessAnalysis,
  getLearnerPracticeRecordDetail,
  getLearningWeaknessAnalysis,
  listAdminUsers,
  listLearnerPracticeRecords,
  listLearningWeaknessAnalyses,
  listWrongQuestionAccuracyStats,
} from "../api";
import WeakAreaLessonPanel from "../components/WeakAreaLessonPanel";
import type {
  AnswerItem,
  LearnerPracticeRecord,
  LearnerPracticeRecordDetail,
  LearningWeaknessAnalysis,
  LearningWeaknessAnalysisListItem,
  WrongQuestionAccuracyStat,
} from "../types";
import { formatDateTimeLocal } from "../utils/datetime";
import { buildGptLearningPrompt } from "../utils/gptLearningPrompt";
import { errorRateLevelLabel, userAssignmentStatusLabel } from "../utils/labels";

const FILTER_THEME = {
  token: {
    colorPrimary: "#7c5cfc",
    colorBorder: "#e4dcf4",
    colorPrimaryHover: "#6b4ef0",
    borderRadius: 10,
    controlHeight: 36,
  },
};

type PracticeTab = "records" | "questions";

function errorLevelFromAccuracy(accuracy: number): "high" | "medium" | "low" {
  const errorRate = 1 - accuracy;
  if (errorRate >= 0.75) return "high";
  if (errorRate >= 0.5) return "medium";
  return "low";
}

function formatAnswerValue(answer?: AnswerItem[] | null): string {
  if (!answer || !answer.length) return "—";
  return answer
    .map((item) => {
      if (item === null) return "（空）";
      if (Array.isArray(item)) return item.join(" / ");
      return String(item);
    })
    .join(" | ");
}

function getApiErrorDetail(error: unknown): string | null {
  if (error && typeof error === "object" && "response" in error) {
    const detail = (error as { response?: { data?: { detail?: string } } }).response?.data?.detail;
    return typeof detail === "string" ? detail : null;
  }
  return null;
}

export default function PracticeRecordsPage() {
  const [tab, setTab] = useState<PracticeTab>("records");
  const [records, setRecords] = useState<LearnerPracticeRecord[]>([]);
  const [recordsTotal, setRecordsTotal] = useState(0);
  const [stats, setStats] = useState<WrongQuestionAccuracyStat[]>([]);
  const [recordsPage, setRecordsPage] = useState(1);
  const [recordsPageSize, setRecordsPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [idDraft, setIdDraft] = useState<number | null>(null);
  const [wrongQuestionId, setWrongQuestionId] = useState<number | undefined>(undefined);
  const [selectedUsername, setSelectedUsername] = useState<string | undefined>(undefined);
  const [learnerOptions, setLearnerOptions] = useState<{ label: string; value: string }[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<LearnerPracticeRecordDetail | null>(null);
  const [weaknessAnalyzing, setWeaknessAnalyzing] = useState(false);
  const [weaknessOpen, setWeaknessOpen] = useState(false);
  const [weaknessResult, setWeaknessResult] = useState<LearningWeaknessAnalysis | null>(null);
  const [historyItems, setHistoryItems] = useState<LearningWeaknessAnalysisListItem[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [detailLoadingId, setDetailLoadingId] = useState<number | null>(null);
  const [gptPrompt, setGptPrompt] = useState("");

  const generatedGptPrompt = useMemo(
    () => (weaknessResult ? buildGptLearningPrompt(weaknessResult) : ""),
    [weaknessResult],
  );

  useEffect(() => {
    setGptPrompt(generatedGptPrompt);
  }, [generatedGptPrompt]);

  const filterCount = [selectedUsername, wrongQuestionId].filter(Boolean).length;

  async function loadWeaknessHistory(page = 1) {
    setHistoryLoading(true);
    try {
      const u = selectedUsername?.trim();
      const data = await listLearningWeaknessAnalyses({
        page,
        page_size: 10,
        ...(u ? { username: u } : {}),
      });
      setHistoryItems(data.items);
      setHistoryTotal(data.total);
      setHistoryPage(page);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function loadRecords(page = recordsPage, pageSize = recordsPageSize) {
    setLoading(true);
    try {
      const u = selectedUsername?.trim();
      const data = await listLearnerPracticeRecords({
        page,
        page_size: pageSize,
        wrong_question_id: wrongQuestionId,
        ...(u ? { username: u } : {}),
      });
      setRecords(data.items);
      setRecordsTotal(data.total);
      setRecordsPage(page);
      setRecordsPageSize(pageSize);
    } finally {
      setLoading(false);
    }
  }

  async function loadStats() {
    const u = selectedUsername?.trim();
    const data = await listWrongQuestionAccuracyStats(50, {
      wrong_question_id: wrongQuestionId,
      ...(u ? { username: u } : {}),
    });
    setStats(data);
  }

  useEffect(() => {
    setUsersLoading(true);
    listAdminUsers()
      .then((users) => {
        const learners = users
          .filter((u) => u.role === "student")
          .sort((a, b) => a.username.localeCompare(b.username, "zh-CN"));
        setLearnerOptions(learners.map((u) => ({ label: u.username, value: u.username })));
      })
      .catch(() => message.error("加载用户列表失败"))
      .finally(() => setUsersLoading(false));
  }, []);

  useEffect(() => {
    Promise.allSettled([loadRecords(1, recordsPageSize), loadStats()]).then(([recordsResult, statsResult]) => {
      if (recordsResult.status === "rejected") message.error("加载练习记录失败");
      if (statsResult.status === "rejected") message.error("加载高错误率统计失败");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wrongQuestionId, selectedUsername, recordsPageSize]);

  function applyQuestionId() {
    setWrongQuestionId(typeof idDraft === "number" ? idDraft : undefined);
  }

  function clearFilters() {
    setSelectedUsername(undefined);
    setIdDraft(null);
    setWrongQuestionId(undefined);
  }

  async function handleViewDetail(recordId: number) {
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      const data = await getLearnerPracticeRecordDetail(recordId);
      setDetail(data);
    } catch {
      message.error("加载批改详情失败");
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }

  async function handleWeaknessAnalyze(force = false) {
    if (!stats.length && force) {
      message.warning("当前没有高错误率题目，无法分析");
      return;
    }
    setWeaknessOpen(true);
    setWeaknessAnalyzing(true);
    try {
      const u = selectedUsername?.trim();
      const scope = {
        wrong_question_id: wrongQuestionId,
        ...(u ? { username: u } : {}),
      };
      if (!force) {
        await loadWeaknessHistory(1).catch(() => undefined);
        const latest = await getLatestLearningWeaknessAnalysis(scope);
        if (latest) {
          setWeaknessResult(latest);
          message.success("已回显上次短板分析");
          return;
        }
        if (!stats.length) {
          message.warning("当前没有高错误率题目，无法分析");
          return;
        }
      }
      const result = await analyzeLearningWeaknesses(50, scope);
      setWeaknessResult(result);
      await loadWeaknessHistory(1);
      message.success(force ? "已重新分析并保存" : "短板分析完成，已保存记录");
    } catch (error) {
      message.error(getApiErrorDetail(error) || "AI 短板分析失败，请稍后重试");
    } finally {
      setWeaknessAnalyzing(false);
    }
  }

  async function handleOpenWeaknessHistory() {
    setWeaknessOpen(true);
    try {
      await loadWeaknessHistory(1);
      if (!weaknessResult) {
        const u = selectedUsername?.trim();
        const latest = await getLatestLearningWeaknessAnalysis({
          wrong_question_id: wrongQuestionId,
          ...(u ? { username: u } : {}),
        });
        if (latest) setWeaknessResult(latest);
      }
    } catch {
      message.error("加载短板分析历史失败");
    }
  }

  async function handleLoadHistoryDetail(id: number) {
    setDetailLoadingId(id);
    try {
      const data = await getLearningWeaknessAnalysis(id);
      setWeaknessResult(data);
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

  const recordColumns: ColumnsType<LearnerPracticeRecord> = [
    { title: "学生", dataIndex: "username", width: 120 },
    {
      title: "任务",
      dataIndex: "assignment_id",
      width: 88,
      render: (id: number) => `#${id}`,
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 88,
      render: (value: LearnerPracticeRecord["status"]) => (
        <span className={`list-status is-${value}`}>{userAssignmentStatusLabel(value)}</span>
      ),
    },
    {
      title: "答对 / 已作答",
      width: 120,
      render: (_, row) => `${row.correct_questions} / ${row.answered_questions}`,
    },
    {
      title: "正确率",
      dataIndex: "accuracy_rate",
      width: 88,
      render: (value?: number | null) => (typeof value === "number" ? `${(value * 100).toFixed(1)}%` : "—"),
    },
    {
      title: "提交时间",
      dataIndex: "submitted_at",
      render: (value?: string | null) => formatDateTimeLocal(value),
    },
    {
      title: "操作",
      width: 64,
      render: (_, row) => (
        <span className="list-icon-actions">
          <Tooltip title="批改详情">
            <button type="button" className="list-icon-action" aria-label="批改详情" onClick={() => handleViewDetail(row.id)}>
              <EyeOutlined />
            </button>
          </Tooltip>
        </span>
      ),
    },
  ];

  const statsColumns: ColumnsType<WrongQuestionAccuracyStat> = [
    {
      title: "题干",
      dataIndex: "stem",
      ellipsis: true,
      render: (value: string) => value,
    },
    { title: "作答次数", dataIndex: "total_attempts", width: 96 },
    {
      title: "错误率",
      dataIndex: "accuracy_rate",
      width: 100,
      render: (value: number) => {
        const level = errorLevelFromAccuracy(value);
        return (
          <span className={`list-status is-err-${level}`}>
            {errorRateLevelLabel(level)} {((1 - value) * 100).toFixed(0)}%
          </span>
        );
      },
    },
    {
      title: "ID",
      dataIndex: "wrong_question_id",
      width: 72,
    },
  ];

  return (
    <ConfigProvider theme={FILTER_THEME}>
      <div className="list-filter">
        <div className="list-filter-tabs">
          <div className="list-view-toggle" role="tablist" aria-label="内容">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "records"}
              className={tab === "records" ? "is-active" : undefined}
              onClick={() => setTab("records")}
            >
              作答记录
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "questions"}
              className={tab === "questions" ? "is-active" : undefined}
              onClick={() => setTab("questions")}
            >
              高频错题
            </button>
          </div>
        </div>
        <div className="list-filter-secondary">
          <div className="list-filter-fields is-2">
            <div className={`list-filter-field${selectedUsername ? " is-filled" : ""}`}>
              <span className="list-filter-kicker">学生</span>
              <Select
                allowClear
                showSearch
                loading={usersLoading}
                placeholder="全部学生"
                optionFilterProp="label"
                value={selectedUsername}
                onChange={(value) => setSelectedUsername(value ?? undefined)}
                options={learnerOptions}
              />
            </div>
            <div className={`list-filter-field is-id${wrongQuestionId ? " is-filled" : ""}`}>
              <span className="list-filter-kicker">题目 ID</span>
              <InputNumber
                min={1}
                precision={0}
                controls={false}
                value={idDraft ?? undefined}
                placeholder="回车查找"
                style={{ width: "100%" }}
                onChange={(value) => setIdDraft(typeof value === "number" ? value : null)}
                onPressEnter={() => applyQuestionId()}
              />
            </div>
          </div>
          {filterCount > 0 ? (
            <button type="button" className="list-filter-reset" onClick={clearFilters}>
              清除条件
            </button>
          ) : null}
        </div>
      </div>

      <div className="list-results">
        <div className="list-results-head">
          <div className="list-results-meta">
            {tab === "records" ? (
              <>
                共 <strong>{recordsTotal}</strong> 条
              </>
            ) : (
              <>
                共 <strong>{stats.length}</strong> 题
              </>
            )}
          </div>
          {tab === "questions" ? (
            <div className="list-results-tools">
              <button
                type="button"
                className="list-action"
                onClick={() => {
                  handleOpenWeaknessHistory().catch(() => undefined);
                }}
              >
                历史记录
              </button>
              <Button
                type="primary"
                icon={<ThunderboltOutlined />}
                loading={weaknessAnalyzing}
                disabled={!stats.length}
                onClick={() => {
                  handleWeaknessAnalyze(false).catch(() => undefined);
                }}
              >
                AI 短板分析
              </Button>
            </div>
          ) : null}
        </div>
        {tab === "records" ? (
          <>
            <Table
              rowKey="id"
              tableLayout="fixed"
              loading={loading}
              columns={recordColumns}
              dataSource={records}
              pagination={false}
              locale={{ emptyText: "暂无作答记录" }}
            />
            <Pagination
              className="list-results-pagination"
              align="end"
              current={recordsPage}
              pageSize={recordsPageSize}
              total={recordsTotal}
              showSizeChanger
              showTotal={(value) => `共 ${value} 条`}
              onChange={(nextPage, nextSize) => {
                loadRecords(nextPage, nextSize).catch(() => message.error("加载练习记录失败"));
              }}
            />
          </>
        ) : (
          <Table
            rowKey="wrong_question_id"
            tableLayout="fixed"
            columns={statsColumns}
            dataSource={stats}
            pagination={false}
            locale={{ emptyText: "暂无高错误率题目" }}
          />
        )}
      </div>

      <Drawer
        className="entry-drawer"
        title={detail ? `批改详情 · ${detail.username}` : "批改详情"}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        size={760}
        destroyOnHidden
        styles={{ body: { padding: 0 } }}
      >
        <div className="entry-drawer-panel">
          <div className="entry-body">
            {detailLoading || !detail ? (
              <div className="entry-empty">加载中…</div>
            ) : (
              <div className="task-sheet">
                <div className="task-summary">
                  <span className={`list-status is-${detail.status}`}>{userAssignmentStatusLabel(detail.status)}</span>
                  <span>任务 #{detail.assignment_id}</span>
                  <span>分数：{detail.score ?? "—"}</span>
                  <span>
                    正确率：
                    {typeof detail.accuracy_rate === "number" ? `${(detail.accuracy_rate * 100).toFixed(1)}%` : "—"}
                  </span>
                  <span>提交：{formatDateTimeLocal(detail.submitted_at)}</span>
                </div>
                {detail.answers.map((item) => (
                  <article key={item.id} className="task-qcard">
                    <div className="task-qcard-head">
                      <span className="task-qcard-index">错题 #{item.wrong_question_id}</span>
                      <span className={`list-status ${item.is_correct ? "is-correct" : "is-wrong"}`}>
                        {item.is_correct ? "正确" : "错误"}
                      </span>
                    </div>
                    <p className="task-stem">{item.wrong_question_stem || "—"}</p>
                    <p className="task-answer">
                      <strong>作答</strong> {formatAnswerValue(item.user_answer)}
                    </p>
                    <p className="task-answer">
                      <strong>标答</strong> {formatAnswerValue(item.standard_answer)}
                    </p>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      </Drawer>

      <Drawer
        className="entry-drawer"
        title="AI 短板分析"
        open={weaknessOpen}
        onClose={() => setWeaknessOpen(false)}
        size={880}
        destroyOnHidden
        styles={{ body: { padding: 0 } }}
      >
        <div className="entry-drawer-panel">
          <div className="entry-body">
            <div className="practice-block">
              <div className="practice-block-kicker">历史记录</div>
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
                    loadWeaknessHistory(page).catch(() => message.error("加载历史失败"));
                  },
                }}
                columns={[
                  { title: "时间", dataIndex: "analyzed_at", width: 168, render: (v: string) => formatDateTimeLocal(v) },
                  {
                    title: "范围",
                    ellipsis: true,
                    render: (_, row: LearningWeaknessAnalysisListItem) =>
                      row.scope_note || (row.username ? `学生 ${row.username}` : "全部范围"),
                  },
                  { title: "题数", dataIndex: "analyzed_count", width: 64 },
                  {
                    title: "",
                    width: 64,
                    render: (_, row) => (
                      <button
                        type="button"
                        className="list-action"
                        disabled={detailLoadingId === row.id}
                        onClick={() => {
                          handleLoadHistoryDetail(row.id).catch(() => undefined);
                        }}
                      >
                        查看
                      </button>
                    ),
                  },
                ]}
                locale={{ emptyText: "暂无历史分析" }}
              />
            </div>

            {weaknessAnalyzing && !weaknessResult ? (
              <div className="entry-empty">
                <Spin />
                <p>正在根据高错误率题目分析短板…</p>
              </div>
            ) : weaknessResult ? (
              <>
                <div className="practice-block">
                  <div className="practice-block-kicker">总评</div>
                  <p>
                    覆盖 {weaknessResult.analyzed_count} 题
                    {weaknessResult.username ? ` · 学生 ${weaknessResult.username}` : " · 当前筛选范围"}
                    {" · "}
                    {formatDateTimeLocal(weaknessResult.analyzed_at)}
                  </p>
                  {weaknessResult.scope_note ? <p>{weaknessResult.scope_note}</p> : null}
                  <p>{weaknessResult.overall_summary}</p>
                </div>

                <div className="practice-block">
                  <div className="practice-block-kicker">主要短板</div>
                  {weaknessResult.weak_areas.length ? (
                    weaknessResult.weak_areas.map((area) => (
                      <WeakAreaLessonPanel
                        key={`${weaknessResult.id ?? "x"}-${area.name}-${area.severity}`}
                        area={area}
                        overallSummary={weaknessResult.overall_summary}
                        weaknessAnalysisId={weaknessResult.id ?? null}
                      />
                    ))
                  ) : (
                    <p>暂无短板项</p>
                  )}
                </div>

                <div className="practice-block">
                  <div className="practice-block-kicker">补全建议</div>
                  {weaknessResult.gap_fill_suggestions.length ? (
                    <ol className="practice-list">
                      {weaknessResult.gap_fill_suggestions.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ol>
                  ) : (
                    <p>暂无建议</p>
                  )}
                </div>

                <div className="practice-block">
                  <div className="practice-block-kicker">学习方法</div>
                  {weaknessResult.study_methods.length ? (
                    <ol className="practice-list">
                      {weaknessResult.study_methods.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ol>
                  ) : (
                    <p>暂无方法</p>
                  )}
                </div>

                <div className="practice-block">
                  <div className="practice-block-kicker">轻量周计划</div>
                  {weaknessResult.weekly_plan.length ? (
                    <ol className="practice-list">
                      {weaknessResult.weekly_plan.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ol>
                  ) : (
                    <p>暂无计划</p>
                  )}
                </div>

                {weaknessResult.source_items?.length ? (
                  <div className="practice-block">
                    <div className="practice-block-kicker">分析题目（{weaknessResult.source_items.length}）</div>
                    <ol className="practice-list">
                      {weaknessResult.source_items.map((item, index) => {
                        const qid = Number(item.wrong_question_id || 0);
                        const errorRate = Number(item.error_rate || 0);
                        const stem = String(item.stem || "");
                        return (
                          <li key={`${qid}-${index}`}>
                            #{qid} · 错误率 {(errorRate * 100).toFixed(1)}% ·{" "}
                            {stem.length > 80 ? `${stem.slice(0, 80)}…` : stem}
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                ) : null}

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
              <p className="entry-hint">可从历史记录查看已保存分析，或点击「重新分析并保存」生成新记录。</p>
            )}
          </div>
          <div className="entry-bar">
            <div className="entry-bar-meta">
              {selectedUsername ? `当前范围：${selectedUsername}` : "当前范围：全部学生"}
              {wrongQuestionId ? ` · 题目 #${wrongQuestionId}` : ""}
            </div>
            <div className="entry-bar-actions">
              <Button onClick={() => setWeaknessOpen(false)}>关闭</Button>
              <Button
                type="primary"
                icon={<ThunderboltOutlined />}
                loading={weaknessAnalyzing}
                disabled={!stats.length}
                onClick={() => {
                  handleWeaknessAnalyze(true).catch(() => undefined);
                }}
              >
                重新分析并保存
              </Button>
            </div>
          </div>
        </div>
      </Drawer>
    </ConfigProvider>
  );
}
