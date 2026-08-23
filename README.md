# wrong-question-service (FastAPI Scaffold)

基于 PRD 的最小可用后端骨架，定位为：

- Service 内负责 OCR 入库（当前保留接口，便于后续接 OCR 引擎）
- Service 提供错题管理与分类筛选 API
- Dify 读取 Service 的错题数据进行出题，并可回写练习结果

## 1. 快速启动

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --host 0.0.0.0 --port 3001
```

或使用一键命令：

```bash
make run
```

如果 `3001` 端口被占用，可用：

```bash
make run-alt
```

启动后访问：

- Swagger: `http://127.0.0.1:3001/docs`
- Health: `http://127.0.0.1:3001/health`
- Web 管理页（MVP）: `http://127.0.0.1:3001/web/wrong-questions`

## 1.1 Antd 前端（重写版）

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

- `GET /api/v1/integrations/dify/wrong-questions` Dify 拉取错题（需 `X-API-Key`）
- `GET /api/v1/integrations/dify/wrong-questions/{id}` Dify 拉取详情（需 `X-API-Key`）
- `POST /api/v1/integrations/dify/wrong-questions/batch` Dify 批量录入错题列表（需 `X-API-Key`）
- `POST /api/v1/integrations/dify/practice-records` Dify 回写练习结果（需 `X-API-Key`）
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

### 2.2 Dify 批量录入字段规范（支持完形/阅读/语法填空）

- `options` 支持三种格式：
  - 单题单组选项：`["A.xxx", "B.xxx", "C.xxx", "D.xxx"]`
  - 多组选项（完形/阅读多小题）：`[["A1","B1","C1","D1"], ["A2","B2","C2","D2"]]`
  - 无选项（语法填空等）：`[]`
- `correct_answer` / `wrong_answer` 支持：
  - 简单答案：`["B"]`
  - 多题/多空答案：`["B", "A", "D"]` 或 `[["B"],["A"],["D"]]`
  - 某空暂时未知：可用 `null` 占位，例如 `["has", null, "to"]`（与 `wrong_answer` 规则一致）

**多空填空（录入与判分格式）**

- `options` 一般为 `[]`。
- `correct_answer`：按 **从左到右、从上到下的空格顺序**，用 **字符串一维数组** 表示，有几个空就几个元素。  
  例：三个空 → `["has", "been", "to"]`。
- `wrong_answer`：与 `correct_answer` **长度相同、位置一一对应**（同一题里老师录入的“错答样本”）。
- Learner 作答：**留空不填** 的位置在提交时会按 **`null`** 保存（不必在 JSON 里写 `null` 关键字）；用 JSON 数组时某一格可用空字符串 `""` 表示留空。

**判分标准化（跨题型统一）**

- 提交与标答都先做标准化再比较：字符串 `trim`、单元素嵌套数组自动展开（如 `[["A"]] -> ["A"]`）。
- 选择题选项支持文本归一：如 `"A.xxx"`、`"A)"`、`"A"` 都按 `"A"` 判定。
- 平铺选择题按**无序集合**比较（兼容多选）；分组小题/填空题按**位置有序**比较。
- 因此推荐前后端统一用 `user_answer: list[AnswerItem]`（`string | string[] | null`）承载作答，避免按题型分裂多套字段。

示例（语法填空）：

```json
{
  "items": [
    {
      "stem": "阅读短文并在空格处填入适当单词",
      "options": [],
      "correct_answer": ["has", "been", "to"],
      "wrong_answer": ["have", "is", "for"],
      "question_type_id": 3,
      "knowledge_tag_ids": [1, 8],
      "source": "mock-paper",
      "ingest_source": "ocr"
    }
  ]
}
```

示例（完形/阅读多小题）：

```json
{
  "items": [
    {
      "stem": "完形填空（含3个小题）",
      "options": [
        ["A.run", "B.runs", "C.ran", "D.running"],
        ["A.at", "B.on", "C.in", "D.for"],
        ["A.him", "B.he", "C.his", "D.himself"]
      ],
      "correct_answer": ["C", "C", "A"],
      "wrong_answer": ["B", "B", "D"],
      "question_type_id": 4,
      "knowledge_tag_ids": [2, 10],
      "source": "school-exam",
      "ingest_source": "ocr"
    }
  ]
}
```

### 2.3 Dify Prompt 模板建议（可直接改造）

请在 Dify 的结构化输出 prompt 中增加以下规则：

1. 对于语法填空题：
   - `options` 固定输出 `[]`
   - `correct_answer` 输出每个空对应答案列表（按空序）
2. 对于完形填空/阅读多小题：
   - `options` 输出为二维数组，每个小题一组
   - `correct_answer` 和 `wrong_answer` 与小题顺序一一对应
3. 对于普通单选题：
   - `options` 输出一维数组
   - `correct_answer`、`wrong_answer` 输出一维数组
4. 确保最终 JSON 可直接用于接口：
   - `POST /api/v1/integrations/dify/wrong-questions/batch`

## 2.1 MVP 管理界面

- `GET /web/wrong-questions` 错题列表页（支持关键词/题型/知识点/复习状态筛选）
- `GET /web/wrong-questions/{id}` 错题详情页（含该题正确率与最近 10 条练习记录）
- `GET /web/wrong-questions/new` 手动新增错题页
- `GET /web/practice-records` 练习记录与正确率统计页

## 3. Dify 鉴权

在请求头传入：

- `X-API-Key: <your-api-key>`

默认 key 在 `.env.example` 中为 `dify-dev-key`，上线请替换。

## 3.1 后台账号认证（新增）

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

- 默认使用 SQLite：`sqlite:///./wrong_questions.db`
- 该文件已在 `.gitignore` 中忽略，不会进 git
- 可通过 `.env` 改为 PostgreSQL URL

部署时建议把数据库放到仓库外，避免 `git pull` / 重新部署覆盖数据：

```bash
export SQLITE_DATA_DIR=../db
# 或者：
export USE_EXTERNAL_DB=1
make prod
# 等价：./scripts/start-prod.sh
```

- `make prod` / `./scripts/start-prod.sh` 默认常驻运行（PID 在 `.run/`，日志在 `.logs/`）；停止：`make prod-stop`
- `USE_EXTERNAL_DB=1`（`start-prod.sh` 默认开启）会把数据目录设为仓库上一级 `db/`
- 若外部目录还没有库文件，启动脚本会把项目内的 `wrong_questions.db` 自动迁移过去
- 开发模式（`make dev` / `scripts/start-dev.sh`）仍固定使用项目内数据库，不受该变量影响
- 若需前台调试：`./scripts/start-prod.sh --foreground`

## 5. 后续建议

- 接入真实 OCR 引擎（替换 `/wrong-questions/ocr` 里的 TODO 逻辑）
- 引入 Alembic 管理迁移
- 补充单元测试与接口测试
- 为练习记录增加按时间范围/题型的聚合统计
- 增加 Alembic 迁移（当前为 MVP 快速迭代，表结构变化由 `create_all` + 兼容逻辑处理）

## 6. 迭代差距文档

- `MVP_GAP.md`：记录 MVP 与最终版 gap、优先级与迭代路线
