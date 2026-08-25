import { useEffect, useMemo, useState } from "react";
import { Button, Card, Col, Drawer, Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import axios from "axios";
import {
  deleteWrongQuestion,
  getWrongQuestion,
  listKnowledgeTags,
  listQuestionTypes,
  listWrongQuestions,
  requestBankAccess,
  suggestKnowledgeTags,
  updateWrongQuestion,
} from "../api";
import WrongQuestionDetailDrawer from "../components/WrongQuestionDetailDrawer";
import { canManageWrongQuestion } from "../permissions";
import type { ClaimRequestStatus, KnowledgeTag, QuestionType, ReviewStatus, UserRole, WrongQuestion } from "../types";
import { buildKnowledgeTagNameMap, buildKnowledgeTagSelectOptions } from "../utils/knowledgeTags";
import { linesToAnswers, linesToOptions, listToLines } from "../utils/optionLines";
import { buildQuestionTypeSelectOptions } from "../utils/questionTypes";

const { Text } = Typography;

interface FilterValues {
  id?: number;
  question_type_id?: number;
  knowledge_tag_id?: number;
  review_status?: ReviewStatus;
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
  canViewQuestionBank,
  bankRequestStatus,
  onBankAccessChange,
}: {
  currentUserId: number | null;
  currentRole: UserRole | null;
  canViewQuestionBank: boolean;
  bankRequestStatus: ClaimRequestStatus | null;
  onBankAccessChange: (next: { canViewQuestionBank: boolean; bankRequestStatus: ClaimRequestStatus | null }) => void;
}) {
  const [form] = Form.useForm<FilterValues>();
  const [editForm] = Form.useForm();
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

  const typeMap = useMemo(() => new Map(questionTypes.map((item) => [item.id, item.name])), [questionTypes]);
  const tagMap = useMemo(() => buildKnowledgeTagNameMap(knowledgeTags), [knowledgeTags]);

  async function fetchMeta() {
    const [types, tags] = await Promise.all([listQuestionTypes(), listKnowledgeTags()]);
    setQuestionTypes(types);
    setKnowledgeTags(tags);
  }

  async function fetchTable(nextPage = page, nextSize = pageSize) {
    const values = form.getFieldsValue();
    setLoading(true);
    try {
      const data = await listWrongQuestions({
        page: nextPage,
        page_size: nextSize,
        id: values.id,
        question_type_id: values.question_type_id,
        knowledge_tag_id: values.knowledge_tag_id,
        review_status: values.review_status,
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
    fetchMeta().catch(() => message.error("初始化元数据失败"));
    fetchTable(1, 20).catch(() => message.error("加载错题列表失败"));
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
      wrong_answer_lines: listToLines(record.wrong_answer),
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
    const wrong_answer = linesToAnswers(values.wrong_answer_lines);
    if (!correct_answer.length) {
      message.warning("请填写正确答案（每空/每小题一行）");
      return;
    }
    if (!wrong_answer.length) {
      message.warning("请填写学生错答（每空/每小题一行）");
      return;
    }
    setEditSubmitting(true);
    try {
      await updateWrongQuestion(editing.id, {
        stem: values.stem,
        options,
        correct_answer,
        wrong_answer,
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
    const formWrong = linesToAnswers(editForm.getFieldValue("wrong_answer_lines"));
    const correct_answer = formCorrect.length ? formCorrect : editing?.correct_answer || [];
    const wrong_answer = formWrong.length ? formWrong : editing?.wrong_answer || [];
    setSuggestingTags(true);
    try {
      const result = await suggestKnowledgeTags({
        stem,
        options,
        correct_answer,
        wrong_answer,
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

  const columns: ColumnsType<WrongQuestion> = [
    { title: "ID", dataIndex: "id", width: 80 },
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
      width: 120,
      render: (id: number) => typeMap.get(id) || id,
    },
    {
      title: "知识点",
      dataIndex: "knowledge_tag_ids",
      width: 260,
      render: (ids: number[]) => (
        <Space wrap size={[4, 4]}>
          {ids.map((id) => (
            <Tag key={id}>{tagMap.get(id) || id}</Tag>
          ))}
        </Space>
      ),
    },
    {
      title: "状态",
      dataIndex: "review_status",
      width: 120,
      render: (status: string) => <Tag>{status}</Tag>,
    },
    {
      title: "录入来源",
      dataIndex: "ingest_source",
      width: 100,
    },
    {
      title: "录入人",
      dataIndex: "created_by_username",
      width: 110,
      render: (name: string | null | undefined) => name || "未归属",
    },
    {
      title: "操作",
      width: 220,
      render: (_, record) => {
        const manageable = canManageWrongQuestion(currentRole, currentUserId, record);
        return (
          <Space wrap>
            <Button size="small" onClick={() => handleView(record.id)}>
              查看
            </Button>
            {manageable ? (
              <>
                <Button size="small" onClick={() => handleEdit(record)}>
                  编辑
                </Button>
                <Popconfirm title="确认删除该错题？" onConfirm={() => handleDelete(record.id)} okText="删除" cancelText="取消">
                  <Button size="small" danger>
                    删除
                  </Button>
                </Popconfirm>
              </>
            ) : null}
          </Space>
        );
      },
    },
  ];

  return (
    <>
      <Card style={{ marginBottom: 16 }}>
        <Form
          form={form}
          layout="vertical"
          onFinish={() => {
            fetchTable(1, pageSize).catch(() => message.error("筛选失败"));
          }}
        >
          <Row gutter={16}>
            <Col span={4}>
              <Form.Item name="id" label="题目 ID">
                <InputNumber min={1} precision={0} style={{ width: "100%" }} placeholder="精确匹配" />
              </Form.Item>
            </Col>
            <Col span={5}>
              <Form.Item name="question_type_id" label="题型">
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  options={buildQuestionTypeSelectOptions(questionTypes)}
                  placeholder="全部题型"
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="knowledge_tag_id" label="知识点">
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  options={buildKnowledgeTagSelectOptions(knowledgeTags, { includeInactive: true })}
                  placeholder="全部知识点"
                />
              </Form.Item>
            </Col>
            <Col span={5}>
              <Form.Item name="review_status" label="复习状态">
                <Select
                  allowClear
                  placeholder="全部状态"
                  options={[
                    { label: "未复习", value: "not_reviewed" },
                    { label: "已复习", value: "reviewed" },
                    { label: "已掌握", value: "mastered" },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item label=" ">
                <Button type="primary" htmlType="submit" block>
                  筛选
                </Button>
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Card>

      <Card
        extra={
          currentRole === "teacher" ? (
            canViewQuestionBank ? (
              <Tag color="success">已开通全库查看</Tag>
            ) : bankRequestStatus === "pending" ? (
              <Tag color="processing">全库查看审批中</Tag>
            ) : (
              <Button
                onClick={() => {
                  setClaimReason("");
                  setClaimOpen(true);
                }}
              >
                {bankRequestStatus === "rejected" ? "再次申请查看全库" : "申请查看全量错题"}
              </Button>
            )
          ) : null
        }
      >
        <Table
          rowKey="id"
          tableLayout="fixed"
          loading={loading}
          columns={columns}
          dataSource={tableData}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (v) => `共 ${v} 条`,
            onChange: (nextPage, nextSize) => {
              fetchTable(nextPage, nextSize).catch(() => message.error("翻页失败"));
            },
          }}
        />
      </Card>

      <WrongQuestionDetailDrawer
        open={detailOpen}
        loading={detailLoading}
        detail={detail}
        typeMap={typeMap}
        tagMap={tagMap}
        canAnalyze={detail ? canManageWrongQuestion(currentRole, currentUserId, detail) : false}
        onClose={() => setDetailOpen(false)}
        onDetailChange={setDetail}
      />

      <Modal
        title="申请查看全量错题"
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
          默认只能看到自己录入的题目。超管批准后可查看全部错题，编辑和删除仍仅限自己录入的。
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
        title={editing ? `编辑错题 #${editing.id}` : "编辑错题"}
        open={!!editing}
        onClose={() => setEditing(null)}
        size={1000}
        extra={
          <Space>
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
          </Space>
        }
      >
        <Form form={editForm} layout="vertical">
          <Form.Item name="stem" label="题干" rules={[{ required: true, message: "请填写题干" }]}>
            <Input.TextArea rows={8} placeholder="支持长文材料 + 多空题干" />
          </Form.Item>
          <Form.Item
            name="options_lines"
            label="选项"
            extra="每行一组选项；组内用 | 分隔。例：A. yes | B. no | C. maybe。无选项题可留空。"
          >
            <Input.TextArea rows={6} placeholder={"A. apple | B. banana | C. orange | D. grape\nA. is | B. are | C. was | D. were"} />
          </Form.Item>
          <Form.Item
            name="correct_answer_lines"
            label="正确答案"
            rules={[{ required: true, message: "请填写正确答案" }]}
            extra="每行对应一个空位/小题；多个可接受答案可用 | 分隔。"
          >
            <Input.TextArea rows={4} placeholder={"B\nA. are"} />
          </Form.Item>
          <Form.Item
            name="wrong_answer_lines"
            label="学生错答"
            rules={[{ required: true, message: "请填写学生错答" }]}
            extra="每行对应一个空位/小题，与正确答案行序对齐。"
          >
            <Input.TextArea rows={4} placeholder={"A\nC"} />
          </Form.Item>
          <Form.Item name="question_type_id" label="题型" rules={[{ required: true, message: "请选择题型" }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={buildQuestionTypeSelectOptions(questionTypes)}
              placeholder="按大类选择题型"
            />
          </Form.Item>
          <Form.Item
            name="knowledge_tag_ids"
            label={
              <Space size={8}>
                <span>知识点</span>
                <Button
                  type="link"
                  size="small"
                  style={{ padding: 0, height: "auto" }}
                  loading={suggestingTags}
                  onClick={(e) => {
                    e.preventDefault();
                    handleSuggestKnowledgeTags();
                  }}
                >
                  AI 推荐
                </Button>
              </Space>
            }
            rules={[{ required: true, message: "请选择知识点" }]}
          >
            <Select
              mode="multiple"
              showSearch
              optionFilterProp="label"
              maxTagCount="responsive"
              options={buildKnowledgeTagSelectOptions(knowledgeTags)}
              placeholder="按大类选择，或点 AI 推荐"
            />
          </Form.Item>
          <Form.Item name="review_status" label="复习状态" rules={[{ required: true, message: "请选择状态" }]}>
            <Select
              options={[
                { label: "未复习", value: "not_reviewed" },
                { label: "已复习", value: "reviewed" },
                { label: "已掌握", value: "mastered" },
              ]}
            />
          </Form.Item>
          <Form.Item name="difficulty" label="难度">
            <InputNumber min={1} max={5} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="source" label="题目来源">
            <Input placeholder="如：mock-paper" />
          </Form.Item>
          <Form.Item name="note" label="备注">
            <Input.TextArea placeholder="可选，支持多行说明" rows={4} />
          </Form.Item>
        </Form>
      </Drawer>
    </>
  );
}
