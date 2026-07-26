import { Button, Card, Form, Input, Typography, message } from "antd";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { login } from "../api";
import { setAccessToken } from "../auth";

const { Title } = Typography;

interface FormValues {
  username: string;
  password: string;
}

export default function LoginPage() {
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<FormValues>();
  const [searchParams] = useSearchParams();

  async function handleSubmit(values: FormValues) {
    setSubmitting(true);
    try {
      const data = await login(values);
      setAccessToken(data.access_token);
      message.success("登录成功");
      const next = searchParams.get("next");
      window.location.replace(next || "/");
    } catch {
      message.error("登录失败，请检查账号密码");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Card style={{ width: 420 }}>
        <Title level={4}>后台登录</Title>
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="username" label="用户名" rules={[{ required: true, message: "请输入用户名" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, message: "请输入密码" }]}>
            <Input.Password />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={submitting}>
            登录
          </Button>
        </Form>
      </Card>
    </div>
  );
}
