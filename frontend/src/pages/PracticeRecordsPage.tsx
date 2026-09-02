import { EyeOutlined } from "@ant-design/icons";
import {
  ConfigProvider,
  Drawer,
  InputNumber,
  Pagination,
  Select,
  Table,
  Tooltip,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  getLearnerPracticeRecordDetail,
  listAdminUsers,
  listLearnerPracticeRecords,
  listOrganizations,
  listWrongQuestionAccuracyStats,
} from "../api";
import type {
  AnswerItem,
  LearnerPracticeRecord,
  LearnerPracticeRecordDetail,
  Organization,
  UserRole,
  WrongQuestionAccuracyStat,
} from "../types";
import { formatDateTimeLocal } from "../utils/datetime";
import { errorRateLevelLabel, userAssignmentStatusLabel } from "../utils/labels";
import { userLabel, userOptionLabel } from "../utils/userLabel";

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
    .map((item, idx) => {
      const text = item === null || item === "" ? "—" : Array.isArray(item) ? item.join(" / ") : String(item);
      return answer.length > 1 ? `第${idx + 1}空 ${text}` : text;
    })
    .join("；");
}

export default function PracticeRecordsPage({ currentRole }: { currentRole?: UserRole | null }) {
  const navigate = useNavigate();
  const isSuperadmin = currentRole === "superadmin";
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
  const [orgFilter, setOrgFilter] = useState<number | undefined>(undefined);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [learnerOptions, setLearnerOptions] = useState<
    { label: string; value: string; userId: number; organizationId: number | null }[]
  >([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<LearnerPracticeRecordDetail | null>(null);

  const orgOptions = useMemo(
    () =>
      organizations
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
        .map((org) => ({ label: org.name, value: org.id })),
    [organizations],
  );
  const visibleLearnerOptions = useMemo(
    () =>
      orgFilter == null
        ? learnerOptions
        : learnerOptions.filter((item) => item.organizationId === orgFilter),
    [learnerOptions, orgFilter],
  );
  const filterCount = [orgFilter, selectedUsername, wrongQuestionId].filter(Boolean).length;
  const selectedUserId = visibleLearnerOptions.find((item) => item.value === selectedUsername)?.userId;

  function scopeParams() {
    const u = selectedUsername?.trim();
    return {
      wrong_question_id: wrongQuestionId,
      ...(u ? { username: u } : {}),
      ...(isSuperadmin && orgFilter != null ? { organization_id: orgFilter } : {}),
    };
  }

  async function loadRecords(page = recordsPage, pageSize = recordsPageSize) {
    setLoading(true);
    try {
      const data = await listLearnerPracticeRecords({
        page,
        page_size: pageSize,
        ...scopeParams(),
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
    const data = await listWrongQuestionAccuracyStats(50, scopeParams());
    setStats(data);
  }

  useEffect(() => {
    setUsersLoading(true);
    const tasks: Promise<unknown>[] = [listAdminUsers()];
    if (isSuperadmin) tasks.push(listOrganizations());
    Promise.all(tasks)
      .then(([users, orgs]) => {
        const learners = (users as Awaited<ReturnType<typeof listAdminUsers>>)
          .filter((u) => u.role === "student")
          .sort((a, b) => userLabel(a).localeCompare(userLabel(b), "zh-CN"));
        setLearnerOptions(
          learners.map((u) => ({
            label: userOptionLabel(u),
            value: u.username,
            userId: u.id,
            organizationId: u.organization_id ?? null,
          })),
        );
        if (isSuperadmin) setOrganizations((orgs as Organization[]) || []);
      })
      .catch(() => message.error("加载用户列表失败"))
      .finally(() => setUsersLoading(false));
  }, [isSuperadmin]);

  useEffect(() => {
    Promise.allSettled([loadRecords(1, recordsPageSize), loadStats()]).then(([recordsResult, statsResult]) => {
      if (recordsResult.status === "rejected") message.error("加载练习记录失败");
      if (statsResult.status === "rejected") message.error("加载高错误率统计失败");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wrongQuestionId, selectedUsername, recordsPageSize, orgFilter]);

  function applyQuestionId() {
    setWrongQuestionId(typeof idDraft === "number" ? idDraft : undefined);
  }

  function clearFilters() {
    setOrgFilter(undefined);
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

  const recordColumns: ColumnsType<LearnerPracticeRecord> = [
    { title: "学生", key: "name", width: 120, ellipsis: true, render: (_, row) => userLabel(row) },
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
      width: 168,
      render: (value?: string | null) => formatDateTimeLocal(value),
    },
    {
      title: "操作",
      width: 72,
      fixed: "right",
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
      width: 360,
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
          <div className={`list-filter-fields ${isSuperadmin ? "is-scope" : "is-2"}`}>
            {isSuperadmin ? (
              <div className={`list-filter-field${orgFilter != null ? " is-filled" : ""}`}>
                <span className="list-filter-kicker">机构</span>
                <Select
                  allowClear
                  showSearch
                  placeholder="全部"
                  optionFilterProp="label"
                  value={orgFilter}
                  options={orgOptions}
                  onChange={(value) => {
                    setOrgFilter(value ?? undefined);
                    setSelectedUsername(undefined);
                  }}
                />
              </div>
            ) : null}
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
                options={visibleLearnerOptions}
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
          {selectedUserId ? (
            <div className="list-results-tools">
              <button type="button" className="list-action" onClick={() => navigate(`/students/${selectedUserId}`)}>
                查看画像
              </button>
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
              scroll={{ x: 760 }}
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
            scroll={{ x: 640 }}
            locale={{ emptyText: "暂无高错误率题目" }}
          />
        )}
      </div>

      <Drawer
        className="entry-drawer"
        title={detail ? `批改详情 · ${userLabel(detail)}` : "批改详情"}
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
                      <span className="task-qcard-index">题目 #{item.wrong_question_id}</span>
                      <span className={`list-status ${item.is_correct ? "is-correct" : item.correct_slots ? "is-pending" : "is-wrong"}`}>
                        {item.total_slots && item.total_slots > 1
                          ? `${item.correct_slots ?? 0}/${item.total_slots} 空`
                          : item.is_correct
                            ? "正确"
                            : "错误"}
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
    </ConfigProvider>
  );
}
