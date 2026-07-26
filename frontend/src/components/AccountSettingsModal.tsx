import { Button, Form, Input, Modal, message } from 'antd';
import { useEffect, useState } from 'react';
import axios from 'axios';

import { changePassword } from '../api';
import { setAccessToken } from '../auth';

type AccountSettingsModalProps = {
  open: boolean;
  currentUsername: string;
  onClose: () => void;
};

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

export default function AccountSettingsModal({
  open,
  currentUsername,
  onClose,
}: AccountSettingsModalProps) {
  const [passwordForm] = Form.useForm<PasswordForm>();
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    passwordForm.resetFields();
  }, [open, passwordForm]);

  async function handleChangePassword(values: PasswordForm) {
    setPasswordSubmitting(true);
    try {
      const data = await changePassword({
        current_password: values.current_password,
        new_password: values.new_password,
      });
      setAccessToken(data.access_token);
      message.success('密码修改成功');
      passwordForm.resetFields();
      onClose();
    } catch (err) {
      message.error(errorDetail(err, '修改密码失败'));
    } finally {
      setPasswordSubmitting(false);
    }
  }

  return (
    <Modal
      title="修改密码"
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
    >
      <Form form={passwordForm} layout="vertical" onFinish={handleChangePassword}>
        <Form.Item label="当前用户名">
          <Input value={currentUsername} disabled />
        </Form.Item>
        <Form.Item
          label="当前密码"
          name="current_password"
          rules={[{ required: true, message: '请输入当前密码' }]}
        >
          <Input.Password autoComplete="current-password" />
        </Form.Item>
        <Form.Item
          label="新密码"
          name="new_password"
          rules={[
            { required: true, message: '请输入新密码' },
            { min: 6, message: '新密码至少 6 位' },
          ]}
        >
          <Input.Password autoComplete="new-password" />
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
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item style={{ marginBottom: 0 }}>
          <Button type="primary" htmlType="submit" loading={passwordSubmitting} block>
            确认修改密码
          </Button>
        </Form.Item>
      </Form>
    </Modal>
  );
}
