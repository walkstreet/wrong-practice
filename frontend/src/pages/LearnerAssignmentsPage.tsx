import {
  Button,
  Card,
  Empty,
  Grid,
  Input,
  Modal,
  Radio,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import axios from 'axios';
import { useEffect, useMemo, useState } from 'react';

import {
  getMyAssignment,
  listMyAssignments,
  saveMyAnswer,
  submitMyAssignment,
} from '../api';
import type {
  AnswerItem,
  LearnerAssignmentDetail,
  LearnerAssignmentListItem,
  SubmitAssignmentResult,
} from '../types';

const { Paragraph, Text } = Typography;
const { useBreakpoint } = Grid;

interface LearnerAssignmentsPageProps {
  entryAssignmentId?: number;
}

interface DisplayOption {
  label: string;
  value: string;
}

function getApiErrorMessage(error: unknown): string | null {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === 'string' && detail.trim()) {
      return detail;
    }
  }
  return null;
}

export default function LearnerAssignmentsPage({
  entryAssignmentId,
}: LearnerAssignmentsPageProps) {
  const screens = useBreakpoint();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<LearnerAssignmentListItem[]>([]);
  const [current, setCurrent] = useState<LearnerAssignmentDetail | null>(null);
  const [answerMap, setAnswerMap] = useState<Record<number, string | string[]>>(
    {},
  );
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitAssignmentResult | null>(null);

  async function loadList() {
    setLoading(true);
    try {
      const data = await listMyAssignments();
      setItems(data);
    } catch {
      message.error('加载我的任务失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadList();
  }, []);

  async function openAssignment(id: number) {
    try {
      const detail = await getMyAssignment(id);
      setCurrent(detail);
      setResult(null);
      setAnswerMap({});
    } catch {
      message.error('加载任务详情失败');
    }
  }

  function buildAnswerPayload(
    wrongQuestionId: number,
    fillTemplate?: AnswerItem[],
  ): { payload: AnswerItem[] | null; error?: string } {
    const draft = answerMap[wrongQuestionId];
    let payload: AnswerItem[];
    if (
      fillTemplate !== undefined &&
      fillTemplate.length > 0 &&
      isFlatFillPattern(fillTemplate)
    ) {
      const draftArr = getFillDraft(wrongQuestionId, fillTemplate.length);
      payload = [];
      for (let i = 0; i < fillTemplate.length; i++) {
        if (fillTemplate[i] === null) {
          payload.push(null);
          continue;
        }
        const v = (draftArr[i] || '').trim();
        payload.push(v ? v : null);
      }
    } else {
      if (Array.isArray(draft)) {
        payload = draft.map((v) => {
          if (typeof v !== 'string') return null;
          const t = v.trim();
          return t ? t : null;
        });
      } else {
        const raw = ((draft as string) || '').trim();
        if (!raw) {
          payload = [];
        } else if (raw.startsWith('[') && raw.endsWith(']')) {
          try {
            const parsed = JSON.parse(raw) as unknown;
            if (!Array.isArray(parsed) || !parsed.length) {
              return {
                payload: null,
                error: 'JSON 数组格式无效，例如：["has","been"]',
              };
            }
            const out: AnswerItem[] = [];
            for (const item of parsed) {
              if (item === null || item === '') {
                out.push(null);
              } else if (typeof item === 'string') {
                const t = item.trim();
                out.push(t ? t : null);
              } else {
                return {
                  payload: null,
                  error: 'JSON 数组每项需为字符串或留空（空串会当作 null）',
                };
              }
            }
            payload = out;
          } catch {
            return {
              payload: null,
              error: '无法解析 JSON，请检查格式，例如：["has","been"]',
            };
          }
        } else {
          payload = [raw];
        }
      }
    }
    if (payload.length === 0 || payload.every((item) => item === null)) {
      return { payload: null };
    }
    return { payload };
  }

  async function handleSubmit() {
    if (!current) return;
    setSubmitting(true);
    try {
      const pendingAnswers: Array<{ wrongQuestionId: number; payload: AnswerItem[] }> =
        [];
      for (const q of sortedQuestions) {
        const result = buildAnswerPayload(
          q.wrong_question_id,
          isFlatFillPattern(q.correct_answer) && q.correct_answer.length > 1
            ? q.correct_answer
            : undefined,
        );
        if (result.error) {
          message.warning(result.error);
          return;
        }
        if (result.payload) {
          pendingAnswers.push({
            wrongQuestionId: q.wrong_question_id,
            payload: result.payload,
          });
        }
      }
      if (!pendingAnswers.length) {
        message.warning('请至少作答一题后再提交');
        return;
      }
      for (const item of pendingAnswers) {
        await saveMyAnswer(current.assignment_id, item.wrongQuestionId, item.payload);
      }
      const data = await submitMyAssignment(current.assignment_id);
      setResult(data);
      message.success('提交成功');
      await loadList();
      setCurrent(null);
      setAnswerMap({});
    } catch (error) {
      const detail = getApiErrorMessage(error);
      message.error(detail || '提交失败，请先至少保存一题答案');
    } finally {
      setSubmitting(false);
    }
  }

  const columns: ColumnsType<LearnerAssignmentListItem> = [
    { title: '任务ID', dataIndex: 'assignment_id', width: 100 },
    { title: '标题', dataIndex: 'title' },
    {
      title: '状态',
      dataIndex: 'status',
      width: 120,
      render: (v) => <Tag>{v === 'submitted' ? '已提交' : v === 'graded' ? '已批改' : v}</Tag>,
    },
    { title: '题数', dataIndex: 'question_count', width: 100 },
    {
      title: '成绩',
      width: 140,
      render: (_, row) =>
        typeof row.score === 'number'
          ? `${row.score} / ${(row.accuracy_rate || 0) * 100}%`
          : '--',
    },
    {
      title: '操作',
      width: 100,
      render: (_, row) => (
        <Button
          size="small"
          disabled={row.status === 'submitted' || row.status === 'graded'}
          onClick={() => openAssignment(row.assignment_id)}
        >
          进入
        </Button>
      ),
    },
  ];

  const sortedQuestions = useMemo(() => {
    if (!current) return [];
    return [...current.questions].sort(
      (a, b) => a.question_order - b.question_order,
    );
  }, [current]);

  function getOptionValue(optionText: string): string {
    const text = optionText.trim();
    const matched = text.match(/^[A-Za-z0-9]{1,3}[\.\):、\s]+(.+)$/);
    return matched ? matched[1].trim() : text;
  }

  function makeShuffledOptions(options: string[]): DisplayOption[] {
    const raw = options.map((option) => getOptionValue(option));
    for (let i = raw.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [raw[i], raw[j]] = [raw[j], raw[i]];
    }
    return raw.map((value, index) => ({
      value,
      label: `${String.fromCharCode(65 + index)}. ${value}`,
    }));
  }

  function isFlatChoiceOptions(options: unknown[]): options is string[] {
    return (
      Array.isArray(options) &&
      options.length > 0 &&
      options.every((item) => typeof item === 'string')
    );
  }

  function isGroupedChoiceOptions(options: unknown[]): options is string[][] {
    return (
      Array.isArray(options) &&
      options.length > 0 &&
      options.every(
        (group) =>
          Array.isArray(group) &&
          group.length > 0 &&
          group.every((item) => typeof item === 'string'),
      )
    );
  }

  /** 多空填空标准答案形态：仅 string | null，无嵌套数组 */
  function isFlatFillPattern(
    answers: AnswerItem[] | undefined,
  ): answers is AnswerItem[] {
    if (!answers || answers.length === 0) return false;
    return answers.every((a) => a === null || typeof a === 'string');
  }

  const shuffledOptionMap = useMemo(() => {
    const flat: Record<number, DisplayOption[]> = {};
    const grouped: Record<number, DisplayOption[][]> = {};
    for (const q of sortedQuestions) {
      if (isFlatChoiceOptions(q.options)) {
        flat[q.wrong_question_id] = makeShuffledOptions(q.options);
      } else if (isGroupedChoiceOptions(q.options)) {
        grouped[q.wrong_question_id] = q.options.map((group) =>
          makeShuffledOptions(group),
        );
      }
    }
    return { flat, grouped };
  }, [sortedQuestions]);

  function getFillDraft(wrongQuestionId: number, slotCount: number): string[] {
    const draft = answerMap[wrongQuestionId];
    if (Array.isArray(draft) && draft.length === slotCount) {
      return draft.map((s) => (typeof s === 'string' ? s : ''));
    }
    return Array.from({ length: slotCount }, () => '');
  }

  function setFillDraftCell(
    wrongQuestionId: number,
    slotCount: number,
    index: number,
    value: string,
  ) {
    const next = getFillDraft(wrongQuestionId, slotCount);
    next[index] = value;
    setAnswerMap((prev) => ({ ...prev, [wrongQuestionId]: next }));
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {entryAssignmentId ? (
        <Card>
          <Space>
            <Text>你当前通过任务链接进入，任务 ID：{entryAssignmentId}</Text>
            <Button
              size="small"
              type="primary"
              onClick={() => openAssignment(entryAssignmentId)}
            >
              进入指定任务
            </Button>
          </Space>
        </Card>
      ) : null}
      <Card title="我的任务">
        <Table
          rowKey="assignment_id"
          loading={loading}
          columns={columns}
          dataSource={items}
          pagination={false}
          scroll={{ x: 680 }}
        />
      </Card>

      <Modal
        title={current ? `任务作答：${current.title}` : '任务作答'}
        open={!!current}
        onCancel={() => setCurrent(null)}
        width={screens.md ? 900 : '100%'}
        style={{
          top: screens.md ? 24 : 0,
          margin: screens.md ? undefined : 0,
          maxWidth: screens.md ? undefined : '100vw',
        }}
        styles={{
          body: {
            maxHeight: screens.md ? '70vh' : 'calc(100vh - 120px)',
            overflow: 'auto',
          },
        }}
        footer={[
          <Button key="cancel" onClick={() => setCurrent(null)}>
            关闭
          </Button>,
          <Button
            key="submit"
            type="primary"
            loading={submitting}
            onClick={handleSubmit}
          >
            提交任务（自动保存）
          </Button>,
        ]}
      >
        {!current ? (
          <Empty />
        ) : (
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            <Card size="small">
              <Space>
                <Tag>{current.status}</Tag>
                <Text>题数：{current.questions.length}</Text>
              </Space>
              {current.description ? (
                <Paragraph style={{ marginTop: 8 }}>
                  {current.description}
                </Paragraph>
              ) : null}
            </Card>
            {sortedQuestions.map((q) => (
              <Card
                key={q.wrong_question_id}
                size="small"
                title={`第 ${q.question_order} 题（错题ID #${q.wrong_question_id}）`}
              >
                <Paragraph>{q.stem}</Paragraph>
                {isFlatChoiceOptions(q.options) ? (
                  <Radio.Group
                    style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
                    value={
                      typeof answerMap[q.wrong_question_id] === 'string'
                        ? answerMap[q.wrong_question_id]
                        : undefined
                    }
                    onChange={(e) =>
                      setAnswerMap((prev) => ({
                        ...prev,
                        [q.wrong_question_id]: e.target.value,
                      }))
                    }
                  >
                    {(shuffledOptionMap.flat[q.wrong_question_id] || []).map(
                      (option) => (
                        <Radio key={option.label} value={option.value}>
                          {option.label}
                        </Radio>
                      ),
                    )}
                  </Radio.Group>
                ) : isGroupedChoiceOptions(q.options) ? (
                  <Space direction="vertical" style={{ width: '100%' }}>
                    {(shuffledOptionMap.grouped[q.wrong_question_id] || []).map(
                      (group, idx) => {
                        const currentGroupAnswers = Array.isArray(
                          answerMap[q.wrong_question_id],
                        )
                          ? answerMap[q.wrong_question_id]
                          : [];
                        return (
                          <Card
                            key={`${q.wrong_question_id}-${idx}`}
                            size="small"
                            title={`小题 ${idx + 1}`}
                          >
                            <Radio.Group
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 8,
                              }}
                              value={currentGroupAnswers[idx]}
                              onChange={(e) => {
                                const next = [...currentGroupAnswers];
                                next[idx] = e.target.value;
                                setAnswerMap((prev) => ({
                                  ...prev,
                                  [q.wrong_question_id]: next,
                                }));
                              }}
                            >
                              {group.map((option) => (
                                <Radio
                                  key={`${idx}-${option.label}`}
                                  value={option.value}
                                >
                                  {option.label}
                                </Radio>
                              ))}
                            </Radio.Group>
                          </Card>
                        );
                      },
                    )}
                  </Space>
                ) : isFlatFillPattern(q.correct_answer) &&
                  q.correct_answer.length > 1 ? (
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <Paragraph type="secondary">
                      多空填空：共 {q.correct_answer.length} 个位置，与
                      correct_answer 录入顺序一致（不会做留空）
                    </Paragraph>
                    {q.correct_answer.map((slot, idx) =>
                      slot === null ? (
                        <Text
                          key={`${q.wrong_question_id}-ph-${idx}`}
                          type="secondary"
                        >
                          第 {idx + 1} 空：标答未录入（等价 null），无需填写
                        </Text>
                      ) : (
                        <Input
                          key={`${q.wrong_question_id}-${idx}`}
                          addonBefore={`第 ${idx + 1} 空`}
                          placeholder="答案"
                          value={
                            getFillDraft(
                              q.wrong_question_id,
                              q.correct_answer.length,
                            )[idx]
                          }
                          onChange={(e) =>
                            setFillDraftCell(
                              q.wrong_question_id,
                              q.correct_answer.length,
                              idx,
                              e.target.value,
                            )
                          }
                        />
                      ),
                    )}
                  </Space>
                ) : (
                  <>
                    <Paragraph type="secondary">
                      {q.options?.length
                        ? '本题支持自定义作答（单空或复杂结构请按下方说明）'
                        : '单空填空单行输入；多空可用 JSON 数组，不会写的位置用空串 "" 即可（当作 null，不必写 null 关键字）'}
                    </Paragraph>
                    <Input
                      placeholder='例：单空 has；多空 ["has","been"]，某格不写用 "" 表示留空（会当作 null）'
                      value={
                        typeof answerMap[q.wrong_question_id] === 'string'
                          ? answerMap[q.wrong_question_id]
                          : ''
                      }
                      onChange={(e) =>
                        setAnswerMap((prev) => ({
                          ...prev,
                          [q.wrong_question_id]: e.target.value,
                        }))
                      }
                    />
                  </>
                )}
                <div style={{ marginTop: 12 }}>
                  <Text type="secondary">本题答案将在“提交任务”时统一保存</Text>
                </div>
              </Card>
            ))}

            {result ? (
              <Card size="small" title="判分结果">
                <Space direction="vertical" size={4}>
                  <Text>总题数：{result.total_questions}</Text>
                  <Text>已作答：{result.answered_questions}</Text>
                  <Text>答对：{result.correct_questions}</Text>
                  <Text strong>得分：{result.score}</Text>
                  <Text strong>
                    正确率：{(result.accuracy_rate * 100).toFixed(2)}%
                  </Text>
                </Space>
              </Card>
            ) : null}
          </Space>
        )}
      </Modal>
    </Space>
  );
}
