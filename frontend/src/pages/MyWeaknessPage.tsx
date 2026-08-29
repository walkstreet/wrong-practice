import { ConfigProvider, Table } from "antd";
import { useEffect, useState } from "react";

import { getMyPortrait, listMyKnowledgeLessons } from "../api";
import KnowledgeLessonQuizCard from "../components/KnowledgeLessonQuizCard";
import type { PortraitKnowledge, StudentKnowledgeLesson, StudentPortrait } from "../types";
import { formatDateTimeLocal } from "../utils/datetime";

const FILTER_THEME = {
  token: {
    colorPrimary: "#7c5cfc",
    colorBorder: "#e4dcf4",
    colorPrimaryHover: "#6b4ef0",
    borderRadius: 10,
    controlHeight: 36,
  },
};

function formatRate(value?: number | null): string {
  return typeof value === "number" ? `${(value * 100).toFixed(0)}%` : "—";
}

export default function MyWeaknessPage() {
  const [loading, setLoading] = useState(false);
  const [portrait, setPortrait] = useState<StudentPortrait | null>(null);
  const [lessons, setLessons] = useState<StudentKnowledgeLesson[]>([]);

  useEffect(() => {
    setLoading(true);
    Promise.all([getMyPortrait(), listMyKnowledgeLessons()])
      .then(([nextPortrait, nextLessons]) => {
        setPortrait(nextPortrait);
        setLessons(nextLessons);
      })
      .catch(() => {
        setPortrait(null);
        setLessons([]);
      })
      .finally(() => setLoading(false));
  }, []);

  const knowledge = portrait?.knowledge.slice(0, 2) ?? [];

  return (
    <ConfigProvider theme={FILTER_THEME}>
      <div className="portrait-page">
        <div className="portrait-head">
          <h1 className="portrait-name">我的短板</h1>
        </div>
        <p className="portrait-meta">只显示你自己的练习情况，看不到同学，也没有班级排名。</p>
        {loading && !portrait ? (
          <div className="entry-empty">加载中…</div>
        ) : !portrait ? (
          <div className="entry-empty">暂时读不到你的练习数据。</div>
        ) : (
          <>
            <div className="portrait-stats">
              <div>
                <strong>{formatRate(portrait.accuracy_rate)}</strong>
                <span>近全部正确率</span>
              </div>
              <div>
                <strong>{knowledge[0]?.name || "—"}</strong>
                <span>最需要补</span>
              </div>
              <div>
                <strong>{portrait.total_attempts}</strong>
                <span>已练习题数</span>
              </div>
            </div>

            {lessons.length ? (
              lessons.map((lesson) => (
                <div key={lesson.id} className="practice-block">
                  <div className="practice-block-kicker">{lesson.knowledge_point}</div>
                  {lesson.sent_at ? <p>老师发送于 {formatDateTimeLocal(lesson.sent_at)}</p> : null}
                  {lesson.student_message ? <p>{lesson.student_message}</p> : null}
                  {lesson.explanation ? <p>{lesson.explanation}</p> : null}
                  {lesson.key_points.length ? (
                    <ol className="practice-list">
                      {lesson.key_points.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ol>
                  ) : null}
                  {lesson.examples.length
                    ? lesson.examples.map((ex, index) => (
                        <p key={`${lesson.id}-ex-${index}`}>
                          {ex.sentence}
                          {ex.translation ? ` ${ex.translation}` : ""}
                          {ex.analysis ? ` ${ex.analysis}` : ""}
                        </p>
                      ))
                    : null}
                  {lesson.quiz.stem ? (
                    <div style={{ marginTop: 12 }}>
                      <KnowledgeLessonQuizCard lesson={lesson} />
                    </div>
                  ) : null}
                </div>
              ))
            ) : (
              <p className="entry-hint">还没有老师发来的内容。</p>
            )}

            <div className="practice-block">
              <div className="practice-block-kicker">建议先补</div>
              <Table
                rowKey="name"
                size="small"
                pagination={false}
                dataSource={knowledge}
                columns={[
                  { title: "知识点", dataIndex: "name" },
                  {
                    title: "最近正确率",
                    dataIndex: "accuracy_rate",
                    width: 120,
                    render: (v: number) => formatRate(v),
                  },
                  {
                    title: "可以怎么练",
                    render: (_, row: PortraitKnowledge) =>
                      row.action === "布置相似题" ? "做一组针对练习" : row.action === "专项巩固" ? "先把这类题练熟" : "按老师建议练",
                  },
                ]}
                locale={{ emptyText: "练习还不够，暂时看不出最弱的点" }}
              />
            </div>
          </>
        )}
      </div>
    </ConfigProvider>
  );
}
