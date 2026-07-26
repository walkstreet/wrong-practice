import { Button, Card, Form, Input, Modal, Select, Space, Switch, Table, Tag, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useState } from "react";

import { createAdminUser, listAdminUsers } from "../api";
import type { AdminUser, UserRole } from "../types";
import { formatDateTimeLocal } from "../utils/datetime";

interface CreateFormValues {
  username: string;
  password: string;
  role: UserRole;
  is_active: boolean;
}

export default function AdminUsersPage() {
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<CreateFormValues>();

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
    } catch {
      message.error("创建失败，用户名可能已存在");
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
      render: (role: AdminUser["role"]) =>
        role === "admin" ? <Tag color="blue">admin</Tag> : <Tag color="green">learner</Tag>,
    },
    {
      title: "状态",
      dataIndex: "is_active",
      width: 120,
      render: (active: boolean) => (active ? <Tag color="success">启用</Tag> : <Tag>禁用</Tag>),
    },
    { title: "创建人ID", dataIndex: "created_by", width: 120, render: (v) => v ?? "--" },
    { title: "创建时间", dataIndex: "created_at", width: 220, render: (v?: string | null) => formatDateTimeLocal(v) },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card>
        <Space>
          <Button type="primary" onClick={() => setOpen(true)}>
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
        title="创建用户（仅 admin 可操作）"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={submitting}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" initialValues={{ is_active: true, role: "learner" }} onFinish={handleCreate}>
          <Form.Item name="username" label="用户名" rules={[{ required: true, message: "请输入用户名" }]}>
            <Input placeholder="至少3位" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, message: "请输入密码" }]}>
            <Input.Password placeholder="至少6位" />
          </Form.Item>
          <Form.Item name="role" label="用户类型" rules={[{ required: true, message: "请选择用户类型" }]}>
            <Select
              options={[
                { label: "learner（前台用户）", value: "learner" },
                { label: "admin（后台管理员）", value: "admin" },
              ]}
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
