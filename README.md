# wrong-question-service (FastAPI Scaffold)

基于 PRD 的最小可用后端骨架，定位为：

- Service 内负责 OCR 入库（当前保留接口，便于后续接 OCR 引擎）
- Service 提供错题管理与分类筛选 API

## 1. 快速启动

### 1.0 前置依赖

- Python 3.11+
- Node.js（版本见 `.nvmrc`）
- PostgreSQL 16

**安装 PostgreSQL：**

```bash
# macOS 13+（推荐 Homebrew，有预编译包）
brew install postgresql@16 && brew services start postgresql@16

# macOS 12（Homebrew 需从源码编译，极慢；改用 EDB 安装器）
# 1. 下载 https://www.enterprisedb.com/downloads/postgres-postgresql-downloads
# 2. 运行安装包，默认设置即可
# 3. 安装后将路径加入 shell：
echo 'export PATH="/Library/PostgreSQL/16/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc
```

### 1.1 一键初始化

```bash
make setup      # 安装 Python + Node 依赖
make db-setup   # 启动 PostgreSQL、建库、迁移、导入旧数据（如有）
make dev        # 同时启动后端 + 前端热加载
```

如果 `3001` 端口被占用，可用：

```bash
make run-alt
```

启动后访问：

- Swagger: `http://127.0.0.1:3001/docs`
- Health: `http://127.0.0.1:3001/health`
- Web 管理页（MVP）: `http://127.0.0.1:3001/web/wrong-questions`

### 1.2 Antd 前端（重写版）

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

访问：`http://127.0.0.1:5174`

移动端联调说明（同一局域网）：

- 后端默认监听 `0.0.0.0:3001`（`make run` 即可）。
- 前端默认走同源 `/api`（由 Vite 代理到本机后端），手机用局域网 IP 或域名打开前端即可登录，无需再开 3001 端口给外网。
- 如需直连后端，可在 `frontend/.env` 设置 `VITE_API_BASE_URL=http://<你的电脑IP>:3001` 后重新 build。

## 2. 关键接口

- `POST /api/v1/wrong-questions` 手动新增错题
- `POST /api/v1/wrong-questions/ocr` OCR 结构化入库（V1 脚手架要求传 `extracted`）
- `GET /api/v1/wrong-questions` 错题列表（支持题型/知识点/状态/关键词筛选）
- `GET /api/v1/wrong-questions/recycle-bin` 回收站列表（仅已删除）
- `GET /api/v1/wrong-questions/{id}` 错题详情
- `PUT /api/v1/wrong-questions/{id}` 更新错题
- `DELETE /api/v1/wrong-questions/{id}` 软删除
- `POST /api/v1/wrong-questions/{id}/restore` 从回收站还原

- `GET /api/v1/knowledge-tags`、`POST /api/v1/knowledge-tags`
- `GET /api/v1/question-types`、`POST /api/v1/question-types`

- `GET /api/v1/practice-records` 练习记录列表（支持按错题 ID 过滤）
- `GET /api/v1/practice-stats/wrong-questions` 错题正确率统计
- `GET /api/v1/admin/users` 管理端用户列表（admin）
- `POST /api/v1/admin/users` 管理端创建 learner 用户（admin）
- `POST /api/v1/admin/assignments` 管理端创建任务（admin）
- `GET /api/v1/admin/assignments` 管理端任务列表（admin）
- `GET /api/v1/admin/assignments/{id}` 管理端任务详情（admin）
- `POST /api/v1/admin/assignments/{id}/close` 管理端关闭任务（admin）
- `DELETE /api/v1/admin/assignments/{id}` 管理端删除任务（admin）
- `POST /api/v1/admin/assignments/{id}/assign-users` 任务分配用户（admin）
- `GET /api/v1/admin/assignments/{id}/submissions` 任务提交记录列表（admin）
- `GET /api/v1/admin/assignments/{id}/submissions/{user_id}` 单用户提交详情（admin）
- `GET /api/v1/me/assignments` learner 我的任务列表
- `GET /api/v1/me/assignments/{id}` learner 任务详情
- `POST /api/v1/me/assignments/{id}/answers` learner 保存单题答案
- `POST /api/v1/me/assignments/{id}/submit` learner 提交任务并自动判分

## 2.1 MVP 管理界面

- `GET /web/wrong-questions` 错题列表页（支持关键词/题型/知识点/复习状态筛选）
- `GET /web/wrong-questions/{id}` 错题详情页（含该题正确率与最近 10 条练习记录）
- `GET /web/wrong-questions/new` 手动新增错题页
- `GET /web/practice-records` 练习记录与正确率统计页

## 3. 后台账号认证

- 后台 API（错题、分类、练习、回收站）需先登录获取 JWT：
- 角色（RBAC 预设）：
  - `superadmin`：超管，题库/任务/用户管理，可创建超管、教师、学生
  - `teacher`：教师，题库与任务管理，只能创建学生
  - `student`：学生，仅可作答自己的任务
  - 接口按权限码校验（如 `question.view`、`assignment.take`），`GET /api/v1/auth/me` 会返回 `permissions`
  - 旧账号会自动迁移：`admin` → `superadmin`，`learner` → `student`
  - `POST /api/v1/auth/login`
  - `GET /api/v1/auth/me`
  - `POST /api/v1/auth/change-password` 修改当前用户密码（需当前密码；用户名不可改）
- 前端顶栏「修改密码」可改密码；管理台会自动跳转登录页。
- 默认管理员账号（可在 `.env` 修改）：
  - `ADMIN_USERNAME=admin`
  - `ADMIN_PASSWORD=admin123`

## 4. 数据库

开发环境使用本机 PostgreSQL 16，表结构由 Alembic 管理。

```bash
# 首次：安装/启动 Postgres、建库、执行迁移
make db-setup

# 之后改了 models.py：
alembic revision --autogenerate -m "说明"
# 检查 alembic/versions 下的新文件后再：
make db-migrate
```

- 连接串写在 `.env` 的 `DATABASE_URL`，格式：`postgresql+psycopg://用户名:密码@127.0.0.1:5432/wrong_questions`
- 应用启动时会自动执行 `alembic upgrade head`，并幂等写入题型/知识点/默认管理员
- 生产环境同样使用 PostgreSQL，需确保 `DATABASE_URL` 指向生产库

## 4.1 生产部署

```bash
# .env 中配置生产数据库
DATABASE_URL=postgresql+psycopg://user:pass@prod-host:5432/wrong_questions

make prod           # 后台常驻启动（PID 在 .run/，日志在 .logs/）
make prod-stop      # 停止
# 前台调试：./scripts/start-prod.sh --foreground
```

## 5. 后续建议

- 接入真实 OCR 引擎（替换 `/wrong-questions/ocr` 里的 TODO 逻辑）
- 补充单元测试与接口测试
- 为练习记录增加按时间范围/题型的聚合统计

## 6. 迭代差距文档

- `MVP_GAP.md`：记录 MVP 与最终版 gap、优先级与迭代路线
