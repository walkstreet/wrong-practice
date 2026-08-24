import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { NavLink, Outlet } from 'react-router-dom';

export default function AccountPage() {
  return (
    <div className="account-page">
      <div className="account-page-head">
        <h1>账号</h1>
        <p>头像、资料与登录安全</p>
      </div>
      <div className="account-layout">
        <nav className="account-rail">
          <NavLink
            to="/account"
            end
            className={({ isActive }) => `account-rail-link${isActive ? ' is-active' : ''}`}
          >
            <UserOutlined />
            用户信息
          </NavLink>
          <NavLink
            to="/account/password"
            className={({ isActive }) => `account-rail-link${isActive ? ' is-active' : ''}`}
          >
            <LockOutlined />
            修改密码
          </NavLink>
        </nav>
        <div className="account-panel">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
