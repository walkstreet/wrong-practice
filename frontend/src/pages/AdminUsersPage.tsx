import { DeleteOutlined, KeyOutlined } from "@ant-design/icons";
import { Button, ConfigProvider, Drawer, Form, Input, Popconfirm, Select, Switch, Table, Tooltip, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import axios from "axios";
import { useEffect, useMemo, useState } from "react";

import { createAdminUser, deleteAdminUser, listAdminUsers, resetAdminUserPassword } from "../api";
import { ROLE_LABELS, canDeleteRole, creatableRoles } from "../permissions";
import type { AdminUser, UserRole } from "../types";
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

interface CreateFormValues {
  username: string;
  password: string;
  role: UserRole;
  is_active: boolean;
}

interface ResetFormValues {
  new_password: string;
  confirm_password: string;
}

function getApiErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error) && typeof error.response?.data?.detail === "string") {
    return error.response.data.detail;
  }
  return fallback;
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
  const [submitting, setSubmitting] = useState(false);
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [form] = Form.useForm<CreateFormValues>();
  const [resetForm] = Form.useForm<ResetFormValues>();
  const allowedRoles = useMemo(() => creatableRoles(currentRole), [currentRole]);
  const canResetPassword = currentRole === "superadmin";

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

  function closeCreate() {
    setOpen(false);
    form.resetFields();
  }

  function closeReset() {
    setResetting(null);
    resetForm.resetFields();
  }

  async function handleResetPassword(values: ResetFormValues) {
    if (!resetting) return;
    setResetSubmitting(true);
    try {
      await resetAdminUserPassword(resetting.id, values.new_password);
      message.success(`已重置「${resetting.username}」的密码`);
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
      await createAdminUser(values);
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
    ...(currentRole === "superadmin"
      ? [{ title: "创建人 ID", dataIndex: "created_by", width: 110, render: (v: number | null) => v ?? "—" }]
      : []),
    { title: "创建时间", dataIndex: "created_at", width: 180, render: (v?: string | null) => formatDateTimeLocal(v) },
    {
      title: "操作",
      key: "actions",
      width: canResetPassword ? 96 : 72,
      render: (_: unknown, record: AdminUser) => {
        const canDelete = record.id !== currentUserId && canDeleteRole(currentRole, record.role);
        if (!canResetPassword && !canDelete) return "—";
        return (
          <span className="list-icon-actions">
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
            {canDelete ? (
              <Tooltip title="删除">
                <Popconfirm
                  title={`确定删除用户「${record.username}」？`}
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
      <div className="list-results">
        <div className="list-results-head">
          <div className="list-results-meta">
            共 <strong>{users.length}</strong> 条
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
          dataSource={users}
          pagination={false}
          scroll={{ x: 820 }}
          locale={{ emptyText: "暂无用户" }}
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
            <p className="entry-hint">创建后即可登录。教师可管理自己录入的题目并布置任务，学生只能作答已分配的任务。</p>
            <Form
              form={form}
              layout="vertical"
              initialValues={{ is_active: true, role: allowedRoles[0] || "student" }}
              onFinish={handleCreate}
            >
              <Form.Item name="username" label="用户名" rules={[{ required: true, message: "请输入用户名" }]}>
                <Input placeholder="至少 3 位" autoComplete="off" />
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
            <div className="entry-bar-meta">用户名创建后不可修改。</div>
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
        title={resetting ? `重置密码 · ${resetting.username}` : "重置密码"}
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
    </ConfigProvider>
  );
}
