import { Typography } from "antd";
import type { SolvingAnalysis } from "../types";

const { Paragraph, Text } = Typography;

interface Props {
  analysis: SolvingAnalysis;
  audience?: "teacher" | "student";
}

export default function SolvingAnalysisCard({ analysis, audience = "teacher" }: Props) {
  const hasWrong =
    (analysis.wrong_answer && analysis.wrong_answer.trim()) ||
    (analysis.wrong_answer_text && analysis.wrong_answer_text.trim());
  const wrongLabel = audience === "student" ? "常见错选：" : "你的错选：";

  return (
    <div>
      <Paragraph style={{ marginBottom: 8 }}>
        <Text strong>正确答案：</Text>
        <Text style={{ color: "#389e0d", fontSize: 16 }}>
          {analysis.correct_answer}
          {analysis.correct_answer_text ? ` — ${analysis.correct_answer_text}` : ""}
        </Text>
      </Paragraph>
      {hasWrong ? (
        <Paragraph style={{ marginBottom: 8 }}>
          <Text strong>{wrongLabel}</Text>
          <Text type="danger" style={{ fontSize: 16 }}>
            {analysis.wrong_answer || "--"}
            {analysis.wrong_answer_text ? ` — ${analysis.wrong_answer_text}` : ""}
          </Text>
        </Paragraph>
      ) : null}
      <Paragraph style={{ marginBottom: 0 }}>
        <Text strong>为什么：</Text>
      </Paragraph>
      <Paragraph style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{analysis.explanation}</Paragraph>
    </div>
  );
}
