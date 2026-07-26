import { useEffect, useMemo, useState } from "react";
import { Button, Card, Col, Form, Popconfirm, Row, Select, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  emptyRecycleBin,
  listDeletedWrongQuestions,
  listKnowledgeTags,
  listQuestionTypes,
  permanentlyDeleteWrongQuestion,
  restoreWrongQuestion,
} from "../api";
import type { KnowledgeTag, QuestionType, ReviewStatus, WrongQuestion } from "../types";
import { buildKnowledgeTagNameMap, buildKnowledgeTagSelectOptions } from "../utils/knowledgeTags";
import { buildQuestionTypeSelectOptions } from "../utils/questionTypes";

const { Text } = Typography;

interface FilterValues {
  question_type_id?: number;
  knowledge_tag_id?: number;
  review_status?: ReviewStatus;
}

export default function RecycleBinPage() {
  const [form] = Form.useForm<FilterValues>();
  const [loading, setLoading] = useState(false);
  const [emptying, setEmptying] = useState(false);
  const [tableData, setTableData] = useState<WrongQuestion[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [questionTypes, setQuestionTypes] = useState<QuestionType[]>([]);
  const [knowledgeTags, setKnowledgeTags] = useState<KnowledgeTag[]>([]);

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
      const data = await listDeletedWrongQuestions({
        page: nextPage,
        page_size: nextSize,
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
    fetchTable(1, 20).catch(() => message.error("加载回收站失败"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleRestore(id: number) {
    await restoreWrongQuestion(id);
    message.success("已还原");
    fetchTable(page, pageSize).catch(() => message.error("刷新回收站失败"));
  }

  async function handlePurge(id: number) {
    await permanentlyDeleteWrongQuestion(id);
    message.success("已彻底删除");
    const nextPage = tableData.length <= 1 && page > 1 ? page - 1 : page;
    fetchTable(nextPage, pageSize).catch(() => message.error("刷新回收站失败"));
  }

  async function handleEmpty() {
    setEmptying(true);
    try {
      const res = await emptyRecycleBin();
      message.success(`已清空回收站，删除 ${res.deleted_count} 条`);
      await fetchTable(1, pageSize);
    } catch {
      message.error("清空回收站失败");
    } finally {
      setEmptying(false);
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
      title: "操作",
      width: 220,
      render: (_, record) => (
        <Space>
          <Popconfirm title="确认还原该错题？" onConfirm={() => handleRestore(record.id)} okText="还原" cancelText="取消">
            <Button size="small" type="primary">
              还原
            </Button>
          </Popconfirm>
          <Popconfirm
            title="确认彻底删除？不可恢复"
            description="将同时清理相关练习记录与作答数据"
            onConfirm={() => handlePurge(record.id)}
            okText="彻底删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button size="small" danger>
              彻底删除
            </Button>
          </Popconfirm>
        </Space>
      ),
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
            <Col span={7}>
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
            <Col span={7}>
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
            <Col span={6}>
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
        title={`回收站（${total}）`}
        extra={
          <Popconfirm
            title="确认清空回收站？"
            description={`将彻底删除全部 ${total} 条，不可恢复`}
            onConfirm={() => {
              handleEmpty().catch(() => undefined);
            }}
            okText="清空"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            disabled={total === 0}
          >
            <Button danger loading={emptying} disabled={total === 0}>
              一键清空
            </Button>
          </Popconfirm>
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
    </>
  );
}
