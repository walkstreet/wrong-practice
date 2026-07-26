import { useState } from "react";
import {
  Alert,
  Button,
  Card,
  Drawer,
  List,
  Radio,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from "antd";
import {
  createKnowledgeLesson,
  getKnowledgeLesson,
  gradeKnowledgeLesson,
  regenerateKnowledgeLessonQuiz,
} from "../api";
import type { KnowledgeGradeResult, KnowledgeLesson, LearningWeakArea } from "../types";

const { Text, Paragraph } = Typography;

interface Props {
  area: LearningWeakArea;
  overallSummary?: string;
  weaknessAnalysisId?: number | null;
}

export default function WeakAreaLessonPanel({
  area,
  overallSummary,
  weaknessAnalysisId,
}: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [quizLoading, setQuizLoading] = useState(false);
  const [grading, setGrading] = useState(false);
  const [lesson, setLesson] = useState<KnowledgeLesson | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [grade, setGrade] = useState<KnowledgeGradeResult | null>(null);
  const [seenStems, setSeenStems] = useState<string[]>([]);

  async function loadLesson(force: boolean) {
    setLoading(true);
    setGrade(null);
    setSelected("");
    try {
      if (!force) {
        const cached = await getKnowledgeLesson({
          knowledge_point: area.name,
          weakness_analysis_id: weaknessAnalysisId ?? null,
        });
        if (cached) {
          setLesson(cached);
          setSeenStems(cached.quiz.stem ? [cached.quiz.stem] : []);
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
      setLesson(data);
      setSeenStems(data.quiz.stem ? [data.quiz.stem] : []);
      message.success(force ? "已重新分析并保存" : "知识点讲解已生成并保存");
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

  async function handleSubmit() {
    if (!lesson) return;
    if (!selected) {
      message.warning("请先选择一个选项");
      return;
    }
    setGrading(true);
    try {
      const result = await gradeKnowledgeLesson({
        knowledge_point: lesson.knowledge_point,
        quiz_stem: lesson.quiz.stem,
        options: lesson.quiz.options,
        correct_answer: lesson.quiz.correct_answer,
        user_answer: selected,
      });
      setGrade(result);
    } catch (error) {
      const detail =
        error && typeof error === "object" && "response" in error
          ? (error as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : null;
      message.error((typeof detail === "string" && detail) || "批改失败");
    } finally {
      setGrading(false);
    }
  }

  async function handleRetryQuiz() {
    if (!lesson) return;
    setQuizLoading(true);
    setGrade(null);
    setSelected("");
    try {
      const quiz = await regenerateKnowledgeLessonQuiz({
        knowledge_point: lesson.knowledge_point,
        evidence: area.evidence || null,
        avoid_stems: seenStems,
        lesson_id: lesson.id ?? null,
        weakness_analysis_id: weaknessAnalysisId ?? lesson.weakness_analysis_id ?? null,
      });
      setLesson({ ...lesson, quiz });
      setSeenStems((prev) => (quiz.stem ? [...prev, quiz.stem] : prev));
      message.success("已换成新题并保存");
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

  return (
    <>
      <Card size="small" style={{ width: "100%", background: "#fafafa" }}>
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          <Space wrap style={{ width: "100%", justifyContent: "space-between" }}>
            <Space wrap>
              <Text strong>{area.name}</Text>
              <Tag color={area.severity === "high" ? "error" : area.severity === "low" ? "default" : "warning"}>
                严重度 {area.severity === "high" ? "高" : area.severity === "low" ? "低" : "中"}
              </Tag>
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
        width={680}
        destroyOnClose={false}
        extra={
          <Button
            size="small"
            loading={loading}
            onClick={() => {
              loadLesson(true).catch(() => undefined);
            }}
          >
            重新分析
          </Button>
        }
      >
        {loading && !lesson ? (
          <div style={{ textAlign: "center", padding: "64px 0" }}>
            <Spin size="large" />
            <div style={{ marginTop: 12 }}>
              <Text type="secondary">AI 正在讲解并出题…</Text>
            </div>
          </div>
        ) : lesson ? (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            {loading ? (
              <Alert type="info" showIcon message="正在重新生成讲解与题目…" />
            ) : null}

            <Card size="small" title="知识点讲解">
              <Paragraph style={{ marginBottom: 8 }}>{lesson.explanation}</Paragraph>
              {lesson.key_points.length > 0 ? (
                <List
                  size="small"
                  dataSource={lesson.key_points}
                  renderItem={(item, index) => (
                    <List.Item style={{ padding: "4px 0" }}>
                      <Text>
                        {index + 1}. {item}
                      </Text>
                    </List.Item>
                  )}
                />
              ) : null}
            </Card>

            {lesson.examples.length > 0 ? (
              <Card size="small" title="例句分析">
                <List
                  size="small"
                  dataSource={lesson.examples}
                  renderItem={(ex, index) => (
                    <List.Item>
                      <Space direction="vertical" size={2} style={{ width: "100%" }}>
                        <Text>
                          {index + 1}. {ex.sentence}
                        </Text>
                        {ex.translation ? <Text type="secondary">{ex.translation}</Text> : null}
                        {ex.analysis ? <Text type="secondary">分析：{ex.analysis}</Text> : null}
                      </Space>
                    </List.Item>
                  )}
                />
              </Card>
            ) : null}

            <Card size="small" title="练一练">
              {quizLoading ? (
                <Alert style={{ marginBottom: 12 }} type="info" showIcon message="AI 正在出新题…" />
              ) : null}
              {grade && !quizLoading ? (
                <Alert
                  style={{ marginBottom: 12 }}
                  type={grade.is_correct ? "success" : "warning"}
                  showIcon
                  message={grade.is_correct ? "回答正确" : `再想想 — 正确答案是 ${grade.correct_answer}`}
                  description={grade.encouragement}
                />
              ) : null}
              <Paragraph style={{ marginBottom: 8 }}>{lesson.quiz.stem}</Paragraph>
              <Radio.Group
                value={selected}
                disabled={!!grade || loading || quizLoading}
                onChange={(e) => setSelected(e.target.value)}
                style={{ display: "flex", flexDirection: "column", gap: 8 }}
              >
                {lesson.quiz.options.map((opt) => {
                  const letter = opt.trim().match(/^([A-Da-d])\b/)?.[1]?.toUpperCase() || opt;
                  return (
                    <Radio key={opt} value={letter} style={{ whiteSpace: "normal", alignItems: "flex-start" }}>
                      {opt}
                    </Radio>
                  );
                })}
              </Radio.Group>
              <Space style={{ marginTop: 12 }}>
                {!grade ? (
                  <Button
                    type="primary"
                    loading={grading}
                    disabled={loading || quizLoading}
                    onClick={() => handleSubmit()}
                  >
                    提交作答
                  </Button>
                ) : (
                  <Button loading={quizLoading} disabled={loading} onClick={() => handleRetryQuiz()}>
                    再做一次
                  </Button>
                )}
              </Space>
            </Card>
          </Space>
        ) : (
          <Text type="secondary">暂无内容，可点击右上角「重新分析」</Text>
        )}
      </Drawer>
    </>
  );
}
