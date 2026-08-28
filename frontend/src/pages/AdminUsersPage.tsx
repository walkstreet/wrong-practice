import { CheckCircleOutlined, DeleteOutlined, EditOutlined, KeyOutlined, StopOutlined } from "@ant-design/icons";
import { Button, ConfigProvider, Drawer, Form, Input, Popconfirm, Select, Switch, Table, Tooltip, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import axios from "axios";
import { useEffect, useMemo, useState } from "react";

import { createAdminUser, deleteAdminUser, listAdminUsers, resetAdminUserPassword, setAdminUserActive, updateAdminUser } from "../api";
import { ROLE_LABELS, canDeleteRole, creatableRoles } from "../permissions";
import type { AdminUser, UserRole } from "../types";
import { formatDateTimeLocal } from "../utils/datetime";
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

interface CreateFormValues {
  username: string;
  password: string;
  display_name?: string;
  role: UserRole;
  is_active: boolean;
}

interface ResetFormValues {
  new_password: string;
  confirm_password: string;
}

interface NameFormValues {
  display_name: string;
}

interface ResetFormValues {
  new_password: string;
  confirm_password: string;
}

type TeacherFilter = number | "unassigned";

function getApiErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail) && typeof detail[0]?.msg === "string") {
      return String(detail[0].msg).replace(/^Value error,\s*/i, "");
    }
  }
  return fallback;
}

function teacherNameOf(user: AdminUser, teacherNames: Map<number, string>): string | null {
  if (user.role !== "student" || user.created_by == null) return null;
  return teacherNames.get(user.created_by) ?? null;
}

export default function AdminUsersPage({
  currentRole,
  currentUserId,
}: {
  currentRole: UserRole | null;
  currentUserId: number | null;
}) {
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [open, setOpen] = useState(false);
  const [resetting, setResetting] = useState<AdminUser | null>(null);
  const [editingName, setEditingName] = useState<AdminUser | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [nameSubmitting, setNameSubmitting] = useState(false);
  const [form] = Form.useForm<CreateFormValues>();
  const [resetForm] = Form.useForm<ResetFormValues>();
  const [nameForm] = Form.useForm<NameFormValues>();
  const createRole = Form.useWatch("role", form);
  const [teacherFilter, setTeacherFilter] = useState<TeacherFilter | undefined>(undefined);
  const allowedRoles = useMemo(() => creatableRoles(currentRole), [currentRole]);
  const isSuperadmin = currentRole === "superadmin";
  const canResetPassword = isSuperadmin;

  const teacherNames = useMemo(() => {
    const map = new Map<number, string>();
    for (const user of users) {
      if (user.role === "teacher") map.set(user.id, userLabel(user));
    }
    return map;
  }, [users]);

  const teacherOptions = useMemo(() => {
    const options: { label: string; value: TeacherFilter }[] = users
      .filter((user) => user.role === "teacher")
      .sort((a, b) => userLabel(a).localeCompare(userLabel(b), "zh-CN"))
      .map((user) => ({ label: userLabel(user), value: user.id }));
    const hasUnassigned = users.some((user) => user.role === "student" && !teacherNameOf(user, teacherNames));
    if (hasUnassigned) options.push({ label: "未归属", value: "unassigned" });
    return options;
  }, [users, teacherNames]);

  const visibleUsers = useMemo(() => {
    if (!isSuperadmin || teacherFilter == null) return users;
    if (teacherFilter === "unassigned") {
      return users.filter((user) => user.role === "student" && !teacherNameOf(user, teacherNames));
    }
    const teacher = users.find((user) => user.id === teacherFilter);
    const students = users.filter((user) => user.role === "student" && user.created_by === teacherFilter);
    return teacher ? [teacher, ...students] : students;
  }, [isSuperadmin, teacherFilter, teacherNames, users]);

  async function loadUsers() {
    setLoading(true);
    try {
      const data = await listAdminUsers();
      setUsers(data);
    } catch {
      message.error("获取用户列表失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  useEffect(() => {
    if (typeof teacherFilter === "number" && !teacherNames.has(teacherFilter)) {
      setTeacherFilter(undefined);
    }
  }, [teacherFilter, teacherNames]);

  function closeCreate() {
    setOpen(false);
    form.resetFields();
  }

  function closeReset() {
    setResetting(null);
    resetForm.resetFields();
  }

  function closeEditName() {
    setEditingName(null);
    nameForm.resetFields();
  }

  async function handleSaveName(values: NameFormValues) {
    if (!editingName) return;
    setNameSubmitting(true);
    try {
      await updateAdminUser(editingName.id, { display_name: values.display_name.trim() || null });
      message.success("姓名已更新");
      closeEditName();
      await loadUsers();
    } catch (error) {
      message.error(getApiErrorMessage(error, "保存姓名失败"));
    } finally {
      setNameSubmitting(false);
    }
  }

  async function handleResetPassword(values: ResetFormValues) {
    if (!resetting) return;
    setResetSubmitting(true);
    try {
      await resetAdminUserPassword(resetting.id, values.new_password);
      message.success(`已重置「${userLabel(resetting)}」的密码`);
      closeReset();
    } catch (error) {
      message.error(getApiErrorMessage(error, "重置密码失败"));
    } finally {
      setResetSubmitting(false);
    }
  }

  async function handleCreate(values: CreateFormValues) {
    setSubmitting(true);
    try {
      await createAdminUser({
        ...values,
        display_name: values.display_name?.trim() || null,
      });
      message.success("用户创建成功");
      closeCreate();
      await loadUsers();
    } catch (error) {
      message.error(getApiErrorMessage(error, "创建失败，用户名可能已存在，或无权创建该角色"));
    } finally {
      setSubmitting(false);
    }
  }

  const columns: ColumnsType<AdminUser> = [
    { title: "ID", dataIndex: "id", width: 72 },
    {
      title: "姓名",
      key: "display_name",
      render: (_: unknown, record: AdminUser) => userLabel(record),
    },
    { title: "用户名", dataIndex: "username" },
    {
      title: "角色",
      dataIndex: "role",
      width: 120,
      render: (role: AdminUser["role"]) => (
        <span className={`list-status is-${role}`}>{ROLE_LABELS[role] || role}</span>
      ),
    },
    {
      title: "状态",
      dataIndex: "is_active",
      width: 100,
      render: (active: boolean) => (
        <span className={`list-status ${active ? "is-ok" : "is-off"}`}>{active ? "启用" : "禁用"}</span>
      ),
    },
    ...(isSuperadmin
      ? [
          {
            title: "所属老师",
            key: "teacher",
            width: 140,
            ellipsis: true,
            render: (_: unknown, record: AdminUser) => teacherNameOf(record, teacherNames) || "—",
          },
        ]
      : []),
    { title: "创建时间", dataIndex: "created_at", width: 180, render: (v?: string | null) => formatDateTimeLocal(v) },
    {
      title: "操作",
      key: "actions",
      width: canResetPassword ? 156 : 132,
      fixed: "right" as const,
      render: (_: unknown, record: AdminUser) => {
        const canManage = record.id !== currentUserId && canDeleteRole(currentRole, record.role);
        if (!canResetPassword && !canManage) return "—";
        return (
          <span className="list-icon-actions">
            <Tooltip title="修改姓名">
              <button
                type="button"
                className="list-icon-action"
                aria-label="修改姓名"
                onClick={() => {
                  nameForm.setFieldsValue({ display_name: record.display_name || "" });
                  setEditingName(record);
                }}
              >
                <EditOutlined />
              </button>
            </Tooltip>
            {canResetPassword ? (
              <Tooltip title="重置密码">
                <button
                  type="button"
                  className="list-icon-action"
                  aria-label="重置密码"
                  onClick={() => {
                    resetForm.resetFields();
                    setResetting(record);
                  }}
                >
                  <KeyOutlined />
                </button>
              </Tooltip>
            ) : null}
            {canManage ? (
              record.is_active ? (
                <Tooltip title="停用">
                  <Popconfirm
                    title={`确定停用「${userLabel(record)}」？`}
                    description="停用后该账号无法登录。"
                    okText="停用"
                    okButtonProps={{ danger: true }}
                    cancelText="取消"
                    onConfirm={async () => {
                      try {
                        await setAdminUserActive(record.id, false);
                        message.success(`已停用「${userLabel(record)}」`);
                        await loadUsers();
                      } catch (error) {
                        message.error(getApiErrorMessage(error, "停用失败"));
                      }
                    }}
                  >
                    <button type="button" className="list-icon-action is-danger" aria-label="停用">
                      <StopOutlined />
                    </button>
                  </Popconfirm>
                </Tooltip>
              ) : (
                <Tooltip title="启用">
                  <button
                    type="button"
                    className="list-icon-action"
                    aria-label="启用"
                    onClick={async () => {
                      try {
                        await setAdminUserActive(record.id, true);
                        message.success(`已启用「${userLabel(record)}」`);
                        await loadUsers();
                      } catch (error) {
                        message.error(getApiErrorMessage(error, "启用失败"));
                      }
                    }}
                  >
                    <CheckCircleOutlined />
                  </button>
                </Tooltip>
              )
            ) : null}
            {canManage ? (
              <Tooltip title="删除">
                <Popconfirm
                  title={`确定删除用户「${userLabel(record)}」？`}
                  description="该用户的作答和任务分配会一并清除。"
                  okText="删除"
                  okButtonProps={{ danger: true }}
                  cancelText="取消"
                  onConfirm={async () => {
                    try {
                      await deleteAdminUser(record.id);
                      message.success("已删除");
                      await loadUsers();
                    } catch (error) {
                      message.error(getApiErrorMessage(error, "删除失败"));
                    }
                  }}
                >
                  <button type="button" className="list-icon-action is-danger" aria-label="删除">
                    <DeleteOutlined />
                  </button>
                </Popconfirm>
              </Tooltip>
            ) : null}
          </span>
        );
      },
    },
  ];

  return (
    <ConfigProvider theme={FILTER_THEME}>
      {isSuperadmin ? (
        <div className="list-filter">
          <div className="list-filter-secondary">
            <div className="list-filter-fields is-1">
              <div className={`list-filter-field${teacherFilter != null ? " is-filled" : ""}`}>
                <span className="list-filter-kicker">教师</span>
                <Select
                  allowClear
                  showSearch
                  placeholder="全部"
                  optionFilterProp="label"
                  value={teacherFilter}
                  options={teacherOptions}
                  onChange={(value) => setTeacherFilter(value ?? undefined)}
                />
              </div>
            </div>
            {teacherFilter != null ? (
              <button type="button" className="list-filter-reset" onClick={() => setTeacherFilter(undefined)}>
                清除条件
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="list-results">
        <div className="list-results-head">
          <div className="list-results-meta">
            共 <strong>{visibleUsers.length}</strong> 条
          </div>
          <div className="list-results-tools">
            <Button
              type="primary"
              disabled={allowedRoles.length === 0}
              onClick={() => {
                form.resetFields();
                setOpen(true);
              }}
            >
              新建用户
            </Button>
          </div>
        </div>
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={visibleUsers}
          pagination={false}
          scroll={{ x: isSuperadmin ? 1100 : 980 }}
          locale={{ emptyText: teacherFilter != null ? "没有匹配的用户" : "暂无用户" }}
        />
      </div>

      <Drawer
        className="entry-drawer is-roomy"
        title="新建用户"
        open={open}
        onClose={closeCreate}
        size={640}
        destroyOnHidden
        styles={{ body: { padding: 0 } }}
      >
        <div className="entry-drawer-panel">
          <div className="entry-body">
            <p className="entry-hint">创建后即可登录。教师可管理自己录入的题目并布置任务，学生只能作答已分配的任务。展示和布置任务时优先用姓名。</p>
            <Form
              form={form}
              layout="vertical"
              initialValues={{ is_active: true, role: allowedRoles[0] || "student" }}
              onFinish={handleCreate}
            >
              <Form.Item
                name="display_name"
                label={createRole === "student" ? "学生姓名" : "姓名"}
                rules={createRole === "student" ? [{ required: true, whitespace: true, message: "请填写学生姓名" }] : []}
              >
                <Input placeholder="展示时优先用姓名" maxLength={32} autoComplete="off" />
              </Form.Item>
              <Form.Item name="username" label="用户名" rules={[{ required: true, message: "请输入用户名" }]}>
                <Input placeholder="登录用，至少 3 位" autoComplete="off" />
              </Form.Item>
              <Form.Item name="password" label="密码" rules={[{ required: true, message: "请输入密码" }]}>
                <Input.Password placeholder="至少 6 位" autoComplete="new-password" />
              </Form.Item>
              <Form.Item name="role" label="角色" rules={[{ required: true, message: "请选择角色" }]}>
                <Select
                  options={allowedRoles.map((role) => ({
                    label: ROLE_LABELS[role],
                    value: role,
                  }))}
                />
              </Form.Item>
              <Form.Item name="is_active" label="启用状态" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Form>
          </div>
          <div className="entry-bar">
            <div className="entry-bar-meta">用户名创建后不可修改，姓名可以随时改。</div>
            <div className="entry-bar-actions">
              <Button onClick={closeCreate}>取消</Button>
              <Button type="primary" loading={submitting} onClick={() => form.submit()}>
                创建
              </Button>
            </div>
          </div>
        </div>
      </Drawer>

      <Drawer
        className="entry-drawer is-roomy"
        title={resetting ? `重置密码 · ${userLabel(resetting)}` : "重置密码"}
        open={!!resetting}
        onClose={closeReset}
        size={560}
        destroyOnHidden
        styles={{ body: { padding: 0 } }}
      >
        <div className="entry-drawer-panel">
          <div className="entry-body">
            <p className="entry-hint">为该用户设置新密码。重置后对方使用新密码登录；当前超管会话不受影响。</p>
            <Form form={resetForm} layout="vertical" onFinish={handleResetPassword}>
              <Form.Item
                name="new_password"
                label="新密码"
                extra="至少 6 位"
                rules={[
                  { required: true, message: "请输入新密码" },
                  { min: 6, message: "新密码至少 6 位" },
                ]}
              >
                <Input.Password placeholder="设置新密码" autoComplete="new-password" />
              </Form.Item>
              <Form.Item
                name="confirm_password"
                label="确认新密码"
                dependencies={["new_password"]}
                rules={[
                  { required: true, message: "请再次输入新密码" },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (!value || getFieldValue("new_password") === value) {
                        return Promise.resolve();
                      }
                      return Promise.reject(new Error("两次输入的密码不一致"));
                    },
                  }),
                ]}
              >
                <Input.Password placeholder="再输入一次新密码" autoComplete="new-password" />
              </Form.Item>
            </Form>
          </div>
          <div className="entry-bar">
            <div className="entry-bar-meta">仅超管可重置他人密码。</div>
            <div className="entry-bar-actions">
              <Button onClick={closeReset}>取消</Button>
              <Button type="primary" loading={resetSubmitting} onClick={() => resetForm.submit()}>
                重置
              </Button>
            </div>
          </div>
        </div>
      </Drawer>

      <Drawer
        className="entry-drawer is-roomy"
        title={editingName ? `修改姓名 · ${userLabel(editingName)}` : "修改姓名"}
        open={!!editingName}
        onClose={closeEditName}
        size={560}
        destroyOnHidden
        styles={{ body: { padding: 0 } }}
      >
        <div className="entry-drawer-panel">
          <div className="entry-body">
            <p className="entry-hint">系统展示和布置任务时优先用姓名，没有则显示用户名 {editingName ? `「${editingName.username}」` : ""}。</p>
            <Form form={nameForm} layout="vertical" onFinish={handleSaveName}>
              <Form.Item
                name="display_name"
                label={editingName?.role === "student" ? "学生姓名" : "姓名"}
                rules={
                  editingName?.role === "student"
                    ? [{ required: true, whitespace: true, message: "请填写学生姓名" }]
                    : []
                }
              >
                <Input placeholder="填写姓名" maxLength={32} autoComplete="off" />
              </Form.Item>
            </Form>
          </div>
          <div className="entry-bar">
            <div className="entry-bar-meta">用户名不会一起改。</div>
            <div className="entry-bar-actions">
              <Button onClick={closeEditName}>取消</Button>
              <Button type="primary" loading={nameSubmitting} onClick={() => nameForm.submit()}>
                保存
              </Button>
            </div>
          </div>
        </div>
      </Drawer>
    </ConfigProvider>
  );
}
