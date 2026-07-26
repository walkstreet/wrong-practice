import {
  App as AntdApp,
  Button,
  Grid,
  Layout,
  Menu,
  Result,
  Space,
  Typography,
} from 'antd';
import { useEffect, useMemo, useState } from 'react';
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import { me } from './api';
import { clearAccessToken, getAccessToken } from './auth';
import AccountSettingsModal from './components/AccountSettingsModal';
import type { UserRole } from './types';
import AdminAssignmentsPage from './pages/AdminAssignmentsPage';
import AdminUsersPage from './pages/AdminUsersPage';
import LearnerAssignmentsPage from './pages/LearnerAssignmentsPage';
import LoginPage from './pages/LoginPage';
import PracticeRecordsPage from './pages/PracticeRecordsPage';
import QuestionEntryPage from './pages/QuestionEntryPage';
import RecycleBinPage from './pages/RecycleBinPage';
import WrongQuestionsPage from './pages/WrongQuestionsPage';

const { Header, Content } = Layout;
const { Title } = Typography;
const { useBreakpoint } = Grid;

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const screens = useBreakpoint();
  const [authChecking, setAuthChecking] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [username, setUsername] = useState<string>('');
  const [role, setRole] = useState<UserRole | null>(null);
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
        setRole(user.role);
      })
      .catch(() => {
        clearAccessToken();
        setAuthed(false);
        setRole(null);
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

  const selectedKeys = useMemo(() => {
    if (location.pathname.startsWith('/my-assignments'))
      return ['my-assignments'];
    if (location.pathname.startsWith('/admin-assignments'))
      return ['admin-assignments'];
    if (location.pathname.startsWith('/practice-records'))
      return ['practice-records'];
    if (location.pathname.startsWith('/recycle-bin')) return ['recycle-bin'];
    if (location.pathname.startsWith('/admin-users')) return ['admin-users'];
    if (location.pathname.startsWith('/question-entry')) return ['question-entry'];
    return ['wrong-questions'];
  }, [location.pathname]);

  function handleLogout() {
    clearAccessToken();
    setAuthed(false);
    setUsername('');
    setRole(null);
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

  if (role === 'learner') {
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
          <Title level={4} style={{ color: '#fff', margin: 0 }}>
            学习端
          </Title>
          <Space wrap>
            <Menu
              theme="dark"
              mode="horizontal"
              selectedKeys={selectedKeys}
              items={[{ key: 'my-assignments', label: '我的任务' }]}
              onClick={({ key }) => navigate(`/${key}`)}
              style={{ minWidth: screens.md ? 160 : 120 }}
            />
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
            <Route
              path="/"
              element={<Navigate to="/my-assignments" replace />}
            />
            <Route
              path="/my-assignments"
              element={<LearnerAssignmentsPage />}
            />
            <Route
              path="/learn/assignments/:assignmentId"
              element={<LearnerAssignmentEntryRoute />}
            />
            <Route
              path="*"
              element={<Navigate to="/my-assignments" replace />}
            />
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

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Title level={4} style={{ color: '#fff', margin: 0 }}>
          英语错题管理
        </Title>
        <Space>
          <Menu
            theme="dark"
            mode="horizontal"
            selectedKeys={selectedKeys}
            items={[
              { key: 'wrong-questions', label: '错题列表' },
              { key: 'question-entry', label: '录入题目' },
              { key: 'admin-assignments', label: '任务管理' },
              { key: 'practice-records', label: '练习记录' },
              { key: 'recycle-bin', label: '回收站' },
              { key: 'admin-users', label: '用户管理' },
            ]}
            onClick={({ key }) => navigate(`/${key}`)}
            style={{ minWidth: 640 }}
          />
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
          <Route
            path="/"
            element={<Navigate to="/wrong-questions" replace />}
          />
          <Route path="/wrong-questions" element={<WrongQuestionsPage />} />
          <Route path="/question-entry" element={<QuestionEntryPage />} />
          <Route path="/admin-assignments" element={<AdminAssignmentsPage />} />
          <Route path="/practice-records" element={<PracticeRecordsPage />} />
          <Route path="/recycle-bin" element={<RecycleBinPage />} />
          <Route path="/admin-users" element={<AdminUsersPage />} />
          <Route
            path="/learn/assignments/:assignmentId"
            element={<AdminLearnerLinkHint />}
          />
          <Route
            path="*"
            element={<Navigate to="/wrong-questions" replace />}
          />
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

function LearnerAssignmentEntryRoute() {
  const params = useParams();
  const assignmentId = Number(params.assignmentId);
  if (!Number.isFinite(assignmentId) || assignmentId <= 0) {
    return <Navigate to="/my-assignments" replace />;
  }
  return <LearnerAssignmentsPage entryAssignmentId={assignmentId} />;
}

function AdminLearnerLinkHint() {
  const location = useLocation();
  const next = `${location.pathname}${location.search}`;
  return (
    <Result
      status="info"
      title="当前登录账号是 admin"
      subTitle="该任务链接仅 learner 可访问。请切换账号后继续。"
      extra={
        <Button
          type="primary"
          onClick={() => {
            clearAccessToken();
            window.location.replace(`/login?next=${encodeURIComponent(next)}`);
          }}
        >
          切换为 learner 登录
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
