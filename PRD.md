# 英语错题管理后台服务 PRD（V1.2）

## 1. 文档信息

- 产品名称：英语错题管理与 Dify 出题集成系统
- 文档版本：V1.2（Service OCR + Dify 出题调整）
- 文档日期：2026-04-19
- 目标形态：后台服务（对外 API）+ 管理界面（Web）
- 当前阶段：需求定义（PRD）

---

## 2. 背景与目标

### 2.1 背景

英语学习中，错题是最有价值的复习素材之一。当前用户通常将错题分散记录在纸笔、截图或多个应用中，导致：

- 错题信息不完整（缺失选项、正确答案、错误选项）
- 后续回顾检索困难（无法按知识点/题型过滤）
- 无法基于错题做针对性练习（相似题训练缺失）

### 2.2 产品目标

构建一个统一的错题管理后台服务，支持在 Service 内完成 OCR 与结构化录入，并提供检索管理、统计分析；相似题出题逻辑由 Dify 负责，Dify 通过读取 Service 数据实现针对性出题。

### 2.3 目标用户

- 主要用户：英语学习者（学生/备考人群）
- 次要用户：教研人员/班主任（可统一查看和组织错题）
- 系统角色：管理员（维护题库、标签与策略）

### 2.4 核心价值

- 结构化沉淀错题资产
- 高效检索与复盘（按知识点、题型、时间、错误类型）
- 基于错题做个性化相似题训练

---

## 3. 需求范围

### 3.1 In Scope（V1）

1. 错题录入与编辑
2. Service 内 OCR 识别与结构化入库
3. 错题列表查询、筛选与详情查看
4. 知识点分类与题型分类管理
5. Dify 读取错题数据并执行相似题生成
6. 基础统计（错题数量、分类分布、近期趋势）
7. 对外 API（供管理端、Dify 工作流和未来移动端调用）

### 3.2 Out of Scope（V1 暂不做）

1. Dify 侧 OCR 引擎能力建设（OCR 不在 Dify 使用）
2. 多学科扩展（仅英语）
3. 复杂学习路径推荐引擎
4. 社区分享与多人协作批注

---

## 4. 业务流程（V1）

### 4.1 错题录入流程

1. 用户在 Service 界面上传题目图片或粘贴文本
2. Service 调用 OCR 能力完成文本识别与字段抽取（题干、选项、正确答案、错误选项等）
3. Service 完成结构化校验、入库与标签关联
4. 错题进入错题库，可继续人工修正

说明：管理端保留“手动新增/编辑”能力，用于修正 OCR 结果或补录。

### 4.2 错题复盘流程

1. 在列表页按条件筛选（题型/知识点/时间）
2. 打开错题详情
3. 查看原错误与正确解答
4. 可标记复习状态（未复习/已复习/已掌握）

### 4.3 相似题训练流程

1. Dify 从 Service 读取错题（按题型/知识点/时间筛选）
2. Dify 基于读取到的错题执行相似题生成
3. 用户在 Dify 侧作答并查看答案解析
4. Dify 可将练习结果回写 Service（V1 可选，建议做）

---

## 5. 功能需求

## 5.1 模块 A：错题管理

### A1 新增错题

- 支持两种录入来源：
  - Service OCR 结构化录入（主入口）
  - 管理端手动录入（补录/修正）
- 必填字段：
  - 题干（stem）
  - 选项（options，至少 2 个，最多 6 个）
  - 正确答案（correctAnswer，可多选）
  - 错误选项（wrongAnswer，可多选）
  - 知识点分类（knowledgeTagId，可多选）
  - 题型分类（questionTypeId，单选）
- 可选字段：
  - 来源（source：考试/练习册/平台名）
  - 录入来源（ingestSource：ocr/manual）
  - 外部请求 ID（externalTraceId，用于幂等）
  - 备注（note）
  - 难度（difficulty：1-5）
  - 做错时间（wrongAt）

### A2 编辑/删除错题

- 支持错题内容更新
- 支持逻辑删除（软删除）
- 保留创建/修改时间与操作人信息

### A3 错题列表

- 支持分页
- 支持筛选：
  - 题型
  - 知识点
  - 时间区间
  - 复习状态
  - 关键词（题干模糊搜索）
- 支持排序：
  - 按创建时间
  - 按做错时间
  - 按复习次数（如有）

### A4 错题详情

- 展示题干、选项、正确答案、错误选项、分类标签
- 展示历史复习记录（V1 可选简版）
- 提供“生成相似题”操作入口

---

## 5.2 模块 B：分类管理

### B1 知识点分类管理

- 支持树状结构（如：语法 > 时态 > 现在完成时）
- 支持新增/编辑/停用
- 停用后不影响历史数据展示

### B2 题型分类管理

- 题型示例：阅读理解、完形填空、语法填空、单项选择、改错等
- 支持新增/编辑/停用
- 支持题型说明字段（便于统一口径）

---

## 5.3 模块 C：Service OCR 识别

### C1 接入方式

- 由 Service 内部 OCR 流程完成识别与字段抽取
- 支持图片上传识别与文本直录两种入口
- 识别后进入结构化映射与人工校对流程（可直接提交）

### C2 入库校验

- 必填字段完整性校验（题干、选项、正确答案、错误选项、分类）
- 枚举值校验（题型、复习状态等）
- 业务规则校验（错误选项不可与正确答案完全相同）

### C3 异常处理

- 返回明确错误码与可读错误信息
- 记录 OCR 失败原因并支持重试
- 记录原始 OCR 文本/结构化载荷（便于追溯与修正）

---

## 5.4 模块 D：Dify 出题集成

### D1 生成入口

- Dify 通过 API 按条件读取错题
- 支持按题型、知识点、时间范围、复习状态筛选读取

### D2 生成策略（由 Dify 实现）

- 主维度：题型一致
- 次维度：知识点重合度高
- Dify 读取 Service 数据后执行出题
- 生成题结构由 Dify 侧定义，建议包含题干、选项、答案、解析

### D3 服务侧职责边界

- Service 负责提供稳定、可筛选的错题数据接口
- Service 负责鉴权、限流、日志审计与数据追溯
- 出题质量、去重策略、提示词策略由 Dify 侧负责

---

## 5.5 模块 E：统计与看板（V1 基础）

- 总错题数
- 近 7/30 天新增错题趋势
- 各知识点错题分布 Top N
- 各题型错题分布 Top N
- 已掌握率（基于复习状态）

---

## 6. 数据模型（建议）

### 6.1 实体：WrongQuestion（错题）

- id
- stem
- options（JSON 数组）
- correct_answer（JSON 数组）
- wrong_answer（JSON 数组）
- question_type_id
- difficulty
- source
- ingest_source（ocr/manual）
- external_trace_id
- ocr_raw_text（可选）
- ocr_payload（JSON，可选）
- note
- wrong_at
- review_status（not_reviewed/reviewed/mastered）
- created_at
- updated_at
- deleted_at

### 6.2 实体：KnowledgeTag（知识点）

- id
- name
- parent_id（支持树）
- status（active/inactive）
- created_at
- updated_at

### 6.3 实体：QuestionType（题型）

- id
- name
- description
- status
- created_at
- updated_at

### 6.4 关系表：WrongQuestionKnowledgeTag

- id
- wrong_question_id
- knowledge_tag_id

### 6.5 实体：GeneratedQuestion（生成题）

- id
- source_wrong_question_id
- stem
- options
- correct_answer
- explanation
- generation_params（JSON）
- created_at

---

## 7. API 需求（V1 草案）

### 7.1 错题 API

- `POST /api/v1/wrong-questions` 新增错题（手动）
- `POST /api/v1/wrong-questions/ocr` OCR 识别并结构化入库（Service 内部流程）
- `PUT /api/v1/wrong-questions/{id}` 更新错题
- `DELETE /api/v1/wrong-questions/{id}` 删除错题（软删除）
- `GET /api/v1/wrong-questions/{id}` 查询错题详情
- `GET /api/v1/wrong-questions` 查询错题列表（分页 + 条件）

### 7.2 Dify 读取/回写 API

- `GET /api/v1/integrations/dify/wrong-questions` Dify 按条件读取错题
- `GET /api/v1/integrations/dify/wrong-questions/{id}` Dify 读取错题详情
- `POST /api/v1/integrations/dify/practice-records` Dify 回写练习结果（可选）
- MVP 鉴权方案（简化）：
  - 仅要求 `X-API-Key`
  - 暂不强制签名、时间戳、防重放与幂等
  - 待进入生产阶段再补 `X-Signature`、`X-Timestamp`、`X-Request-Id`
- 返回：
  - 成功：`data`、`status`
  - 失败：`errorCode`、`message`、`fieldErrors`

### 7.3 分类 API

- `GET /api/v1/knowledge-tags`
- `POST /api/v1/knowledge-tags`
- `PUT /api/v1/knowledge-tags/{id}`
- `GET /api/v1/question-types`
- `POST /api/v1/question-types`
- `PUT /api/v1/question-types/{id}`

### 7.4 统计 API

- `GET /api/v1/dashboard/overview`
- `GET /api/v1/dashboard/trend`
- `GET /api/v1/dashboard/distribution`

---

## 8. 管理端页面需求（Web）

### 8.1 页面清单

1. 登录页（若启用账号体系）
2. 错题列表页
3. 错题详情页
4. 错题新建/编辑页
5. 知识点管理页
6. 题型管理页
7. 统计看板页

### 8.2 关键交互

- 列表多条件筛选 + 保存筛选条件（V1 可选）
- 支持按知识点、题型、时间、复习状态筛选展示错题集
- 详情页展示 OCR 结构化结果并支持人工修正
- 复习状态可快速切换

---

## 9. 权限与角色（V1 简化）

- Admin：全量管理权限（错题、分类、统计、生成）
- User：错题增删改查、相似题练习、查看个人统计

说明：如 V1 仅单用户，可先不做复杂 RBAC，保留角色字段兼容扩展。

---

## 10. 非功能需求

### 10.0 技术约束（新增）

- 后端服务遵循“轻量优先”原则，避免重框架和复杂部署
- V1 技术栈限定为 Node.js 或 Python
- Python 框架候选：FastAPI 或 Django（按团队偏好二选一）
- 原则上单体服务优先（先保证业务闭环，再考虑拆分）
- 优先使用成熟开源组件，减少自研基础设施

### 10.1 性能

- 列表查询接口 P95 < 300ms（1 万条错题规模）
- Dify 集成读取接口 P95 < 300ms（常规筛选条件）

### 10.2 可用性

- 服务可用性目标：99.9%（开发阶段可放宽）
- 接口错误需返回明确错误码与 message

### 10.3 安全

- 接口鉴权（JWT 或 Session）
- 关键操作日志（删除、批量操作）
- 输入内容做长度与格式校验，防止注入

### 10.4 可观测性

- 记录访问日志、错误日志、慢查询日志
- 暴露基础健康检查接口 `/health`

---

## 11. 验收标准（V1）

1. Service 可通过 OCR 识别流程完整入库一条英语错题（含必填字段）
2. 可按题型与知识点筛选错题
3. 可查看错题详情并看到正确/错误答案对比
4. Dify 可按筛选条件读取错题并成功完成相似题生成
5. 可查看基础统计看板（趋势 + 分布）
6. 关键接口具备参数校验、鉴权和幂等处理

---

## 12. 里程碑建议

- M1（第 1 周）：数据模型与基础 CRUD API
- M2（第 2 周）：管理端错题列表/详情/编辑页联调
- M3（第 3 周）：分类管理 + 统计看板
- M4（第 4 周）：相似题生成 + 练习页 + 验收

---

## 13. 风险与待确认项

1. 相似题生成技术路线：
   - Dify 工作流编排
   - Dify 大模型与提示词策略
   - 题目质量评估与去重策略
2. 多选题与主观题是否同一模型处理
3. 是否需要导入历史错题（CSV/Excel）
4. 是否支持多用户隔离与组织空间（班级维度）
5. 统计口径（按录入时间还是做错时间）需统一

---

## 14. 下一步建议

1. 冻结 V1 必做范围（先保证“录入-管理-生成-复盘”闭环）
2. 将本 PRD 拆分为：
   - 后端 API 详细设计（字段、错误码、鉴权）
   - 管理端原型（页面与交互）
   - Dify 出题工作流方案（模型/提示词/回写）
3. 进入技术选型与任务排期阶段（可输出开发任务清单）
4. 后端轻量选型建议（V1）：
   - Node.js 方案：`Fastify + TypeScript + Prisma + PostgreSQL`
   - Python 方案 A（更轻量，推荐）：`FastAPI + SQLAlchemy + PostgreSQL`
   - Python 方案 B（全栈内建能力更强）：`Django + Django REST Framework + PostgreSQL`
   - 选型建议：若优先“轻量 + API 性能 + 与 Dify 集成速度”，优先 FastAPI；若优先“后台管理、权限、ORM 全家桶”，优先 Django
