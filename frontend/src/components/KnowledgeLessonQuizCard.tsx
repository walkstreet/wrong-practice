import { useState } from "react";
import { Alert, Button, Radio, Space, Typography, message } from "antd";
import { gradeMyKnowledgeLesson } from "../api";
import type { KnowledgeGradeResult, StudentKnowledgeLesson } from "../types";

const { Paragraph } = Typography;

export default function KnowledgeLessonQuizCard({ lesson }: { lesson: StudentKnowledgeLesson }) {
  const [selected, setSelected] = useState("");
  const [grading, setGrading] = useState(false);
  const [grade, setGrade] = useState<KnowledgeGradeResult | null>(null);

  async function handleSubmit() {
    if (!selected) {
      message.warning("请先选择一个选项");
      return;
    }
    setGrading(true);
    try {
      const result = await gradeMyKnowledgeLesson(lesson.id, selected);
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

  return (
    <div>
      <div className="practice-block-kicker">练一练</div>
      {grade ? (
        <Alert
          style={{ marginBottom: 12 }}
          type={grade.is_correct ? "success" : "warning"}
          showIcon
          message={grade.is_correct ? "这把稳了" : `这把没了 — 正确答案是 ${grade.correct_answer}`}
          description={grade.encouragement}
        />
      ) : null}
      <Paragraph style={{ marginBottom: 8 }}>{lesson.quiz.stem}</Paragraph>
      <Radio.Group
        value={selected}
        disabled={!!grade}
        onChange={(event) => setSelected(event.target.value)}
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
          <Button type="primary" loading={grading} onClick={() => handleSubmit()}>
            提交作答
          </Button>
        ) : (
          <Button
            onClick={() => {
              setGrade(null);
              setSelected("");
            }}
          >
            再做一次
          </Button>
        )}
      </Space>
    </div>
  );
}
