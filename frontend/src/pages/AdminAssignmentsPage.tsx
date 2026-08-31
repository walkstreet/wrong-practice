import {
  CopyOutlined,
  DeleteOutlined,
  ExportOutlined,
  EyeOutlined,
  StopOutlined,
  TeamOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Checkbox,
  Col,
  ConfigProvider,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Select,
  Spin,
  Table,
  Tooltip,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import axios from "axios";
import { useEffect, useMemo, useState } from "react";

import {
  assignUsers,
  closeAssignment,
  createAssignment,
  deleteAssignment,
  generateAssignmentQuestions,
  getAssignmentQuestionPool,
  getAssignmentSubmissionDetail,
  listAdminUsers,
  listAssignmentSubmissions,
  listAssignments,
  listKnowledgeTags,
  listQuestionTypes,
  suggestKnowledgeTags,
  type AiExtractDraftItem,
} from "../api";
import { DifficultyFieldLabel } from "../components/DifficultyHint";
import type {
  AdminUser,
  AnswerItem,
  Assignment,
  AssignmentSubmissionDetail,
  AssignmentSubmissionItem,
  KnowledgeTag,
  QuestionType,
  UserRole,
} from "../types";
import { copyText } from "../utils/clipboard";
import { formatDateTimeLocal } from "../utils/datetime";
import { DIFFICULTY_SELECT_OPTIONS, difficultyLabel } from "../utils/difficulty";
import { buildKnowledgeTagSelectOptions } from "../utils/knowledgeTags";
import { assignmentStatusLabel, userAssignmentStatusLabel } from "../utils/labels";
import { linesToAnswers, linesToOptions, listToLines } from "../utils/optionLines";
import { buildQuestionTypeSelectOptions } from "../utils/questionTypes";
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

interface CreateAssignmentValues {
  title: string;
  description?: string;
  question_type_id: number;
  question_count: number;
  sources?: string[];
}

function assignedLabels(usernames: string[] | undefined, learners: AdminUser[]): string {
  if (!usernames?.length) return "—";
  const map = new Map(learners.map((u) => [u.username, userLabel(u)]));
  return usernames.map((name) => map.get(name) || name).join("、");
}

function getApiErrorMessage(error: unknown): string | null {
  if (axios.isAxiosError(error)) {
    if (error.response?.status === 401) return "登录已失效，请重新登录后再试";
    if (error.response?.status === 403) return "权限不足";
    const detail = error.response?.data?.detail;
    if (typeof detail === "string" && detail.trim()) return detail;
  }
  return null;
}

function joinWarnings(warnings?: string[] | string | null): string {
  if (!warnings) return "";
  if (typeof warnings === "string") return warnings.trim();
  return warnings.filter((w) => typeof w === "string" && w.trim()).join("；");
}

function previewLines(value: unknown, empty = "未填") {
  const text = listToLines(value).replace(/\n/g, " · ").trim();
  return text || empty;
}

function itemNeedsAttention(item: AiExtractDraftItem) {
  return !item.question_type_id || !item.knowledge_tag_ids?.length || Boolean(item.warnings?.length);
}

export default function AdminAssignmentsPage({
  currentUserId,
  currentRole,
  canViewQuestionBank,
}: {
  currentUserId: number | null;
  currentRole: UserRole | null;
  canViewQuestionBank: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Assignment[]>([]);
  const [questionTypes, setQuestionTypes] = useState<QuestionType[]>([]);
  const [learners, setLearners] = useState<AdminUser[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [assigning, setAssigning] = useState<Assignment | null>(null);
  const [assignUserIds, setAssignUserIds] = useState<number[]>([]);
  const [submissions, setSubmissions] = useState<AssignmentSubmissionItem[]>([]);
  const [submissionLoading, setSubmissionLoading] = useState(false);
  const [activeAssignmentId, setActiveAssignmentId] = useState<number | null>(null);
  const [detail, setDetail] = useState<AssignmentSubmissionDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [form] = Form.useForm<CreateAssignmentValues>();
  const [knowledgeTags, setKnowledgeTags] = useState<KnowledgeTag[]>([]);
  const [poolAvailable, setPoolAvailable] = useState<number | null>(null);
  const [includesSharedBank, setIncludesSharedBank] = useState(false);
  const [pendingCreate, setPendingCreate] = useState<CreateAssignmentValues | null>(null);
  const [shortageOpen, setShortageOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [aiItems, setAiItems] = useState<AiExtractDraftItem[]>([]);
  const [aiWarnings, setAiWarnings] = useState<string[]>([]);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiConfirming, setAiConfirming] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [suggestingLocalId, setSuggestingLocalId] = useState<string | null>(null);

  const watchedTypeId = Form.useWatch("question_type_id", form);
  const watchedCount = Form.useWatch("question_count", form);
  const watchedSources = Form.useWatch("sources", form) as string[] | undefined;
  const canUsePublic = canViewQuestionBank || currentRole === "superadmin";
  const selectedSources = watchedSources?.length ? watchedSources : ["mine"];

  function canMutateAssignment(row: Assignment) {
    return currentRole === "superadmin" || row.created_by === currentUserId;
  }

  const learnerOptions = useMemo(
    () => learners.filter((u) => u.role === "student").map((u) => ({ label: userOptionLabel(u), value: u.id })),
    [learners],
  );

  const questionTypeOptions = useMemo(() => buildQuestionTypeSelectOptions(questionTypes), [questionTypes]);
  const typeMap = useMemo(() => new Map(questionTypes.map((item) => [item.id, item.name])), [questionTypes]);
  const tagMap = useMemo(() => new Map(knowledgeTags.map((item) => [item.id, item.name])), [knowledgeTags]);
  const selectedAiCount = aiItems.filter((item) => item.selected !== false).length;

  async function loadBaseData() {
    setLoading(true);
    try {
      const [assignmentData, typeData, userData, tagData] = await Promise.all([
        listAssignments(),
        listQuestionTypes(),
        listAdminUsers(),
        listKnowledgeTags(),
      ]);
      setItems(assignmentData);
      setQuestionTypes(typeData);
      setLearners(userData);
      setKnowledgeTags(tagData);
    } catch {
      message.error("加载任务数据失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBaseData();
  }, []);

  useEffect(() => {
    if (!createOpen || !watchedTypeId) {
      setPoolAvailable(null);
      setIncludesSharedBank(false);
      return;
    }
    let cancelled = false;
    getAssignmentQuestionPool(watchedTypeId, selectedSources)
      .then((res) => {
        if (!cancelled) {
          setPoolAvailable(res.available);
          setIncludesSharedBank(Boolean(res.includes_shared_bank));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPoolAvailable(null);
          setIncludesSharedBank(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [createOpen, watchedTypeId, selectedSources.join(",")]);

  function resetAiReview() {
    setReviewOpen(false);
    setAiItems([]);
    setAiWarnings([]);
    setExpandedIds(new Set());
    setSuggestingLocalId(null);
    setPendingCreate(null);
  }

  async function submitAssignment(values: CreateAssignmentValues, aiDrafts?: AiExtractDraftItem[]) {
    const created = await createAssignment({
      title: values.title,
      description: values.description,
      question_type_id: values.question_type_id,
      question_count: values.question_count,
      sources: values.sources?.length ? values.sources : ["mine"],
      ai_items: aiDrafts,
    });
    const imported = aiDrafts?.filter((item) => item.selected !== false).length ?? 0;
    message.success(
      imported
        ? `任务创建成功，已入库 ${imported} 道 AI 出题，共 ${created.question_count} 题`
        : `任务创建成功，实际抽取 ${created.question_count} 题`,
    );
    setCreateOpen(false);
    setShortageOpen(false);
    resetAiReview();
    form.resetFields();
    await loadBaseData();
  }

  async function handleCreate(values: CreateAssignmentValues) {
    setCreateSubmitting(true);
    try {
      const pool = await getAssignmentQuestionPool(
        values.question_type_id,
        values.sources?.length ? values.sources : ["mine"],
      );
      setPoolAvailable(pool.available);
      setIncludesSharedBank(Boolean(pool.includes_shared_bank));
      if (pool.available >= values.question_count) {
        await submitAssignment(values);
        return;
      }
      setPendingCreate(values);
      setCreateOpen(false);
      setShortageOpen(true);
    } catch (error) {
      message.error(getApiErrorMessage(error) || "任务创建失败");
    } finally {
      setCreateSubmitting(false);
    }
  }

  async function handleCreateWithBankOnly() {
    if (!pendingCreate) return;
    setCreateSubmitting(true);
    try {
      await submitAssignment(pendingCreate);
    } catch (error) {
      message.error(getApiErrorMessage(error) || "任务创建失败");
    } finally {
      setCreateSubmitting(false);
    }
  }

  async function handleGenerateAiQuestions() {
    if (!pendingCreate) return;
    const needed = Math.max(1, pendingCreate.question_count - (poolAvailable ?? 0));
    setAiGenerating(true);
    try {
      const result = await generateAssignmentQuestions({
        question_type_id: pendingCreate.question_type_id,
        count: needed,
        title: pendingCreate.title,
        sources: pendingCreate.sources?.length ? pendingCreate.sources : ["mine"],
      });
      const nextItems = result.items.map((item) => ({
        ...item,
        selected: item.selected !== false,
        source: item.source || "AI出题",
        knowledge_tag_ids: item.knowledge_tag_ids || [],
      }));
      setAiItems(nextItems);
      setAiWarnings(result.warnings || []);
      setExpandedIds(new Set(nextItems.filter(itemNeedsAttention).map((item) => item.local_id)));
      setShortageOpen(false);
      setReviewOpen(true);
      if (result.warnings?.length) {
        message.warning(result.warnings[0]);
      } else {
        message.success(`已生成 ${nextItems.length} 题，请核对后再入库`);
      }
    } catch (error) {
      message.error(getApiErrorMessage(error) || "AI 出题失败");
    } finally {
      setAiGenerating(false);
    }
  }

  function updateAiItem(localId: string, patch: Partial<AiExtractDraftItem>) {
    setAiItems((prev) => prev.map((item) => (item.local_id === localId ? { ...item, ...patch } : item)));
  }

  function toggleExpanded(localId: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(localId)) next.delete(localId);
      else next.add(localId);
      return next;
    });
  }

  async function handleSuggestItemTags(item: AiExtractDraftItem) {
    if (!item.stem.trim()) {
      message.warning("请先填写题干");
      return;
    }
    setSuggestingLocalId(item.local_id);
    try {
      const result = await suggestKnowledgeTags({
        stem: item.stem,
        options: item.options,
        correct_answer: item.correct_answer,
        question_type_name: typeMap.get(item.question_type_id || 0) || item.question_type_name || null,
        note: item.note,
      });
      if (!result.knowledge_tag_ids.length) {
        message.warning("未能推荐知识点，请手动选择");
        return;
      }
      updateAiItem(item.local_id, { knowledge_tag_ids: result.knowledge_tag_ids });
      message.success("已填入推荐知识点");
    } catch (error) {
      message.error(getApiErrorMessage(error) || "推荐知识点失败");
    } finally {
      setSuggestingLocalId(null);
    }
  }

  async function handleConfirmAiAndCreate() {
    if (!pendingCreate) return;
    const selected = aiItems.filter((item) => item.selected !== false);
    if (!selected.length) {
      message.warning("请至少勾选一道题，或改为仅用现有题目创建");
      return;
    }
    const incomplete = selected.filter((item) => !item.question_type_id || !item.knowledge_tag_ids?.length);
    if (incomplete.length) {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        incomplete.forEach((item) => next.add(item.local_id));
        return next;
      });
      message.warning(`还有 ${incomplete.length} 题缺少题型或知识点`);
      return;
    }
    setAiConfirming(true);
    try {
      await submitAssignment(pendingCreate, aiItems);
    } catch (error) {
      message.error(getApiErrorMessage(error) || "确认入库失败");
    } finally {
      setAiConfirming(false);
    }
  }

  async function handleAssign() {
    if (!assigning || assignUserIds.length === 0) return;
    try {
      const res = await assignUsers(assigning.id, assignUserIds);
      message.success(`分配成功，新增 ${res.created} 条`);
      setAssigning(null);
      setAssignUserIds([]);
      await loadBaseData();
      if (activeAssignmentId === assigning.id) {
        await handleLoadSubmissions(assigning.id);
      }
    } catch {
      message.error("分配失败，请检查用户是否为学生");
    }
  }

  async function handleLoadSubmissions(assignmentId: number) {
    setActiveAssignmentId(assignmentId);
    setSubmissionLoading(true);
    try {
      const data = await listAssignmentSubmissions(assignmentId);
      setSubmissions(data);
    } catch {
      message.error("加载提交记录失败");
    } finally {
      setSubmissionLoading(false);
    }
  }

  async function handleViewSubmission(userId: number) {
    if (!activeAssignmentId) return;
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      const data = await getAssignmentSubmissionDetail(activeAssignmentId, userId);
      setDetail(data);
    } catch {
      message.error("加载提交详情失败");
    } finally {
      setDetailLoading(false);
    }
  }

  function handleOpenAssignModal(row: Assignment) {
    const usernameToId = new Map(learners.map((u) => [u.username, u.id]));
    const currentAssignedIds = (row.assigned_users || [])
      .map((name) => usernameToId.get(name))
      .filter((id): id is number => typeof id === "number");
    setAssigning(row);
    setAssignUserIds(currentAssignedIds);
  }

  function learnerLink(assignmentId: number) {
    return `${window.location.origin}/learn/assignments/${assignmentId}`;
  }

  async function handleCopyLearnerLink(assignmentId: number) {
    const url = learnerLink(assignmentId);
    const ok = await copyText(url);
    if (ok) {
      message.success("前台任务链接已复制");
      return;
    }
    message.error({
      content: `复制失败，请手动复制：${url}`,
      duration: 8,
    });
  }

  function handleOpenLearnerLink(assignmentId: number) {
    window.open(learnerLink(assignmentId), "_blank", "noopener,noreferrer");
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

  async function handleCloseAssignment(row: Assignment) {
    if (row.status === "closed") {
      message.info("任务已关闭");
      return;
    }
    try {
      await closeAssignment(row.id);
      message.success("任务已关闭");
      await loadBaseData();
      if (activeAssignmentId === row.id) {
        await handleLoadSubmissions(row.id);
      }
    } catch {
      message.error("关闭任务失败");
    }
  }

  async function handleDeleteAssignment(row: Assignment) {
    try {
      await deleteAssignment(row.id);
      message.success("任务已删除");
      if (activeAssignmentId === row.id) {
        setActiveAssignmentId(null);
        setSubmissions([]);
      }
      await loadBaseData();
    } catch {
      message.error("删除任务失败");
    }
  }

  const columns: ColumnsType<Assignment> = [
    { title: "ID", dataIndex: "id", width: 64 },
    { title: "标题", dataIndex: "title", ellipsis: true },
    {
      title: "状态",
      dataIndex: "status",
      width: 88,
      render: (v: Assignment["status"]) => <span className={`list-status is-${v}`}>{assignmentStatusLabel(v)}</span>,
    },
    { title: "题数", dataIndex: "question_count", width: 64 },
    {
      title: "分配人",
      dataIndex: "assigned_users",
      width: 160,
      ellipsis: true,
      render: (users: string[]) => assignedLabels(users, learners),
    },
    {
      title: "操作",
      width: 228,
      render: (_, row) => {
        const mutable = canMutateAssignment(row);
        return (
        <span className="list-icon-actions">
          {mutable ? (
          <Tooltip title="分配用户">
            <button type="button" className="list-icon-action" aria-label="分配用户" onClick={() => handleOpenAssignModal(row)}>
              <TeamOutlined />
            </button>
          </Tooltip>
          ) : null}
          <Tooltip title="复制前台链接">
            <button
              type="button"
              className="list-icon-action"
              aria-label="复制前台链接"
              onClick={() => handleCopyLearnerLink(row.id)}
            >
              <CopyOutlined />
            </button>
          </Tooltip>
          <Tooltip title={`打开 ${learnerLink(row.id)}`}>
            <button
              type="button"
              className="list-icon-action"
              aria-label="打开前台链接"
              onClick={() => handleOpenLearnerLink(row.id)}
            >
              <ExportOutlined />
            </button>
          </Tooltip>
          <Tooltip title="提交记录">
            <button
              type="button"
              className="list-icon-action"
              aria-label="提交记录"
              onClick={() => handleLoadSubmissions(row.id)}
            >
              <UnorderedListOutlined />
            </button>
          </Tooltip>
          {mutable ? (
            <>
          <Tooltip title={row.status === "closed" ? "任务已关闭" : "关闭任务"}>
            <Popconfirm
              title={`确认关闭任务「${row.title}」？`}
              description="关闭后学生将无法继续作答。"
              onConfirm={() => handleCloseAssignment(row)}
              okText="关闭"
              cancelText="取消"
              disabled={row.status === "closed"}
            >
              <button
                type="button"
                className="list-icon-action"
                aria-label="关闭任务"
                disabled={row.status === "closed"}
              >
                <StopOutlined />
              </button>
            </Popconfirm>
          </Tooltip>
          <Tooltip title="删除任务">
            <Popconfirm
              title={`确认删除任务「${row.title}」？`}
              description="删除后不可恢复，关联的分配和作答记录也会一并删除。"
              okText="确认删除"
              okButtonProps={{ danger: true }}
              cancelText="取消"
              onConfirm={() => handleDeleteAssignment(row)}
            >
              <button type="button" className="list-icon-action is-danger" aria-label="删除任务">
                <DeleteOutlined />
              </button>
            </Popconfirm>
          </Tooltip>
            </>
          ) : (
            <span style={{ color: "#8a829c", fontSize: 12 }}>只读</span>
          )}
        </span>
        );
      },
    },
  ];

  const submissionColumns: ColumnsType<AssignmentSubmissionItem> = [
    { title: "用户 ID", dataIndex: "user_id", width: 80 },
    { title: "学生", key: "name", ellipsis: true, render: (_, row) => userLabel(row) },
    {
      title: "状态",
      dataIndex: "status",
      width: 100,
      render: (v: AssignmentSubmissionItem["status"]) => (
        <span className={`list-status is-${v}`}>{userAssignmentStatusLabel(v)}</span>
      ),
    },
    { title: "已作答", dataIndex: "answered_questions", width: 88 },
    { title: "答对", dataIndex: "correct_questions", width: 72 },
    { title: "分数", dataIndex: "score", width: 80, render: (v) => (typeof v === "number" ? v : "—") },
    {
      title: "正确率",
      dataIndex: "accuracy_rate",
      width: 100,
      render: (v) => (typeof v === "number" ? `${(v * 100).toFixed(1)}%` : "—"),
    },
    {
      title: "提交时间",
      dataIndex: "submitted_at",
      width: 180,
      render: (v?: string | null) => formatDateTimeLocal(v),
    },
    {
      title: "操作",
      width: 64,
      render: (_, row) => (
        <Tooltip title="查看详情">
          <button type="button" className="list-icon-action" aria-label="查看详情" onClick={() => handleViewSubmission(row.user_id)}>
            <EyeOutlined />
          </button>
        </Tooltip>
      ),
    },
  ];

  return (
    <ConfigProvider theme={FILTER_THEME}>
      <div className="list-results is-fit">
        <div className="list-results-head">
          <div className="list-results-meta">
            共 <strong>{items.length}</strong> 条
          </div>
          <div className="list-results-tools">
            <Button
              type="primary"
              onClick={() => {
                form.resetFields();
                setCreateOpen(true);
              }}
            >
              新建任务
            </Button>
          </div>
        </div>
        <Table
          rowKey="id"
          tableLayout="fixed"
          loading={loading}
          columns={columns}
          dataSource={items}
          pagination={false}
          locale={{ emptyText: "暂无任务" }}
        />
      </div>

      {activeAssignmentId ? (
        <div className="list-results is-fit">
          <div className="list-results-head">
            <div className="list-results-meta">
              任务 #{activeAssignmentId} 的提交 · 共 <strong>{submissions.length}</strong> 条
            </div>
            <div className="list-results-tools">
              <button
                type="button"
                className="list-action"
                onClick={() => {
                  setActiveAssignmentId(null);
                  setSubmissions([]);
                }}
              >
                收起
              </button>
            </div>
          </div>
          <Table
            rowKey={(row) => `${row.user_id}-${row.submitted_at || "none"}`}
            tableLayout="fixed"
            loading={submissionLoading}
            columns={submissionColumns}
            dataSource={submissions}
            pagination={false}
            locale={{ emptyText: "暂无提交记录" }}
          />
        </div>
      ) : null}

      <Drawer
        className="entry-drawer is-roomy"
        title="新建任务"
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        size={880}
        destroyOnHidden
        styles={{ body: { padding: 0 } }}
      >
        <div className="entry-drawer-panel">
          <div className="entry-body">
            <p className="entry-hint">
              按题型从勾选的题库来源随机抽题。可选自己录入的、机构库（含自己的）、以及已开通的平台公共库，可混合。题库不够时可由 AI 出题补充，经你确认后入库并编入任务。
            </p>
            <Form form={form} layout="vertical" onFinish={handleCreate} initialValues={{ question_count: 20, sources: ["mine"] }}>
              <Form.Item name="title" label="任务标题" rules={[{ required: true, message: "请输入任务标题" }]}>
                <Input placeholder="例如：比较级周练" />
              </Form.Item>
              <Form.Item name="description" label="任务描述">
                <Input.TextArea rows={4} placeholder="可选，给学生的说明" />
              </Form.Item>
              <div className="entry-view-row">
                <Form.Item name="question_type_id" label="抽题题型" rules={[{ required: true, message: "请选择题型" }]}>
                  <Select options={questionTypeOptions} placeholder="请选择题型" />
                </Form.Item>
                <Form.Item name="question_count" label="抽题数量" rules={[{ required: true, message: "请输入抽题数量" }]}>
                  <InputNumber min={1} max={200} style={{ width: "100%" }} />
                </Form.Item>
              </div>
              <Form.Item
                name="sources"
                label="抽题来源"
                rules={[{ required: true, message: "请至少选一个来源" }]}
                extra={
                  watchedTypeId && poolAvailable != null
                    ? `${
                        poolAvailable >= (watchedCount || 0)
                          ? `当前来源可抽 ${poolAvailable} 题，足够抽取 ${watchedCount || 0} 题。`
                          : `当前来源可抽 ${poolAvailable} 题，还差 ${Math.max(0, (watchedCount || 0) - poolAvailable)} 题。创建时会询问是否让 AI 出题补充。`
                      }${includesSharedBank && selectedSources.includes("public") ? " 已包含平台公共库。" : ""}`
                    : "选择题型和来源后可查看可抽题数量。机构库含本机构所有人录入的题。题库不足时 AI 出题需老师确认才会入库。"
                }
              >
                <Checkbox.Group
                  options={[
                    { label: "自己录入的", value: "mine" },
                    { label: "机构库", value: "org" },
                    { label: canUsePublic ? "平台公共库" : "平台公共库（未开通）", value: "public", disabled: !canUsePublic },
                  ]}
                />
              </Form.Item>
            </Form>
          </div>
          <div className="entry-bar">
            <div className="entry-bar-meta">创建后可再分配学生。</div>
            <div className="entry-bar-actions">
              <Button onClick={() => setCreateOpen(false)}>取消</Button>
              <Button type="primary" loading={createSubmitting} onClick={() => form.submit()}>
                创建
              </Button>
            </div>
          </div>
        </div>
      </Drawer>

      <Modal
        className="list-modal"
        title="题库数量不足"
        open={shortageOpen}
        onCancel={() => {
          setShortageOpen(false);
          setPendingCreate(null);
        }}
        footer={null}
      >
        <p className="list-modal-hint">
          当前题型题库有 <strong>{poolAvailable ?? 0}</strong> 题，任务需要{" "}
          <strong>{pendingCreate?.question_count ?? 0}</strong> 题，还差{" "}
          <strong>{Math.max(0, (pendingCreate?.question_count ?? 0) - (poolAvailable ?? 0))}</strong> 题。
          AI 生成的题目需你核对后才会加入题库，来源标记为「AI出题」。
        </p>
        <div className="entry-bar-actions" style={{ justifyContent: "flex-end", marginTop: 16 }}>
          <Button
            onClick={() => {
              setShortageOpen(false);
              setPendingCreate(null);
            }}
          >
            取消
          </Button>
          <Button loading={createSubmitting} onClick={() => handleCreateWithBankOnly().catch(() => undefined)}>
            仅用现有题目创建
          </Button>
          <Button
            type="primary"
            loading={aiGenerating}
            onClick={() => handleGenerateAiQuestions().catch(() => undefined)}
          >
            AI 出题补充
          </Button>
        </div>
      </Modal>

      <Drawer
        className="entry-drawer is-roomy"
        title="确认 AI 出题"
        open={reviewOpen}
        onClose={resetAiReview}
        size={880}
        destroyOnHidden
        styles={{ body: { padding: 0 } }}
      >
        <div className="entry-drawer-panel">
          <div className="entry-body">
            {aiGenerating ? (
              <div className="entry-empty">
                <Spin />
                <p>正在出题，请稍候…</p>
              </div>
            ) : (
              <div className="entry-review-list">
                <p className="entry-hint">
                  勾选你认为可用的题目。确认后会加入题库（来源：AI出题），并编入任务「{pendingCreate?.title}」。
                </p>
                {aiWarnings.length ? <Alert type="warning" showIcon message={joinWarnings(aiWarnings)} /> : null}
                {aiItems.map((item, index) => {
                  const warn = itemNeedsAttention(item);
                  const expanded = expandedIds.has(item.local_id);
                  const typeName =
                    (item.question_type_id && typeMap.get(item.question_type_id)) || item.question_type_name || "未分题型";
                  const tags = (item.knowledge_tag_ids || []).map((id) => tagMap.get(id)).filter(Boolean) as string[];
                  return (
                    <article key={item.local_id} className={`entry-qcard${warn ? " is-warn" : ""}`}>
                      <div className="entry-qcard-head">
                        <Checkbox
                          checked={item.selected !== false}
                          onChange={(event) => updateAiItem(item.local_id, { selected: event.target.checked })}
                        />
                        <span className="entry-qcard-title">第 {index + 1} 题</span>
                        {warn ? <span className="list-status is-not_reviewed">建议核对</span> : null}
                        <div className="entry-qcard-tools">
                          <button type="button" className="list-action" onClick={() => toggleExpanded(item.local_id)}>
                            {expanded ? "收起" : "展开编辑"}
                          </button>
                          <Popconfirm
                            title="从本次出题中移除？"
                            okText="移除"
                            cancelText="取消"
                            onConfirm={() => setAiItems((prev) => prev.filter((row) => row.local_id !== item.local_id))}
                          >
                            <button type="button" className="list-action is-danger">
                              移除
                            </button>
                          </Popconfirm>
                        </div>
                      </div>
                      {item.warnings?.length ? <div className="entry-qcard-warn">{joinWarnings(item.warnings)}</div> : null}
                      {expanded ? (
                        <Form layout="vertical" size="small" className="entry-qcard-form">
                          <Form.Item label="题干" required>
                            <Input.TextArea
                              rows={4}
                              value={item.stem}
                              onChange={(e) => updateAiItem(item.local_id, { stem: e.target.value })}
                            />
                          </Form.Item>
                          <Row gutter={16}>
                            <Col xs={24} md={8}>
                              <Form.Item label="题型" required>
                                <Select
                                  placeholder="按大类选择题型"
                                  showSearch
                                  optionFilterProp="label"
                                  value={item.question_type_id ?? undefined}
                                  options={questionTypeOptions}
                                  onChange={(value) => updateAiItem(item.local_id, { question_type_id: value })}
                                />
                              </Form.Item>
                            </Col>
                            <Col xs={24} md={16}>
                              <Form.Item
                                label={
                                  <span>
                                    知识点{" "}
                                    <button
                                      type="button"
                                      className="list-action"
                                      disabled={suggestingLocalId === item.local_id}
                                      onClick={() => {
                                        handleSuggestItemTags(item).catch(() => undefined);
                                      }}
                                    >
                                      {suggestingLocalId === item.local_id ? "推荐中…" : "AI 推荐"}
                                    </button>
                                  </span>
                                }
                                required
                              >
                                <Select
                                  mode="multiple"
                                  placeholder="可点 AI 推荐或手动选择"
                                  showSearch
                                  optionFilterProp="label"
                                  maxTagCount="responsive"
                                  value={item.knowledge_tag_ids || []}
                                  options={buildKnowledgeTagSelectOptions(knowledgeTags)}
                                  onChange={(value) => updateAiItem(item.local_id, { knowledge_tag_ids: value })}
                                />
                              </Form.Item>
                            </Col>
                          </Row>
                          <Form.Item label="选项" extra="每行一组；多组可用 | 分隔">
                            <Input.TextArea
                              rows={4}
                              value={listToLines(item.options)}
                              onChange={(e) => updateAiItem(item.local_id, { options: linesToOptions(e.target.value) })}
                            />
                          </Form.Item>
                          <Row gutter={16}>
                            <Col xs={24}>
                              <Form.Item label="正确答案" required>
                                <Input.TextArea
                                  rows={3}
                                  value={listToLines(item.correct_answer)}
                                  onChange={(e) =>
                                    updateAiItem(item.local_id, { correct_answer: linesToAnswers(e.target.value) })
                                  }
                                />
                              </Form.Item>
                            </Col>
                          </Row>
                          <Row gutter={16}>
                            <Col xs={24} md={8}>
                              <Form.Item label={<DifficultyFieldLabel />}>
                                <Select
                                  allowClear
                                  placeholder="未评级"
                                  options={DIFFICULTY_SELECT_OPTIONS}
                                  value={item.difficulty ?? undefined}
                                  onChange={(value) => updateAiItem(item.local_id, { difficulty: value ?? null })}
                                />
                              </Form.Item>
                            </Col>
                            <Col xs={24} md={16}>
                              <Form.Item label="来源">
                                <Input
                                  value={item.source ?? "AI出题"}
                                  onChange={(e) => updateAiItem(item.local_id, { source: e.target.value || "AI出题" })}
                                />
                              </Form.Item>
                            </Col>
                          </Row>
                          <Form.Item label="备注">
                            <Input.TextArea
                              rows={2}
                              value={item.note ?? ""}
                              onChange={(e) => updateAiItem(item.local_id, { note: e.target.value || null })}
                            />
                          </Form.Item>
                        </Form>
                      ) : (
                        <div
                          className="entry-qcard-summary"
                          onClick={() => toggleExpanded(item.local_id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              toggleExpanded(item.local_id);
                            }
                          }}
                          role="button"
                          tabIndex={0}
                        >
                          <div className="entry-qcard-stem">{item.stem || "（无题干）"}</div>
                          <div className="entry-qcard-pair">
                            <span>
                              正确 <strong>{previewLines(item.correct_answer)}</strong>
                            </span>
                          </div>
                          <div className="entry-qcard-meta">
                            <span className="list-chip is-muted">{typeName}</span>
                            {item.difficulty != null ? (
                              <span className="list-chip is-muted">{difficultyLabel(item.difficulty)}</span>
                            ) : null}
                            {tags.length ? (
                              tags.slice(0, 3).map((name) => (
                                <span key={name} className="list-chip">
                                  {name}
                                </span>
                              ))
                            ) : (
                              <span className="list-chip is-muted">未选知识点</span>
                            )}
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </div>
          <div className="entry-bar">
            <div className="entry-bar-meta">
              <Checkbox
                checked={selectedAiCount === aiItems.length && aiItems.length > 0}
                indeterminate={selectedAiCount > 0 && selectedAiCount < aiItems.length}
                onChange={(event) =>
                  setAiItems((prev) => prev.map((item) => ({ ...item, selected: event.target.checked })))
                }
              >
                已选 <strong>{selectedAiCount}</strong> / {aiItems.length} 题
              </Checkbox>
            </div>
            <div className="entry-bar-actions">
              <Button loading={createSubmitting} onClick={() => handleCreateWithBankOnly().catch(() => undefined)}>
                跳过，仅用题库创建
              </Button>
              <Button
                type="primary"
                loading={aiConfirming}
                disabled={selectedAiCount === 0}
                onClick={() => handleConfirmAiAndCreate().catch(() => undefined)}
              >
                确认入库并创建任务
              </Button>
            </div>
          </div>
        </div>
      </Drawer>

      <Modal
        className="list-modal"
        title={assigning ? `分配用户（任务 #${assigning.id}）` : "分配用户"}
        open={!!assigning}
        onCancel={() => {
          setAssigning(null);
          setAssignUserIds([]);
        }}
        onOk={handleAssign}
        okText="分配"
        cancelText="取消"
      >
        <p className="list-modal-hint">
          当前已分配：{assignedLabels(assigning?.assigned_users, learners)}
        </p>
        <Select
          mode="multiple"
          showSearch
          optionFilterProp="label"
          style={{ width: "100%" }}
          value={assignUserIds}
          onChange={setAssignUserIds}
          options={learnerOptions}
          placeholder="按姓名选择学生"
        />
      </Modal>

      <Drawer
        className="entry-drawer"
        title="提交详情"
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        size={760}
      >
        {detailLoading || !detail ? (
          <div className="entry-empty">加载中…</div>
        ) : (
          <div className="task-sheet">
            <div className="task-summary">
              <span className={`list-status is-${detail.status}`}>{userAssignmentStatusLabel(detail.status)}</span>
              <span>学生：{userLabel(detail)}</span>
              <span>分数：{detail.score ?? "—"}</span>
              <span>
                正确率：
                {typeof detail.accuracy_rate === "number" ? `${(detail.accuracy_rate * 100).toFixed(1)}%` : "—"}
              </span>
            </div>
            {detail.answers.map((a) => (
              <article key={a.id} className="task-qcard">
                <div className="task-qcard-head">
                  <span className="task-qcard-index">题目 #{a.wrong_question_id}</span>
                    <span className={`list-status ${a.is_correct ? "is-correct" : a.correct_slots ? "is-pending" : "is-wrong"}`}>
                      {a.total_slots && a.total_slots > 1
                        ? `${a.correct_slots ?? 0}/${a.total_slots} 空`
                        : a.is_correct
                          ? "正确"
                          : "错误"}
                    </span>
                </div>
                <p className="task-stem">{a.wrong_question_stem || "—"}</p>
                <p className="task-answer">
                  <strong>作答</strong> {formatAnswerValue(a.user_answer as AnswerItem[])}
                </p>
                <p className="task-answer">
                  <strong>标答</strong> {formatAnswerValue(a.standard_answer as AnswerItem[] | null)}
                </p>
              </article>
            ))}
          </div>
        )}
      </Drawer>
    </ConfigProvider>
  );
}
