import {
  App as AntdApp,
  Button,
  Drawer,
  Dropdown,
  Grid,
  Result,
  Tooltip,
} from 'antd';
import {
  AimOutlined,
  AuditOutlined,
  CarryOutOutlined,
  DeleteOutlined,
  DownOutlined,
  FileSearchOutlined,
  FormOutlined,
  HistoryOutlined,
  IdcardOutlined,
  LockOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuOutlined,
  MenuUnfoldOutlined,
  ProjectOutlined,
  QuestionCircleOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import { me, type MeResponse } from './api';
import {
  clearAccessToken,
  getAccessToken,
  getTokenUsername,
  subscribeAuthTokenChange,
} from './auth';
import AppLogo from './components/AppLogo';
import type { ClaimRequestStatus, UserRole } from './types';
import AccountPage from './pages/AccountPage';
import AccountPasswordPage from './pages/AccountPasswordPage';
import AccountProfilePage from './pages/AccountProfilePage';
import ActivityLogsPage from './pages/ActivityLogsPage';
import AdminAssignmentsPage from './pages/AdminAssignmentsPage';
import AdminUsersPage from './pages/AdminUsersPage';
import HelpPage from './pages/HelpPage';
import LearnerAssignmentsPage from './pages/LearnerAssignmentsPage';
import LoginPage from './pages/LoginPage';
import MyWeaknessPage from './pages/MyWeaknessPage';
import PracticeRecordsPage from './pages/PracticeRecordsPage';
import QuestionEntryPage from './pages/QuestionEntryPage';
import RecycleBinPage from './pages/RecycleBinPage';
import StudentPortraitPage from './pages/StudentPortraitPage';
import StudentsPage from './pages/StudentsPage';
import WrongQuestionsPage from './pages/WrongQuestionsPage';
import { Permission, ROLE_LABELS, can, defaultHomePath } from './permissions';
import './shell.css';
import { userLabel } from './utils/userLabel';

const { useBreakpoint } = Grid;

const SIDER_COLLAPSED_KEY = 'righton.sider-collapsed';

const MENU_ITEMS: { key: string; label: string; icon: ReactNode; permission?: string }[] = [
  { key: 'wrong-questions', label: '题库管理', icon: <FileSearchOutlined />, permission: Permission.QUESTION_VIEW },
  { key: 'question-entry', label: '录入题目', icon: <FormOutlined />, permission: Permission.QUESTION_CREATE },
  { key: 'admin-assignments', label: '任务管理', icon: <ProjectOutlined />, permission: Permission.ASSIGNMENT_MANAGE },
  { key: 'my-assignments', label: '我的任务', icon: <CarryOutOutlined />, permission: Permission.ASSIGNMENT_TAKE },
  { key: 'my-weakness', label: '我的短板', icon: <AimOutlined />, permission: Permission.ASSIGNMENT_TAKE },
  { key: 'students', label: '我的学生', icon: <IdcardOutlined />, permission: Permission.PRACTICE_VIEW },
  { key: 'practice-records', label: '练习记录', icon: <HistoryOutlined />, permission: Permission.PRACTICE_VIEW },
  { key: 'recycle-bin', label: '回收站', icon: <DeleteOutlined />, permission: Permission.QUESTION_RESTORE },
  { key: 'admin-users', label: '用户管理', icon: <TeamOutlined />, permission: Permission.USER_VIEW },
  { key: 'activity-logs', label: '行为列表', icon: <AuditOutlined />, permission: Permission.AUDIT_VIEW },
  { key: 'help', label: '帮助中心', icon: <QuestionCircleOutlined /> },
];

function readSiderCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDER_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeSiderCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem(SIDER_COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {
    /* ignore quota / private mode */
  }
}

function initialLetter(name: string): string {
  const ch = name.trim().charAt(0);
  return ch ? ch.toUpperCase() : '?';
}

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const screens = useBreakpoint();
  const isMobile = screens.md === false;
  const [authChecking, setAuthChecking] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [username, setUsername] = useState<string>('');
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [userId, setUserId] = useState<number | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [isActive, setIsActive] = useState(true);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [organizationName, setOrganizationName] = useState<string | null>(null);
  const [organizationId, setOrganizationId] = useState<number | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [canViewQuestionBank, setCanViewQuestionBank] = useState(false);
  const [bankRequestStatus, setBankRequestStatus] = useState<ClaimRequestStatus | null>(null);
  const [siderCollapsed, setSiderCollapsed] = useState(readSiderCollapsed);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  function applyUser(user: MeResponse) {
    setAuthed(true);
    setUsername(user.username);
    setDisplayName(user.display_name?.trim() || null);
    setUserId(user.id);
    setRole(user.role);
    setIsActive(user.is_active);
    setAvatarUrl(user.avatar_url || null);
    setOrganizationName(user.organization_name?.trim() || null);
    setOrganizationId(user.organization_id ?? null);
    setPermissions(user.permissions || []);
    setCanViewQuestionBank(Boolean(user.can_view_question_bank) || user.role === 'superadmin');
    setBankRequestStatus(user.bank_request_status || null);
  }

  function clearSession() {
    setAuthed(false);
    setUsername('');
    setDisplayName(null);
    setUserId(null);
    setRole(null);
    setIsActive(true);
    setAvatarUrl(null);
    setOrganizationName(null);
    setOrganizationId(null);
    setPermissions([]);
    setCanViewQuestionBank(false);
    setBankRequestStatus(null);
  }

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      setAuthed(false);
      setAuthChecking(false);
      return;
    }
    me()
      .then((user) => {
        applyUser(user);
      })
      .catch(() => {
        clearAccessToken();
        clearSession();
      })
      .finally(() => {
        setAuthChecking(false);
      });
  }, []);

  useEffect(() => {
    if (!authChecking && !authed && !location.pathname.startsWith('/login')) {
      const next = `${location.pathname}${location.search}`;
      navigate(`/login?next=${encodeURIComponent(next)}`, { replace: true });
    }
  }, [authChecking, authed, location.pathname, location.search, navigate]);

  const authedRef = useRef(authed);
  const usernameRef = useRef(username);
  authedRef.current = authed;
  usernameRef.current = username;

  useEffect(() => {
    const applySharedAuth = (token: string | null) => {
      if (!token) {
        if (!authedRef.current && window.location.pathname.startsWith('/login')) {
          return;
        }
        clearSession();
        if (!window.location.pathname.startsWith('/login')) {
          navigate('/login', { replace: true });
        }
        return;
      }
      const nextUser = getTokenUsername(token);
      if (!authedRef.current || (nextUser && nextUser !== usernameRef.current)) {
        window.location.reload();
      }
    };

    const onFocus = () => applySharedAuth(getAccessToken());
    const unsubscribe = subscribeAuthTokenChange(applySharedAuth);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      unsubscribe();
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [navigate]);

  const visibleMenu = useMemo(
    () =>
      MENU_ITEMS.filter((item) => !item.permission || can(permissions, item.permission)).map((item) =>
        item.key === "students" && role !== "teacher" ? { ...item, label: "学生" } : item,
      ),
    [permissions, role],
  );

  const selectedKey = useMemo(() => {
    const matched = MENU_ITEMS.find((item) => location.pathname.startsWith(`/${item.key}`));
    return matched?.key ?? '';
  }, [location.pathname]);

  const homePath = useMemo(() => defaultHomePath(permissions), [permissions]);

  function handleLogout() {
    setAccountMenuOpen(false);
    clearAccessToken();
    clearSession();
    navigate('/login', { replace: true });
  }

  function handleNavClick(key: string) {
    navigate(`/${key}`);
    setDrawerOpen(false);
  }

  function handleSiderCollapse(next: boolean) {
    setSiderCollapsed(next);
    writeSiderCollapsed(next);
  }

  function goAccount(path: string) {
    setAccountMenuOpen(false);
    setDrawerOpen(false);
    navigate(path);
  }

  if (authChecking) return null;

  if (!authed) {
    const next = `${location.pathname}${location.search}`;
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="*"
          element={
            <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />
          }
        />
      </Routes>
    );
  }

  const nav = (
    <nav className="shell-nav">
      {visibleMenu.map((item) => {
        const active = selectedKey === item.key;
        const button = (
          <button
            key={item.key}
            type="button"
            className={`shell-nav-item${active ? ' is-active' : ''}`}
            onClick={() => handleNavClick(item.key)}
          >
            <span className="shell-nav-icon">{item.icon}</span>
            {(!siderCollapsed || isMobile) && <span className="shell-nav-label">{item.label}</span>}
          </button>
        );
        if (siderCollapsed && !isMobile) {
          return (
            <Tooltip key={item.key} title={item.label} placement="right">
              {button}
            </Tooltip>
          );
        }
        return button;
      })}
    </nav>
  );

  const shownName = userLabel({ display_name: displayName, username });

  const accountPanel = (
    <div className="shell-account-panel">
      <div className="shell-account-head">
        <span className="shell-avatar is-lg">
          {avatarUrl ? <img src={avatarUrl} alt="" /> : initialLetter(shownName)}
        </span>
        <div>
          <div className="shell-account-name">{shownName}</div>
          <div className="shell-account-role">
            {role ? ROLE_LABELS[role] : ''}
            {organizationName ? ` · ${organizationName}` : ''}
          </div>
        </div>
      </div>
      <div className="shell-account-divider" />
      <button type="button" className="shell-account-item" onClick={() => goAccount('/account')}>
        <UserOutlined />
        用户信息
      </button>
      <button type="button" className="shell-account-item" onClick={() => goAccount('/account/password')}>
        <LockOutlined />
        修改密码
      </button>
      <div className="shell-account-divider" />
      <button type="button" className="shell-account-item is-danger" onClick={handleLogout}>
        <LogoutOutlined />
        退出登录
      </button>
    </div>
  );

  const routes = (
    <Routes>
      <Route path="/" element={<Navigate to={homePath} replace />} />
      <Route
        path="/account"
        element={<AccountPage />}
      >
        <Route
          index
          element={
            <AccountProfilePage
              username={username}
              displayName={displayName}
              role={role}
              isActive={isActive}
              avatarUrl={avatarUrl}
              organizationName={organizationName}
              onUpdated={applyUser}
            />
          }
        />
        <Route path="password" element={<AccountPasswordPage />} />
      </Route>
      <Route
        path="/wrong-questions"
        element={
          <RequirePermission permissions={permissions} code={Permission.QUESTION_VIEW} fallback={homePath}>
            <WrongQuestionsPage
              currentUserId={userId}
              currentRole={role}
              organizationId={organizationId}
              canViewQuestionBank={canViewQuestionBank}
              bankRequestStatus={bankRequestStatus}
              onBankAccessChange={(next) => {
                setCanViewQuestionBank(next.canViewQuestionBank);
                setBankRequestStatus(next.bankRequestStatus);
              }}
            />
          </RequirePermission>
        }
      />
      <Route
        path="/question-entry"
        element={
          <RequirePermission permissions={permissions} code={Permission.QUESTION_CREATE} fallback={homePath}>
            <QuestionEntryPage />
          </RequirePermission>
        }
      />
      <Route
        path="/admin-assignments"
        element={
          <RequirePermission permissions={permissions} code={Permission.ASSIGNMENT_MANAGE} fallback={homePath}>
            <AdminAssignmentsPage
              currentUserId={userId}
              currentRole={role}
              canViewQuestionBank={canViewQuestionBank}
            />
          </RequirePermission>
        }
      />
      <Route
        path="/my-assignments"
        element={
          <RequirePermission permissions={permissions} code={Permission.ASSIGNMENT_TAKE} fallback={homePath}>
            <LearnerAssignmentsPage />
          </RequirePermission>
        }
      />
      <Route
        path="/my-weakness"
        element={
          <RequirePermission permissions={permissions} code={Permission.ASSIGNMENT_TAKE} fallback={homePath}>
            <MyWeaknessPage />
          </RequirePermission>
        }
      />
      <Route
        path="/students"
        element={
          <RequirePermission permissions={permissions} code={Permission.PRACTICE_VIEW} fallback={homePath}>
            <StudentsPage currentRole={role} />
          </RequirePermission>
        }
      />
      <Route
        path="/students/:userId"
        element={
          <RequirePermission permissions={permissions} code={Permission.PRACTICE_VIEW} fallback={homePath}>
            <StudentPortraitPage />
          </RequirePermission>
        }
      />
      <Route
        path="/learn/assignments/:assignmentId"
        element={<AssignmentEntryRoute permissions={permissions} />}
      />
      <Route
        path="/practice-records"
        element={
          <RequirePermission permissions={permissions} code={Permission.PRACTICE_VIEW} fallback={homePath}>
            <PracticeRecordsPage />
          </RequirePermission>
        }
      />
      <Route
        path="/recycle-bin"
        element={
          <RequirePermission permissions={permissions} code={Permission.QUESTION_RESTORE} fallback={homePath}>
            <RecycleBinPage />
          </RequirePermission>
        }
      />
      <Route
        path="/admin-users"
        element={
          <RequirePermission permissions={permissions} code={Permission.USER_VIEW} fallback={homePath}>
            <AdminUsersPage currentRole={role} currentUserId={userId} />
          </RequirePermission>
        }
      />
      <Route
        path="/activity-logs"
        element={
          <RequirePermission permissions={permissions} code={Permission.AUDIT_VIEW} fallback={homePath}>
            <ActivityLogsPage />
          </RequirePermission>
        }
      />
      <Route path="/help" element={<HelpPage />} />
      <Route path="*" element={<Navigate to={homePath} replace />} />
    </Routes>
  );

  return (
    <div className="shell">
      <header className="shell-header">
        <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
          {isMobile && (
            <button type="button" className="shell-menu-btn" onClick={() => setDrawerOpen(true)} aria-label="打开目录">
              <MenuOutlined />
            </button>
          )}
          <button type="button" className="shell-brand" onClick={() => navigate(homePath)}>
            <AppLogo size={28} id="header-app" />
            <span className="shell-brand-mark">RightOn</span>
          </button>
        </div>
        <Dropdown
          trigger={['click']}
          placement="bottomRight"
          open={accountMenuOpen}
          onOpenChange={setAccountMenuOpen}
          destroyOnHidden
          popupRender={() => accountPanel}
        >
          <button
            type="button"
            className={`shell-account-chip${accountMenuOpen ? ' is-open' : ''}`}
            aria-label="账号菜单"
          >
            <span className="shell-avatar">
              {avatarUrl ? <img src={avatarUrl} alt="" /> : initialLetter(shownName)}
            </span>
            <span className="shell-account-meta">
              <span className="shell-account-chip-name">{shownName}</span>
              {role ? <span className="shell-account-chip-role">{ROLE_LABELS[role]}</span> : null}
            </span>
            <DownOutlined className="shell-account-caret" />
          </button>
        </Dropdown>
      </header>
      <div className="shell-body">
        {!isMobile && (
          <aside className={`shell-sider${siderCollapsed ? ' is-collapsed' : ''}`}>
            <div className="shell-sider-inner">{nav}</div>
            {siderCollapsed ? (
              <Tooltip title="展开目录" placement="right">
                <button
                  type="button"
                  className="shell-collapse"
                  onClick={() => handleSiderCollapse(false)}
                  aria-label="展开目录"
                >
                  <span className="shell-nav-icon">
                    <MenuUnfoldOutlined />
                  </span>
                </button>
              </Tooltip>
            ) : (
              <button
                type="button"
                className="shell-collapse"
                onClick={() => handleSiderCollapse(true)}
                aria-label="收起目录"
              >
                <span className="shell-nav-icon">
                  <MenuFoldOutlined />
                </span>
                <span className="shell-nav-label">收起</span>
              </button>
            )}
          </aside>
        )}
        <main className="shell-main">{routes}</main>
      </div>
      {isMobile && (
        <Drawer
          title="目录"
          placement="left"
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          size={228}
          className="shell-drawer"
          styles={{ body: { padding: 0 } }}
        >
          <div className="shell-sider-inner">{nav}</div>
        </Drawer>
      )}
    </div>
  );
}

function RequirePermission({
  permissions,
  code,
  fallback,
  children,
}: {
  permissions: string[];
  code: string;
  fallback: string;
  children: ReactNode;
}) {
  if (!can(permissions, code)) {
    return <Navigate to={fallback} replace />;
  }
  return children;
}

function AssignmentEntryRoute({ permissions }: { permissions: string[] }) {
  const params = useParams();
  const assignmentId = Number(params.assignmentId);
  if (!Number.isFinite(assignmentId) || assignmentId <= 0) {
    return <Navigate to="/my-assignments" replace />;
  }
  if (can(permissions, Permission.ASSIGNMENT_TAKE)) {
    return <LearnerAssignmentsPage entryAssignmentId={assignmentId} />;
  }
  return (
    <Result
      status="info"
      title="当前账号没有作答权限"
      subTitle="这份任务链接需要学生账号才能打开。"
      extra={
        <Button
          type="primary"
          onClick={() => {
            clearAccessToken();
            const next = `${window.location.pathname}${window.location.search}`;
            window.location.replace(`/login?next=${encodeURIComponent(next)}`);
          }}
        >
          切换账号登录
        </Button>
      }
    />
  );
}

export default function RootApp() {
  return (
    <AntdApp>
      <App />
    </AntdApp>
  );
}
