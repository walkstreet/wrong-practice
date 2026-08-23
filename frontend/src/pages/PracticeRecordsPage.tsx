import {
  Button,
  Card,
  Col,
  Drawer,
  Input,
  InputNumber,
  List,
  Row,
  Select,
  Space,
  Spin,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { CopyOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useEffect, useMemo, useState } from 'react';
import {
  analyzeLearningWeaknesses,
  getLatestLearningWeaknessAnalysis,
  getLearnerPracticeRecordDetail,
  getLearningWeaknessAnalysis,
  listAdminUsers,
  listLearnerPracticeRecords,
  listLearningWeaknessAnalyses,
  listWrongQuestionAccuracyStats,
} from '../api';
import type {
  AnswerItem,
  LearnerPracticeRecord,
  LearnerPracticeRecordDetail,
  LearningWeaknessAnalysis,
  LearningWeaknessAnalysisListItem,
  WrongQuestionAccuracyStat,
} from '../types';
import { formatDateTimeLocal } from '../utils/datetime';
import { buildGptLearningPrompt } from '../utils/gptLearningPrompt';
import WeakAreaLessonPanel from '../components/WeakAreaLessonPanel';

const { Text, Paragraph, Title } = Typography;
const { TextArea } = Input;

export default function PracticeRecordsPage() {
  const [records, setRecords] = useState<LearnerPracticeRecord[]>([]);
  const [recordsTotal, setRecordsTotal] = useState(0);
  const [stats, setStats] = useState<WrongQuestionAccuracyStat[]>([]);
  const [recordsPage, setRecordsPage] = useState(1);
  const [recordsPageSize, setRecordsPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [wrongQuestionId, setWrongQuestionId] = useState<number | undefined>(
    undefined,
  );
  const [selectedUsername, setSelectedUsername] = useState<string | undefined>(
    undefined,
  );
  const [learnerOptions, setLearnerOptions] = useState<
    { label: string; value: string }[]
  >([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<LearnerPracticeRecordDetail | null>(
    null,
  );
  const [weaknessAnalyzing, setWeaknessAnalyzing] = useState(false);
  const [weaknessOpen, setWeaknessOpen] = useState(false);
  const [weaknessResult, setWeaknessResult] =
    useState<LearningWeaknessAnalysis | null>(null);
  const [historyItems, setHistoryItems] = useState<
    LearningWeaknessAnalysisListItem[]
  >([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [detailLoadingId, setDetailLoadingId] = useState<number | null>(null);
  const [gptPrompt, setGptPrompt] = useState('');

  const generatedGptPrompt = useMemo(
    () => (weaknessResult ? buildGptLearningPrompt(weaknessResult) : ''),
    [weaknessResult],
  );

  useEffect(() => {
    setGptPrompt(generatedGptPrompt);
  }, [generatedGptPrompt]);

  async function loadWeaknessHistory(page = 1) {
    setHistoryLoading(true);
    try {
      const u = selectedUsername?.trim();
      const data = await listLearningWeaknessAnalyses({
        page,
        page_size: 10,
        ...(u ? { username: u } : {}),
      });
      setHistoryItems(data.items);
      setHistoryTotal(data.total);
      setHistoryPage(page);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function loadRecords(page = recordsPage, pageSize = recordsPageSize) {
    setLoading(true);
    try {
      const u = selectedUsername?.trim();
      const data = await listLearnerPracticeRecords({
        page,
        page_size: pageSize,
        wrong_question_id: wrongQuestionId,
        ...(u ? { username: u } : {}),
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
    const u = selectedUsername?.trim();
    const data = await listWrongQuestionAccuracyStats(50, {
      wrong_question_id: wrongQuestionId,
      ...(u ? { username: u } : {}),
    });
    setStats(data);
  }

  useEffect(() => {
    setUsersLoading(true);
    listAdminUsers()
      .then((users) => {
        const learners = users
          .filter((u) => u.role === 'student')
          .sort((a, b) => a.username.localeCompare(b.username, 'zh-CN'));
        setLearnerOptions(
          learners.map((u) => ({ label: u.username, value: u.username })),
        );
      })
      .catch(() => message.error('加载用户列表失败'))
      .finally(() => setUsersLoading(false));
  }, []);

  useEffect(() => {
    Promise.allSettled([loadRecords(1, recordsPageSize), loadStats()]).then(
      ([recordsResult, statsResult]) => {
        if (recordsResult.status === 'rejected') {
          message.error('加载练习记录失败');
        }
        if (statsResult.status === 'rejected') {
          message.error('加载高错误率统计失败');
        }
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wrongQuestionId, selectedUsername, recordsPageSize]);

  async function handleViewDetail(recordId: number) {
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      const data = await getLearnerPracticeRecordDetail(recordId);
      setDetail(data);
    } catch {
      message.error('加载批改详情失败');
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }

  async function handleWeaknessAnalyze(force = false) {
    if (!stats.length && force) {
      message.warning('当前没有高错误率题目，无法分析');
      return;
    }
    setWeaknessOpen(true);
    setWeaknessAnalyzing(true);
    try {
      const u = selectedUsername?.trim();
      const scope = {
        wrong_question_id: wrongQuestionId,
        ...(u ? { username: u } : {}),
      };
      if (!force) {
        await loadWeaknessHistory(1).catch(() => undefined);
        const latest = await getLatestLearningWeaknessAnalysis(scope);
        if (latest) {
          setWeaknessResult(latest);
          message.success('已回显上次短板分析');
          return;
        }
        if (!stats.length) {
          message.warning('当前没有高错误率题目，无法分析');
          return;
        }
      }
      const result = await analyzeLearningWeaknesses(50, scope);
      setWeaknessResult(result);
      await loadWeaknessHistory(1);
      message.success(force ? '已重新分析并保存' : '短板分析完成，已保存记录');
    } catch (error) {
      const detailMsg =
        error && typeof error === 'object' && 'response' in error
          ? (error as { response?: { data?: { detail?: string } } }).response
              ?.data?.detail
          : null;
      message.error(
        (typeof detailMsg === 'string' && detailMsg) ||
          'AI 短板分析失败，请稍后重试',
      );
    } finally {
      setWeaknessAnalyzing(false);
    }
  }

  async function handleOpenWeaknessHistory() {
    setWeaknessOpen(true);
    try {
      await loadWeaknessHistory(1);
      if (!weaknessResult) {
        const u = selectedUsername?.trim();
        const latest = await getLatestLearningWeaknessAnalysis({
          wrong_question_id: wrongQuestionId,
          ...(u ? { username: u } : {}),
        });
        if (latest) setWeaknessResult(latest);
      }
    } catch {
      message.error('加载短板分析历史失败');
    }
  }

  async function handleLoadHistoryDetail(id: number) {
    setDetailLoadingId(id);
    try {
      const data = await getLearningWeaknessAnalysis(id);
      setWeaknessResult(data);
    } catch {
      message.error('加载分析详情失败');
    } finally {
      setDetailLoadingId(null);
    }
  }

  async function handleCopyGptPrompt() {
    const text = gptPrompt.trim();
    if (!text) {
      message.warning('暂无可用 prompt');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      message.success('已复制，可粘贴到 ChatGPT / DeepSeek 开始对话');
    } catch {
      message.error('复制失败，请手动全选复制');
    }
  }

  function formatAnswerValue(answer?: AnswerItem[] | null): string {
    if (!answer || !answer.length) return '--';
    return answer
      .map((item) => {
        if (item === null) return '（空）';
        if (Array.isArray(item)) return item.join(' / ');
        return String(item);
      })
      .join(' | ');
  }

  const recordColumns: ColumnsType<LearnerPracticeRecord> = [
    { title: '提交ID', dataIndex: 'id', width: 90 },
    { title: '用户ID', dataIndex: 'user_id', width: 90 },
    { title: '用户名', dataIndex: 'username', width: 130 },
    { title: '任务ID', dataIndex: 'assignment_id', width: 90 },
    {
      title: '状态',
      dataIndex: 'status',
      width: 120,
      render: (value: LearnerPracticeRecord['status']) =>
        value === 'submitted' ? (
          <Tag color="success">已提交</Tag>
        ) : value === 'graded' ? (
          <Tag color="blue">已批改</Tag>
        ) : (
          <Tag>{value}</Tag>
        ),
    },
    { title: '已作答', dataIndex: 'answered_questions', width: 90 },
    { title: '答对', dataIndex: 'correct_questions', width: 90 },
    {
      title: '分数',
      dataIndex: 'score',
      width: 90,
      render: (value?: number | null) =>
        typeof value === 'number' ? value : '--',
    },
    {
      title: '正确率',
      dataIndex: 'accuracy_rate',
      width: 110,
      render: (value?: number | null) =>
        typeof value === 'number' ? `${(value * 100).toFixed(2)}%` : '--',
    },
    {
      title: '提交时间',
      dataIndex: 'submitted_at',
      width: 190,
      render: (value?: string | null) => formatDateTimeLocal(value),
    },
    {
      title: '详情',
      width: 90,
      render: (_, row) => (
        <Button size="small" onClick={() => handleViewDetail(row.id)}>
          详情
        </Button>
      ),
    },
  ];

  const statsColumns: ColumnsType<WrongQuestionAccuracyStat> = [
    { title: '错题ID', dataIndex: 'wrong_question_id', width: 90 },
    {
      title: '题干',
      dataIndex: 'stem',
      render: (value: string) => (
        <Text ellipsis={{ tooltip: value }}>{value}</Text>
      ),
    },
    { title: '总次数', dataIndex: 'total_attempts', width: 100 },
    { title: '答对次数', dataIndex: 'correct_attempts', width: 100 },
    {
      title: '错误率',
      dataIndex: 'accuracy_rate',
      width: 120,
      render: (value: number) => `${((1 - value) * 100).toFixed(2)}%`,
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Row gutter={16}>
        <Col span={8}>
          <Card
            style={{ height: '100%' }}
            bodyStyle={{ minHeight: 86, display: 'flex', alignItems: 'center' }}
          >
            <Space align="center">
              <span>按用户：</span>
              <Select
                allowClear
                showSearch
                loading={usersLoading}
                placeholder="选择学生"
                optionFilterProp="label"
                value={selectedUsername}
                onChange={(v) => setSelectedUsername(v ?? undefined)}
                options={learnerOptions}
                style={{ width: 230 }}
              />
            </Space>
          </Card>
        </Col>
        <Col span={8}>
          <Card
            style={{ height: '100%' }}
            bodyStyle={{ minHeight: 86, display: 'flex', alignItems: 'center' }}
          >
            <Space align="center">
              <span>按错题ID：</span>
              <InputNumber
                min={1}
                value={wrongQuestionId}
                onChange={(val) =>
                  setWrongQuestionId(typeof val === 'number' ? val : undefined)
                }
              />
            </Space>
          </Card>
        </Col>
        <Col span={4}>
          <Card style={{ height: '100%' }} bodyStyle={{ minHeight: 86 }}>
            <Statistic title="练习记录总数" value={recordsTotal} />
          </Card>
        </Col>
        <Col span={4}>
          <Card style={{ height: '100%' }} bodyStyle={{ minHeight: 86 }}>
            <Statistic title="统计覆盖错题数" value={stats.length} />
          </Card>
        </Col>
      </Row>

      <Card title="练习记录">
        <Table
          rowKey="id"
          loading={loading}
          columns={recordColumns}
          dataSource={records}
          pagination={{
            current: recordsPage,
            pageSize: recordsPageSize,
            total: recordsTotal,
            showSizeChanger: true,
            onChange: (nextPage, nextSize) => {
              loadRecords(nextPage, nextSize).catch(() =>
                message.error('加载练习记录失败'),
              );
            },
          }}
        />
      </Card>

      <Card
        title="高错误率 Top 50"
        extra={
          <Space>
            <Button
              onClick={() => {
                handleOpenWeaknessHistory().catch(() => undefined);
              }}
            >
              历史记录
            </Button>
            <Button
              type="primary"
              icon={<ThunderboltOutlined />}
              loading={weaknessAnalyzing}
              disabled={!stats.length}
              onClick={() => {
              handleWeaknessAnalyze(false).catch(() => undefined);
            }}
          >
              AI 短板分析
            </Button>
          </Space>
        }
      >
        <Paragraph type="secondary" style={{ marginTop: 0 }}>
          可先筛选用户，再基于该范围内的高错误率题目做短板诊断、补全建议与学习方法。
        </Paragraph>
        <Table
          rowKey="wrong_question_id"
          columns={statsColumns}
          dataSource={stats}
          pagination={false}
        />
      </Card>

      <Drawer
        title="批改详情"
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        width={680}
      >
        {detailLoading || !detail ? (
          <div>加载中...</div>
        ) : (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Card size="small">
              <Space>
                {detail.status === 'submitted' ? (
                  <Tag color="success">已提交</Tag>
                ) : detail.status === 'graded' ? (
                  <Tag color="blue">已批改</Tag>
                ) : (
                  <Tag>{detail.status}</Tag>
                )}
                <span>用户：{detail.username}</span>
                <span>任务：#{detail.assignment_id}</span>
                <span>
                  提交时间：{formatDateTimeLocal(detail.submitted_at)}
                </span>
                <span>分数：{detail.score ?? '--'}</span>
                <span>
                  正确率：
                  {typeof detail.accuracy_rate === 'number'
                    ? `${(detail.accuracy_rate * 100).toFixed(2)}%`
                    : '--'}
                </span>
              </Space>
            </Card>
            {detail.answers.map((a) => (
              <Card
                key={a.id}
                size="small"
                title={`错题 #${a.wrong_question_id}`}
              >
                <Space direction="vertical" size={6} style={{ width: '100%' }}>
                  <Text>题干：{a.wrong_question_stem || '--'}</Text>
                  <Text>用户答案：{formatAnswerValue(a.user_answer)}</Text>
                  <Text>标准答案：{formatAnswerValue(a.standard_answer)}</Text>
                  <Tag color={a.is_correct ? 'success' : 'error'}>
                    {a.is_correct ? '正确' : '错误'}
                  </Tag>
                </Space>
              </Card>
            ))}
          </Space>
        )}
      </Drawer>

      <Drawer
        title="AI 学习短板分析"
        open={weaknessOpen}
        onClose={() => setWeaknessOpen(false)}
        width={820}
        extra={
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            loading={weaknessAnalyzing}
            disabled={!stats.length}
            onClick={() => {
              handleWeaknessAnalyze(true).catch(() => undefined);
            }}
          >
            重新分析并保存
          </Button>
        }
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Card size="small" title="历史记录（全量保存）">
            <Table
              rowKey="id"
              size="small"
              loading={historyLoading}
              dataSource={historyItems}
              pagination={{
                current: historyPage,
                pageSize: 10,
                total: historyTotal,
                size: 'small',
                onChange: (page) => {
                  loadWeaknessHistory(page).catch(() =>
                    message.error('加载历史失败'),
                  );
                },
              }}
              columns={[
                { title: 'ID', dataIndex: 'id', width: 70 },
                {
                  title: '时间',
                  dataIndex: 'analyzed_at',
                  width: 170,
                  render: (v: string) => formatDateTimeLocal(v),
                },
                {
                  title: '范围',
                  dataIndex: 'scope_note',
                  ellipsis: true,
                  render: (v?: string | null, row?: LearningWeaknessAnalysisListItem) =>
                    v ||
                    (row?.username ? `用户=${row.username}` : '全部范围'),
                },
                {
                  title: '题数',
                  dataIndex: 'analyzed_count',
                  width: 70,
                },
                {
                  title: '操作',
                  width: 90,
                  render: (_, row) =>
                    row ? (
                    <Button
                      size="small"
                      type="link"
                      loading={detailLoadingId === row.id}
                      onClick={() => {
                        handleLoadHistoryDetail(row.id).catch(() => undefined);
                      }}
                    >
                      查看
                    </Button>
                    ) : null,
                },
              ]}
            />
          </Card>

          {weaknessAnalyzing && !weaknessResult ? (
            <div style={{ textAlign: 'center', padding: '48px 0' }}>
              <Spin size="large" />
              <div style={{ marginTop: 12 }}>
                <Text type="secondary">正在根据 Top 高错误率题目分析短板…</Text>
              </div>
            </div>
          ) : weaknessResult ? (
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              <Card size="small">
                <Space wrap>
                  {weaknessResult.id ? (
                    <Tag color="processing">记录 #{weaknessResult.id}</Tag>
                  ) : null}
                  <Tag>覆盖 {weaknessResult.analyzed_count} 题</Tag>
                  {weaknessResult.username ? (
                    <Tag color="blue">用户：{weaknessResult.username}</Tag>
                  ) : (
                    <Tag>全部筛选范围</Tag>
                  )}
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {formatDateTimeLocal(weaknessResult.analyzed_at)} ·{' '}
                    {weaknessResult.model}
                  </Text>
                </Space>
                {weaknessResult.scope_note ? (
                  <Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
                    {weaknessResult.scope_note}
                  </Paragraph>
                ) : null}
                <Title level={5} style={{ marginTop: 12, marginBottom: 8 }}>
                  总评
                </Title>
                <Paragraph style={{ marginBottom: 0 }}>
                  {weaknessResult.overall_summary}
                </Paragraph>
              </Card>

              <Card size="small" title="主要短板">
                <Paragraph type="secondary" style={{ marginTop: 0 }}>
                  点「知识点分析」会再开一层抽屉：讲解 + 例句 + 基础小测，做对做错都有浮夸鼓励。
                </Paragraph>
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  {weaknessResult.weak_areas.length ? (
                    weaknessResult.weak_areas.map((area) => (
                      <WeakAreaLessonPanel
                        key={`${weaknessResult.id ?? 'x'}-${area.name}-${area.severity}`}
                        area={area}
                        overallSummary={weaknessResult.overall_summary}
                        weaknessAnalysisId={weaknessResult.id ?? null}
                      />
                    ))
                  ) : (
                    <Text type="secondary">暂无短板项</Text>
                  )}
                </Space>
              </Card>

              <Card size="small" title="补全建议">
                <List
                  size="small"
                  dataSource={weaknessResult.gap_fill_suggestions}
                  locale={{ emptyText: '暂无建议' }}
                  renderItem={(item, index) => (
                    <List.Item>
                      <Text>
                        {index + 1}. {item}
                      </Text>
                    </List.Item>
                  )}
                />
              </Card>

              <Card
                size="small"
                title="问 GPT：深挖知识点"
                extra={
                  <Space>
                    <Button
                      size="small"
                      onClick={() => setGptPrompt(generatedGptPrompt)}
                      disabled={!generatedGptPrompt}
                    >
                      重置
                    </Button>
                    <Button
                      type="primary"
                      size="small"
                      icon={<CopyOutlined />}
                      onClick={() => {
                        handleCopyGptPrompt().catch(() => undefined);
                      }}
                    >
                      复制 Prompt
                    </Button>
                  </Space>
                }
              >
                <Paragraph type="secondary" style={{ marginTop: 0 }}>
                  已根据本次短板分析生成对话 Prompt。复制后粘贴到 ChatGPT / DeepSeek，即可按知识点逐个讲解、小测与纠错。
                </Paragraph>
                <TextArea
                  value={gptPrompt}
                  onChange={(e) => setGptPrompt(e.target.value)}
                  rows={14}
                  style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 }}
                />
              </Card>

              <Card size="small" title="学习方法">
                <List
                  size="small"
                  dataSource={weaknessResult.study_methods}
                  locale={{ emptyText: '暂无方法' }}
                  renderItem={(item, index) => (
                    <List.Item>
                      <Text>
                        {index + 1}. {item}
                      </Text>
                    </List.Item>
                  )}
                />
              </Card>

              <Card size="small" title="轻量周计划">
                <List
                  size="small"
                  dataSource={weaknessResult.weekly_plan}
                  locale={{ emptyText: '暂无计划' }}
                  renderItem={(item) => (
                    <List.Item>
                      <Text>{item}</Text>
                    </List.Item>
                  )}
                />
              </Card>

              {weaknessResult.source_items?.length ? (
                <Card size="small" title={`分析题目快照（${weaknessResult.source_items.length}）`}>
                  <List
                    size="small"
                    dataSource={weaknessResult.source_items}
                    renderItem={(item, index) => {
                      const qid = Number(item.wrong_question_id || 0);
                      const errorRate = Number(item.error_rate || 0);
                      const stem = String(item.stem || '');
                      return (
                        <List.Item>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {index + 1}. #{qid} · 错误率 {(errorRate * 100).toFixed(1)}% ·{' '}
                            {stem.length > 80 ? `${stem.slice(0, 80)}…` : stem}
                          </Text>
                        </List.Item>
                      );
                    }}
                  />
                </Card>
              ) : null}
            </Space>
          ) : (
            <Text type="secondary">
              可从上方历史记录查看已保存分析；再次打开会回显当前筛选范围下的最新记录，或点击「重新分析并保存」生成新记录。
            </Text>
          )}
        </Space>
      </Drawer>
    </Space>
  );
}
