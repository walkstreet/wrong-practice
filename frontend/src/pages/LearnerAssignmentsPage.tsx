import { PlayCircleOutlined } from '@ant-design/icons';
import {
  Button,
  ConfigProvider,
  Empty,
  Grid,
  Input,
  Modal,
  Radio,
  Table,
  Tooltip,
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
import { userAssignmentStatusLabel } from '../utils/labels';

const { useBreakpoint } = Grid;

const FILTER_THEME = {
  token: {
    colorPrimary: '#7c5cfc',
    colorBorder: '#e4dcf4',
    colorPrimaryHover: '#6b4ef0',
    borderRadius: 10,
    controlHeight: 36,
  },
};

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

  useEffect(() => {
    if (entryAssignmentId) {
      openAssignment(entryAssignmentId).catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryAssignmentId]);

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
                error: '多空答案格式无效，例如：["has","been"]',
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
                  error: '多空答案每项需为文字，不会的空请留空',
                };
              }
            }
            payload = out;
          } catch {
            return {
              payload: null,
              error: '无法解析多空答案，请检查格式，例如：["has","been"]',
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
    { title: 'ID', dataIndex: 'assignment_id', width: 72 },
    { title: '标题', dataIndex: 'title', ellipsis: true },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (v) => <span className={`list-status is-${v}`}>{userAssignmentStatusLabel(v)}</span>,
    },
    { title: '题数', dataIndex: 'question_count', width: 72 },
    {
      title: '成绩',
      width: 140,
      render: (_, row) =>
        typeof row.score === 'number'
          ? `${row.score} / ${((row.accuracy_rate || 0) * 100).toFixed(1)}%`
          : '—',
    },
    {
      title: '操作',
      width: 72,
      fixed: 'right',
      render: (_, row) => {
        const locked = row.status === 'submitted' || row.status === 'graded';
        return (
          <Tooltip title={locked ? '已提交，无法再作答' : '进入作答'}>
            <button
              type="button"
              className="list-icon-action"
              aria-label="进入作答"
              disabled={locked}
              onClick={() => openAssignment(row.assignment_id)}
            >
              <PlayCircleOutlined />
            </button>
          </Tooltip>
        );
      },
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
    <ConfigProvider theme={FILTER_THEME}>
      <div className="list-results">
        <div className="list-results-head">
          <div className="list-results-meta">
            共 <strong>{items.length}</strong> 条
          </div>
        </div>
        <Table
          rowKey="assignment_id"
          loading={loading}
          columns={columns}
          dataSource={items}
          pagination={false}
          scroll={{ x: 680 }}
          locale={{ emptyText: '暂无任务' }}
        />
      </div>

      <Modal
        className="list-modal"
        title={current ? current.title : '任务作答'}
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
            提交任务
          </Button>,
        ]}
      >
        {!current ? (
          <Empty description="暂无题目" />
        ) : (
          <div className="task-sheet">
            <div className="task-meta">
              <span className={`list-status is-${current.status}`}>
                {userAssignmentStatusLabel(current.status)}
              </span>
              <span>共 {current.questions.length} 题</span>
            </div>
            {current.description ? <p className="task-desc">{current.description}</p> : null}
            {sortedQuestions.map((q) => (
              <article key={q.wrong_question_id} className="task-qcard">
                <div className="task-qcard-head">
                  <span className="task-qcard-index">第 {q.question_order} 题</span>
                  <span className="task-qcard-id">#{q.wrong_question_id}</span>
                </div>
                <p className="task-stem">{q.stem}</p>
                {isFlatChoiceOptions(q.options) ? (
                  <Radio.Group
                    className="task-options"
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
                  <div>
                    {(shuffledOptionMap.grouped[q.wrong_question_id] || []).map(
                      (group, idx) => {
                        const currentGroupAnswers = Array.isArray(
                          answerMap[q.wrong_question_id],
                        )
                          ? answerMap[q.wrong_question_id]
                          : [];
                        return (
                          <div
                            key={`${q.wrong_question_id}-${idx}`}
                            className="task-subq"
                          >
                            <div className="task-subq-title">小题 {idx + 1}</div>
                            <Radio.Group
                              className="task-options"
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
                          </div>
                        );
                      },
                    )}
                  </div>
                ) : isFlatFillPattern(q.correct_answer) &&
                  q.correct_answer.length > 1 ? (
                  <div className="task-fills">
                    <p className="task-hint">
                      多空填空，共 {q.correct_answer.length} 个空，按出现顺序填写。
                    </p>
                    {q.correct_answer.map((slot, idx) =>
                      slot === null ? (
                        <p key={`${q.wrong_question_id}-ph-${idx}`} className="task-hint">
                          第 {idx + 1} 空无需填写
                        </p>
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
                  </div>
                ) : (
                  <>
                    <p className="task-hint">
                      {q.options?.length
                        ? '请输入本题答案'
                        : '单空直接填写；多空可用 ["has","been"]，不会的空用 ""'}
                    </p>
                    <Input
                      placeholder="输入答案"
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
                <div className="task-save-note">答案将在提交任务时统一保存</div>
              </article>
            ))}

            {result ? (
              <div className="task-result">
                <div className="task-result-title">判分结果</div>
                <div className="task-result-grid">
                  <div className="task-result-item">
                    总题数
                    <strong>{result.total_questions}</strong>
                  </div>
                  <div className="task-result-item">
                    已作答
                    <strong>{result.answered_questions}</strong>
                  </div>
                  <div className="task-result-item">
                    答对
                    <strong>{result.correct_questions}</strong>
                  </div>
                  <div className="task-result-item">
                    得分
                    <strong>{result.score}</strong>
                  </div>
                  <div className="task-result-item">
                    正确率
                    <strong>{(result.accuracy_rate * 100).toFixed(1)}%</strong>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </Modal>
    </ConfigProvider>
  );
}
