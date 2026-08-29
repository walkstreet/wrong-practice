import { LeftOutlined } from '@ant-design/icons';
import { ConfigProvider, Input, Modal, message } from 'antd';
import axios from 'axios';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  getMyAssignment,
  getMyAssignmentReview,
  listMyAssignments,
  saveMyAnswer,
  submitMyAssignment,
} from '../api';
import ExamResultAnalysis from '../components/ExamResultAnalysis';
import type {
  AnswerItem,
  LearnerAssignmentDetail,
  LearnerAssignmentListItem,
  LearnerAssignmentReview,
  LearnerQuestion,
} from '../types';
import { formatDateTimeLocal } from '../utils/datetime';
import { splitStemBlanks, slotLabel } from '../utils/fillBlanks';
import { userAssignmentStatusLabel } from '../utils/labels';

const FILTER_THEME = {
  token: {
    colorPrimary: '#7c5cfc',
    colorBorder: '#e4dcf4',
    colorPrimaryHover: '#6b4ef0',
    borderRadius: 12,
    controlHeight: 40,
  },
};

interface LearnerAssignmentsPageProps {
  entryAssignmentId?: number;
}

interface DisplayOption {
  label: string;
  value: string;
  key: string;
}

type ExamPhase = 'start' | 'exam' | 'result';
type DraftValue = string | string[];

function getApiErrorMessage(error: unknown): string | null {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === 'string' && detail.trim()) {
      return detail;
    }
  }
  return null;
}

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
    key: String.fromCharCode(65 + index),
    label: value,
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

function formatDue(value?: string | null): string | null {
  if (!value) return null;
  const text = formatDateTimeLocal(value);
  return text === '--' ? null : text.replace(/:\d{2}$/, '');
}

function buildAnswerPayloadForQuestion(
  q: LearnerQuestion | undefined,
  draft: DraftValue | undefined,
): { payload: AnswerItem[] | null; error?: string } {
  if (!q) return { payload: null };
  let payload: AnswerItem[];
  if (q.fill_slots && q.fill_slots.length > 0) {
    const draftArr = Array.isArray(draft)
      ? draft
      : typeof draft === 'string'
        ? [draft, ...Array.from({ length: Math.max(q.fill_slots.length - 1, 0) }, () => '')]
        : Array.from({ length: q.fill_slots.length }, () => '');
    payload = q.fill_slots.map((needFill, i) => {
      if (!needFill) return null;
      const v = (draftArr[i] || '').trim();
      return v ? v : null;
    });
  } else if (q.multiple || isGroupedChoiceOptions(q.options)) {
    const arr = Array.isArray(draft) ? draft : [];
    payload = arr.map((v) => {
      const t = (v || '').trim();
      return t ? t : null;
    });
  } else {
    const raw = typeof draft === 'string' ? draft.trim() : '';
    payload = raw ? [raw] : [];
  }
  if (payload.length === 0 || payload.every((item) => item === null)) {
    return { payload: null };
  }
  return { payload };
}

function draftFromSaved(q: LearnerQuestion): DraftValue | undefined {
  const saved = q.user_answer;
  if (!saved?.length) return undefined;
  if (isGroupedChoiceOptions(q.options)) {
    return q.options.map((_, idx) => {
      const item = saved[idx];
      return typeof item === 'string' ? item : '';
    });
  }
  if (q.fill_slots && q.fill_slots.length) {
    return q.fill_slots.map((_, idx) => {
      const item = saved[idx];
      return typeof item === 'string' ? item : '';
    });
  }
  if (q.multiple) {
    return saved.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
  }
  const first = saved.find((item) => typeof item === 'string' && item.trim() !== '');
  return typeof first === 'string' ? first : '';
}

function kindLabel(q: LearnerQuestion): string {
  if (q.question_type_name) return q.question_type_name;
  if (isGroupedChoiceOptions(q.options)) return '分组选择';
  if (isFlatChoiceOptions(q.options)) return q.multiple ? '多选题' : '选择题';
  if (q.fill_slots?.length) return '填空题';
  return '作答题';
}

export default function LearnerAssignmentsPage({
  entryAssignmentId,
}: LearnerAssignmentsPageProps) {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<LearnerAssignmentListItem[]>([]);
  const [current, setCurrent] = useState<LearnerAssignmentDetail | null>(null);
  const [answerMap, setAnswerMap] = useState<Record<number, DraftValue>>({});
  const [phase, setPhase] = useState<ExamPhase>('start');
  const [cursor, setCursor] = useState(0);
  const [opening, setOpening] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedTick, setSavedTick] = useState(0);
  const [review, setReview] = useState<LearnerAssignmentReview | null>(null);

  const answerMapRef = useRef(answerMap);
  const currentRef = useRef(current);
  const saveTimers = useRef<Record<number, number>>({});
  answerMapRef.current = answerMap;
  currentRef.current = current;

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

  const sortedQuestions = useMemo(() => {
    if (!current) return [];
    return [...current.questions].sort((a, b) => a.question_order - b.question_order);
  }, [current]);

  const shuffledOptionMap = useMemo(() => {
    const flat: Record<number, DisplayOption[]> = {};
    const grouped: Record<number, DisplayOption[][]> = {};
    for (const q of sortedQuestions) {
      if (isFlatChoiceOptions(q.options)) {
        flat[q.wrong_question_id] = makeShuffledOptions(q.options);
      } else if (isGroupedChoiceOptions(q.options)) {
        grouped[q.wrong_question_id] = q.options.map((group) => makeShuffledOptions(group));
      }
    }
    return { flat, grouped };
  }, [sortedQuestions]);

  function getFillDraft(wrongQuestionId: number, slotCount: number): string[] {
    const draft = answerMap[wrongQuestionId];
    if (typeof draft === 'string') {
      if (slotCount <= 1) return [draft];
      return [draft, ...Array.from({ length: slotCount - 1 }, () => '')];
    }
    if (Array.isArray(draft) && draft.length === slotCount) {
      return draft.map((s) => (typeof s === 'string' ? s : ''));
    }
    return Array.from({ length: slotCount }, () => '');
  }

  const persistAnswer = useCallback(async (wrongQuestionId: number) => {
    const assignment = currentRef.current;
    if (!assignment) return;
    const q = assignment.questions.find((item) => item.wrong_question_id === wrongQuestionId);
    const built = buildAnswerPayloadForQuestion(q, answerMapRef.current[wrongQuestionId]);
    if (built.error || !built.payload) return;
    setSaving(true);
    try {
      await saveMyAnswer(assignment.assignment_id, wrongQuestionId, built.payload);
      setSavedTick(Date.now());
    } catch {
      // 交卷时会再保存一次
    } finally {
      setSaving(false);
    }
  }, []);

  function scheduleSave(wrongQuestionId: number) {
    window.clearTimeout(saveTimers.current[wrongQuestionId]);
    saveTimers.current[wrongQuestionId] = window.setTimeout(() => {
      void persistAnswer(wrongQuestionId);
    }, 450);
  }

  function setDraft(wrongQuestionId: number, value: DraftValue, persist = true) {
    setAnswerMap((prev) => ({ ...prev, [wrongQuestionId]: value }));
    if (persist) scheduleSave(wrongQuestionId);
  }

  function isAnswered(q: LearnerQuestion): boolean {
    const draft = answerMap[q.wrong_question_id];
    if (q.fill_slots && q.fill_slots.length) {
      const arr = getFillDraft(q.wrong_question_id, q.fill_slots.length);
      return q.fill_slots.some((need, i) => need && (arr[i] || '').trim());
    }
    if (q.multiple || isGroupedChoiceOptions(q.options)) {
      return Array.isArray(draft) && draft.some((item) => (item || '').trim());
    }
    return typeof draft === 'string' && draft.trim().length > 0;
  }

  async function openAssignment(id: number, startExam = false) {
    setOpening(true);
    try {
      const detail = await getMyAssignment(id);
      const drafts: Record<number, DraftValue> = {};
      const ordered = [...detail.questions].sort((a, b) => a.question_order - b.question_order);
      ordered.forEach((q) => {
        const draft = draftFromSaved(q);
        if (draft !== undefined) drafts[q.wrong_question_id] = draft;
      });
      const unansweredIndex = ordered.findIndex((q) => {
        const draft = drafts[q.wrong_question_id];
        if (draft === undefined) return true;
        if (Array.isArray(draft)) return !draft.some((item) => item.trim());
        return !draft.trim();
      });
      setCurrent(detail);
      setAnswerMap(drafts);
      setReview(null);
      setCursor(unansweredIndex >= 0 ? unansweredIndex : 0);
      setPhase(startExam || detail.status === 'in_progress' ? 'exam' : 'start');
    } catch (error) {
      message.error(getApiErrorMessage(error) || '加载任务详情失败');
    } finally {
      setOpening(false);
    }
  }

  useEffect(() => {
    if (entryAssignmentId) {
      openAssignment(entryAssignmentId, true).catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryAssignmentId]);

  useEffect(() => {
    if (!current && !review) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [current, review]);

  useEffect(() => {
    return () => {
      Object.values(saveTimers.current).forEach((id) => window.clearTimeout(id));
    };
  }, []);

  function closeExam() {
    Object.values(saveTimers.current).forEach((id) => window.clearTimeout(id));
    setCurrent(null);
    setAnswerMap({});
    setReview(null);
    setPhase('start');
    setCursor(0);
    void loadList();
  }

  async function openReview(id: number) {
    setOpening(true);
    try {
      const data = await getMyAssignmentReview(id);
      setCurrent(null);
      setAnswerMap({});
      setReview(data);
      setPhase('result');
    } catch (error) {
      message.error(getApiErrorMessage(error) || '加载作答结果失败');
    } finally {
      setOpening(false);
    }
  }

  async function handleSubmit() {
    if (!current) return;
    const unanswered = sortedQuestions.filter((q) => !isAnswered(q)).length;
    const run = async () => {
      setSubmitting(true);
      try {
        Object.values(saveTimers.current).forEach((id) => window.clearTimeout(id));
        const pendingAnswers: Array<{ wrongQuestionId: number; payload: AnswerItem[] }> = [];
        for (const q of sortedQuestions) {
          const built = buildAnswerPayloadForQuestion(q, answerMapRef.current[q.wrong_question_id]);
          if (built.error) {
            message.warning(built.error);
            return;
          }
          if (built.payload) {
            pendingAnswers.push({
              wrongQuestionId: q.wrong_question_id,
              payload: built.payload,
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
        await submitMyAssignment(current.assignment_id);
        Modal.destroyAll();
        message.success('已交卷');
        await loadList();
        try {
          setReview(await getMyAssignmentReview(current.assignment_id));
        } catch (error) {
          message.warning(getApiErrorMessage(error) || '交卷成功，解析可稍后从已完成任务打开');
        }
        setPhase('result');
      } catch (error) {
        const detail = getApiErrorMessage(error);
        message.error(detail || '提交失败，请先至少保存一题答案');
      } finally {
        setSubmitting(false);
      }
    };
    if (unanswered > 0) {
      Modal.confirm({
        title: '还有题目未作答',
        content: `还有 ${unanswered} 题空白，确定现在交卷吗？`,
        okText: '交卷',
        cancelText: '继续作答',
        zIndex: 1200,
        onOk: run,
      });
      return;
    }
    await run();
  }

  const active = sortedQuestions[cursor];
  const answeredCount = sortedQuestions.filter(isAnswered).length;
  const progress = sortedQuestions.length
    ? Math.round((answeredCount / sortedQuestions.length) * 100)
    : 0;
  const slotTotal = sortedQuestions.reduce((sum, q) => {
    if (q.fill_slots?.length) return sum + q.fill_slots.filter(Boolean).length;
    if (isGroupedChoiceOptions(q.options)) return sum + q.options.length;
    return sum + 1;
  }, 0);

  useEffect(() => {
    if (phase !== 'exam' || !active) return undefined;
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault();
        setCursor((prev) => Math.min(prev + 1, sortedQuestions.length - 1));
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault();
        setCursor((prev) => Math.max(prev - 1, 0));
      }
      if (!active || !isFlatChoiceOptions(active.options) || active.multiple) return;
      const options = shuffledOptionMap.flat[active.wrong_question_id] || [];
      const idxFromDigit = Number(event.key) - 1;
      const idxFromLetter = event.key.toUpperCase().charCodeAt(0) - 65;
      const idx = event.key >= '1' && event.key <= '9' ? idxFromDigit : idxFromLetter;
      if (idx >= 0 && idx < options.length) {
        event.preventDefault();
        setDraft(active.wrong_question_id, options[idx].value);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, active, sortedQuestions.length, shuffledOptionMap]);

  function renderChoices(
    q: LearnerQuestion,
    options: DisplayOption[],
    selected: string | undefined,
    onPick: (value: string) => void,
    multiple = false,
  ) {
    return (
      <div className="exam-choices" role={multiple ? 'group' : 'radiogroup'}>
        {options.map((option) => {
          const checked = multiple
            ? Array.isArray(answerMap[q.wrong_question_id]) &&
              (answerMap[q.wrong_question_id] as string[]).includes(option.value)
            : selected === option.value;
          return (
            <button
              key={`${q.wrong_question_id}-${option.key}-${option.value}`}
              type="button"
              className={`exam-choice${checked ? ' is-selected' : ''}`}
              onClick={() => onPick(option.value)}
            >
              <span className="exam-choice-key">{option.key}</span>
              <span className="exam-choice-text">{option.label}</span>
            </button>
          );
        })}
      </div>
    );
  }

  function renderQuestion(q: LearnerQuestion) {
    if (isFlatChoiceOptions(q.options)) {
      const options = shuffledOptionMap.flat[q.wrong_question_id] || [];
      if (q.multiple) {
        const selected = Array.isArray(answerMap[q.wrong_question_id])
          ? (answerMap[q.wrong_question_id] as string[])
          : [];
        return (
          <>
            <p className="exam-hint">本题可多选</p>
            {renderChoices(
              q,
              options,
              undefined,
              (value) => {
                const next = selected.includes(value)
                  ? selected.filter((item) => item !== value)
                  : [...selected, value];
                setDraft(q.wrong_question_id, next);
              },
              true,
            )}
          </>
        );
      }
      return renderChoices(q, options, typeof answerMap[q.wrong_question_id] === 'string'
        ? answerMap[q.wrong_question_id]
        : undefined, (value) => setDraft(q.wrong_question_id, value));
    }
    if (isGroupedChoiceOptions(q.options)) {
      const groups = shuffledOptionMap.grouped[q.wrong_question_id] || [];
      const currentGroupAnswers = Array.isArray(answerMap[q.wrong_question_id])
        ? (answerMap[q.wrong_question_id] as string[])
        : [];
      return (
        <div className="exam-subqs">
          {groups.map((group, idx) => (
            <div key={`${q.wrong_question_id}-${idx}`} className="exam-subq">
              <div className="exam-kicker">第 {idx + 1} 小题</div>
              {renderChoices(q, group, currentGroupAnswers[idx], (value) => {
                const next = [...currentGroupAnswers];
                next[idx] = value;
                setDraft(q.wrong_question_id, next);
              })}
            </div>
          ))}
        </div>
      );
    }
    if (q.fill_slots && q.fill_slots.length) {
      const slots = q.fill_slots;
      const fillable = slots.map((need, idx) => (need ? idx : -1)).filter((idx) => idx >= 0);
      const parts = splitStemBlanks(q.stem);
      const hasMarkers = parts.some((part) => part.type === 'blank');
      const markerCount = parts.filter((part) => part.type === 'blank').length;
      const inlineCount = hasMarkers ? Math.min(markerCount, fillable.length) : 0;
      const extraSlots = fillable.slice(inlineCount);
      const draft = getFillDraft(q.wrong_question_id, slots.length);
      const writeSlot = (slotIndex: number, value: string) => {
        const next = getFillDraft(q.wrong_question_id, slots.length);
        next[slotIndex] = value;
        setDraft(q.wrong_question_id, next);
      };
      let markerCursor = 0;
      return (
        <div className="exam-fills">
          {hasMarkers ? (
            <p className="exam-stem exam-stem-fill">
              {parts.map((part, i) => {
                if (part.type === 'text') {
                  return <span key={`t-${i}`}>{part.value}</span>;
                }
                const slotIndex = fillable[markerCursor++];
                if (slotIndex == null) {
                  return <span key={`b-${i}`}>____</span>;
                }
                return (
                  <input
                    key={`b-${i}`}
                    className="exam-inline-blank"
                    value={draft[slotIndex] || ''}
                    onChange={(e) => writeSlot(slotIndex, e.target.value)}
                    aria-label={`第 ${fillable.indexOf(slotIndex) + 1} 空`}
                    autoComplete="off"
                  />
                );
              })}
            </p>
          ) : (
            <p className="exam-stem">{q.stem}</p>
          )}
          <p className="exam-hint">每个空单独填写，不会的可以留空。共 {fillable.length} 个空，按空计分。</p>
          {extraSlots.map((slotIndex) => (
            <label key={`extra-${slotIndex}`} className="exam-fill">
              <span>第 {fillable.indexOf(slotIndex) + 1} 空</span>
              <Input
                placeholder="写下答案"
                value={draft[slotIndex] || ''}
                onChange={(e) => writeSlot(slotIndex, e.target.value)}
              />
            </label>
          ))}
        </div>
      );
    }
    return (
      <div className="exam-fills">
        <p className="exam-hint">写下这题的答案，不会可以留空。</p>
        <Input
          placeholder="写下答案"
          value={typeof answerMap[q.wrong_question_id] === 'string' ? answerMap[q.wrong_question_id] : ''}
          onChange={(e) => setDraft(q.wrong_question_id, e.target.value)}
        />
      </div>
    );
  }

  const pending = items.filter((row) => row.status === 'assigned' || row.status === 'in_progress');
  const done = items.filter((row) => row.status === 'submitted' || row.status === 'graded');

  return (
    <ConfigProvider theme={FILTER_THEME}>
      <div className="exam-home">
        <div className="exam-home-head">
          <div>
            <div className="exam-home-kicker">练习</div>
            <h1>我的任务</h1>
            <p>老师布置的练习会显示在这里。点开后一题一题作答，中途退出也会保留进度。</p>
          </div>
          <div className="exam-home-stat">
            <strong>{pending.length}</strong>
            <span>待完成</span>
          </div>
        </div>

        {loading && !items.length ? (
          <div className="exam-empty">正在加载任务…</div>
        ) : !items.length ? (
          <div className="exam-empty">暂时还没有布置给你的任务。</div>
        ) : (
          <>
            {pending.length ? (
              <section className="exam-board">
                {pending.map((row) => (
                  <article key={row.assignment_id} className="exam-ticket">
                    <div className="exam-ticket-top">
                      <span className={`list-status is-${row.status}`}>
                        {userAssignmentStatusLabel(row.status)}
                      </span>
                      <span>{row.question_count} 题</span>
                    </div>
                    <h2>{row.title}</h2>
                    <p>
                      {formatDue(row.due_at) ? `截止 ${formatDue(row.due_at)}` : '不限截止时间'}
                    </p>
                    <button
                      type="button"
                      className="exam-ticket-go"
                      disabled={opening}
                      onClick={() => openAssignment(row.assignment_id, row.status === 'in_progress')}
                    >
                      {row.status === 'in_progress' ? '继续作答' : '开始作答'}
                    </button>
                  </article>
                ))}
              </section>
            ) : null}

            {done.length ? (
              <section className="exam-done">
                <div className="exam-done-label">已完成</div>
                {done.map((row) => (
                  <button
                    key={row.assignment_id}
                    type="button"
                    className="exam-done-row"
                    disabled={opening}
                    onClick={() => void openReview(row.assignment_id)}
                  >
                    <div>
                      <strong>{row.title}</strong>
                      <span>{userAssignmentStatusLabel(row.status)}</span>
                    </div>
                    <em>
                      {typeof row.score === 'number'
                        ? `${row.score} 分 · ${((row.accuracy_rate || 0) * 100).toFixed(0)}%`
                        : '已交卷'}
                    </em>
                  </button>
                ))}
              </section>
            ) : null}
          </>
        )}
      </div>

      {current || review ? (
        <div className="exam-overlay" role="dialog" aria-modal="true" aria-label={current?.title || review?.title}>
          {phase === 'exam' ? <div className="exam-progress-line" style={{ width: `${progress}%` }} /> : null}
          <header className="exam-topbar">
            <button type="button" className="exam-icon-btn" onClick={closeExam} aria-label={phase === 'result' ? '离开回顾' : '离开作答'}>
              <LeftOutlined />
              离开
            </button>
            <div className="exam-topbar-title">{current?.title || review?.title}</div>
            <div className="exam-topbar-meta">
              {phase === 'exam' ? (
                <span>{saving ? '正在保存' : savedTick ? '已保存' : '作答会自动保存'}</span>
              ) : phase === 'result' ? (
                <span>已交卷</span>
              ) : (
                <span>
                  {answeredCount}/{sortedQuestions.length}
                </span>
              )}
            </div>
          </header>

          {phase === 'start' && current ? (
            <div className="exam-hero">
              <div className="exam-hero-card">
                <div className="exam-kicker">即将开始</div>
                <h2>{current.title}</h2>
                {current.description ? <p className="exam-hero-desc">{current.description}</p> : null}
                <ul className="exam-hero-meta">
                  <li>{sortedQuestions.length} 道题{slotTotal > sortedQuestions.length ? ` · ${slotTotal} 个空` : ''}</li>
                  <li>{slotTotal > sortedQuestions.length ? '按空计分，对几个空得几分' : '做对一题得相应分数'}</li>
                  <li>中途可退出，进度会保留</li>
                  {formatDue(current.due_at) ? <li>截止 {formatDue(current.due_at)}</li> : null}
                </ul>
                <button type="button" className="exam-primary" onClick={() => setPhase('exam')}>
                  开始作答
                </button>
              </div>
            </div>
          ) : null}

          {phase === 'exam' && active ? (
            <div className="exam-body">
              <aside className="exam-nav" aria-label="题目导航">
                <div className="exam-nav-label">
                  {answeredCount} / {sortedQuestions.length}
                </div>
                <div className="exam-nav-grid">
                  {sortedQuestions.map((q, idx) => (
                    <button
                      key={q.wrong_question_id}
                      type="button"
                      className={`exam-nav-dot${idx === cursor ? ' is-current' : ''}${isAnswered(q) ? ' is-done' : ''}`}
                      onClick={() => setCursor(idx)}
                    >
                      {idx + 1}
                    </button>
                  ))}
                </div>
              </aside>
              <section className="exam-stage">
                <div className="exam-paper">
                  <div className="exam-kicker">
                    第 {cursor + 1} 题 · {kindLabel(active)}
                  </div>
                  {active.fill_slots?.length ? null : <p className="exam-stem">{active.stem}</p>}
                  {renderQuestion(active)}
                </div>
              </section>
            </div>
          ) : null}

          {phase === 'result' && review ? (
            <div className="exam-result">
              <div className="exam-result-hero">
                <div className="exam-score">
                  <strong>{Math.round(review.score ?? 0)}</strong>
                  <span>分</span>
                </div>
                <div>
                  <div className="exam-kicker">{current ? '交卷结果' : '已完成'}</div>
                  <h2>{current ? '这次作答已经记下了' : '回顾这次作答'}</h2>
                  <p>
                    {typeof review.correct_slots === 'number' && typeof review.total_slots === 'number' && review.total_slots > 0
                      ? `${review.correct_slots} / ${review.total_slots} 空正确`
                      : `${review.correct_questions} / ${review.total_questions} 题正确`}
                    {typeof review.score === 'number' ? `，得分 ${review.score.toFixed(0)}` : ''}
                  </p>
                </div>
              </div>
              <div className="exam-result-list">
                {[...review.questions]
                  .sort((a, b) => a.question_order - b.question_order)
                  .map((q, idx) => {
                    const unanswered = q.user_answer == null;
                    const totalSlots = q.total_slots || q.fill_slots?.filter(Boolean).length || 1;
                    const correctSlots = q.correct_slots ?? 0;
                    const flags = q.slot_correct || [];
                    const partial = totalSlots > 1;
                    const state = unanswered ? '' : q.is_correct ? ' is-ok' : correctSlots > 0 ? ' is-mid' : ' is-bad';
                    return (
                      <article key={q.wrong_question_id} className={`exam-result-item${state}`}>
                        <div className="exam-result-flag">
                          {unanswered ? '未' : q.is_correct ? '对' : partial ? `${correctSlots}/${totalSlots}` : '错'}
                        </div>
                        <div className="exam-result-main">
                          <div className="exam-kicker">
                            第 {idx + 1} 题
                            {partial ? ` · ${correctSlots}/${totalSlots} 空` : ''}
                          </div>
                          <p>{q.stem}</p>
                          {flags.length > 1 ? (
                            <div className="exam-slot-list">
                              {flags.map((ok, slotIdx) => {
                                const sourceIdx =
                                  q.fill_slots?.length
                                    ? q.fill_slots
                                        .map((need, idx) => (need ? idx : -1))
                                        .filter((idx) => idx >= 0)[slotIdx] ?? slotIdx
                                    : slotIdx;
                                return (
                                  <span key={slotIdx} className={`exam-slot-chip${ok ? ' is-ok' : ' is-bad'}`}>
                                    {slotIdx + 1}. {slotLabel(q.user_answer?.[sourceIdx])}
                                    <em>{slotLabel(q.standard_answer?.[sourceIdx])}</em>
                                  </span>
                                );
                              })}
                            </div>
                          ) : (
                            <p>
                              你的答案 {slotLabel(q.user_answer?.[0] ?? q.user_answer)}
                              {q.standard_answer ? (
                                <span className="exam-result-std">
                                  {' '}
                                  · 参考 {slotLabel(q.standard_answer[0] ?? q.standard_answer)}
                                </span>
                              ) : null}
                            </p>
                          )}
                          <ExamResultAnalysis
                            analysis={q.ai_analysis}
                            questionTypeName={q.question_type_name}
                            defaultOpen={!q.is_correct}
                          />
                        </div>
                      </article>
                    );
                  })}
              </div>
              <button type="button" className="exam-primary" onClick={closeExam}>
                返回任务列表
              </button>
            </div>
          ) : null}

          {phase === 'exam' ? (
            <footer className="exam-footer">
              <button
                type="button"
                className="exam-ghost"
                disabled={cursor <= 0}
                onClick={() => setCursor((prev) => Math.max(prev - 1, 0))}
              >
                上一题
              </button>
              <div className="exam-footer-actions">
                {cursor < sortedQuestions.length - 1 ? (
                  <button
                    type="button"
                    className="exam-primary"
                    onClick={() => setCursor((prev) => Math.min(prev + 1, sortedQuestions.length - 1))}
                  >
                    下一题
                  </button>
                ) : null}
                <button
                  type="button"
                  className={cursor < sortedQuestions.length - 1 ? 'exam-ghost' : 'exam-primary'}
                  disabled={submitting}
                  onClick={() => void handleSubmit()}
                >
                  {submitting ? '正在交卷…' : '交卷'}
                </button>
              </div>
            </footer>
          ) : null}
        </div>
      ) : null}
    </ConfigProvider>
  );
}
