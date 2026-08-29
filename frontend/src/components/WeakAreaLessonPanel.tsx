import { useState } from "react";
import {
  Alert,
  Button,
  Card,
  Drawer,
  Input,
  Modal,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from "antd";
import {
  createKnowledgeLesson,
  getKnowledgeLesson,
  regenerateKnowledgeLessonQuiz,
  sendKnowledgeLesson,
  updateKnowledgeLesson,
} from "../api";
import type { KnowledgeLesson, KnowledgeLessonExample, LearningWeakArea } from "../types";
import { formatDateTimeLocal } from "../utils/datetime";

const { Text, Paragraph } = Typography;

interface Props {
  area: LearningWeakArea;
  overallSummary?: string;
  weaknessAnalysisId?: number | null;
}

function examplesToDraft(examples: KnowledgeLessonExample[]): KnowledgeLessonExample[] {
  return examples.map((item) => ({
    sentence: item.sentence || "",
    translation: item.translation || "",
    analysis: item.analysis || "",
  }));
}

export default function WeakAreaLessonPanel({
  area,
  overallSummary,
  weaknessAnalysisId,
}: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [quizLoading, setQuizLoading] = useState(false);
  const [lesson, setLesson] = useState<KnowledgeLesson | null>(null);
  const [studentMessage, setStudentMessage] = useState("");
  const [explanation, setExplanation] = useState("");
  const [keyPointsText, setKeyPointsText] = useState("");
  const [examples, setExamples] = useState<KnowledgeLessonExample[]>([]);
  const [seenStems, setSeenStems] = useState<string[]>([]);

  function applyLesson(data: KnowledgeLesson) {
    setLesson(data);
    setStudentMessage(data.student_message || "");
    setExplanation(data.explanation || "");
    setKeyPointsText((data.key_points || []).join("\n"));
    setExamples(examplesToDraft(data.examples || []));
    setSeenStems(data.quiz.stem ? [data.quiz.stem] : []);
  }

  async function loadLesson(force: boolean) {
    setLoading(true);
    try {
      if (!force) {
        const cached = await getKnowledgeLesson({
          knowledge_point: area.name,
          weakness_analysis_id: weaknessAnalysisId ?? null,
        });
        if (cached) {
          applyLesson(cached);
          message.success("已回显上次知识点分析");
          return;
        }
      }
      const data = await createKnowledgeLesson({
        knowledge_point: area.name,
        evidence: area.evidence || null,
        overall_summary: overallSummary || null,
        weakness_analysis_id: weaknessAnalysisId ?? null,
        force,
      });
      applyLesson(data);
      message.success(force ? "已重新分析" : "已生成");
    } catch (error) {
      const detail =
        error && typeof error === "object" && "response" in error
          ? (error as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : null;
      message.error((typeof detail === "string" && detail) || "知识点分析失败");
    } finally {
      setLoading(false);
    }
  }

  async function handleOpenDrawer() {
    setDrawerOpen(true);
    if (!lesson && !loading) {
      await loadLesson(false);
    }
  }

  async function saveDraft(): Promise<KnowledgeLesson | null> {
    if (!lesson?.id) {
      message.warning("请先生成知识点分析");
      return null;
    }
    setSaving(true);
    try {
      const data = await updateKnowledgeLesson(lesson.id, {
        student_message: studentMessage,
        explanation,
        key_points: keyPointsText
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
        examples,
      });
      applyLesson(data);
      return data;
    } catch (error) {
      const detail =
        error && typeof error === "object" && "response" in error
          ? (error as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : null;
      message.error((typeof detail === "string" && detail) || "保存失败");
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    const data = await saveDraft();
    if (data) message.success("已保存");
  }

  async function handleSend() {
    if (!lesson?.id) {
      message.warning("请先生成知识点分析");
      return;
    }
    Modal.confirm({
      title: lesson.status === "sent" ? "再次发送？" : "发送给学生？",
      okText: "发送",
      onOk: async () => {
        setSending(true);
        try {
          const saved = await saveDraft();
          if (!saved?.id) return;
          const data = await sendKnowledgeLesson(saved.id);
          applyLesson(data);
          message.success("已发给学生");
        } catch (error) {
          const detail =
            error && typeof error === "object" && "response" in error
              ? (error as { response?: { data?: { detail?: string } } }).response?.data?.detail
              : null;
          message.error((typeof detail === "string" && detail) || "发送失败");
        } finally {
          setSending(false);
        }
      },
    });
  }

  async function handleRetryQuiz() {
    if (!lesson) return;
    setQuizLoading(true);
    try {
      const quiz = await regenerateKnowledgeLessonQuiz({
        knowledge_point: lesson.knowledge_point,
        evidence: area.evidence || null,
        avoid_stems: seenStems,
        lesson_id: lesson.id ?? null,
        weakness_analysis_id: weaknessAnalysisId ?? lesson.weakness_analysis_id ?? null,
      });
      const next = { ...lesson, quiz, has_unpublished_changes: lesson.status === "sent" };
      setLesson(next);
      setSeenStems((prev) => (quiz.stem ? [...prev, quiz.stem] : prev));
      message.success("已换题");
    } catch (error) {
      const detail =
        error && typeof error === "object" && "response" in error
          ? (error as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : null;
      message.error((typeof detail === "string" && detail) || "换题失败");
    } finally {
      setQuizLoading(false);
    }
  }

  function updateExample(index: number, patch: Partial<KnowledgeLessonExample>) {
    setExamples((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  const sent = lesson?.status === "sent";

  return (
    <>
      <Card size="small" style={{ width: "100%", background: "#fafafa", marginBottom: 8 }}>
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          <Space wrap style={{ width: "100%", justifyContent: "space-between" }}>
            <Space wrap>
              <Text strong>{area.name}</Text>
              <Tag color={area.severity === "high" ? "error" : area.severity === "low" ? "default" : "warning"}>
                严重度 {area.severity === "high" ? "高" : area.severity === "low" ? "低" : "中"}
              </Tag>
              {sent ? <Tag color="success">已发给学生</Tag> : null}
              {lesson?.has_unpublished_changes ? <Tag>有未发送的修改</Tag> : null}
            </Space>
            <Button type="primary" size="small" onClick={() => handleOpenDrawer()}>
              知识点分析
            </Button>
          </Space>
          {area.evidence ? <Text type="secondary">{area.evidence}</Text> : null}
          {area.related_question_ids?.length ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              相关题 ID：{area.related_question_ids.join("、")}
            </Text>
          ) : null}
        </Space>
      </Card>

      <Drawer
        title={`知识点分析 · ${area.name}`}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        size={680}
        destroyOnClose={false}
        extra={
          <Space>
            {sent ? <Tag color="success">已发送</Tag> : <Tag>草稿</Tag>}
            <Button
              size="small"
              loading={loading}
              onClick={() => {
                loadLesson(true).catch(() => undefined);
              }}
            >
              重新分析
            </Button>
          </Space>
        }
        footer={
          <Space style={{ width: "100%", justifyContent: "flex-end" }}>
            <Button loading={saving} disabled={loading || !lesson} onClick={() => handleSave()}>
              保存
            </Button>
            <Button
              type="primary"
              loading={sending}
              disabled={loading || !lesson}
              onClick={() => handleSend()}
            >
              {sent ? "再次发送" : "发送给学生"}
            </Button>
          </Space>
        }
      >
        {loading && !lesson ? (
          <div style={{ textAlign: "center", padding: "64px 0" }}>
            <Spin size="large" />
            <div style={{ marginTop: 12 }}>
              <Text type="secondary">正在生成讲解…</Text>
            </div>
          </div>
        ) : lesson ? (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            {loading ? <Alert type="info" showIcon message="正在重新生成…" /> : null}
            {sent && lesson.sent_at ? (
              <Text type="secondary">上次发送于 {formatDateTimeLocal(lesson.sent_at)}</Text>
            ) : null}

            <Card size="small" title="写给学生的话">
              <Input.TextArea
                value={studentMessage}
                onChange={(event) => setStudentMessage(event.target.value)}
                rows={3}
                placeholder="可选"
              />
            </Card>

            <Card size="small" title="知识点讲解">
              <Input.TextArea
                value={explanation}
                onChange={(event) => setExplanation(event.target.value)}
                rows={6}
                placeholder="讲解"
              />
            </Card>

            <Card size="small" title="要点">
              <Input.TextArea
                value={keyPointsText}
                onChange={(event) => setKeyPointsText(event.target.value)}
                rows={4}
                placeholder="每行一条要点"
              />
            </Card>

            {examples.length > 0 ? (
              <Card size="small" title="例句分析">
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                  {examples.map((ex, index) => (
                    <Space key={`${index}-${ex.sentence.slice(0, 12)}`} direction="vertical" size={4} style={{ width: "100%" }}>
                      <Text type="secondary">例句 {index + 1}</Text>
                      <Input
                        value={ex.sentence}
                        onChange={(event) => updateExample(index, { sentence: event.target.value })}
                        placeholder="英文例句"
                      />
                      <Input
                        value={ex.translation}
                        onChange={(event) => updateExample(index, { translation: event.target.value })}
                        placeholder="中文"
                      />
                      <Input.TextArea
                        value={ex.analysis}
                        onChange={(event) => updateExample(index, { analysis: event.target.value })}
                        rows={2}
                        placeholder="分析"
                      />
                    </Space>
                  ))}
                </Space>
              </Card>
            ) : null}

            <details className="practice-fold">
              <summary>小测</summary>
              <Paragraph style={{ marginTop: 10 }}>{lesson.quiz.stem}</Paragraph>
              <Space direction="vertical" size={4}>
                {lesson.quiz.options.map((opt) => (
                  <Text key={opt}>{opt}</Text>
                ))}
              </Space>
              {lesson.quiz.correct_answer ? (
                <Paragraph type="secondary" style={{ marginTop: 8 }}>
                  答案 {lesson.quiz.correct_answer}
                </Paragraph>
              ) : null}
              <div className="practice-fold-actions">
                <Button size="small" loading={quizLoading} disabled={loading} onClick={() => handleRetryQuiz()}>
                  换一题
                </Button>
              </div>
            </details>
          </Space>
        ) : (
          <Text type="secondary">暂无内容，可点击右上角「重新分析」</Text>
        )}
      </Drawer>
    </>
  );
}
