# 英语错题系统 V2 PRD（用户前台 + 任务分配 + 判分统计）

## 1. 文档信息

- 文档名称：英语错题系统 V2 PRD
- 文档版本：V2.0
- 文档日期：2026-04-27
- 适用范围：后台管理端（Admin）+ 用户前台（Learner）+ 服务后端（API）

---

## 2. V2 目标

在现有“错题管理后台”的基础上，新增用户侧练习闭环能力，形成：

1. 后台生成练习任务并分配用户
2. 用户前台作答并提交
3. 后端自动判分与统计
4. 题目错率可持续累积，用于后续等级排序和策略分层

---

## 3. 用户角色与边界

## 3.1 Admin（后台管理员）

- 管理错题、分类、用户
- 创建练习任务（可从错题集筛选生成）
- 分配任务给用户（单个/批量）
- 查看任务完成情况与统计报表
- 后台注册前台用户（Learner）

## 3.2 Learner（用户前台）

- 登录并查看“我的任务”
- 进入任务作答
- 提交答案并查看结果/解析
- 查看个人统计（可选）
- 无后台管理权限
- 不支持自助注册（由后台创建账号）

## 3.3 系统职责

- 判分（V2 先支持客观题）
- 统计聚合（用户维度、题目维度、知识点维度）
- 错率沉淀（用于后续排序/分层）
- 前后台路由与权限隔离（RBAC）

---

## 4. 核心业务流程

## 4.1 管理端流程

1. 筛选错题（题型/知识点/错率）
2. 创建练习任务（设置任务名、截止时间、题目集合）
3. 指定分配对象（用户列表）
4. 发布任务

## 4.2 用户端流程

1. 登录前台
2. 进入“我的任务”
3. 打开任务并作答
4. 提交
5. 查看判分结果与错因（基于错题本身属性判定：正确答案、题型、知识点）

## 4.3 数据闭环

1. 用户提交答案 -> `UserAnswer`
2. 系统判分 -> 记录 `is_correct`
3. 更新题目统计（作答次数/错误次数/错率）
4. 更新用户统计（总正确率、按题型/知识点正确率）

---

## 5. 功能需求（V2）

## 5.1 后台管理端（Admin）

- 用户管理（新增/禁用/重置密码，V2 可简版）
  - 新增前台用户（Learner）
  - 仅 Admin 可创建/修改 Learner 账号
- 任务管理
  - 创建任务
  - 编辑任务（发布前）
  - 发布/撤回
  - 查看任务完成率
  - 查看提交记录列表（按任务/用户/提交状态筛选）
  - 查看单用户提交详情（作答明细、判分明细、错因明细）
- 任务分配
  - 按用户分配
  - 批量分配
- 统计看板
  - 任务维度：参与人数、提交率、平均正确率
  - 题目维度：错率 Top N
  - 知识点维度：薄弱点 Top N

## 5.2 用户前台（Learner）

- 登录/退出
- 我的任务列表（未开始、进行中、已完成）
- 任务详情与答题页
- 提交确认页
- 结果页（总分、正确率、错题列表）
- 不具备用户管理、任务管理、统计看板权限

## 5.3 判分与统计引擎（后端）

- 判分规则
  - 客观题：严格匹配（V2）
  - 多空题：按空位匹配
  - 多小题：按小题匹配
- 统计规则
  - 单题错率 = 错误次数 / 作答次数
  - 用户正确率 = 正确题数 / 总作答题数
  - 知识点正确率按题目标签聚合

---

## 6. 数据模型设计（V2）

说明：以下为新增实体。已有 `WrongQuestion`、`KnowledgeTag`、`QuestionType` 继续沿用。

## 6.1 User（用户）

- id
- username（唯一）
- password_hash
- role（admin/learner）
- is_active
- created_by（admin_id，可空；系统初始化管理员为空）
- created_at

## 6.2 Assignment（任务）

- id
- title
- description
- status（draft/published/closed）
- publish_at
- due_at
- created_by（admin_id）
- created_at
- updated_at

## 6.3 AssignmentQuestion（任务题目）

- id
- assignment_id
- wrong_question_id
- question_order
- snapshot（JSON，可选：题目快照，防止原题被改影响历史任务）

## 6.4 UserAssignment（用户任务关系）

- id
- assignment_id
- user_id
- status（assigned/in_progress/submitted/graded）
- started_at
- submitted_at
- score（可选）
- accuracy_rate（可选）

## 6.5 UserAnswer（用户作答）

- id
- assignment_id
- user_id
- wrong_question_id
- user_answer（JSON）
- standard_answer（JSON，可选快照）
- is_correct
- answered_at

## 6.6 QuestionStats（题目统计，可选物化）

- wrong_question_id（唯一）
- total_attempts
- wrong_attempts
- wrong_rate
- updated_at

---

## 7. API 设计清单（V2）

## 7.1 认证

- `POST /api/v1/auth/login`
- `GET /api/v1/auth/me`
- 后台前端入口：仅 `role=admin` 可访问管理端路由
- 用户前台入口：`role=learner` 访问用户侧路由

## 7.2 管理端 - 用户

- `GET /api/v1/admin/users`
- `POST /api/v1/admin/users`（创建前台用户 learner）
- `PUT /api/v1/admin/users/{id}`
- `POST /api/v1/admin/users/{id}/reset-password`

## 7.3 管理端 - 任务

- `POST /api/v1/admin/assignments`
- `GET /api/v1/admin/assignments`
- `GET /api/v1/admin/assignments/{id}`
- `PUT /api/v1/admin/assignments/{id}`
- `POST /api/v1/admin/assignments/{id}/publish`
- `POST /api/v1/admin/assignments/{id}/close`

## 7.4 管理端 - 分配

- `POST /api/v1/admin/assignments/{id}/assign-users`
- `GET /api/v1/admin/assignments/{id}/users`
- `GET /api/v1/admin/assignments/{id}/submissions`（任务下提交记录列表）
- `GET /api/v1/admin/assignments/{id}/submissions/{userId}`（指定用户提交详情）

## 7.5 用户端 - 我的任务

- `GET /api/v1/me/assignments`
- `GET /api/v1/me/assignments/{id}`
- `POST /api/v1/me/assignments/{id}/start`
- `POST /api/v1/me/assignments/{id}/submit`

## 7.6 用户端 - 作答

- `POST /api/v1/me/assignments/{id}/answers`（单题提交，可多次）
- `PUT /api/v1/me/assignments/{id}/answers/{answerId}`（提交前可修改）

## 7.7 统计

- `GET /api/v1/admin/stats/overview`
- `GET /api/v1/admin/stats/question-wrong-rate`
- `GET /api/v1/admin/stats/knowledge-accuracy`
- `GET /api/v1/me/stats`

---

## 8. 判分规则细节（V2）

## 8.1 普通单选/多选

- 规则：答案集合完全匹配记对，否则记错

## 8.2 多空题（语法填空）

- 规则：按空位逐个比较
- 可输出：
  - 全对/全错
  - 按空位正确率（为 V3 预留）

## 8.3 多小题（完形/阅读）

- 规则：按小题位序比较
- V2 判分结果先落地到整题 `is_correct`，同时可记录 `detail` JSON

---

## 9. 统计指标定义

## 9.1 用户维度

- assignment_accuracy_rate
- total_answered
- correct_count
- wrong_count

## 9.2 题目维度

- total_attempts
- wrong_attempts
- wrong_rate

## 9.3 知识点维度

- total_attempts
- correct_attempts
- accuracy_rate

---

## 10. 非功能要求（V2）

- 权限隔离：Admin 与 Learner 路由严格分离
- 数据审计：关键行为记录日志（发布任务、提交答案）
- 幂等与并发：提交接口防重复提交
- 性能：任务详情加载 P95 < 500ms（100 题以内）

---

## 11. 开发拆解建议（按优先级）

## P0（先跑通闭环）

1. 用户模型与登录鉴权
2. Assignment / UserAssignment / UserAnswer 基础表
3. Admin 任务创建 + 分配
4. Learner 我的任务 + 提交答案
5. 自动判分 + 基础结果页

## P1（可运营）

1. 管理端任务统计看板
2. 题目错率榜单
3. 知识点薄弱榜单
4. 回收站与任务联动细节（防止误删影响任务）

## P2（优化）

1. 分层出题策略（按错率/难度）
2. 排名与等级体系
3. 自适应推荐练习

---

## 12. 风险与待确认

1. 判分是否允许近似匹配（拼写容错）？
2. 任务中的题目是否采用快照冻结？
3. 用户是否允许重复提交同一任务？
4. 统计是实时算还是异步聚合？
5. 是否需要班级/组织维度？

---

## 13. 下一步建议（立刻可执行）

1. 先冻结 V2 数据模型
2. 按 P0 输出数据库迁移脚本
3. 先实现 Admin“创建并分配任务” + Learner“提交并判分”最小链路
4. 用 1-2 个真实用户做端到端联调
