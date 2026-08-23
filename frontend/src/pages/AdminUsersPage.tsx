import { Button, Card, Form, Input, Modal, Popconfirm, Select, Space, Switch, Table, Tag, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import axios from "axios";
import { useEffect, useMemo, useState } from "react";

import { createAdminUser, deleteAdminUser, listAdminUsers } from "../api";
import { ROLE_LABELS, canDeleteRole, creatableRoles } from "../permissions";
import type { AdminUser, UserRole } from "../types";
import { formatDateTimeLocal } from "../utils/datetime";

interface CreateFormValues {
  username: string;
  password: string;
  role: UserRole;
  is_active: boolean;
}

const ROLE_TAG_COLOR: Record<UserRole, string> = {
  superadmin: "red",
  teacher: "blue",
  student: "green",
};

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
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<CreateFormValues>();
  const allowedRoles = useMemo(() => creatableRoles(currentRole), [currentRole]);

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

  async function handleCreate(values: CreateFormValues) {
    setSubmitting(true);
    try {
      await createAdminUser(values);
      message.success("用户创建成功");
      setOpen(false);
      form.resetFields();
      await loadUsers();
    } catch (error) {
      message.error(getApiErrorMessage(error, "创建失败，用户名可能已存在，或无权创建该角色"));
    } finally {
      setSubmitting(false);
    }
  }

  const columns: ColumnsType<AdminUser> = [
    { title: "ID", dataIndex: "id", width: 80 },
    { title: "用户名", dataIndex: "username" },
    {
      title: "角色",
      dataIndex: "role",
      width: 120,
      render: (role: AdminUser["role"]) => (
        <Tag color={ROLE_TAG_COLOR[role] || "default"}>{ROLE_LABELS[role] || role}</Tag>
      ),
    },
    {
      title: "状态",
      dataIndex: "is_active",
      width: 120,
      render: (active: boolean) => (active ? <Tag color="success">启用</Tag> : <Tag>禁用</Tag>),
    },
    ...(currentRole === "superadmin"
      ? [{ title: "创建人ID", dataIndex: "created_by", width: 120, render: (v: number | null) => v ?? "--" }]
      : []),
    { title: "创建时间", dataIndex: "created_at", width: 220, render: (v?: string | null) => formatDateTimeLocal(v) },
    {
      title: "操作",
      key: "actions",
      width: 100,
      render: (_: unknown, record: AdminUser) => {
        const canDelete =
          record.id !== currentUserId && canDeleteRole(currentRole, record.role);
        if (!canDelete) return "--";
        return (
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
            <Button type="link" danger size="small">
              删除
            </Button>
          </Popconfirm>
        );
      },
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card>
        <Space>
          <Button type="primary" disabled={allowedRoles.length === 0} onClick={() => setOpen(true)}>
            新建用户
          </Button>
          <Button onClick={loadUsers} loading={loading}>
            刷新
          </Button>
        </Space>
      </Card>

      <Card>
        <Table rowKey="id" loading={loading} columns={columns} dataSource={users} pagination={false} />
      </Card>

      <Modal
        title="创建用户"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={submitting}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ is_active: true, role: allowedRoles[0] || "student" }}
          onFinish={handleCreate}
        >
          <Form.Item name="username" label="用户名" rules={[{ required: true, message: "请输入用户名" }]}>
            <Input placeholder="至少3位" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, message: "请输入密码" }]}>
            <Input.Password placeholder="至少6位" />
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
      </Modal>
    </Space>
  );
}
