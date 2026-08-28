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
  Button,
  ConfigProvider,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Table,
  Tooltip,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";

import {
  assignUsers,
  closeAssignment,
  createAssignment,
  deleteAssignment,
  getLocalIpForShare,
  getAssignmentSubmissionDetail,
  listAdminUsers,
  listAssignmentSubmissions,
  listAssignments,
  listQuestionTypes,
} from "../api";
import type {
  AdminUser,
  AnswerItem,
  Assignment,
  AssignmentSubmissionDetail,
  AssignmentSubmissionItem,
  QuestionType,
} from "../types";
import { formatDateTimeLocal } from "../utils/datetime";
import { assignmentStatusLabel, userAssignmentStatusLabel } from "../utils/labels";
import { userLabel, userOptionLabel } from "../utils/userLabel";
import { buildQuestionTypeSelectOptions } from "../utils/questionTypes";

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
}

function assignedLabels(usernames: string[] | undefined, learners: AdminUser[]): string {
  if (!usernames?.length) return "—";
  const map = new Map(learners.map((u) => [u.username, userLabel(u)]));
  return usernames.map((name) => map.get(name) || name).join("、");
}

export default function AdminAssignmentsPage() {
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
  const [shareHost, setShareHost] = useState<string>(window.location.hostname);
  const [form] = Form.useForm<CreateAssignmentValues>();

  const learnerOptions = useMemo(
    () => learners.filter((u) => u.role === "student").map((u) => ({ label: userOptionLabel(u), value: u.id })),
    [learners],
  );

  const questionTypeOptions = useMemo(() => buildQuestionTypeSelectOptions(questionTypes), [questionTypes]);

  async function loadBaseData() {
    setLoading(true);
    try {
      const [assignmentData, typeData, userData] = await Promise.all([
        listAssignments(),
        listQuestionTypes(),
        listAdminUsers(),
      ]);
      setItems(assignmentData);
      setQuestionTypes(typeData);
      setLearners(userData);
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
    getLocalIpForShare()
      .then((res) => {
        if (res.ip) {
          setShareHost(res.ip);
        }
      })
      .catch(() => {
        // 回退到当前 host
      });
  }, []);

  async function handleCreate(values: CreateAssignmentValues) {
    setCreateSubmitting(true);
    try {
      const created = await createAssignment({
        title: values.title,
        description: values.description,
        question_type_id: values.question_type_id,
        question_count: values.question_count,
      });
      message.success(`任务创建成功，实际抽取 ${created.question_count} 题`);
      setCreateOpen(false);
      form.resetFields();
      await loadBaseData();
    } catch {
      message.error("任务创建失败");
    } finally {
      setCreateSubmitting(false);
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
    const port = window.location.port ? `:${window.location.port}` : "";
    return `${window.location.protocol}//${shareHost}${port}/learn/assignments/${assignmentId}`;
  }

  async function handleCopyLearnerLink(assignmentId: number) {
    try {
      await navigator.clipboard.writeText(learnerLink(assignmentId));
      message.success("前台任务链接已复制");
    } catch {
      message.error("复制失败，请手动复制链接");
    }
  }

  function handleOpenLearnerLink(assignmentId: number) {
    window.open(learnerLink(assignmentId), "_blank", "noopener,noreferrer");
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
      render: (_, row) => (
        <span className="list-icon-actions">
          <Tooltip title="分配用户">
            <button type="button" className="list-icon-action" aria-label="分配用户" onClick={() => handleOpenAssignModal(row)}>
              <TeamOutlined />
            </button>
          </Tooltip>
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
          <Tooltip title="打开前台链接">
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
        </span>
      ),
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
            <p className="entry-hint">从题库按题型抽题生成一份练习。创建后可以再分配学生、复制作答链接。</p>
            <Form form={form} layout="vertical" onFinish={handleCreate} initialValues={{ question_count: 20 }}>
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
              <p className="list-modal-hint">若题库不足指定数量，则按实际可抽题数创建。</p>
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
                  <span className="task-qcard-index">错题 #{a.wrong_question_id}</span>
                  <span className={`list-status ${a.is_correct ? "is-correct" : "is-wrong"}`}>
                    {a.is_correct ? "正确" : "错误"}
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
