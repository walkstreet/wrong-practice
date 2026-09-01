import { Button, ConfigProvider, Form, Input, Modal, Popconfirm, Select, Table, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import axios from "axios";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  createStudentGroup,
  deleteStudentGroup,
  getStudentRoster,
  listAdminUsers,
  listOrganizations,
  listStudentGroups,
  setStudentGroupMembers,
  updateStudentGroup,
} from "../api";
import type {
  AdminUser,
  Organization,
  PortraitStatus,
  StudentGroup,
  StudentRoster,
  StudentRosterItem,
  UserRole,
} from "../types";
import { formatDateTimeLocal } from "../utils/datetime";
import { portraitStatusLabel } from "../utils/labels";
import { userLabel, userOptionLabel } from "../utils/userLabel";

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
type GroupFilter = "all" | "ungrouped" | number;

interface GroupFormValues {
  name: string;
  teacher_id?: number;
  member_ids?: number[];
}

interface RankedStudent extends StudentRosterItem {
  rank: number | null;
}

function statusClass(status: PortraitStatus): string {
  if (status === "lagging") return "is-err-high";
  if (status === "watch") return "is-err-medium";
  if (status === "insufficient") return "is-err-none";
  return "is-ok";
}

function matchesStatus(item: StudentRosterItem, filter: RosterFilter): boolean {
  if (filter === "watch") return item.status === "watch";
  if (filter === "lag") return item.status === "lagging";
  if (filter === "insufficient") return item.status === "insufficient";
  return true;
}

function formatRate(value?: number | null): string {
  return typeof value === "number" ? `${(value * 100).toFixed(0)}%` : "—";
}

function getApiErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === "string") return detail;
  }
  return fallback;
}

function withRanks(items: StudentRosterItem[]): RankedStudent[] {
  const scored = items
    .filter((item) => item.status !== "insufficient" && typeof item.accuracy_rate === "number")
    .slice()
    .sort((a, b) => {
      const rate = (b.accuracy_rate ?? 0) - (a.accuracy_rate ?? 0);
      if (rate !== 0) return rate;
      return (b.total_attempts ?? 0) - (a.total_attempts ?? 0);
    });
  const rankById = new Map<number, number>();
  scored.forEach((item, index) => rankById.set(item.user_id, index + 1));
  return items.map((item) => ({ ...item, rank: rankById.get(item.user_id) ?? null }));
}

function averageErrorRate(items: StudentRosterItem[]): number | null {
  const rates = items
    .map((item) => item.error_rate)
    .filter((value): value is number => typeof value === "number");
  if (!rates.length) return null;
  return rates.reduce((sum, value) => sum + value, 0) / rates.length;
}

export default function StudentsPage({ currentRole }: { currentRole: UserRole | null }) {
  const navigate = useNavigate();
  const isSuperadmin = currentRole === "superadmin";
  const isOrgAdmin = currentRole === "org_admin";
  const canPickTeacher = isSuperadmin || isOrgAdmin;
  const [loading, setLoading] = useState(false);
  const [roster, setRoster] = useState<StudentRoster | null>(null);
  const [groups, setGroups] = useState<StudentGroup[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [filter, setFilter] = useState<RosterFilter>("all");
  const [orgFilter, setOrgFilter] = useState<number | undefined>(undefined);
  const [teacherFilter, setTeacherFilter] = useState<number | undefined>(undefined);
  const [groupFilter, setGroupFilter] = useState<GroupFilter>("all");
  const [groupOpen, setGroupOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<StudentGroup | null>(null);
  const [savingGroup, setSavingGroup] = useState(false);
  const [form] = Form.useForm<GroupFormValues>();
  const watchedTeacherId = Form.useWatch("teacher_id", form);

  async function loadData() {
    setLoading(true);
    try {
      const tasks: Promise<unknown>[] = [getStudentRoster(), listStudentGroups()];
      if (canPickTeacher) tasks.push(listAdminUsers());
      if (isSuperadmin) tasks.push(listOrganizations());
      const [rosterData, groupData, userData, orgData] = await Promise.all(tasks);
      setRoster(rosterData as StudentRoster);
      setGroups(groupData as StudentGroup[]);
      if (canPickTeacher) setUsers((userData as AdminUser[]) || []);
      if (isSuperadmin) setOrganizations((orgData as Organization[]) || []);
    } catch {
      setRoster(null);
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData().catch(() => undefined);
  }, [canPickTeacher, isSuperadmin]);

  const orgOptions = useMemo(
    () => organizations.map((org) => ({ label: org.name, value: org.id })),
    [organizations],
  );

  const teacherOptions = useMemo(() => {
    const staff = users.filter((user) => user.role === "teacher" || user.role === "org_admin");
    const scoped = orgFilter != null ? staff.filter((user) => user.organization_id === orgFilter) : staff;
    return scoped.map((user) => ({ label: userOptionLabel(user), value: user.id }));
  }, [users, orgFilter]);

  const visibleGroups = useMemo(
    () =>
      groups.filter((group) => {
        if (orgFilter != null && group.organization_id !== orgFilter) return false;
        if (teacherFilter != null && group.teacher_id !== teacherFilter) return false;
        return true;
      }),
    [groups, orgFilter, teacherFilter],
  );

  const scopedStudents = useMemo(() => {
    const students = roster?.students ?? [];
    return students.filter((item) => {
      if (orgFilter != null && item.organization_id !== orgFilter) return false;
      if (teacherFilter != null && item.teacher_id !== teacherFilter) return false;
      if (groupFilter === "ungrouped") return !(item.group_ids?.length);
      if (typeof groupFilter === "number") return item.group_ids?.includes(groupFilter);
      return true;
    });
  }, [roster, orgFilter, teacherFilter, groupFilter]);

  const rankedScoped = useMemo(() => withRanks(scopedStudents), [scopedStudents]);

  const rows = useMemo(
    () => rankedScoped.filter((item) => matchesStatus(item, filter)),
    [rankedScoped, filter],
  );

  const selectedGroup = typeof groupFilter === "number" ? groups.find((group) => group.id === groupFilter) : null;
  const displayErrorRate = averageErrorRate(rows);
  const memberTeacherId = editingGroup?.teacher_id ?? watchedTeacherId;
  const memberOptions = useMemo(() => {
    const students = roster?.students ?? [];
    return students
      .filter((item) => (memberTeacherId == null ? true : item.teacher_id === memberTeacherId))
      .map((item) => ({ label: userOptionLabel(item), value: item.user_id }));
  }, [roster, memberTeacherId]);

  function openCreateGroup() {
    setEditingGroup(null);
    form.resetFields();
    const defaultTeacher = !canPickTeacher
      ? undefined
      : teacherFilter ?? (teacherOptions.length === 1 ? teacherOptions[0].value : undefined);
    form.setFieldsValue({
      name: "",
      teacher_id: defaultTeacher,
      member_ids: [],
    });
    setGroupOpen(true);
  }

  function openEditGroup(group: StudentGroup) {
    setEditingGroup(group);
    form.setFieldsValue({
      name: group.name,
      teacher_id: group.teacher_id,
      member_ids: group.member_ids,
    });
    setGroupOpen(true);
  }

  async function handleSaveGroup(values: GroupFormValues) {
    setSavingGroup(true);
    try {
      const name = values.name.trim();
      if (editingGroup) {
        if (name !== editingGroup.name) {
          await updateStudentGroup(editingGroup.id, { name });
        }
        await setStudentGroupMembers(editingGroup.id, values.member_ids ?? []);
        message.success("编组已更新");
      } else {
        await createStudentGroup({
          name,
          teacher_id: canPickTeacher ? values.teacher_id : undefined,
          member_ids: values.member_ids ?? [],
        });
        message.success("编组已创建");
      }
      setGroupOpen(false);
      await loadData();
    } catch (error) {
      message.error(getApiErrorMessage(error, "保存编组失败"));
    } finally {
      setSavingGroup(false);
    }
  }

  async function handleDeleteGroup(group: StudentGroup) {
    try {
      await deleteStudentGroup(group.id);
      message.success("编组已删除");
      if (groupFilter === group.id) setGroupFilter("all");
      await loadData();
    } catch (error) {
      message.error(getApiErrorMessage(error, "删除编组失败"));
    }
  }

  const columns: ColumnsType<RankedStudent> = [
    {
      title: "排名",
      dataIndex: "rank",
      width: 72,
      render: (value?: number | null) => (typeof value === "number" ? value : "—"),
    },
    {
      title: "学生",
      key: "name",
      render: (_, row) => (
        <button type="button" className="list-action" onClick={() => navigate(`/students/${row.user_id}`)}>
          {userLabel(row)}
        </button>
      ),
    },
    ...(canPickTeacher
      ? [
          {
            title: "老师",
            dataIndex: "teacher_name",
            width: 112,
            ellipsis: true,
            render: (value?: string | null) => value || "—",
          } as ColumnsType<RankedStudent>[number],
        ]
      : []),
    {
      title: "编组",
      dataIndex: "group_names",
      ellipsis: true,
      render: (names?: string[]) => (names?.length ? names.join(" · ") : "未编组"),
    },
    {
      title: "错误率",
      dataIndex: "error_rate",
      width: 88,
      render: (value?: number | null) => formatRate(value),
    },
    {
      title: "正确率",
      dataIndex: "accuracy_rate",
      width: 88,
      render: (value?: number | null) => formatRate(value),
    },
    { title: "作答", dataIndex: "total_attempts", width: 72 },
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
                ["all", `全部 ${scopedStudents.length}`],
                ["watch", `需关注 ${scopedStudents.filter((item) => item.status === "watch").length}`],
                ["lag", `掉队 ${scopedStudents.filter((item) => item.status === "lagging").length}`],
                ["insufficient", `数据不足 ${scopedStudents.filter((item) => item.status === "insufficient").length}`],
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
        {canPickTeacher ? (
          <div className="list-filter-secondary">
            <div className={`list-filter-fields ${isSuperadmin ? "is-2" : "is-1"}`}>
              {isSuperadmin ? (
                <div className={`list-filter-field${orgFilter != null ? " is-filled" : ""}`}>
                  <span className="list-filter-kicker">机构</span>
                  <Select
                    allowClear
                    showSearch
                    placeholder="全部机构"
                    optionFilterProp="label"
                    value={orgFilter}
                    options={orgOptions}
                    onChange={(value) => {
                      setOrgFilter(value ?? undefined);
                      setTeacherFilter(undefined);
                      setGroupFilter("all");
                    }}
                  />
                </div>
              ) : null}
              <div className={`list-filter-field${teacherFilter != null ? " is-filled" : ""}`}>
                <span className="list-filter-kicker">老师</span>
                <Select
                  allowClear
                  showSearch
                  placeholder="全部老师"
                  optionFilterProp="label"
                  value={teacherFilter}
                  options={teacherOptions}
                  onChange={(value) => {
                    setTeacherFilter(value ?? undefined);
                    setGroupFilter("all");
                  }}
                />
              </div>
            </div>
          </div>
        ) : null}
        <div className="list-filter-tabs">
          <div className="list-filter-row">
            <span className="list-filter-kicker">编组</span>
            <div className="list-view-toggle" role="tablist" aria-label="编组">
              <button
                type="button"
                role="tab"
                aria-selected={groupFilter === "all"}
                className={groupFilter === "all" ? "is-active" : undefined}
                onClick={() => setGroupFilter("all")}
              >
                全部学生
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={groupFilter === "ungrouped"}
                className={groupFilter === "ungrouped" ? "is-active" : undefined}
                onClick={() => setGroupFilter("ungrouped")}
              >
                未编组
              </button>
              {visibleGroups.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  role="tab"
                  aria-selected={groupFilter === group.id}
                  className={groupFilter === group.id ? "is-active" : undefined}
                  onClick={() => setGroupFilter(group.id)}
                >
                  {group.name} {group.member_count}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="list-results">
        <div className="list-results-head">
          <div className="list-results-meta">
            共 <strong>{rows.length}</strong> 人
            {typeof displayErrorRate === "number" ? ` · 错误率 ${formatRate(displayErrorRate)}` : ""}
            {typeof roster?.class_accuracy_rate === "number" && groupFilter === "all" && orgFilter == null && teacherFilter == null
              ? ` · 学生正确率 ${formatRate(roster.class_accuracy_rate)}`
              : ""}
          </div>
          <div className="list-results-tools">
            {selectedGroup ? (
              <>
                <Button onClick={() => openEditGroup(selectedGroup)}>编辑编组</Button>
                <Popconfirm
                  title={`删除编组「${selectedGroup.name}」？组内学生不会被删除。`}
                  okText="删除"
                  cancelText="取消"
                  onConfirm={() => handleDeleteGroup(selectedGroup)}
                >
                  <Button danger>删除编组</Button>
                </Popconfirm>
              </>
            ) : null}
            <Button type="primary" onClick={openCreateGroup}>
              新建编组
            </Button>
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
      <Modal
        className="list-modal"
        title={editingGroup ? `编辑编组「${editingGroup.name}」` : "新建编组"}
        open={groupOpen}
        onCancel={() => setGroupOpen(false)}
        onOk={() => form.submit()}
        okText="保存"
        cancelText="取消"
        confirmLoading={savingGroup}
      >
        <Form form={form} layout="vertical" onFinish={handleSaveGroup}>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: "请填写编组名称" }]}>
            <Input maxLength={32} placeholder="例如：阅读强化" />
          </Form.Item>
          {canPickTeacher ? (
            <Form.Item
              name="teacher_id"
              label="所属老师"
              rules={[{ required: true, message: "请选择所属老师" }]}
            >
              <Select
                showSearch
                optionFilterProp="label"
                options={teacherOptions}
                placeholder="选择老师"
                disabled={Boolean(editingGroup)}
              />
            </Form.Item>
          ) : null}
          <Form.Item name="member_ids" label="学生">
            <Select
              mode="multiple"
              showSearch
              optionFilterProp="label"
              options={memberOptions}
              placeholder={canPickTeacher && !memberTeacherId ? "请先选择所属老师" : "选择学生，可留空"}
              disabled={canPickTeacher && !memberTeacherId}
            />
          </Form.Item>
        </Form>
      </Modal>
    </ConfigProvider>
  );
}
