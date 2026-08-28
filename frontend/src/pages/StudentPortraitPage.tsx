import { LeftOutlined } from "@ant-design/icons";
import { ConfigProvider, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { getStudentPortrait } from "../api";
import AbilityRadar from "../components/AbilityRadar";
import WeaknessAnalysisPanel from "../components/WeaknessAnalysisPanel";
import type { PortraitAxis, PortraitKnowledge, StudentPortrait } from "../types";
import { formatDateTimeLocal } from "../utils/datetime";
import { portraitStatusLabel } from "../utils/labels";
import { userLabel } from "../utils/userLabel";

const FILTER_THEME = {
  token: {
    colorPrimary: "#7c5cfc",
    colorBorder: "#e4dcf4",
    colorPrimaryHover: "#6b4ef0",
    borderRadius: 10,
    controlHeight: 36,
  },
};

function statusClass(status: StudentPortrait["status"]): string {
  if (status === "lagging") return "is-err-high";
  if (status === "watch") return "is-err-medium";
  if (status === "insufficient") return "is-err-none";
  return "is-ok";
}

function formatRate(value?: number | null): string {
  return typeof value === "number" ? `${(value * 100).toFixed(0)}%` : "—";
}

export default function StudentPortraitPage() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const id = Number(userId);
  const [loading, setLoading] = useState(false);
  const [portrait, setPortrait] = useState<StudentPortrait | null>(null);

  const load = useCallback(() => {
    if (!Number.isFinite(id) || id <= 0) return;
    setLoading(true);
    getStudentPortrait(id)
      .then(setPortrait)
      .catch(() => setPortrait(null))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const axisColumns: ColumnsType<PortraitAxis> = [
    { title: "能力", dataIndex: "label", width: 96 },
    {
      title: "正确率",
      dataIndex: "accuracy_rate",
      width: 88,
      render: (value, row) => (row.sufficient ? formatRate(value) : "数据不足"),
    },
    {
      title: "班级",
      dataIndex: "class_accuracy_rate",
      width: 88,
      render: (value?: number | null) => formatRate(value),
    },
    { title: "作答", dataIndex: "attempts", width: 72 },
  ];

  const knowledgeColumns: ColumnsType<PortraitKnowledge> = [
    { title: "知识点", dataIndex: "name" },
    { title: "正确率", dataIndex: "accuracy_rate", width: 88, render: (v: number) => formatRate(v) },
    { title: "作答", dataIndex: "attempts", width: 72 },
    { title: "建议动作", dataIndex: "action" },
  ];

  function handleBack() {
    if (typeof window.history.state?.idx === "number" && window.history.state.idx > 0) {
      navigate(-1);
      return;
    }
    navigate("/students");
  }

  if (!Number.isFinite(id) || id <= 0) {
    navigate("/students", { replace: true });
    return null;
  }

  return (
    <ConfigProvider theme={FILTER_THEME}>
      <div className="portrait-page">
        <button type="button" className="portrait-back" onClick={handleBack}>
          <LeftOutlined />
          返回上一级
        </button>
        {loading && !portrait ? (
          <div className="entry-empty">加载中…</div>
        ) : !portrait ? (
          <div className="entry-empty">找不到这名学生，或你没有查看权限。</div>
        ) : (
          <>
            <div className="portrait-head">
              <h1 className="portrait-name">{userLabel(portrait)}</h1>
              <span className={`list-status ${statusClass(portrait.status)}`}>
                {portraitStatusLabel(portrait.status)}
              </span>
            </div>
            <p className="portrait-meta">
              {portrait.total_attempts} 次作答
              {typeof portrait.accuracy_rate === "number" ? ` · 正确率 ${formatRate(portrait.accuracy_rate)}` : ""}
              {portrait.last_answered_at ? ` · 最近 ${formatDateTimeLocal(portrait.last_answered_at)}` : ""}
            </p>

            {portrait.latest_analysis?.overall_summary ? null : (
              <p className="entry-hint">还没有 AI 总评。下面的能力模型来自作答统计，需要诊断时再生成短板分析。</p>
            )}

            <div className="portrait-split">
              <div className="practice-block">
                <div className="practice-block-kicker">能力模型</div>
                <AbilityRadar axes={portrait.axes} compare />
              </div>
              <div className="practice-block">
                <div className="practice-block-kicker">各能力正确率</div>
                <Table
                  rowKey="name"
                  size="small"
                  pagination={false}
                  columns={axisColumns}
                  dataSource={portrait.axes}
                />
              </div>
            </div>

            <div className="practice-block">
              <div className="practice-block-kicker">最弱知识点</div>
              <Table
                rowKey="name"
                size="small"
                pagination={false}
                columns={knowledgeColumns}
                dataSource={portrait.knowledge}
                locale={{ emptyText: "作答还不够，暂不能按知识点评估" }}
              />
            </div>

            <WeaknessAnalysisPanel username={portrait.username} displayName={portrait.display_name} onUpdated={load} />
          </>
        )}
      </div>
    </ConfigProvider>
  );
}
