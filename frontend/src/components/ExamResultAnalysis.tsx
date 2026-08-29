import { useState } from "react";
import type { AiAnalysis } from "../types";
import { showsSentenceAnalysis } from "../utils/questionTypes";
import SentenceAnalysisView from "./SentenceAnalysisView";
import SolvingAnalysisCard from "./SolvingAnalysisCard";

function hasSolvingAnalysis(analysis: AiAnalysis | null | undefined): boolean {
  return Boolean(analysis?.solving_analysis);
}

function sentenceAnalysesOf(analysis: AiAnalysis) {
  if (analysis.sentence_analyses && analysis.sentence_analyses.length > 0) {
    return analysis.sentence_analyses;
  }
  return analysis.sentence_analysis ? [analysis.sentence_analysis] : [];
}

interface Props {
  analysis?: AiAnalysis | null;
  questionTypeName?: string | null;
  defaultOpen: boolean;
}

export default function ExamResultAnalysis({ analysis, questionTypeName, defaultOpen }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  if (!analysis) return null;

  const showSentence = showsSentenceAnalysis(questionTypeName);
  const sentences = showSentence ? sentenceAnalysesOf(analysis) : [];
  const showSolving = hasSolvingAnalysis(analysis);
  if (!showSolving && sentences.length === 0) return null;

  return (
    <div className="exam-result-analysis">
      <button type="button" className="exam-result-analysis-toggle" onClick={() => setOpen((value) => !value)}>
        {open ? "收起解析" : "查看解析"}
      </button>
      {open ? (
        <div className="exam-result-analysis-body">
          {showSolving ? (
            <section className="exam-result-analysis-block">
              <div className="exam-result-analysis-title">做题分析</div>
              <SolvingAnalysisCard analysis={analysis.solving_analysis} audience="student" />
            </section>
          ) : null}
          {sentences.length > 0 && sentences[0] ? (
            <section className="exam-result-analysis-block">
              <div className="exam-result-analysis-title">句子成分分析</div>
              <SentenceAnalysisView analysis={sentences[0]} analyses={sentences} />
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
