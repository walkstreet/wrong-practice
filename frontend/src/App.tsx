import {
  App as AntdApp,
  Button,
  Grid,
  Layout,
  Menu,
  Result,
  Space,
} from 'antd';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import { me } from './api';
import {
  clearAccessToken,
  getAccessToken,
  getTokenUsername,
  subscribeAuthTokenChange,
} from './auth';
import AccountSettingsModal from './components/AccountSettingsModal';
import AppLogo from './components/AppLogo';
import type { ClaimRequestStatus, UserRole } from './types';
import ActivityLogsPage from './pages/ActivityLogsPage';
import AdminAssignmentsPage from './pages/AdminAssignmentsPage';
import AdminUsersPage from './pages/AdminUsersPage';
import LearnerAssignmentsPage from './pages/LearnerAssignmentsPage';
import LoginPage from './pages/LoginPage';
import PracticeRecordsPage from './pages/PracticeRecordsPage';
import QuestionEntryPage from './pages/QuestionEntryPage';
import RecycleBinPage from './pages/RecycleBinPage';
import WrongQuestionsPage from './pages/WrongQuestionsPage';
import { Permission, can, defaultHomePath } from './permissions';

const { Header, Content } = Layout;
const { useBreakpoint } = Grid;

const MENU_ITEMS = [
  { key: 'wrong-questions', label: '错题列表', permission: Permission.QUESTION_VIEW },
  { key: 'question-entry', label: '录入题目', permission: Permission.QUESTION_CREATE },
  { key: 'admin-assignments', label: '任务管理', permission: Permission.ASSIGNMENT_MANAGE },
  { key: 'my-assignments', label: '我的任务', permission: Permission.ASSIGNMENT_TAKE },
  { key: 'practice-records', label: '练习记录', permission: Permission.PRACTICE_VIEW },
  { key: 'recycle-bin', label: '回收站', permission: Permission.QUESTION_RESTORE },
  { key: 'admin-users', label: '用户管理', permission: Permission.USER_VIEW },
  { key: 'activity-logs', label: '行为列表', permission: Permission.AUDIT_VIEW },
];

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const screens = useBreakpoint();
  const [authChecking, setAuthChecking] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [username, setUsername] = useState<string>('');
  const [userId, setUserId] = useState<number | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [canViewQuestionBank, setCanViewQuestionBank] = useState(false);
  const [bankRequestStatus, setBankRequestStatus] = useState<ClaimRequestStatus | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      setAuthed(false);
      setAuthChecking(false);
      return;
    }
    me()
      .then((user) => {
        setAuthed(true);
        setUsername(user.username);
        setUserId(user.id);
        setRole(user.role);
        setPermissions(user.permissions || []);
        setCanViewQuestionBank(Boolean(user.can_view_question_bank) || user.role === 'superadmin');
        setBankRequestStatus(user.bank_request_status || null);
      })
      .catch(() => {
        clearAccessToken();
        setAuthed(false);
        setUserId(null);
        setRole(null);
        setPermissions([]);
        setCanViewQuestionBank(false);
        setBankRequestStatus(null);
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
        setAuthed(false);
        setUsername('');
        setUserId(null);
        setRole(null);
        setPermissions([]);
        setCanViewQuestionBank(false);
        setBankRequestStatus(null);
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
    () => MENU_ITEMS.filter((item) => can(permissions, item.permission)),
    [permissions],
  );

  const selectedKeys = useMemo(() => {
    const matched = MENU_ITEMS.find((item) => location.pathname.startsWith(`/${item.key}`));
    return matched ? [matched.key] : [];
  }, [location.pathname]);

  const homePath = useMemo(() => defaultHomePath(permissions), [permissions]);

  function handleLogout() {
    clearAccessToken();
    setAuthed(false);
    setUsername('');
    setUserId(null);
    setRole(null);
    setPermissions([]);
    setCanViewQuestionBank(false);
    setBankRequestStatus(null);
    navigate('/login', { replace: true });
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

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header
        style={{
          display: 'flex',
          alignItems: screens.md ? 'center' : 'flex-start',
          justifyContent: 'space-between',
          flexDirection: screens.md ? 'row' : 'column',
          gap: screens.md ? 0 : 8,
          height: screens.md ? 64 : 'auto',
          paddingTop: screens.md ? 0 : 8,
          paddingBottom: screens.md ? 0 : 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <AppLogo size={28} id="header-app" />
          <span style={{ color: '#fff', fontFamily: "'Righteous', cursive", fontSize: 18, letterSpacing: 1, lineHeight: 1 }}>RightOn</span>
        </div>
        <Space wrap>
          {visibleMenu.length > 0 && (
            <Menu
              theme="dark"
              mode="horizontal"
              selectedKeys={selectedKeys}
              items={visibleMenu.map(({ key, label }) => ({ key, label }))}
              onClick={({ key }) => navigate(`/${key}`)}
              style={{ minWidth: screens.md ? Math.min(160 + visibleMenu.length * 80, 720) : 120 }}
            />
          )}
          <span style={{ color: '#fff' }}>{username}</span>
          <Button size="small" onClick={() => setAccountOpen(true)}>
            修改密码
          </Button>
          <Button size="small" onClick={handleLogout}>
            退出
          </Button>
        </Space>
      </Header>
      <Content style={{ padding: 24 }}>
        <Routes>
          <Route path="/" element={<Navigate to={homePath} replace />} />
          <Route
            path="/wrong-questions"
            element={
              <RequirePermission permissions={permissions} code={Permission.QUESTION_VIEW} fallback={homePath}>
                <WrongQuestionsPage
                  currentUserId={userId}
                  currentRole={role}
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
                <AdminAssignmentsPage />
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
          <Route path="*" element={<Navigate to={homePath} replace />} />
        </Routes>
      </Content>
      <AccountSettingsModal
        open={accountOpen}
        currentUsername={username}
        onClose={() => setAccountOpen(false)}
      />
    </Layout>
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
