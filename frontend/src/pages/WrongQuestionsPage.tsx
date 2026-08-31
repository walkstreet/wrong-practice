import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { AppstoreOutlined, DeleteOutlined, EditOutlined, EyeOutlined, UnorderedListOutlined } from "@ant-design/icons";
import { Button, ConfigProvider, Drawer, Empty, Form, Input, InputNumber, Modal, Pagination, Popconfirm, Select, Space, Spin, Table, Tag, Tooltip, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import axios from "axios";
import {
  deleteWrongQuestion,
  getWrongQuestion,
  listKnowledgeTags,
  listQuestionTypes,
  listWrongQuestions,
  requestBankAccess,
  setQuestionPublic,
  suggestKnowledgeTags,
  updateWrongQuestion,
} from "../api";
import WrongQuestionDetailDrawer from "../components/WrongQuestionDetailDrawer";
import WrongQuestionFormFields from "../components/WrongQuestionFormFields";
import { canManageWrongQuestion, isOrgStaffRole } from "../permissions";
import type { ClaimRequestStatus, ErrorRateLevel, KnowledgeTag, QuestionType, UserRole, WrongQuestion } from "../types";
import { buildKnowledgeTagNameMap, buildKnowledgeTagSelectOptions } from "../utils/knowledgeTags";
import { errorRateLevelLabel, ingestSourceLabel } from "../utils/labels";
import { DIFFICULTY_LEVELS, difficultyLabel } from "../utils/difficulty";
import { linesToAnswers, linesToOptions, listToLines } from "../utils/optionLines";
import { buildQuestionTypeSelectOptions } from "../utils/questionTypes";

const { Text } = Typography;

interface FilterValues {
  id?: number;
  question_type_id?: number;
  knowledge_tag_id?: number;
  error_rate_level?: ErrorRateLevel;
  difficulty?: number;
}

const ERROR_RATE_PILLS: { label: string; value: ErrorRateLevel | undefined }[] = [
  { label: "全部", value: undefined },
  { label: "高", value: "high" },
  { label: "中", value: "medium" },
  { label: "低", value: "low" },
];

const DIFFICULTY_PILLS: { label: string; value: number | undefined }[] = [
  { label: "全部", value: undefined },
  ...DIFFICULTY_LEVELS.map((level) => ({ label: level.name, value: level.value })),
];

function toDifficultyFilter(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 5 ? parsed : undefined;
}

const FILTER_THEME = {
  token: {
    colorPrimary: "#7c5cfc",
    colorBorder: "#e4dcf4",
    colorPrimaryHover: "#6b4ef0",
    borderRadius: 10,
    controlHeight: 36,
  },
};

const VIEW_KEY = "righton.wq-view";

type ListView = "table" | "card";

function readListView(): ListView {
  try {
    return localStorage.getItem(VIEW_KEY) === "table" ? "table" : "card";
  } catch {
    return "card";
  }
}

function writeListView(view: ListView) {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    /* ignore quota / private mode */
  }
}

function getApiErrorMessage(error: unknown): string | null {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === "string" && detail.trim()) return detail;
    if (error.response?.status === 401) return "登录已失效，请重新登录";
    if (error.response?.status === 403) return "权限不足";
  }
  return null;
}

export default function WrongQuestionsPage({
  currentUserId,
  currentRole,
  organizationId,
  canViewQuestionBank,
  bankRequestStatus,
  onBankAccessChange,
}: {
  currentUserId: number | null;
  currentRole: UserRole | null;
  organizationId: number | null;
  canViewQuestionBank: boolean;
  bankRequestStatus: ClaimRequestStatus | null;
  onBankAccessChange: (next: { canViewQuestionBank: boolean; bankRequestStatus: ClaimRequestStatus | null }) => void;
}) {
  const [searchParams] = useSearchParams();
  const [form] = Form.useForm<FilterValues>();
  const [editForm] = Form.useForm();
  const errorRateLevel = Form.useWatch("error_rate_level", form);
  const difficulty = Form.useWatch("difficulty", form);
  const selectedDifficulty = toDifficultyFilter(difficulty);
  const knowledgeTagId = Form.useWatch("knowledge_tag_id", form);
  const questionTypeId = Form.useWatch("question_type_id", form);
  const questionId = Form.useWatch("id", form);
  const activeFilterCount = [errorRateLevel, selectedDifficulty, knowledgeTagId, questionTypeId, questionId].filter(
    (value) => value !== undefined && value !== null,
  ).length;
  const [loading, setLoading] = useState(false);
  const [tableData, setTableData] = useState<WrongQuestion[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [questionTypes, setQuestionTypes] = useState<QuestionType[]>([]);
  const [knowledgeTags, setKnowledgeTags] = useState<KnowledgeTag[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<WrongQuestion | null>(null);
  const [editing, setEditing] = useState<WrongQuestion | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [suggestingTags, setSuggestingTags] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  const [claimReason, setClaimReason] = useState("");
  const [claimSubmitting, setClaimSubmitting] = useState(false);
  const [listView, setListView] = useState<ListView>(readListView);
  const [bankScope, setBankScope] = useState<"mine" | "org" | "public">("mine");
  const showBankTabs = isOrgStaffRole(currentRole) || currentRole === "superadmin";
  const canSeePublicBank = canViewQuestionBank || currentRole === "superadmin";
  const orgBankLabel = currentRole === "superadmin" ? "全站题目" : "机构库";

  const typeMap = useMemo(() => new Map(questionTypes.map((item) => [item.id, item.name])), [questionTypes]);
  const tagMap = useMemo(() => buildKnowledgeTagNameMap(knowledgeTags), [knowledgeTags]);

  async function fetchMeta() {
    const [types, tags] = await Promise.all([listQuestionTypes(), listKnowledgeTags()]);
    setQuestionTypes(types);
    setKnowledgeTags(tags);
  }

  function applyFilters() {
    fetchTable(1, pageSize).catch(() => message.error("筛选失败"));
  }

  function handleResetFilters() {
    form.resetFields();
    applyFilters();
  }

  async function fetchTable(nextPage = page, nextSize = pageSize, nextScope = bankScope) {
    const values = form.getFieldsValue();
    setLoading(true);
    try {
      const data = await listWrongQuestions({
        page: nextPage,
        page_size: nextSize,
        id: values.id,
        question_type_id: values.question_type_id,
        knowledge_tag_id: values.knowledge_tag_id,
        error_rate_level: values.error_rate_level,
        difficulty: toDifficultyFilter(values.difficulty),
        scope: showBankTabs ? nextScope : undefined,
      });
      setTableData(data.items);
      setTotal(data.total);
      setPage(nextPage);
      setPageSize(nextSize);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const raw = searchParams.get("id");
    const parsed = raw ? Number(raw) : NaN;
    const hasId = Number.isInteger(parsed) && parsed > 0;
    if (hasId) {
      form.setFieldValue("id", parsed);
    }
    fetchMeta().catch(() => message.error("初始化元数据失败"));
    fetchTable(1, 20)
      .then(() => {
        if (hasId) {
          handleView(parsed).catch(() => message.error("无法打开该题目"));
        }
      })
      .catch(() => message.error("加载题库失败"));
    // 仅首次按地址栏 id 定位
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleView(id: number) {
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      const data = await getWrongQuestion(id);
      setDetail(data);
    } finally {
      setDetailLoading(false);
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteWrongQuestion(id);
      message.success("删除成功，已移入回收站");
      await fetchTable(page, pageSize);
    } catch (error) {
      message.error(getApiErrorMessage(error) || "删除失败");
    }
  }

  async function handleClaim() {
    setClaimSubmitting(true);
    try {
      await requestBankAccess(claimReason.trim() || undefined);
      message.success("已提交申请，等待超管审批");
      setClaimOpen(false);
      setClaimReason("");
      onBankAccessChange({ canViewQuestionBank: false, bankRequestStatus: "pending" });
    } catch (error) {
      message.error(getApiErrorMessage(error) || "申请失败");
    } finally {
      setClaimSubmitting(false);
    }
  }

  function handleEdit(record: WrongQuestion) {
    setEditing(record);
    editForm.setFieldsValue({
      stem: record.stem,
      options_lines: listToLines(record.options),
      correct_answer_lines: listToLines(record.correct_answer),
      question_type_id: record.question_type_id,
      knowledge_tag_ids: record.knowledge_tag_ids,
      review_status: record.review_status,
      source: record.source || "",
      note: record.note || "",
      difficulty: record.difficulty ?? null,
    });
  }

  async function handleEditSubmit() {
    if (!editing) return;
    const values = await editForm.validateFields();
    const options = linesToOptions(values.options_lines);
    const correct_answer = linesToAnswers(values.correct_answer_lines);
    if (!correct_answer.length) {
      message.warning("请填写正确答案（每空/每小题一行）");
      return;
    }
    setEditSubmitting(true);
    try {
      await updateWrongQuestion(editing.id, {
        stem: values.stem,
        options,
        correct_answer,
        question_type_id: values.question_type_id,
        knowledge_tag_ids: values.knowledge_tag_ids,
        review_status: values.review_status,
        source: values.source || null,
        note: values.note || null,
        difficulty: values.difficulty ?? null,
      });
      message.success("修改成功");
      setEditing(null);
      fetchTable(page, pageSize).catch(() => message.error("刷新列表失败"));
    } finally {
      setEditSubmitting(false);
    }
  }

  async function handleSuggestKnowledgeTags() {
    const stem = String(editForm.getFieldValue("stem") || editing?.stem || "").trim();
    if (!stem) {
      message.warning("请先填写题干");
      return;
    }
    const questionTypeId = editForm.getFieldValue("question_type_id") as number | undefined;
    const questionTypeName =
      questionTypes.find((t) => t.id === questionTypeId)?.name ||
      (editing ? typeMap.get(editing.question_type_id) : null) ||
      null;
    const options = linesToOptions(editForm.getFieldValue("options_lines")) || editing?.options || [];
    const formCorrect = linesToAnswers(editForm.getFieldValue("correct_answer_lines"));
    const correct_answer = formCorrect.length ? formCorrect : editing?.correct_answer || [];
    setSuggestingTags(true);
    try {
      const result = await suggestKnowledgeTags({
        stem,
        options,
        correct_answer,
        question_type_name: questionTypeName,
        note: editForm.getFieldValue("note") || editing?.note || null,
      });
      if (!result.knowledge_tag_ids.length) {
        message.warning((Array.isArray(result.warnings) ? result.warnings.filter(Boolean).join("；") : String(result.warnings || "")) || "未能推荐知识点");
        return;
      }
      editForm.setFieldsValue({ knowledge_tag_ids: result.knowledge_tag_ids });
      message.success(`已推荐：${result.items.map((item) => item.name).join("、")}`);
    } catch (error) {
      message.error(getApiErrorMessage(error) || "知识点推荐失败");
    } finally {
      setSuggestingTags(false);
    }
  }

  function handleListView(next: ListView) {
    setListView(next);
    writeListView(next);
  }

  function handleBankScope(next: "mine" | "org" | "public") {
    if (next === bankScope) return;
    if (next === "public" && !canSeePublicBank) return;
    setBankScope(next);
    fetchTable(1, pageSize, next).catch(() => message.error("加载题库失败"));
  }

  function questionManageable(record: { created_by?: number | null; organization_id?: number | null }) {
    return canManageWrongQuestion(currentRole, currentUserId, record, organizationId);
  }

  async function handleTogglePublic(record: WrongQuestion) {
    try {
      const next = await setQuestionPublic(record.id, !record.is_public);
      message.success(next.is_public ? "已发布到平台公共库" : "已取消公共库发布");
      if (detail?.id === record.id) setDetail(next);
      await fetchTable(page, pageSize);
    } catch (error) {
      message.error(getApiErrorMessage(error) || "操作失败");
    }
  }

  function renderDifficulty(value?: number | null) {
    const tone = value == null ? "none" : String(value);
    return <span className={`list-status is-d${tone}`}>{difficultyLabel(value)}</span>;
  }

  function renderErrorRate(record: WrongQuestion) {
    const level = record.error_rate_level;
    const tone = level ?? "none";
    const pct =
      record.error_rate == null ? null : `${Math.round(record.error_rate * 100)}%`;
    return (
      <span
        className={`list-status is-err-${tone}`}
        title={pct ? `错误率 ${pct}` : "还没有练习或作答记录"}
      >
        {errorRateLevelLabel(level)}
      </span>
    );
  }

  function renderTags(ids: number[], max = 2) {
    const shown = ids.slice(0, max);
    const rest = ids.length - shown.length;
    return (
      <span className="list-tags">
        {shown.map((id) => (
          <span key={id} className="list-chip" title={tagMap.get(id) || String(id)}>
            {tagMap.get(id) || id}
          </span>
        ))}
        {rest > 0 ? <span className="list-chip is-more">+{rest}</span> : null}
      </span>
    );
  }

  function renderActions(record: WrongQuestion, inCard = false) {
    const manageable = questionManageable(record);
    const stopCard = inCard
      ? (event: MouseEvent) => {
          event.stopPropagation();
        }
      : undefined;
    const icons = !inCard;
    return (
      <span className={inCard ? "list-qcard-actions" : undefined} onClick={stopCard}>
        <Space size={icons ? 4 : 12}>
          {icons ? (
            <Tooltip title="查看">
              <button type="button" className="list-icon-action" aria-label="查看" onClick={() => handleView(record.id)}>
                <EyeOutlined />
              </button>
            </Tooltip>
          ) : (
            <button type="button" className="list-action" onClick={() => handleView(record.id)}>
              查看
            </button>
          )}
          {manageable ? (
            icons ? (
              <Tooltip title="编辑">
                <button type="button" className="list-icon-action" aria-label="编辑" onClick={() => handleEdit(record)}>
                  <EditOutlined />
                </button>
              </Tooltip>
            ) : (
              <button type="button" className="list-action" onClick={() => handleEdit(record)}>
                编辑
              </button>
            )
          ) : null}
          {currentRole === "superadmin" ? (
            icons ? (
              <Tooltip title={record.is_public ? "取消公共库发布" : "发布到平台公共库"}>
                <button
                  type="button"
                  className="list-icon-action"
                  aria-label={record.is_public ? "取消公共库发布" : "发布到平台公共库"}
                  onClick={() => handleTogglePublic(record)}
                >
                  {record.is_public ? "撤" : "发"}
                </button>
              </Tooltip>
            ) : (
              <button type="button" className="list-action" onClick={() => handleTogglePublic(record)}>
                {record.is_public ? "取消发布" : "发布公共库"}
              </button>
            )
          ) : null}
          {manageable && !inCard ? (
            <Tooltip title="删除">
              <Popconfirm title="确认删除该题目？" onConfirm={() => handleDelete(record.id)} okText="删除" cancelText="取消">
                <button type="button" className="list-icon-action is-danger" aria-label="删除">
                  <DeleteOutlined />
                </button>
              </Popconfirm>
            </Tooltip>
          ) : null}
        </Space>
      </span>
    );
  }

  const pagination = {
    current: page,
    pageSize,
    total,
    showSizeChanger: true,
    showTotal: (value: number) => `共 ${value} 条`,
    onChange: (nextPage: number, nextSize: number) => {
      fetchTable(nextPage, nextSize).catch(() => message.error("翻页失败"));
    },
  };

  const columns: ColumnsType<WrongQuestion> = [
    { title: "ID", dataIndex: "id", width: 72 },
    {
      title: "题干",
      dataIndex: "stem",
      width: 360,
      ellipsis: true,
      render: (value: string) => <Text ellipsis={{ tooltip: value }}>{value}</Text>,
    },
    {
      title: "题型",
      dataIndex: "question_type_id",
      width: 112,
      render: (id: number) => typeMap.get(id) || "—",
    },
    {
      title: "知识点",
      dataIndex: "knowledge_tag_ids",
      width: 220,
      render: (ids: number[]) => renderTags(ids),
    },
    {
      title: "难度",
      dataIndex: "difficulty",
      width: 108,
      render: (value: number | null | undefined) => renderDifficulty(value),
    },
    {
      title: "错误率",
      dataIndex: "error_rate_level",
      width: 88,
      render: (_: unknown, record: WrongQuestion) => renderErrorRate(record),
    },
    {
      title: "录入来源",
      dataIndex: "ingest_source",
      width: 100,
      render: (source: string) => ingestSourceLabel(source),
    },
    {
      title: "录入人",
      dataIndex: "created_by_username",
      width: 110,
      render: (name: string | null | undefined) => name || "未归属",
    },
    {
      title: "操作",
      width: 108,
      fixed: "right",
      render: (_, record) => renderActions(record),
    },
  ];

  return (
    <ConfigProvider theme={FILTER_THEME}>
      <div className="list-filter">
          <Form form={form} onFinish={applyFilters}>
            <Form.Item name="error_rate_level" hidden>
              <Input />
            </Form.Item>
            <Form.Item name="difficulty" hidden>
              <Input />
            </Form.Item>
            <div className="list-filter-primary">
              <div className="list-filter-row">
                <span className="list-filter-kicker" title="高 ≥75%，中 50%–75%，低 &lt;50%；未练的题只出现在全部">
                  错误率
                </span>
                <div className="list-filter-pills" role="radiogroup" aria-label="错误率">
                  {ERROR_RATE_PILLS.map((item) => {
                    const active = errorRateLevel === item.value;
                    return (
                      <button
                        key={item.label}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        className={`list-filter-pill${active ? " is-active" : ""}`}
                        onClick={() => {
                          if (active) return;
                          if (item.value == null) {
                            form.resetFields(["error_rate_level"]);
                          } else {
                            form.setFieldValue("error_rate_level", item.value);
                          }
                          applyFilters();
                        }}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="list-filter-row">
                <span className="list-filter-kicker">难度</span>
                <div className="list-filter-pills" role="radiogroup" aria-label="难度">
                  {DIFFICULTY_PILLS.map((item) => {
                    const active = selectedDifficulty === item.value;
                    return (
                      <button
                        key={item.label}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        className={`list-filter-pill${active ? " is-active" : ""}`}
                        onClick={() => {
                          if (active) return;
                          if (item.value == null) {
                            form.resetFields(["difficulty"]);
                          } else {
                            form.setFieldValue("difficulty", item.value);
                          }
                          applyFilters();
                        }}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              {activeFilterCount > 0 ? (
                <button type="button" className="list-filter-reset" onClick={handleResetFilters}>
                  清除条件{activeFilterCount > 1 ? ` · ${activeFilterCount}` : ""}
                </button>
              ) : null}
            </div>

            <div className="list-filter-fields">
              <div className={`list-filter-field${knowledgeTagId ? " is-filled" : ""}`}>
                <span className="list-filter-kicker">知识点</span>
                <Form.Item name="knowledge_tag_id">
                  <Select
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    options={buildKnowledgeTagSelectOptions(knowledgeTags, { includeInactive: true })}
                    placeholder="按知识点筛选"
                    onChange={(value) => {
                      form.setFieldValue("knowledge_tag_id", value);
                      applyFilters();
                    }}
                  />
                </Form.Item>
              </div>
              <div className={`list-filter-field${questionTypeId ? " is-filled" : ""}`}>
                <span className="list-filter-kicker">题型</span>
                <Form.Item name="question_type_id">
                  <Select
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    options={buildQuestionTypeSelectOptions(questionTypes)}
                    placeholder="按题型筛选"
                    onChange={(value) => {
                      form.setFieldValue("question_type_id", value);
                      applyFilters();
                    }}
                  />
                </Form.Item>
              </div>
              <div className={`list-filter-field is-id${questionId ? " is-filled" : ""}`}>
                <span className="list-filter-kicker">题目 ID</span>
                <Form.Item name="id">
                  <InputNumber
                    min={1}
                    precision={0}
                    controls={false}
                    style={{ width: "100%" }}
                    placeholder="回车查找"
                    onPressEnter={applyFilters}
                    onChange={(value) => {
                      if (value == null) applyFilters();
                    }}
                  />
                </Form.Item>
              </div>
            </div>
          </Form>
        </div>

      <div className="list-results">
        <div className="list-results-head">
          <div className="list-results-meta">
            共 <strong>{total}</strong> 条
            {bankScope === "org" ? (
              <span className="list-results-note">
                {currentRole === "superadmin" ? " · 全站题目" : " · 本机构所有人录入的题目，含你自己的"}
              </span>
            ) : bankScope === "public" ? (
              <span className="list-results-note"> · 超管已发布到平台公共库的题目</span>
            ) : null}
          </div>
          <div className="list-results-tools">
            {showBankTabs ? (
              <>
                <div className="list-view-toggle" role="radiogroup" aria-label="题库范围">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={bankScope === "mine"}
                    className={bankScope === "mine" ? "is-active" : undefined}
                    onClick={() => handleBankScope("mine")}
                  >
                    自己录入的
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={bankScope === "org"}
                    className={bankScope === "org" ? "is-active" : undefined}
                    onClick={() => handleBankScope("org")}
                  >
                    {orgBankLabel}
                  </button>
                  {canSeePublicBank ? (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={bankScope === "public"}
                      className={bankScope === "public" ? "is-active" : undefined}
                      onClick={() => handleBankScope("public")}
                    >
                      平台公共库
                    </button>
                  ) : null}
                </div>
                {currentRole === "org_admin" && !canSeePublicBank ? (
                  bankRequestStatus === "pending" ? (
                    <Tag color="processing">公共库审批中</Tag>
                  ) : (
                    <Button
                      onClick={() => {
                        setClaimReason("");
                        setClaimOpen(true);
                      }}
                    >
                      {bankRequestStatus === "rejected" ? "再次申请平台公共库" : "申请平台公共库"}
                    </Button>
                  )
                ) : null}
              </>
            ) : null}
            <div className="list-view-toggle" role="radiogroup" aria-label="展现方式">
              <button
                type="button"
                role="radio"
                aria-checked={listView === "table"}
                className={listView === "table" ? "is-active" : undefined}
                onClick={() => handleListView("table")}
              >
                <UnorderedListOutlined />
                <span>表格</span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={listView === "card"}
                className={listView === "card" ? "is-active" : undefined}
                onClick={() => handleListView("card")}
              >
                <AppstoreOutlined />
                <span>卡片</span>
              </button>
            </div>
          </div>
        </div>

        {listView === "table" ? (
          <Table
            rowKey="id"
            tableLayout="fixed"
            loading={loading}
            columns={columns}
            dataSource={tableData}
            pagination={false}
            scroll={{ x: 1266 }}
            locale={{
              emptyText:
                bankScope === "org"
                  ? "机构库暂无题目"
                  : bankScope === "public"
                    ? "平台公共库暂无已发布题目"
                    : "暂无题目",
            }}
          />
        ) : (
          <Spin spinning={loading}>
            {tableData.length ? (
              <div className="list-cards">
                {tableData.map((record) => (
                  <article
                    key={record.id}
                    className="list-qcard"
                    onClick={() => handleView(record.id)}
                  >
                    <div className="list-qcard-top">
                      <span className="list-qcard-flags">
                        {renderDifficulty(record.difficulty)}
                        {renderErrorRate(record)}
                      </span>
                      {questionManageable(record) ? (
                        <span className="list-qcard-id-slot" onClick={(event) => event.stopPropagation()}>
                          <span className="list-qcard-id">#{record.id}</span>
                          <Popconfirm title="确认删除该题目？" onConfirm={() => handleDelete(record.id)} okText="删除" cancelText="取消">
                            <button type="button" className="list-qcard-delete" aria-label="删除">
                              <DeleteOutlined />
                            </button>
                          </Popconfirm>
                        </span>
                      ) : (
                        <span className="list-qcard-id">#{record.id}</span>
                      )}
                    </div>
                    <div className="list-qcard-stem">{record.stem}</div>
                    <div className="list-qcard-meta">
                      <span>{typeMap.get(record.question_type_id) || "未分题型"}</span>
                      <span>{ingestSourceLabel(record.ingest_source)}</span>
                      {record.is_public ? <span>公共库</span> : null}
                    </div>
                    {record.knowledge_tag_ids.length ? renderTags(record.knowledge_tag_ids, 3) : null}
                    <div className="list-qcard-foot">
                      <span className="list-qcard-author">{record.created_by_username || "未归属"}</span>
                      {renderActions(record, true)}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="list-empty">
                <Empty
                  description={
                    bankScope === "org"
                      ? "机构库暂无题目"
                      : bankScope === "public"
                        ? "平台公共库暂无已发布题目"
                        : "暂无题目"
                  }
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              </div>
            )}
          </Spin>
        )}
        <Pagination className="list-results-pagination" align="end" {...pagination} />
      </div>

      <WrongQuestionDetailDrawer
        open={detailOpen}
        loading={detailLoading}
        detail={detail}
        typeMap={typeMap}
        tagMap={tagMap}
        canAnalyze={detail ? questionManageable(detail) : false}
        onClose={() => setDetailOpen(false)}
        onDetailChange={setDetail}
      />

      <Modal
        title="申请平台公共库"
        open={claimOpen}
        okText="提交申请"
        confirmLoading={claimSubmitting}
        onOk={() => {
          handleClaim().catch(() => undefined);
        }}
        onCancel={() => {
          setClaimOpen(false);
          setClaimReason("");
        }}
      >
        <Typography.Paragraph type="secondary">
          仅机构管理员可以申请。开通后，本机构布置任务时可抽取超管已发布的平台公共库题目；撤回后不再能抽，已布置进任务的题目和学生作答会保留。
        </Typography.Paragraph>
        <Input.TextArea
          rows={4}
          value={claimReason}
          onChange={(e) => setClaimReason(e.target.value)}
          placeholder="可选：说明用途，例如布置作业、补充解析"
          maxLength={500}
        />
      </Modal>

      <Drawer
        className="entry-drawer"
        title={editing ? `编辑 #${editing.id}` : "编辑"}
        open={!!editing}
        onClose={() => setEditing(null)}
        size={880}
        destroyOnHidden
        styles={{ body: { padding: 0 } }}
      >
        <div className="entry-drawer-panel">
          <div className="entry-body">
            <Form form={editForm} layout="vertical">
              <WrongQuestionFormFields
                questionTypes={questionTypes}
                knowledgeTags={knowledgeTags}
                suggestingTags={suggestingTags}
                onSuggest={() => {
                  handleSuggestKnowledgeTags().catch(() => undefined);
                }}
              />
            </Form>
          </div>
          <div className="entry-bar">
            <div className="entry-bar-meta">保存后立即更新列表。</div>
            <div className="entry-bar-actions">
              <Button onClick={() => setEditing(null)}>取消</Button>
              <Button
                type="primary"
                loading={editSubmitting}
                onClick={() => {
                  handleEditSubmit().catch((error) => {
                    message.error(getApiErrorMessage(error) || "提交失败，请检查字段");
                  });
                }}
              >
                保存
              </Button>
            </div>
          </div>
        </div>
      </Drawer>
    </ConfigProvider>
  );
}
