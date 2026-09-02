import { useEffect, useMemo, useState } from "react";
import { DeleteOutlined, UndoOutlined } from "@ant-design/icons";
import { Button, ConfigProvider, Pagination, Popconfirm, Select, Table, Tooltip, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  emptyRecycleBin,
  listDeletedWrongQuestions,
  listKnowledgeTags,
  listOrganizations,
  listQuestionTypes,
  permanentlyDeleteWrongQuestion,
  restoreWrongQuestion,
} from "../api";
import type { KnowledgeTag, Organization, QuestionType, ReviewStatus, UserRole, WrongQuestion } from "../types";
import { formatDateTimeLocal } from "../utils/datetime";
import { buildKnowledgeTagNameMap } from "../utils/knowledgeTags";
import { reviewStatusLabel } from "../utils/labels";

const { Text } = Typography;

const FILTER_THEME = {
  token: {
    colorPrimary: "#7c5cfc",
    colorBorder: "#e4dcf4",
    colorPrimaryHover: "#6b4ef0",
    borderRadius: 10,
    controlHeight: 36,
  },
};

export default function RecycleBinPage({ currentRole }: { currentRole?: UserRole | null }) {
  const isSuperadmin = currentRole === "superadmin";
  const [loading, setLoading] = useState(false);
  const [emptying, setEmptying] = useState(false);
  const [tableData, setTableData] = useState<WrongQuestion[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [questionTypes, setQuestionTypes] = useState<QuestionType[]>([]);
  const [knowledgeTags, setKnowledgeTags] = useState<KnowledgeTag[]>([]);
  const [orgFilter, setOrgFilter] = useState<number | undefined>(undefined);
  const [organizations, setOrganizations] = useState<Organization[]>([]);

  const typeMap = useMemo(() => new Map(questionTypes.map((item) => [item.id, item.name])), [questionTypes]);
  const tagMap = useMemo(() => buildKnowledgeTagNameMap(knowledgeTags), [knowledgeTags]);
  const orgOptions = useMemo(
    () =>
      organizations
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
        .map((org) => ({ label: org.name, value: org.id })),
    [organizations],
  );

  async function fetchMeta() {
    const tasks: Promise<unknown>[] = [listQuestionTypes(), listKnowledgeTags()];
    if (isSuperadmin) tasks.push(listOrganizations());
    const [types, tags, orgs] = await Promise.all(tasks);
    setQuestionTypes(types as QuestionType[]);
    setKnowledgeTags(tags as KnowledgeTag[]);
    if (isSuperadmin) setOrganizations((orgs as Organization[]) || []);
  }

  async function fetchTable(nextPage = page, nextSize = pageSize, nextOrgId = orgFilter) {
    setLoading(true);
    try {
      const data = await listDeletedWrongQuestions({
        page: nextPage,
        page_size: nextSize,
        organization_id: isSuperadmin ? nextOrgId : undefined,
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
  }, [isSuperadmin]);

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

  function renderTags(ids: number[]) {
    const shown = ids.slice(0, 2);
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

  const columns: ColumnsType<WrongQuestion> = [
    { title: "ID", dataIndex: "id", width: 64 },
    {
      title: "题干",
      dataIndex: "stem",
      width: 280,
      ellipsis: true,
      render: (value: string) => <Text ellipsis={{ tooltip: value }}>{value}</Text>,
    },
    {
      title: "题型",
      dataIndex: "question_type_id",
      width: 100,
      render: (id: number) => typeMap.get(id) || "—",
    },
    {
      title: "知识点",
      dataIndex: "knowledge_tag_ids",
      width: 160,
      render: (ids: number[]) => (ids?.length ? renderTags(ids) : "—"),
    },
    {
      title: "状态",
      dataIndex: "review_status",
      width: 88,
      render: (status: ReviewStatus) => (
        <span className={`list-status is-${status}`}>{reviewStatusLabel(status)}</span>
      ),
    },
    {
      title: "录入时间",
      dataIndex: "created_at",
      width: 168,
      render: (value?: string | null) => formatDateTimeLocal(value),
    },
    {
      title: "删除时间",
      dataIndex: "deleted_at",
      width: 168,
      render: (value?: string | null) => formatDateTimeLocal(value),
    },
    {
      title: "操作",
      width: 96,
      fixed: "right",
      render: (_, record) => (
        <span className="list-icon-actions">
          <Tooltip title="还原">
            <Popconfirm title="确认还原该题目？" onConfirm={() => handleRestore(record.id)} okText="还原" cancelText="取消">
              <button type="button" className="list-icon-action" aria-label="还原">
                <UndoOutlined />
              </button>
            </Popconfirm>
          </Tooltip>
          <Tooltip title="彻底删除">
            <Popconfirm
              title="确认彻底删除？不可恢复"
              description="将同时清理相关练习记录与作答数据"
              onConfirm={() => handlePurge(record.id)}
              okText="彻底删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
            >
              <button type="button" className="list-icon-action is-danger" aria-label="彻底删除">
                <DeleteOutlined />
              </button>
            </Popconfirm>
          </Tooltip>
        </span>
      ),
    },
  ];

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

  return (
    <ConfigProvider theme={FILTER_THEME}>
      {isSuperadmin ? (
        <div className="list-filter">
          <div className="list-filter-secondary">
            <div className="list-filter-fields is-1">
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
                    const next = value ?? undefined;
                    setOrgFilter(next);
                    fetchTable(1, pageSize, next).catch(() => message.error("加载回收站失败"));
                  }}
                />
              </div>
            </div>
            {orgFilter != null ? (
              <button
                type="button"
                className="list-filter-reset"
                onClick={() => {
                  setOrgFilter(undefined);
                  fetchTable(1, pageSize, undefined).catch(() => message.error("加载回收站失败"));
                }}
              >
                清除条件
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="list-results">
        <div className="list-results-head">
          <div className="list-results-meta">
            共 <strong>{total}</strong> 条
          </div>
          <div className="list-results-tools">
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
          </div>
        </div>
        <Table
          rowKey="id"
          tableLayout="fixed"
          loading={loading}
          columns={columns}
          dataSource={tableData}
          pagination={false}
          scroll={{ x: 1140 }}
          locale={{ emptyText: "暂无已删除题目" }}
        />
        <Pagination className="list-results-pagination" align="end" {...pagination} />
      </div>
    </ConfigProvider>
  );
}
