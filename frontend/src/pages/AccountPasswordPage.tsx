import { Button, ConfigProvider, Form, Input, message } from 'antd';
import axios from 'axios';
import { useState } from 'react';

import { changePassword } from '../api';
import { setAccessToken } from '../auth';

type PasswordForm = {
  current_password: string;
  new_password: string;
  confirm_password: string;
};

function errorDetail(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const detail = err.response?.data?.detail;
    if (typeof detail === 'string' && detail.trim()) return detail;
  }
  return fallback;
}

export default function AccountPasswordPage() {
  const [form] = Form.useForm<PasswordForm>();
  const [submitting, setSubmitting] = useState(false);

  async function handleChangePassword(values: PasswordForm) {
    setSubmitting(true);
    try {
      const data = await changePassword({
        current_password: values.current_password,
        new_password: values.new_password,
      });
      setAccessToken(data.access_token);
      message.success('密码修改成功');
      form.resetFields();
    } catch (err) {
      message.error(errorDetail(err, '修改密码失败'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="account-password">
      <div className="account-section-head">
        <h2>登录密码</h2>
        <p>修改后当前会话保持登录，建议不要与其他站点共用密码。</p>
      </div>
      <ConfigProvider
        theme={{
          token: {
            colorPrimary: '#7c5cfc',
            borderRadius: 10,
            controlHeight: 40,
          },
        }}
      >
        <Form form={form} layout="vertical" onFinish={handleChangePassword} requiredMark={false}>
          <Form.Item
            label="当前密码"
            name="current_password"
            rules={[{ required: true, message: '请输入当前密码' }]}
          >
            <Input.Password autoComplete="current-password" placeholder="输入现在使用的密码" />
          </Form.Item>
          <Form.Item
            label="新密码"
            name="new_password"
            extra="至少 6 位"
            rules={[
              { required: true, message: '请输入新密码' },
              { min: 6, message: '新密码至少 6 位' },
            ]}
          >
            <Input.Password autoComplete="new-password" placeholder="设置新密码" />
          </Form.Item>
          <Form.Item
            label="确认新密码"
            name="confirm_password"
            dependencies={['new_password']}
            rules={[
              { required: true, message: '请再次输入新密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('new_password') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('两次输入的新密码不一致'));
                },
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" placeholder="再输入一次新密码" />
          </Form.Item>
          <Form.Item className="account-password-submit">
            <Button type="primary" htmlType="submit" loading={submitting}>
              更新密码
            </Button>
          </Form.Item>
        </Form>
      </ConfigProvider>
    </div>
  );
}
