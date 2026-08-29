import { CheckOutlined, CloseOutlined } from "@ant-design/icons";
import { ConfigProvider, Form, Input, Modal, Pagination, Select, Table, Tooltip, Typography, message } from "antd";
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
import { CLAIM_STATUS_LABELS, claimStatusLabel } from "../utils/labels";

const FILTER_THEME = {
  token: {
    colorPrimary: "#7c5cfc",
    colorBorder: "#e4dcf4",
    colorPrimaryHover: "#6b4ef0",
    borderRadius: 10,
    controlHeight: 36,
  },
};

const ACTION_OPTIONS = [
  { label: "全部", value: "" },
  { label: "录入题目", value: "question.create" },
  { label: "编辑题目", value: "question.update" },
  { label: "删除题目", value: "question.delete" },
  { label: "还原题目", value: "question.restore" },
  { label: "彻底删除题目", value: "question.purge" },
  { label: "清空回收站", value: "recycle.empty" },
  { label: "申请查看题库", value: "question.claim.request" },
  { label: "批准题库申请", value: "question.claim.approve" },
  { label: "驳回题库申请", value: "question.claim.reject" },
  { label: "重置密码", value: "user.password.reset" },
  { label: "启用账号", value: "user.activate" },
  { label: "停用账号", value: "user.deactivate" },
];

const CLAIM_PILLS: { label: string; value: ClaimRequestStatus | "" }[] = [
  { label: "全部", value: "" },
  { label: CLAIM_STATUS_LABELS.pending, value: "pending" },
  { label: CLAIM_STATUS_LABELS.approved, value: "approved" },
  { label: CLAIM_STATUS_LABELS.rejected, value: "rejected" },
];

type ActivityTab = "claims" | "logs";

function getApiErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error) && typeof error.response?.data?.detail === "string") {
    return error.response.data.detail;
  }
  return fallback;
}

export default function ActivityLogsPage() {
  const [tab, setTab] = useState<ActivityTab>("claims");
  const [logForm] = Form.useForm<{ action?: string; actor_username?: string }>();
  const [claimForm] = Form.useForm<{ status?: ClaimRequestStatus | "" }>();
  const claimStatus = Form.useWatch("status", claimForm) ?? "";
  const logAction = Form.useWatch("action", logForm);
  const logActor = Form.useWatch("actor_username", logForm);
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

  const claimFilterCount = claimStatus ? 1 : 0;
  const logFilterCount = [logAction, logActor].filter((value) => value !== undefined && value !== null && value !== "").length;

  async function fetchLogs(nextPage = logPage, nextSize = logPageSize) {
    const values = logForm.getFieldsValue();
    setLogLoading(true);
    try {
      const data = await listActivityLogs({
        page: nextPage,
        page_size: nextSize,
        action: values.action || undefined,
        actor_username: values.actor_username || undefined,
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
        status: values.status || undefined,
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
    claimForm.setFieldValue("status", "pending");
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
        message.success("已批准，该教师可查看共享题库");
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
    { title: "ID", dataIndex: "id", width: 72 },
    { title: "申请人", dataIndex: "requester_username", width: 140 },
    {
      title: "状态",
      dataIndex: "status",
      width: 100,
      render: (status: ClaimRequestStatus) => <span className={`list-status is-${status}`}>{claimStatusLabel(status)}</span>,
    },
    {
      title: "申请说明",
      dataIndex: "reason",
      ellipsis: true,
      render: (value?: string | null) => value || "—",
    },
    {
      title: "申请时间",
      dataIndex: "created_at",
      width: 180,
      render: (value: string) => formatDateTimeLocal(value),
    },
    {
      title: "操作",
      width: 88,
      fixed: "right",
      render: (_, record) =>
        record.status === "pending" ? (
          <span className="list-icon-actions">
            <Tooltip title="批准">
              <button
                type="button"
                className="list-icon-action"
                aria-label="批准"
                onClick={() => {
                  setReviewNote("");
                  setReviewing({ item: record, approved: true });
                }}
              >
                <CheckOutlined />
              </button>
            </Tooltip>
            <Tooltip title="驳回">
              <button
                type="button"
                className="list-icon-action is-danger"
                aria-label="驳回"
                onClick={() => {
                  setReviewNote("");
                  setReviewing({ item: record, approved: false });
                }}
              >
                <CloseOutlined />
              </button>
            </Tooltip>
          </span>
        ) : (
          <span style={{ color: "#8a829c", fontSize: 13 }}>{record.reviewer_username || "—"}</span>
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
    { title: "操作人", dataIndex: "actor_username", width: 120, render: (value?: string | null) => value || "—" },
    { title: "行为", dataIndex: "action_label", width: 140 },
    { title: "说明", dataIndex: "summary", ellipsis: true },
  ];

  return (
    <ConfigProvider theme={FILTER_THEME}>
      <div className="list-filter">
        <div className="list-filter-tabs">
          <div className="list-view-toggle" role="tablist" aria-label="内容">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "claims"}
              className={tab === "claims" ? "is-active" : undefined}
              onClick={() => setTab("claims")}
            >
              题库申请
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "logs"}
              className={tab === "logs" ? "is-active" : undefined}
              onClick={() => setTab("logs")}
            >
              行为记录
            </button>
          </div>
        </div>

        {tab === "claims" ? (
          <div className="list-filter-primary is-solo">
            <div className="list-filter-row">
              <span className="list-filter-kicker">状态</span>
              <div className="list-filter-pills" role="radiogroup" aria-label="申请状态">
                {CLAIM_PILLS.map((item) => {
                  const active = claimStatus === item.value;
                  return (
                    <button
                      key={item.label}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      className={`list-filter-pill${active ? " is-active" : ""}`}
                      onClick={() => {
                        if (active) return;
                        claimForm.setFieldValue("status", item.value);
                        fetchClaims(1, claimPageSize).catch(() => undefined);
                      }}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
            {claimFilterCount > 0 ? (
              <button
                type="button"
                className="list-filter-reset"
                onClick={() => {
                  claimForm.setFieldValue("status", "");
                  fetchClaims(1, claimPageSize).catch(() => undefined);
                }}
              >
                清除条件
              </button>
            ) : null}
          </div>
        ) : (
          <div className="list-filter-secondary">
            <Form form={logForm}>
              <div className="list-filter-fields is-2">
                <div className={`list-filter-field${logAction ? " is-filled" : ""}`}>
                  <span className="list-filter-kicker">行为</span>
                  <Form.Item name="action">
                    <Select
                      allowClear
                      options={ACTION_OPTIONS}
                      placeholder="全部"
                      onChange={(value) => {
                        logForm.setFieldValue("action", value ?? "");
                        fetchLogs(1, logPageSize).catch(() => undefined);
                      }}
                    />
                  </Form.Item>
                </div>
                <div className={`list-filter-field${logActor ? " is-filled" : ""}`}>
                  <span className="list-filter-kicker">操作人</span>
                  <Form.Item name="actor_username">
                    <Input
                      allowClear
                      placeholder="回车查找用户名"
                      onPressEnter={() => fetchLogs(1, logPageSize).catch(() => undefined)}
                      onChange={(event) => {
                        if (!event.target.value) fetchLogs(1, logPageSize).catch(() => undefined);
                      }}
                    />
                  </Form.Item>
                </div>
              </div>
            </Form>
            {logFilterCount > 0 ? (
              <button
                type="button"
                className="list-filter-reset"
                onClick={() => {
                  logForm.resetFields();
                  fetchLogs(1, logPageSize).catch(() => undefined);
                }}
              >
                清除条件
              </button>
            ) : null}
          </div>
        )}

        <Form form={claimForm} hidden>
          <Form.Item name="status">
            <Input />
          </Form.Item>
        </Form>
      </div>

      <div className="list-results">
        <div className="list-results-head">
          <div className="list-results-meta">
            共 <strong>{tab === "claims" ? claimTotal : logTotal}</strong> 条
          </div>
        </div>
        {tab === "claims" ? (
          <>
            <Table
              rowKey="id"
              loading={claimLoading}
              columns={claimColumns}
              dataSource={claims}
              pagination={false}
              scroll={{ x: 900 }}
              locale={{ emptyText: "暂无题库申请" }}
            />
            <Pagination
              className="list-results-pagination"
              align="end"
              current={claimPage}
              pageSize={claimPageSize}
              total={claimTotal}
              showSizeChanger
              showTotal={(v) => `共 ${v} 条`}
              onChange={(nextPage, nextSize) => {
                fetchClaims(nextPage, nextSize).catch(() => undefined);
              }}
            />
          </>
        ) : (
          <>
            <Table
              rowKey="id"
              loading={logLoading}
              columns={logColumns}
              dataSource={logs}
              pagination={false}
              scroll={{ x: 720 }}
              locale={{ emptyText: "暂无行为记录" }}
            />
            <Pagination
              className="list-results-pagination"
              align="end"
              current={logPage}
              pageSize={logPageSize}
              total={logTotal}
              showSizeChanger
              showTotal={(v) => `共 ${v} 条`}
              onChange={(nextPage, nextSize) => {
                fetchLogs(nextPage, nextSize).catch(() => undefined);
              }}
            />
          </>
        )}
      </div>

      <Modal
        className="list-modal"
        title={reviewing?.approved ? "批准申请" : "驳回申请"}
        open={!!reviewing}
        okText={reviewing?.approved ? "批准开通共享题库" : "确认驳回"}
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
          <Typography.Paragraph className="list-modal-hint">
            {reviewing.approved
              ? `批准后，${reviewing.item.requester_username} 可以查看共享题库（超管及其他老师录入的题目，不含其本人录入的），但仍只能改删自己录入的题目。`
              : `驳回 ${reviewing.item.requester_username} 查看共享题库的申请。`}
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
    </ConfigProvider>
  );
}
