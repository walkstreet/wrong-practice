import { CheckCircleOutlined, DeleteOutlined, EditOutlined, KeyOutlined, StopOutlined, SwapOutlined } from "@ant-design/icons";
import { Button, ConfigProvider, Drawer, Form, Input, Popconfirm, Select, Switch, Table, Tooltip, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import axios from "axios";
import { useEffect, useMemo, useState } from "react";

import {
  createAdminUser,
  createOrganization,
  deleteAdminUser,
  listAdminUsers,
  listOrganizations,
  reassignStudentTeacher,
  resetAdminUserPassword,
  setAdminUserActive,
  updateAdminUser,
} from "../api";
import { ROLE_LABELS, canDeleteRole, canResetUserPassword, creatableRoles } from "../permissions";
import type { AdminUser, Organization, UserRole } from "../types";
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
  organization_id?: number;
  teacher_id?: number;
}

interface CreateOrgFormValues {
  name: string;
  admin_display_name?: string;
  admin_username: string;
  admin_password: string;
}

interface ResetFormValues {
  new_password: string;
  confirm_password: string;
}

interface NameFormValues {
  display_name: string;
}

interface ReassignFormValues {
  teacher_id: number;
}

type OrgFilter = number;

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

function teacherNameOf(user: AdminUser, staffNames: Map<number, string>): string | null {
  if (user.role !== "student") return null;
  if (user.teacher_name) return user.teacher_name;
  if (user.teacher_id == null) return null;
  return staffNames.get(user.teacher_id) ?? null;
}

function isStaffRole(role: UserRole): boolean {
  return role === "teacher" || role === "org_admin";
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
  const [reassigning, setReassigning] = useState<AdminUser | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [nameSubmitting, setNameSubmitting] = useState(false);
  const [reassignSubmitting, setReassignSubmitting] = useState(false);
  const [form] = Form.useForm<CreateFormValues>();
  const [resetForm] = Form.useForm<ResetFormValues>();
  const [nameForm] = Form.useForm<NameFormValues>();
  const [reassignForm] = Form.useForm<ReassignFormValues>();
  const createRole = Form.useWatch("role", form);
  const [orgFilter, setOrgFilter] = useState<OrgFilter | undefined>(undefined);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [orgOpen, setOrgOpen] = useState(false);
  const [orgSubmitting, setOrgSubmitting] = useState(false);
  const [orgForm] = Form.useForm<CreateOrgFormValues>();
  const allowedRoles = useMemo(() => creatableRoles(currentRole), [currentRole]);
  const isSuperadmin = currentRole === "superadmin";
  const isOrgAdmin = currentRole === "org_admin";
  const showResetPassword = isSuperadmin || isOrgAdmin;

  const staffNames = useMemo(() => {
    const map = new Map<number, string>();
    for (const user of users) {
      if (isStaffRole(user.role)) map.set(user.id, userLabel(user));
    }
    return map;
  }, [users]);

  const staffOptions = useMemo(
    () =>
      users
        .filter((user) => isStaffRole(user.role) && user.is_active)
        .sort((a, b) => userLabel(a).localeCompare(userLabel(b), "zh-CN"))
        .map((user) => ({ label: `${userLabel(user)}（${ROLE_LABELS[user.role]}）`, value: user.id })),
    [users],
  );

  const orgOptions = useMemo(
    () =>
      organizations
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
        .map((org) => ({ label: org.name, value: org.id })),
    [organizations],
  );

  const visibleUsers = useMemo(() => {
    if (!isSuperadmin || orgFilter == null) return users;
    return users.filter((user) => user.organization_id === orgFilter);
  }, [isSuperadmin, orgFilter, users]);

  async function loadUsers() {
    setLoading(true);
    try {
      const data = await listAdminUsers();
      setUsers(data);
      if (currentRole === "superadmin") {
        const orgs = await listOrganizations();
        setOrganizations(orgs);
      }
    } catch {
      message.error("获取用户列表失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, [currentRole]);

  useEffect(() => {
    if (orgFilter != null && !organizations.some((org) => org.id === orgFilter)) {
      setOrgFilter(undefined);
    }
  }, [orgFilter, organizations]);

  function closeCreate() {
    setOpen(false);
    form.resetFields();
  }

  function closeOrgCreate() {
    setOrgOpen(false);
    orgForm.resetFields();
  }

  function closeReset() {
    setResetting(null);
    resetForm.resetFields();
  }

  function closeEditName() {
    setEditingName(null);
    nameForm.resetFields();
  }

  function closeReassign() {
    setReassigning(null);
    reassignForm.resetFields();
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
        organization_id: values.role === "org_admin" ? values.organization_id : null,
        teacher_id: values.role === "student" ? values.teacher_id : null,
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

  async function handleCreateOrg(values: CreateOrgFormValues) {
    setOrgSubmitting(true);
    try {
      await createOrganization({
        name: values.name.trim(),
        admin_username: values.admin_username.trim(),
        admin_password: values.admin_password,
        admin_display_name: values.admin_display_name?.trim() || null,
      });
      message.success("机构已创建");
      closeOrgCreate();
      await loadUsers();
    } catch (error) {
      message.error(getApiErrorMessage(error, "创建机构失败，机构管理员用户名可能已存在"));
    } finally {
      setOrgSubmitting(false);
    }
  }

  async function handleReassign(values: ReassignFormValues) {
    if (!reassigning) return;
    setReassignSubmitting(true);
    try {
      await reassignStudentTeacher(reassigning.id, values.teacher_id);
      message.success("所属老师已更新，历史任务和讲解仍保留");
      closeReassign();
      await loadUsers();
    } catch (error) {
      message.error(getApiErrorMessage(error, "调整所属老师失败"));
    } finally {
      setReassignSubmitting(false);
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
      width: 132,
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
            title: "机构",
            dataIndex: "organization_name",
            width: 160,
            ellipsis: true,
            render: (name: string | null | undefined) => name || "—",
          },
          {
            title: "所属老师",
            key: "teacher",
            width: 140,
            ellipsis: true,
            render: (_: unknown, record: AdminUser) => teacherNameOf(record, staffNames) || "—",
          },
        ]
      : isOrgAdmin
        ? [
            {
              title: "所属老师",
              key: "teacher",
              width: 180,
              ellipsis: true,
              render: (_: unknown, record: AdminUser) => {
                const name = teacherNameOf(record, staffNames) || "—";
                if (record.role !== "student") return name;
                return (
                  <span className="list-icon-actions">
                    <span>{name}</span>
                    <Tooltip title="调整所属老师">
                      <button
                        type="button"
                        className="list-icon-action"
                        aria-label="调整所属老师"
                        onClick={() => {
                          reassignForm.setFieldsValue({ teacher_id: record.teacher_id || undefined });
                          setReassigning(record);
                        }}
                      >
                        <SwapOutlined />
                      </button>
                    </Tooltip>
                  </span>
                );
              },
            },
          ]
        : []),
    { title: "创建时间", dataIndex: "created_at", width: 180, render: (v?: string | null) => formatDateTimeLocal(v) },
    {
      title: "操作",
      key: "actions",
      width: showResetPassword ? 156 : 132,
      fixed: "right" as const,
      render: (_: unknown, record: AdminUser) => {
        const canManage = record.id !== currentUserId && canDeleteRole(currentRole, record.role);
        const canReset = canResetUserPassword(currentRole, record.role, record.id === currentUserId);
        if (!canReset && !canManage) return "—";
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
            {canReset ? (
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
              <div className={`list-filter-field${orgFilter != null ? " is-filled" : ""}`}>
                <span className="list-filter-kicker">机构</span>
                <Select
                  allowClear
                  showSearch
                  placeholder="全部"
                  optionFilterProp="label"
                  value={orgFilter}
                  options={orgOptions}
                  onChange={(value) => setOrgFilter(value ?? undefined)}
                />
              </div>
            </div>
            {orgFilter != null ? (
              <button type="button" className="list-filter-reset" onClick={() => setOrgFilter(undefined)}>
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
            {isSuperadmin ? (
              <Button
                onClick={() => {
                  orgForm.resetFields();
                  setOrgOpen(true);
                }}
              >
                新建机构
              </Button>
            ) : null}
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
          scroll={{ x: isSuperadmin ? 1240 : 980 }}
          locale={{ emptyText: orgFilter != null ? "没有匹配的用户" : "暂无用户" }}
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
            <p className="entry-hint">
              {isSuperadmin
                ? "超管可创建其他超管，或把机构管理员加入已有机构。新建机构请用「新建机构」。"
                : isOrgAdmin
                  ? "机构管理员可创建本机构的教师和学生。学生会自动属于本机构。"
                  : "创建后即可登录。教师可管理自己录入的题目并布置任务，学生只能作答已分配的任务。展示和布置任务时优先用姓名。"}
            </p>
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
              {isSuperadmin && createRole === "org_admin" ? (
                <Form.Item name="organization_id" label="所属机构" rules={[{ required: true, message: "请选择机构" }]}>
                  <Select
                    showSearch
                    optionFilterProp="label"
                    placeholder="选择机构"
                    options={orgOptions}
                  />
                </Form.Item>
              ) : null}
              {isOrgAdmin && createRole === "student" ? (
                <Form.Item name="teacher_id" label="所属老师">
                  <Select
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    placeholder="默认挂到当前机构管理员"
                    options={staffOptions}
                  />
                </Form.Item>
              ) : null}
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
            <p className="entry-hint">为该用户设置新密码。重置后对方使用新密码登录；你的当前登录不受影响。</p>
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
            <div className="entry-bar-meta">
              {isSuperadmin ? "超管可重置机构管理员和超管密码。" : "机构管理员可重置本机构教师和学生密码。"}
            </div>
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

      <Drawer
        className="entry-drawer is-roomy"
        title={reassigning ? `调整所属老师 · ${userLabel(reassigning)}` : "调整所属老师"}
        open={!!reassigning}
        onClose={closeReassign}
        size={640}
        destroyOnHidden
        styles={{ body: { padding: 0 } }}
      >
        <div className="entry-drawer-panel">
          <div className="entry-body">
            <p className="entry-hint">只改当前归谁管。已经发给学生的任务、讲解和生成内容都会保留，不会搬到新老师名下。</p>
            <Form form={reassignForm} layout="vertical" onFinish={handleReassign}>
              <Form.Item name="teacher_id" label="所属老师" rules={[{ required: true, message: "请选择所属老师" }]}>
                <Select showSearch optionFilterProp="label" placeholder="选择本机构教师或机构管理员" options={staffOptions} />
              </Form.Item>
            </Form>
          </div>
          <div className="entry-bar">
            <div className="entry-bar-meta">只能改挂到同一机构的老师。</div>
            <div className="entry-bar-actions">
              <Button onClick={closeReassign}>取消</Button>
              <Button type="primary" loading={reassignSubmitting} onClick={() => reassignForm.submit()}>
                保存
              </Button>
            </div>
          </div>
        </div>
      </Drawer>

      <Drawer
        className="entry-drawer is-roomy"
        title="新建机构"
        open={orgOpen}
        onClose={closeOrgCreate}
        size={640}
        destroyOnHidden
        styles={{ body: { padding: 0 } }}
      >
        <div className="entry-drawer-panel">
          <div className="entry-body">
            <p className="entry-hint">
              同时创建机构和第一位机构管理员。个体老师也建一个机构，管理员就是他自己。
            </p>
            <Form form={orgForm} layout="vertical" onFinish={handleCreateOrg}>
              <Form.Item name="name" label="机构名称" rules={[{ required: true, whitespace: true, message: "请填写机构名称" }]}>
                <Input placeholder="学校、培训机构或个人工作室名称" maxLength={64} autoComplete="off" />
              </Form.Item>
              <Form.Item name="admin_display_name" label="管理员姓名">
                <Input placeholder="选填，展示时优先用姓名" maxLength={32} autoComplete="off" />
              </Form.Item>
              <Form.Item
                name="admin_username"
                label="管理员用户名"
                rules={[{ required: true, message: "请输入用户名" }]}
              >
                <Input placeholder="登录用，至少 3 位" autoComplete="off" />
              </Form.Item>
              <Form.Item
                name="admin_password"
                label="管理员密码"
                rules={[{ required: true, message: "请输入密码" }]}
              >
                <Input.Password placeholder="至少 6 位" autoComplete="new-password" />
              </Form.Item>
            </Form>
          </div>
          <div className="entry-bar">
            <div className="entry-bar-meta">创建后该管理员即可登录并在本机构下建教师和学生。</div>
            <div className="entry-bar-actions">
              <Button onClick={closeOrgCreate}>取消</Button>
              <Button type="primary" loading={orgSubmitting} onClick={() => orgForm.submit()}>
                创建
              </Button>
            </div>
          </div>
        </div>
      </Drawer>
    </ConfigProvider>
  );
}
