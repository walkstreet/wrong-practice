import { DeleteOutlined, EditOutlined, EyeOutlined, TeamOutlined, UserDeleteOutlined } from "@ant-design/icons";
import { Button, ConfigProvider, Drawer, Dropdown, Form, Input, Popconfirm, Select, Table, Tooltip, Transfer, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { TransferKey } from "antd/es/transfer/interface";
import axios from "axios";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  createStudentGroup,
  deleteStudentGroup,
  getStudentRoster,
  listAdminUsers,
  listOrganizations,
  listStudentGroups,
  removeStudentGroupMember,
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
type GroupDrawerMode = "create" | "info" | "members";

interface GroupFormValues {
  name: string;
  teacher_id?: number;
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

function sameIdList(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort((x, y) => x - y);
  const right = [...b].sort((x, y) => x - y);
  return left.every((id, index) => id === right[index]);
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
  const [groupDrawerMode, setGroupDrawerMode] = useState<GroupDrawerMode>("create");
  const [editingGroup, setEditingGroup] = useState<StudentGroup | null>(null);
  const [savingGroup, setSavingGroup] = useState(false);
  const [memberKeys, setMemberKeys] = useState<string[]>([]);
  const [memberBusyId, setMemberBusyId] = useState<number | null>(null);
  const [form] = Form.useForm<GroupFormValues>();
  const watchedTeacherId = Form.useWatch("teacher_id", form);
  const groupOpenRef = useRef(false);
  groupOpenRef.current = groupOpen;

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

  const groupSelectOptions = useMemo(
    () => [
      { label: "全部学生", value: "all" },
      { label: "未编组", value: "ungrouped" },
      ...visibleGroups.map((group) => ({
        label: `${group.name}（${group.member_count}）`,
        value: String(group.id),
      })),
    ],
    [visibleGroups],
  );

  const statusCounts = useMemo(
    () => ({
      all: scopedStudents.length,
      watch: scopedStudents.filter((item) => item.status === "watch").length,
      lag: scopedStudents.filter((item) => item.status === "lagging").length,
      insufficient: scopedStudents.filter((item) => item.status === "insufficient").length,
    }),
    [scopedStudents],
  );

  const hasScopeFilter = orgFilter != null || teacherFilter != null || groupFilter !== "all";

  function parseGroupFilter(value: string | number | null | undefined): GroupFilter {
    if (value == null || value === "all") return "all";
    if (value === "ungrouped") return "ungrouped";
    const id = Number(value);
    return Number.isFinite(id) && id > 0 ? id : "all";
  }

  function resetScope() {
    setOrgFilter(undefined);
    setTeacherFilter(undefined);
    setGroupFilter("all");
  }

  const selectedGroup = typeof groupFilter === "number" ? groups.find((group) => group.id === groupFilter) : null;
  const displayErrorRate = averageErrorRate(rows);
  const memberTeacherId = editingGroup?.teacher_id ?? watchedTeacherId;
  const transferReady = !canPickTeacher || memberTeacherId != null;
  const memberStudents = useMemo(() => {
    const students = roster?.students ?? [];
    const selected = new Set(memberKeys);
    return students.filter((item) => {
      if (memberTeacherId == null) return !canPickTeacher;
      if (Number(item.teacher_id) !== Number(memberTeacherId)) return selected.has(String(item.user_id));
      return item.is_active || selected.has(String(item.user_id));
    });
  }, [roster, memberTeacherId, canPickTeacher, memberKeys]);
  const memberTransferData = useMemo(
    () =>
      memberStudents.map((item) => {
        const selected = memberKeys.includes(String(item.user_id));
        const otherNames = groups
          .filter((group) => group.id !== editingGroup?.id && item.group_ids?.includes(group.id))
          .map((group) => group.name);
        return {
          key: String(item.user_id),
          title: userOptionLabel(item),
          otherGroups: otherNames.join("、"),
          disabled: !selected && !item.is_active,
        };
      }),
    [memberStudents, groups, editingGroup?.id, memberKeys],
  );

  function openCreateGroup() {
    setEditingGroup(null);
    setGroupDrawerMode("create");
    setMemberKeys([]);
    form.resetFields();
    const defaultTeacher = !canPickTeacher
      ? undefined
      : teacherFilter ?? (teacherOptions.length === 1 ? teacherOptions[0].value : undefined);
    form.setFieldsValue({
      name: "",
      teacher_id: defaultTeacher,
    });
    setGroupOpen(true);
  }

  function openEditGroupInfo(group: StudentGroup) {
    setEditingGroup(group);
    setGroupDrawerMode("info");
    setMemberKeys([]);
    form.setFieldsValue({
      name: group.name,
      teacher_id: group.teacher_id,
    });
    setGroupOpen(true);
  }

  function openEditGroupMembers(group: StudentGroup) {
    setEditingGroup(group);
    setGroupDrawerMode("members");
    setMemberKeys(group.member_ids.map(String));
    form.setFieldsValue({
      name: group.name,
      teacher_id: group.teacher_id,
    });
    setGroupOpen(true);
  }

  function closeGroupEditor() {
    setGroupOpen(false);
  }

  function handleGroupDrawerOpenChange(open: boolean) {
    if (open || groupOpenRef.current) return;
    setEditingGroup(null);
    setGroupDrawerMode("create");
    setMemberKeys([]);
    form.resetFields();
  }

  function handleMemberTransferChange(nextKeys: TransferKey[]) {
    const selectable = new Set(memberTransferData.filter((item) => !item.disabled).map((item) => item.key));
    const current = new Set(memberKeys);
    setMemberKeys(nextKeys.map(String).filter((key) => selectable.has(key) || current.has(key)));
  }

  async function handleSaveGroup(values: GroupFormValues) {
    setSavingGroup(true);
    try {
      const name = values.name.trim();
      const memberIds = memberKeys.map(Number).filter((id) => Number.isFinite(id));
      if (editingGroup) {
        if (name !== editingGroup.name) {
          await updateStudentGroup(editingGroup.id, { name });
        }
        message.success("编组信息已更新");
      } else {
        await createStudentGroup({
          name,
          teacher_id: canPickTeacher ? values.teacher_id : undefined,
          member_ids: memberIds,
        });
        message.success("编组已创建");
      }
      closeGroupEditor();
      await loadData();
    } catch (error) {
      message.error(getApiErrorMessage(error, editingGroup ? "保存编组信息失败" : "创建编组失败"));
    } finally {
      setSavingGroup(false);
    }
  }

  async function handleSaveGroupMembers() {
    if (!editingGroup) return;
    setSavingGroup(true);
    try {
      const memberIds = memberKeys.map(Number).filter((id) => Number.isFinite(id));
      if (!sameIdList(memberIds, editingGroup.member_ids)) {
        await setStudentGroupMembers(editingGroup.id, memberIds);
      }
      message.success("组内学生已更新");
      closeGroupEditor();
      await loadData();
    } catch (error) {
      message.error(getApiErrorMessage(error, "保存组内学生失败"));
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

  async function handleLeaveGroup(student: StudentRosterItem, group: StudentGroup) {
    setMemberBusyId(student.user_id);
    try {
      await removeStudentGroupMember(group.id, student.user_id);
      message.success(`${userLabel(student)} 已移出「${group.name}」`);
      await loadData();
    } catch (error) {
      message.error(getApiErrorMessage(error, "移出编组失败"));
    } finally {
      setMemberBusyId(null);
    }
  }

  const groupColumns: ColumnsType<StudentGroup> = [
    {
      title: "名称",
      dataIndex: "name",
      width: 180,
      ellipsis: true,
      render: (_, group) => (
        <button type="button" className="list-action" onClick={() => openEditGroupInfo(group)}>
          {group.name}
        </button>
      ),
    },
    ...(canPickTeacher
      ? [
          {
            title: "老师",
            dataIndex: "teacher_name",
            width: 140,
            ellipsis: true,
            render: (value?: string | null) => value || "—",
          } as ColumnsType<StudentGroup>[number],
        ]
      : []),
    {
      title: "人数",
      dataIndex: "member_count",
      width: 72,
    },
    {
      title: "操作",
      width: 120,
      fixed: "right",
      render: (_, group) => (
        <span className="list-icon-actions">
          <Tooltip title="编组信息">
            <button
              type="button"
              className="list-icon-action"
              aria-label="编组信息"
              onClick={() => openEditGroupInfo(group)}
            >
              <EditOutlined />
            </button>
          </Tooltip>
          <Tooltip title="学生管理">
            <button
              type="button"
              className="list-icon-action"
              aria-label="学生管理"
              onClick={() => openEditGroupMembers(group)}
            >
              <TeamOutlined />
            </button>
          </Tooltip>
          <Tooltip title="删除编组">
            <Popconfirm
              title={`删除编组「${group.name}」？组内学生不会被删除。`}
              okText="删除"
              cancelText="取消"
              onConfirm={() => handleDeleteGroup(group)}
            >
              <button type="button" className="list-icon-action is-danger" aria-label="删除编组">
                <DeleteOutlined />
              </button>
            </Popconfirm>
          </Tooltip>
        </span>
      ),
    },
  ];

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
      width: 140,
      ellipsis: true,
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
      width: 168,
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
      width: 140,
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
      title: "操作",
      width: 88,
      fixed: "right",
      render: (_, row) => {
        const currentGroups = groups.filter((group) => row.group_ids?.includes(group.id));
        const busy = memberBusyId === row.user_id;
        return (
          <span className="list-icon-actions">
            {selectedGroup ? (
              <Tooltip title="移出本组">
                <Popconfirm
                  title={`将 ${userLabel(row)} 移出「${selectedGroup.name}」？移出后需在编组管理里重新加入。`}
                  okText="移出"
                  cancelText="取消"
                  onConfirm={() => handleLeaveGroup(row, selectedGroup)}
                >
                  <button type="button" className="list-icon-action" aria-label="移出本组" disabled={busy}>
                    <UserDeleteOutlined />
                  </button>
                </Popconfirm>
              </Tooltip>
            ) : currentGroups.length ? (
              <Dropdown
                trigger={["click"]}
                disabled={busy}
                menu={{
                  items: currentGroups.map((group) => ({
                    key: String(group.id),
                    label: group.name,
                  })),
                  onClick: ({ key }) => {
                    const group = currentGroups.find((item) => item.id === Number(key));
                    if (group) handleLeaveGroup(row, group).catch(() => undefined);
                  },
                }}
              >
                <Tooltip title="移出编组后需在编组管理里重新加入">
                  <button type="button" className="list-icon-action" aria-label="移出编组" disabled={busy}>
                    <UserDeleteOutlined />
                  </button>
                </Tooltip>
              </Dropdown>
            ) : null}
            <Tooltip title="画像">
              <button
                type="button"
                className="list-icon-action"
                aria-label="画像"
                onClick={() => navigate(`/students/${row.user_id}`)}
              >
                <EyeOutlined />
              </button>
            </Tooltip>
          </span>
        );
      },
    },
  ];

  return (
    <ConfigProvider theme={FILTER_THEME}>
      <div className="list-filter">
        <div className={`list-filter-primary${canPickTeacher ? "" : " is-solo"}`}>
          <div className="list-filter-row">
            <span className="list-filter-kicker">状态</span>
            <div className="list-filter-pills" role="radiogroup" aria-label="状态">
              {(
                [
                  ["all", `全部 ${statusCounts.all}`],
                  ["watch", `需关注 ${statusCounts.watch}`],
                  ["lag", `掉队 ${statusCounts.lag}`],
                  ["insufficient", `数据不足 ${statusCounts.insufficient}`],
                ] as const
              ).map(([key, label]) => {
                const active = filter === key;
                return (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={`list-filter-pill${active ? " is-active" : ""}`}
                    onClick={() => {
                      if (!active) setFilter(key);
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          {canPickTeacher ? null : (
            <div className="list-filter-row">
              <span className="list-filter-kicker">编组</span>
              <div className="list-filter-pills" role="radiogroup" aria-label="编组">
                <button
                  type="button"
                  role="radio"
                  aria-checked={groupFilter === "all"}
                  className={`list-filter-pill${groupFilter === "all" ? " is-active" : ""}`}
                  onClick={() => setGroupFilter("all")}
                >
                  全部学生
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={groupFilter === "ungrouped"}
                  className={`list-filter-pill${groupFilter === "ungrouped" ? " is-active" : ""}`}
                  onClick={() => setGroupFilter("ungrouped")}
                >
                  未编组
                </button>
                {visibleGroups.map((group) => (
                  <button
                    key={group.id}
                    type="button"
                    role="radio"
                    aria-checked={groupFilter === group.id}
                    className={`list-filter-pill${groupFilter === group.id ? " is-active" : ""}`}
                    onClick={() => setGroupFilter(group.id)}
                  >
                    {group.name} {group.member_count}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        {canPickTeacher ? (
          <div className="list-filter-secondary">
            <div className="list-filter-fields is-scope">
              {isSuperadmin ? (
                <div className={`list-filter-field${orgFilter != null ? " is-filled" : ""}`}>
                  <span className="list-filter-kicker">机构</span>
                  <Select
                    allowClear
                    showSearch
                    placeholder="全部"
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
                  placeholder="全部"
                  optionFilterProp="label"
                  value={teacherFilter}
                  options={teacherOptions}
                  onChange={(value) => {
                    setTeacherFilter(value ?? undefined);
                    setGroupFilter("all");
                  }}
                />
              </div>
              <div className={`list-filter-field${groupFilter !== "all" ? " is-filled" : ""}`}>
                <span className="list-filter-kicker">编组</span>
                <Select
                  showSearch
                  optionFilterProp="label"
                  placeholder="全部学生"
                  value={typeof groupFilter === "number" ? String(groupFilter) : groupFilter}
                  options={groupSelectOptions}
                  onChange={(value) => setGroupFilter(parseGroupFilter(value))}
                />
              </div>
            </div>
            {hasScopeFilter ? (
              <button type="button" className="list-filter-reset" onClick={resetScope}>
                清除条件
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="list-results">
        <div className="list-results-head">
          <div className="list-results-meta">
            编组 <strong>{visibleGroups.length}</strong> 个
            {selectedGroup ? ` · 正在看「${selectedGroup.name}」` : ""}
          </div>
          <div className="list-results-tools">
            {selectedGroup ? (
              <span className="list-icon-actions">
                <Tooltip title="编组信息">
                  <button
                    type="button"
                    className="list-icon-action"
                    aria-label="编组信息"
                    onClick={() => openEditGroupInfo(selectedGroup)}
                  >
                    <EditOutlined />
                  </button>
                </Tooltip>
                <Tooltip title="学生管理">
                  <button
                    type="button"
                    className="list-icon-action"
                    aria-label="学生管理"
                    onClick={() => openEditGroupMembers(selectedGroup)}
                  >
                    <TeamOutlined />
                  </button>
                </Tooltip>
                <Tooltip title="删除当前编组">
                  <Popconfirm
                    title={`删除编组「${selectedGroup.name}」？组内学生不会被删除。`}
                    okText="删除"
                    cancelText="取消"
                    onConfirm={() => handleDeleteGroup(selectedGroup)}
                  >
                    <button type="button" className="list-icon-action is-danger" aria-label="删除当前编组">
                      <DeleteOutlined />
                    </button>
                  </Popconfirm>
                </Tooltip>
              </span>
            ) : null}
            <Button type="primary" onClick={openCreateGroup}>
              新建编组
            </Button>
          </div>
        </div>
        <Table
          rowKey="id"
          tableLayout="fixed"
          loading={loading}
          columns={groupColumns}
          dataSource={visibleGroups}
          pagination={false}
          scroll={{ x: canPickTeacher ? 560 : 400 }}
          locale={{ emptyText: "还没有编组。建好后可以改名称，也可以单独管理组内学生。" }}
        />
      </div>
      <div className="list-results">
        <div className="list-results-head">
          <div className="list-results-meta">
            共 <strong>{rows.length}</strong> 人
            {typeof displayErrorRate === "number" ? ` · 错误率 ${formatRate(displayErrorRate)}` : ""}
            {typeof roster?.class_accuracy_rate === "number" &&
            groupFilter === "all" &&
            orgFilter == null &&
            teacherFilter == null
              ? ` · 学生正确率 ${formatRate(roster.class_accuracy_rate)}`
              : ""}
          </div>
        </div>
        <Table
          rowKey="user_id"
          tableLayout="fixed"
          loading={loading}
          columns={columns}
          dataSource={rows}
          pagination={false}
          scroll={{ x: canPickTeacher ? 1280 : 1160 }}
          locale={{ emptyText: "还没有学生，或当前筛选下没有人" }}
        />
      </div>
      <Drawer
        className={`entry-drawer${groupDrawerMode === "info" ? "" : " is-roomy is-group-editor"}`}
        title={
          groupDrawerMode === "members"
            ? `学生管理「${editingGroup?.name || ""}」`
            : groupDrawerMode === "info"
              ? `编组信息「${editingGroup?.name || ""}」`
              : "新建编组"
        }
        open={groupOpen}
        onClose={closeGroupEditor}
        afterOpenChange={handleGroupDrawerOpenChange}
        size={groupDrawerMode === "info" ? 480 : 880}
        destroyOnHidden
        styles={{ body: { padding: 0 } }}
      >
        <div className="entry-drawer-panel">
          <div className="entry-body">
            <p className="entry-hint">
              {groupDrawerMode === "info"
                ? "只改名称。组内学生和已经布置的任务都不会变。所属老师创建后不能更换。"
                : canPickTeacher
                  ? "编组属于一位老师，只能加入这位老师名下的学生。花名册仍能看到全部学生，但不会把 A 老师的学生加进 B 老师的组。移出后只能在这里重新加入。"
                  : "左侧是你名下的全部学生。编组不会跨到其他老师。移出后只能在这里重新加入。"}
            </p>
            {groupDrawerMode !== "members" ? (
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
                      disabled={groupDrawerMode === "info"}
                      onChange={(value) => {
                        const allowed = new Set(
                          (roster?.students ?? [])
                            .filter((item) => item.is_active && item.teacher_id === value)
                            .map((item) => String(item.user_id)),
                        );
                        setMemberKeys((prev) => prev.filter((key) => allowed.has(key)));
                      }}
                    />
                  </Form.Item>
                ) : null}
              </Form>
            ) : null}
            {groupDrawerMode !== "info" ? (
              <Transfer
                className="assign-transfer"
                showSearch
                disabled={!transferReady}
                dataSource={memberTransferData}
                targetKeys={memberKeys}
                titles={["可加入", "组内"]}
                locale={{
                  itemUnit: "人",
                  itemsUnit: "人",
                  searchPlaceholder: "搜索姓名或账号",
                  notFoundContent: transferReady
                    ? ["暂无可加入学生", "组内还没有人"]
                    : ["请先选择所属老师", "组内还没有人"],
                }}
                filterOption={(input, item) => {
                  const q = input.trim().toLowerCase();
                  return (
                    (item.title || "").toLowerCase().includes(q) ||
                    String(item.otherGroups || "").toLowerCase().includes(q)
                  );
                }}
                render={(item) => (
                  <span>
                    {item.title}
                    {item.otherGroups ? <em className="assign-transfer-badge">已在 {item.otherGroups}</em> : null}
                  </span>
                )}
                onChange={handleMemberTransferChange}
              />
            ) : null}
          </div>
          <div className="entry-bar">
            <div className="entry-bar-meta">
              {groupDrawerMode === "info"
                ? "保存后只更新编组名称。"
                : (
                  <>
                    组内 <strong>{memberKeys.length}</strong> 人
                    {canPickTeacher && memberTeacherId == null
                      ? "。先选所属老师，才能把该老师名下的学生加进组。"
                      : "。移出后需在编组管理里重新加入。"}
                  </>
                )}
            </div>
            <div className="entry-bar-actions">
              <Button onClick={closeGroupEditor}>取消</Button>
              <Button
                type="primary"
                loading={savingGroup}
                onClick={() => {
                  if (groupDrawerMode === "members") {
                    handleSaveGroupMembers().catch(() => undefined);
                    return;
                  }
                  form.submit();
                }}
              >
                {groupDrawerMode === "create" ? "创建" : "保存"}
              </Button>
            </div>
          </div>
        </div>
      </Drawer>
    </ConfigProvider>
  );
}
