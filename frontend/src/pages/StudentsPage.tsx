import { ConfigProvider, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { getStudentRoster } from "../api";
import type { PortraitStatus, StudentRoster, StudentRosterItem } from "../types";
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

type RosterFilter = "all" | "watch" | "lag" | "insufficient";

function statusClass(status: PortraitStatus): string {
  if (status === "lagging") return "is-err-high";
  if (status === "watch") return "is-err-medium";
  if (status === "insufficient") return "is-err-none";
  return "is-ok";
}

function matchesFilter(item: StudentRosterItem, filter: RosterFilter): boolean {
  if (filter === "watch") return item.status === "watch";
  if (filter === "lag") return item.status === "lagging";
  if (filter === "insufficient") return item.status === "insufficient";
  return true;
}

export default function StudentsPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [roster, setRoster] = useState<StudentRoster | null>(null);
  const [filter, setFilter] = useState<RosterFilter>("all");

  useEffect(() => {
    setLoading(true);
    getStudentRoster()
      .then(setRoster)
      .catch(() => setRoster(null))
      .finally(() => setLoading(false));
  }, []);

  const rows = useMemo(
    () => (roster ? roster.students.filter((item) => matchesFilter(item, filter)) : []),
    [roster, filter],
  );

  const columns: ColumnsType<StudentRosterItem> = [
    {
      title: "学生",
      key: "name",
      render: (_, row) => (
        <button type="button" className="list-action" onClick={() => navigate(`/students/${row.user_id}`)}>
          {userLabel(row)}
        </button>
      ),
    },
    {
      title: "正确率",
      dataIndex: "accuracy_rate",
      width: 96,
      render: (value?: number | null) => (typeof value === "number" ? `${(value * 100).toFixed(0)}%` : "—"),
    },
    { title: "作答", dataIndex: "total_attempts", width: 80 },
    {
      title: "最弱",
      dataIndex: "weak_tags",
      ellipsis: true,
      render: (tags: string[]) => (tags.length ? tags.join(" · ") : "—"),
    },
    {
      title: "最近",
      dataIndex: "last_answered_at",
      width: 168,
      render: (value?: string | null) => formatDateTimeLocal(value),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 96,
      render: (status: PortraitStatus) => (
        <span className={`list-status ${statusClass(status)}`}>{portraitStatusLabel(status)}</span>
      ),
    },
    {
      title: "",
      width: 72,
      render: (_, row) => (
        <button type="button" className="list-action" onClick={() => navigate(`/students/${row.user_id}`)}>
          画像
        </button>
      ),
    },
  ];

  return (
    <ConfigProvider theme={FILTER_THEME}>
      <div className="list-filter">
        <div className="list-filter-tabs">
          <div className="list-view-toggle" role="tablist" aria-label="状态">
            {(
              [
                ["all", `全部 ${roster?.students.length ?? 0}`],
                ["watch", `需关注 ${roster?.watch_count ?? 0}`],
                ["lag", `掉队 ${roster?.lag_count ?? 0}`],
                ["insufficient", `数据不足 ${roster?.insufficient_count ?? 0}`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={filter === key}
                className={filter === key ? "is-active" : undefined}
                onClick={() => setFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="list-results">
        <div className="list-results-head">
          <div className="list-results-meta">
            共 <strong>{rows.length}</strong> 人
            {typeof roster?.class_accuracy_rate === "number"
              ? ` · 学生正确率 ${(roster.class_accuracy_rate * 100).toFixed(0)}%`
              : ""}
          </div>
        </div>
        <Table
          rowKey="user_id"
          loading={loading}
          columns={columns}
          dataSource={rows}
          pagination={false}
          locale={{ emptyText: "还没有学生，或当前筛选下没有人" }}
        />
      </div>
    </ConfigProvider>
  );
}
