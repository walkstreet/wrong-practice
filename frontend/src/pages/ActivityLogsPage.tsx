import { Button, Card, Form, Input, Modal, Select, Space, Table, Tabs, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import axios from "axios";
import { useEffect, useState } from "react";

import {
  approveQuestionClaim,
  listActivityLogs,
  listQuestionClaims,
  rejectQuestionClaim,
} from "../api";
import type { ActivityLog, ClaimRequestStatus, QuestionClaimRequest } from "../types";
import { formatDateTimeLocal } from "../utils/datetime";

const ACTION_OPTIONS = [
  { label: "录入题目", value: "question.create" },
  { label: "编辑题目", value: "question.update" },
  { label: "删除题目", value: "question.delete" },
  { label: "还原题目", value: "question.restore" },
  { label: "彻底删除题目", value: "question.purge" },
  { label: "清空回收站", value: "recycle.empty" },
  { label: "申请查看题库", value: "question.claim.request" },
  { label: "批准题库申请", value: "question.claim.approve" },
  { label: "驳回题库申请", value: "question.claim.reject" },
];

const STATUS_LABEL: Record<ClaimRequestStatus, string> = {
  pending: "待审批",
  approved: "已批准",
  rejected: "已驳回",
};

const STATUS_COLOR: Record<ClaimRequestStatus, string> = {
  pending: "processing",
  approved: "success",
  rejected: "error",
};

function getApiErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error) && typeof error.response?.data?.detail === "string") {
    return error.response.data.detail;
  }
  return fallback;
}

export default function ActivityLogsPage() {
  const [logForm] = Form.useForm<{ action?: string; actor_username?: string }>();
  const [claimForm] = Form.useForm<{ status?: ClaimRequestStatus }>();
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [logTotal, setLogTotal] = useState(0);
  const [logPage, setLogPage] = useState(1);
  const [logPageSize, setLogPageSize] = useState(20);
  const [logLoading, setLogLoading] = useState(false);
  const [claims, setClaims] = useState<QuestionClaimRequest[]>([]);
  const [claimTotal, setClaimTotal] = useState(0);
  const [claimPage, setClaimPage] = useState(1);
  const [claimPageSize, setClaimPageSize] = useState(20);
  const [claimLoading, setClaimLoading] = useState(false);
  const [reviewing, setReviewing] = useState<{ item: QuestionClaimRequest; approved: boolean } | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [reviewSubmitting, setReviewSubmitting] = useState(false);

  async function fetchLogs(nextPage = logPage, nextSize = logPageSize) {
    const values = logForm.getFieldsValue();
    setLogLoading(true);
    try {
      const data = await listActivityLogs({
        page: nextPage,
        page_size: nextSize,
        action: values.action,
        actor_username: values.actor_username,
      });
      setLogs(data.items);
      setLogTotal(data.total);
      setLogPage(nextPage);
      setLogPageSize(nextSize);
    } catch {
      message.error("加载行为记录失败");
    } finally {
      setLogLoading(false);
    }
  }

  async function fetchClaims(nextPage = claimPage, nextSize = claimPageSize) {
    const values = claimForm.getFieldsValue();
    setClaimLoading(true);
    try {
      const data = await listQuestionClaims({
        page: nextPage,
        page_size: nextSize,
        status: values.status,
      });
      setClaims(data.items);
      setClaimTotal(data.total);
      setClaimPage(nextPage);
      setClaimPageSize(nextSize);
    } catch {
      message.error("加载题目申请失败");
    } finally {
      setClaimLoading(false);
    }
  }

  useEffect(() => {
    fetchLogs(1, 20).catch(() => undefined);
    fetchClaims(1, 20).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleReview() {
    if (!reviewing) return;
    setReviewSubmitting(true);
    try {
      if (reviewing.approved) {
        await approveQuestionClaim(reviewing.item.id, reviewNote.trim() || undefined);
        message.success("已批准，该教师可查看全量错题");
      } else {
        await rejectQuestionClaim(reviewing.item.id, reviewNote.trim() || undefined);
        message.success("已驳回申请");
      }
      setReviewing(null);
      setReviewNote("");
      await Promise.all([fetchClaims(claimPage, claimPageSize), fetchLogs(logPage, logPageSize)]);
    } catch (error) {
      message.error(getApiErrorMessage(error, "处理失败"));
    } finally {
      setReviewSubmitting(false);
    }
  }

  const claimColumns: ColumnsType<QuestionClaimRequest> = [
    { title: "ID", dataIndex: "id", width: 70 },
    { title: "申请人", dataIndex: "requester_username", width: 140 },
    {
      title: "状态",
      dataIndex: "status",
      width: 100,
      render: (status: ClaimRequestStatus) => <Tag color={STATUS_COLOR[status]}>{STATUS_LABEL[status]}</Tag>,
    },
    {
      title: "申请说明",
      dataIndex: "reason",
      width: 200,
      ellipsis: true,
      render: (value?: string | null) => value || "--",
    },
    {
      title: "申请时间",
      dataIndex: "created_at",
      width: 180,
      render: (value: string) => formatDateTimeLocal(value),
    },
    {
      title: "操作",
      width: 180,
      render: (_, record) =>
        record.status === "pending" ? (
          <Space>
            <Button
              size="small"
              type="primary"
              onClick={() => {
                setReviewNote("");
                setReviewing({ item: record, approved: true });
              }}
            >
              批准
            </Button>
            <Button
              size="small"
              danger
              onClick={() => {
                setReviewNote("");
                setReviewing({ item: record, approved: false });
              }}
            >
              驳回
            </Button>
          </Space>
        ) : (
          <Typography.Text type="secondary">{record.reviewer_username || "--"}</Typography.Text>
        ),
    },
  ];

  const logColumns: ColumnsType<ActivityLog> = [
    {
      title: "时间",
      dataIndex: "created_at",
      width: 180,
      render: (value: string) => formatDateTimeLocal(value),
    },
    { title: "操作人", dataIndex: "actor_username", width: 120, render: (value?: string | null) => value || "--" },
    { title: "行为", dataIndex: "action_label", width: 140 },
    { title: "说明", dataIndex: "summary", ellipsis: true },
  ];

  return (
    <>
      <Tabs
        items={[
          {
            key: "claims",
            label: `题库申请（${claimTotal}）`,
            children: (
              <>
                <Card style={{ marginBottom: 16 }}>
                  <Form
                    form={claimForm}
                    layout="inline"
                    initialValues={{ status: "pending" }}
                    onFinish={() => {
                      fetchClaims(1, claimPageSize).catch(() => undefined);
                    }}
                  >
                    <Form.Item name="status" label="状态">
                      <Select
                        allowClear
                        style={{ width: 160 }}
                        options={[
                          { label: "待审批", value: "pending" },
                          { label: "已批准", value: "approved" },
                          { label: "已驳回", value: "rejected" },
                        ]}
                      />
                    </Form.Item>
                    <Form.Item>
                      <Button type="primary" htmlType="submit">
                        筛选
                      </Button>
                    </Form.Item>
                  </Form>
                </Card>
                <Card>
                  <Table
                    rowKey="id"
                    loading={claimLoading}
                    columns={claimColumns}
                    dataSource={claims}
                    pagination={{
                      current: claimPage,
                      pageSize: claimPageSize,
                      total: claimTotal,
                      showSizeChanger: true,
                      showTotal: (v) => `共 ${v} 条`,
                      onChange: (nextPage, nextSize) => {
                        fetchClaims(nextPage, nextSize).catch(() => undefined);
                      },
                    }}
                  />
                </Card>
              </>
            ),
          },
          {
            key: "logs",
            label: `行为记录（${logTotal}）`,
            children: (
              <>
                <Card style={{ marginBottom: 16 }}>
                  <Form
                    form={logForm}
                    layout="inline"
                    onFinish={() => {
                      fetchLogs(1, logPageSize).catch(() => undefined);
                    }}
                  >
                    <Form.Item name="action" label="行为">
                      <Select allowClear style={{ width: 180 }} options={ACTION_OPTIONS} placeholder="全部行为" />
                    </Form.Item>
                    <Form.Item name="actor_username" label="操作人">
                      <Input allowClear placeholder="用户名" />
                    </Form.Item>
                    <Form.Item>
                      <Button type="primary" htmlType="submit">
                        筛选
                      </Button>
                    </Form.Item>
                  </Form>
                </Card>
                <Card>
                  <Table
                    rowKey="id"
                    loading={logLoading}
                    columns={logColumns}
                    dataSource={logs}
                    pagination={{
                      current: logPage,
                      pageSize: logPageSize,
                      total: logTotal,
                      showSizeChanger: true,
                      showTotal: (v) => `共 ${v} 条`,
                      onChange: (nextPage, nextSize) => {
                        fetchLogs(nextPage, nextSize).catch(() => undefined);
                      },
                    }}
                  />
                </Card>
              </>
            ),
          },
        ]}
      />
      <Modal
        title={reviewing?.approved ? "批准申请" : "驳回申请"}
        open={!!reviewing}
        okText={reviewing?.approved ? "批准开通全库查看" : "确认驳回"}
        okButtonProps={{ danger: !reviewing?.approved }}
        confirmLoading={reviewSubmitting}
        onOk={() => {
          handleReview().catch(() => undefined);
        }}
        onCancel={() => {
          setReviewing(null);
          setReviewNote("");
        }}
      >
        {reviewing ? (
          <Typography.Paragraph>
            {reviewing.approved
              ? `批准后，${reviewing.item.requester_username} 可以查看全部错题，但仍只能改删自己录入的题目。`
              : `驳回 ${reviewing.item.requester_username} 查看全量错题的申请。`}
          </Typography.Paragraph>
        ) : null}
        <Input.TextArea
          rows={3}
          value={reviewNote}
          onChange={(e) => setReviewNote(e.target.value)}
          placeholder="可选：审批说明"
          maxLength={500}
        />
      </Modal>
    </>
  );
}
