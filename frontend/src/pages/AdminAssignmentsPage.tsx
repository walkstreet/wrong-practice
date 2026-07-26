import { Button, Card, Drawer, Form, Input, InputNumber, Modal, Select, Space, Table, Tag, Typography, message } from "antd";
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
import { buildQuestionTypeSelectOptions } from "../utils/questionTypes";

const { Text } = Typography;

interface CreateAssignmentValues {
  title: string;
  description?: string;
  question_type_id: number;
  question_count: number;
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
    () => learners.filter((u) => u.role === "learner").map((u) => ({ label: `${u.username} (#${u.id})`, value: u.id })),
    [learners],
  );

  const questionTypeOptions = useMemo(
    () => buildQuestionTypeSelectOptions(questionTypes),
    [questionTypes],
  );

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
      message.error("分配失败，请检查用户是否为 learner");
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

  async function handleCopyLearnerLink(assignmentId: number) {
    const port = window.location.port ? `:${window.location.port}` : "";
    const link = `${window.location.protocol}//${shareHost}${port}/learn/assignments/${assignmentId}`;
    try {
      await navigator.clipboard.writeText(link);
      message.success("前台任务链接已复制");
    } catch {
      message.error("复制失败，请手动复制链接");
    }
  }

  function handleOpenLearnerLink(assignmentId: number) {
    const port = window.location.port ? `:${window.location.port}` : "";
    const link = `${window.location.protocol}//${shareHost}${port}/learn/assignments/${assignmentId}`;
    window.open(link, "_blank", "noopener,noreferrer");
  }

  function renderSubmissionStatus(status: AssignmentSubmissionItem["status"]) {
    if (status === "assigned") return <Tag>未开始</Tag>;
    if (status === "in_progress") return <Tag color="processing">进行中</Tag>;
    if (status === "submitted") return <Tag color="success">已提交</Tag>;
    if (status === "graded") return <Tag color="blue">已批改</Tag>;
    return <Tag>{status}</Tag>;
  }

  function formatAnswerValue(answer?: AnswerItem[] | null): string {
    if (!answer || !answer.length) return "--";
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
    { title: "任务ID", dataIndex: "id", width: 100 },
    { title: "标题", dataIndex: "title" },
    {
      title: "状态",
      dataIndex: "status",
      width: 120,
      render: (v: Assignment["status"]) => <Tag>{v}</Tag>,
    },
    { title: "题数", dataIndex: "question_count", width: 100 },
    {
      title: "分配人",
      dataIndex: "assigned_users",
      width: 220,
      render: (users: string[]) => (users && users.length ? users.join("、") : "--"),
    },
    {
      title: "操作",
      width: 560,
      render: (_, row) => (
        <Space>
          <Button size="small" onClick={() => handleOpenAssignModal(row)}>
            分配用户
          </Button>
          <Button size="small" onClick={() => handleCopyLearnerLink(row.id)}>
            复制前台链接
          </Button>
          <Button size="small" onClick={() => handleOpenLearnerLink(row.id)}>
            打开前台链接
          </Button>
          <Button size="small" onClick={() => handleLoadSubmissions(row.id)}>
            提交记录
          </Button>
          <Button size="small" disabled={row.status === "closed"} onClick={() => handleCloseAssignment(row)}>
            关闭任务
          </Button>
          <Button
            size="small"
            danger
            onClick={() =>
              Modal.confirm({
                title: `确认删除任务 #${row.id}？`,
                content: "删除后不可恢复，关联的分配和作答记录也会一并删除。",
                okText: "确认删除",
                okButtonProps: { danger: true },
                cancelText: "取消",
                onOk: () => handleDeleteAssignment(row),
              })
            }
          >
            删除任务
          </Button>
        </Space>
      ),
    },
  ];

  const submissionColumns: ColumnsType<AssignmentSubmissionItem> = [
    { title: "用户ID", dataIndex: "user_id", width: 90 },
    { title: "用户名", dataIndex: "username", width: 140 },
    { title: "状态", dataIndex: "status", width: 120, render: (v) => renderSubmissionStatus(v) },
    { title: "已作答", dataIndex: "answered_questions", width: 90 },
    { title: "答对", dataIndex: "correct_questions", width: 90 },
    { title: "分数", dataIndex: "score", width: 90, render: (v) => (typeof v === "number" ? v : "--") },
    {
      title: "正确率",
      dataIndex: "accuracy_rate",
      width: 110,
      render: (v) => (typeof v === "number" ? `${(v * 100).toFixed(2)}%` : "--"),
    },
    {
      title: "提交时间",
      dataIndex: "submitted_at",
      width: 180,
      render: (v?: string | null) => formatDateTimeLocal(v),
    },
    {
      title: "操作",
      width: 100,
      render: (_, row) => (
        <Button size="small" onClick={() => handleViewSubmission(row.user_id)}>
          详情
        </Button>
      ),
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card>
        <Button type="primary" onClick={() => setCreateOpen(true)}>
          新建任务
        </Button>
      </Card>

      <Card title="任务列表">
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={items}
          pagination={{ pageSize: 10, showSizeChanger: true }}
        />
      </Card>

      {activeAssignmentId ? (
        <Card title={`提交记录（任务 #${activeAssignmentId}）`}>
          <Table
            rowKey={(row) => `${row.user_id}-${row.submitted_at || "none"}`}
            loading={submissionLoading}
            columns={submissionColumns}
            dataSource={submissions}
            pagination={{ pageSize: 10, showSizeChanger: true }}
          />
        </Card>
      ) : null}

      <Modal
        title="新建任务"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={createSubmitting}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={handleCreate} initialValues={{ question_count: 20 }}>
          <Form.Item name="title" label="任务标题" rules={[{ required: true, message: "请输入任务标题" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="任务描述">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item
            name="question_type_id"
            label="抽题题型"
            rules={[{ required: true, message: "请选择题型" }]}
          >
            <Select options={questionTypeOptions} placeholder="请选择题型" />
          </Form.Item>
          <Form.Item
            name="question_count"
            label="抽题数量"
            rules={[{ required: true, message: "请输入抽题数量" }]}
          >
            <InputNumber min={1} max={200} style={{ width: "100%" }} />
          </Form.Item>
          <Text type="secondary">若题库不足指定数量，则按实际可抽题数创建。</Text>
        </Form>
      </Modal>

      <Modal
        title={assigning ? `分配用户（任务 #${assigning.id}）` : "分配用户"}
        open={!!assigning}
        onCancel={() => {
          setAssigning(null);
          setAssignUserIds([]);
        }}
        onOk={handleAssign}
      >
        <div style={{ marginBottom: 8, color: "rgba(0,0,0,0.65)" }}>
          当前已分配：{assigning?.assigned_users?.length ? assigning.assigned_users.join("、") : "--"}
        </div>
        <Select
          mode="multiple"
          style={{ width: "100%" }}
          value={assignUserIds}
          onChange={setAssignUserIds}
          options={learnerOptions}
          placeholder="选择 learner 用户"
        />
      </Modal>

      <Drawer title="提交详情" open={detailOpen} onClose={() => setDetailOpen(false)} width={760}>
        {detailLoading || !detail ? (
          <div>加载中...</div>
        ) : (
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Card size="small">
              <Space>
                {renderSubmissionStatus(detail.status)}
                <span>用户：{detail.username}</span>
                <span>分数：{detail.score ?? "--"}</span>
                <span>正确率：{typeof detail.accuracy_rate === "number" ? `${(detail.accuracy_rate * 100).toFixed(2)}%` : "--"}</span>
              </Space>
            </Card>
            {detail.answers.map((a) => (
              <Card key={a.id} size="small" title={`错题 #${a.wrong_question_id}`}>
                <Space direction="vertical" size={4}>
                  <Text>题干：{a.wrong_question_stem || "--"}</Text>
                  <Text>用户答案：{formatAnswerValue(a.user_answer as AnswerItem[])}</Text>
                  <Text>标准答案：{formatAnswerValue(a.standard_answer as AnswerItem[] | null)}</Text>
                  <Tag color={a.is_correct ? "success" : "error"}>{a.is_correct ? "正确" : "错误"}</Tag>
                </Space>
              </Card>
            ))}
          </Space>
        )}
      </Drawer>
    </Space>
  );
}
