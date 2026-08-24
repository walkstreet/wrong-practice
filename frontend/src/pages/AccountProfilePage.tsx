import { CameraOutlined } from '@ant-design/icons';
import { Upload, message } from 'antd';
import axios from 'axios';
import { useState } from 'react';

import { deleteAvatar, uploadAvatar, type MeResponse } from '../api';
import { ROLE_LABELS } from '../permissions';
import type { UserRole } from '../types';
import { AVATAR_ACCEPT, compressAvatarFile } from '../utils/avatarImage';

type AccountProfilePageProps = {
  username: string;
  role: UserRole | null;
  isActive: boolean;
  avatarUrl?: string | null;
  onUpdated: (user: MeResponse) => void;
};

function errorDetail(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (axios.isAxiosError(err)) {
    const detail = err.response?.data?.detail;
    if (typeof detail === 'string' && detail.trim()) return detail;
  }
  return fallback;
}

function initialLetter(username: string): string {
  const ch = username.trim().charAt(0);
  return ch ? ch.toUpperCase() : '?';
}

export default function AccountProfilePage({
  username,
  role,
  isActive,
  avatarUrl,
  onUpdated,
}: AccountProfilePageProps) {
  const [uploading, setUploading] = useState(false);
  const [clearing, setClearing] = useState(false);

  async function handleUpload(file: File) {
    setUploading(true);
    try {
      const prepared = await compressAvatarFile(file);
      const next = await uploadAvatar(prepared);
      onUpdated(next);
      message.success('头像已更新');
    } catch (err) {
      message.error(errorDetail(err, '上传头像失败'));
    } finally {
      setUploading(false);
    }
    return false;
  }

  async function handleClear() {
    setClearing(true);
    try {
      const next = await deleteAvatar();
      onUpdated(next);
      message.success('已恢复默认头像');
    } catch (err) {
      message.error(errorDetail(err, '清除头像失败'));
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="account-profile">
      <div className="account-identity">
        <Upload
          accept={AVATAR_ACCEPT}
          showUploadList={false}
          disabled={uploading}
          beforeUpload={handleUpload}
        >
          <div className={`account-avatar-preview${uploading ? ' is-busy' : ''}`}>
            {avatarUrl ? (
              <img src={avatarUrl} alt={username} />
            ) : (
              <span className="letter">{initialLetter(username)}</span>
            )}
            <span className="account-avatar-overlay">
              <CameraOutlined />
              {uploading ? '上传中' : '更换'}
            </span>
          </div>
        </Upload>
        <div className="account-identity-meta">
          <div className="account-identity-name">{username}</div>
          <div className="account-identity-tags">
            {role ? <span className="account-pill">{ROLE_LABELS[role]}</span> : null}
            <span className={`account-pill ${isActive ? 'is-ok' : 'is-off'}`}>
              {isActive ? '已启用' : '已禁用'}
            </span>
          </div>
          <div className="account-identity-actions">
            <Upload
              accept={AVATAR_ACCEPT}
              showUploadList={false}
              disabled={uploading}
              beforeUpload={handleUpload}
            >
              <button type="button" className="account-text-btn" disabled={uploading}>
                {uploading ? '上传中…' : '上传照片'}
              </button>
            </Upload>
            {avatarUrl ? (
              <button
                type="button"
                className="account-text-btn is-muted"
                onClick={handleClear}
                disabled={clearing}
              >
                {clearing ? '处理中…' : '恢复默认'}
              </button>
            ) : null}
          </div>
          <p className="account-hint">支持 JPG、PNG、WebP，最大 2MB</p>
        </div>
      </div>
      <dl className="account-dl">
        <div className="account-dl-row">
          <dt>用户名</dt>
          <dd>
            <span>{username}</span>
            <small>登录标识，暂不支持自行修改</small>
          </dd>
        </div>
        <div className="account-dl-row">
          <dt>角色</dt>
          <dd>
            <span>{role ? ROLE_LABELS[role] : '--'}</span>
            <small>由管理员分配</small>
          </dd>
        </div>
        <div className="account-dl-row">
          <dt>状态</dt>
          <dd>
            <span>{isActive ? '已启用' : '已禁用'}</span>
            <small>{isActive ? '当前可以登录使用' : '账号已被停用'}</small>
          </dd>
        </div>
      </dl>
    </div>
  );
}
