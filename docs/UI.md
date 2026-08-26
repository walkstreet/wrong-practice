# RightOn UI 规范

本站视觉以淡紫壳层为准：白底、浅紫灰描边、紫色强调。前端样式集中在 `frontend/src/shell.css`，壳层结构在 `frontend/src/App.tsx`。新页面、新组件必须对齐本文，不要另起一套灰蓝 Ant Design 默认风。

实现时优先复用已有 class（`shell-*`、`account-*`、`list-*`），不要为同一视觉再写一份颜色。

---

## 1. 原则

- **与 Layout 同源**：页面背景、描边、主色、圆角都跟 header / sider 走，不引入蓝色主色或厚投影卡片。
- **少装饰**：白面板 + 1px 描边即可；阴影只用于下拉/悬浮，不用大卡片阴影堆叠。
- **枚举不外露**：界面只显示中文。`not_reviewed` → 未复习，`ocr` → 识别录入。映射见 `frontend/src/utils/labels.ts`。
- **常用条件更醒目**：筛选里离散、高频条件用分段胶囊；精确查找放右侧、弱化。
- **交互即时**：分段/下拉改完即筛；ID 回车才查。破坏性操作必须二次确认。

---

## 2. 设计令牌

### 2.1 颜色

| 用途 | 色值 | 说明 |
| --- | --- | --- |
| 页面底 | `#f4f2f8` | `.shell` 背景 |
| 主表面 | `#fff` | header、内容卡片 |
| 侧栏底 | `#fbfafd` | sider、移动端抽屉 |
| 主色 | `#5b3fd4` | 选中文字、链接、强调 |
| 主色亮 | `#7c5cfc` | 控件 focus、Ant Design `colorPrimary`、Logo 渐变起点 |
| 主色悬停 | `#6b4ef0` / `#4a32c4` | 按钮 hover；文字链用更深的 `#4a32c4` |
| 渐变辅 | `#8b73ff` | 头像默认底 `linear-gradient(145deg, #8b73ff 0%, #5b3fd4 100%)` |
| 品牌字 | `#2a1848` | RightOn 字标 |
| 主文字 | `#1c1333` | 标题、题干、姓名 |
| 次文字 | `#3d3358` | 图标按钮、菜单项 |
| 弱文字 | `#5c5670` | 未选导航、未选胶囊 |
| 辅助文字 | `#8a829c` | 标签、说明、分页元信息 |
| 占位 | `#b8b0c8` | placeholder、禁用文字链 |
| 描边 | `#ece8f4` | 面板、header 底边、sider 右边 |
| 控件描边 | `#e4dcf4` | 输入框、账号芯片默认边 |
| 描边悬停 | `#cbbef0` | 输入/芯片/题目卡片 hover |
| 内分割 | `#f0ecf6` | 卡片内横线 |
| 选中底 | `#efe8ff` | 导航选中、胶囊轨道、知识点标签 |
| 悬停底 | `#f3eefc` / `#f4f0fb` / `#f6f2ff` | 导航 hover、菜单按钮、表格行 hover |
| 填充浅 | `#f6f3fb` | 账号芯片、已填筛选控件 |
| 危险 | `#c43c3c` | 删除、退出 |
| 危险底 | `#fff3f3` | 危险项 hover |
| 成功 | `#1f7a45` / `#e9f7ef` | 已掌握、启用 |
| 预警 | `#c45c26` / `#fff1e8` | 未复习 |

Focus 环：`box-shadow: 0 0 0 3px rgba(124, 92, 252, 0.12)`，边框 `#7c5cfc`。

禁止：Ant Design 默认蓝 `#1677ff` 作为主色；纯灰 `#d9d9d9` 作为本站控件边框。

### 2.2 圆角

| 场景 | 值 |
| --- | --- |
| 页面大卡片（筛选、结果、账号面板） | 18px |
| 下拉面板、题目卡片 | 14px |
| 分段轨道 | 12px |
| 分段滑块、导航项、输入 | 10px / 9px |
| 图标按钮 | 8px |
| 胶囊标签、账号芯片 | 999px / 20px |
| Logo | 8px（32 画板） |

### 2.3 字体与字重

- UI 字体：系统栈 `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`
- 品牌字标：`"Righteous", cursive`，18px，`letter-spacing: 0.6px`，色 `#2a1848`
- 标题字重 650，正文强调 600，常规 500
- 筛选 kicker / 表头：12px、字重 600、色 `#8a829c`

### 2.4 间距与层级

- 顶栏高度 56px；内容区内边距 24px（主栏 `.shell-main`）
- 筛选与结果区间距 16px
- 动效 0.15s ease（宽收起 0.2s）
- z-index：header 30，sider 10

### 2.5 阴影

- 账号下拉：`0 16px 40px rgba(42, 24, 72, 0.1)`
- 分段选中滑块：`0 1px 3px rgba(42, 24, 72, 0.1)`
- 题目卡片 hover：`0 10px 24px rgba(42, 24, 72, 0.06)`
- 固定列表操作列：`inset -8px 0 8px -8px rgba(42, 24, 72, 0.12)`

---

## 3. Layout

结构：

```
.shell
  .shell-header          // sticky 顶栏
  .shell-body
    .shell-sider         // ≥ md，可折叠
    .shell-main          // 路由出口
  Drawer.shell-drawer    // < md，左侧目录
```

- 全页最小高度 100vh，背景 `#f4f2f8`
- 主体 `min-height: calc(100vh - 56px)`，sider 与其对齐并 `position: sticky; top: 56px`
- 主栏 `flex: 1; min-width: 0; padding: 24px`
- 断点：Ant Design `Grid.md` 为桌面侧栏；`< 768px` 改为顶栏菜单按钮 + 左抽屉。筛选栅格另有 `900px` 中间档。
- 不要用 Ant Design `Layout.Sider` 默认深色侧栏。壳层是自定义的，颜色必须跟本文一致。

---

## 4. Header

- 高度 56px，白底，底边 `#ece8f4`，左右 padding 20px
- 左侧：品牌（Logo 28px + RightOn 字标），点击回角色首页
- 窄屏在品牌前加菜单按钮 36×36、圆角 10px，hover 底 `#f4f0fb`
- 右侧：账号芯片（见 Avatar）
- Header 不放一级导航；导航只在 sider / 抽屉

Logo（`AppLogo`）：圆角方、渐变 `#7C5CFC → #5B3FD4`，白色展开书，绿色笔尖。同一页多个 Logo 必须传不同 `id`，避免渐变 `id` 冲突。

---

## 5. Avatar 与账号菜单

### 5.1 头像

| 尺寸 | class | 规格 |
| --- | --- | --- |
| 顶栏 | `.shell-avatar` | 28px，字 12px |
| 下拉头 | `.shell-avatar.is-lg` | 36px，字 14px |
| 个人页 | `.account-avatar-preview` | 88px，字 32px，外圈 `0 0 0 3px #fff, 0 0 0 4px #e4dcf4` |

- 圆形；有图则 `object-fit: cover`，无图则渐变底 + 用户名首字母大写白字
- 个人页头像 hover 出半透明遮罩（`rgba(28, 19, 51, 0.5)`）提示更换

### 5.2 账号芯片 `.shell-account-chip`

- 高 40px，左头像右信息，圆角 20px
- 默认：边 `#e4dcf4`，底 `#f6f3fb`
- hover / 打开：边 `#cbbef0`，底 `#efe8ff`
- 姓名 `#1c1333` 13px / 600，最多 104px 省略；角色 `#8a829c` 11px
- 窄屏隐藏角色行
- 打开时 caret 旋转 180°

### 5.3 下拉面板 `.shell-account-panel`

- 宽 248px，白底，边 `#ece8f4`，圆角 14px，阴影见令牌
- 项高约 9px 12px padding，圆角 8px，字 `#3d3358`
- hover 底 `#f6f2ff`；退出为 `.is-danger`（`#c43c3c` / hover `#fff3f3`）
- 分割线 `#f0ecf6`

---

## 6. Sider

- 展开 228px，收起 72px，过渡 0.2s
- 底 `#fbfafd`，右边 `#ece8f4`
- 收起状态写入 `localStorage` 键 `righton.sider-collapsed`（`1` / `0`）
- 导航项：高 ≥ 40px，圆角 10px，默认字 `#5c5670`
  - hover：底 `#f3eefc`，字 `#3d3358`
  - 选中：底 `#efe8ff`，字 `#5b3fd4`，字重 600
- 图标槽 18px；收起时项居中、只留图标，并用 Tooltip 显示名称
- 底部「收起」：高 48px，顶边分割，字 `#8a829c`；hover 字 `#5b3fd4`、底 `#f6f2ff`
- 移动端抽屉复用同一套 nav，抽屉头部分割 `#ece8f4`，body 底 `#fbfafd`

账号页左侧 rail（`.account-rail-link`）与 sider 选中态同一套颜色；窄屏变成横向胶囊轨道，轨道底 `#ece8f4`，选中为白底。

---

## 7. Card

### 7.1 页面容器卡

筛选条 `.list-filter`、结果区 `.list-results`、账号 `.account-panel`：

- 白底、边 `#ece8f4`、圆角 18px
- 不要再用默认 Ant Design `Card` 当列表页外壳（默认描边/阴影与壳层不一致）
- 账号面板内边距桌面 `28px 32px 32px`，窄屏 `22px 18px`

### 7.2 结果区头 `.list-results-head`

- 左右 18px、上下 12px，底部分割 `#f0ecf6`
- 左：`共 **N** 条`（数字用主文字）
- 右：工具 + 表格/卡片切换（分段控件，同筛选胶囊）

### 7.3 题目卡片 `.list-qcard`

- 栅格：`repeat(auto-fill, minmax(300px, 1fr))`，间距 12px，区内边距 `16px 18px 0`
- 卡片：边 14px 圆角、padding 16px、最小高度 176px
- hover：边 `#cbbef0` + 浅阴影；整卡可点进详情
- 顶栏：左状态胶囊，右 `#ID`
- **删除在右上角**：有管理权限时，hover 整卡（或确认框打开时）`#ID` 淡出，换成删除图标；点击后仍用 Popconfirm，文案「确认删除该错题？」
- 无管理权限：右上角始终显示编号
- 触控（无 hover）：右上角直接显示删除图标
- 底部：录入人 + 文字链「查看 / 编辑」（删除不在底部）
- 题干最多 3 行省略，字 14px / 600

列表默认展现为**卡片**；仅当用户选过表格时记住表格（`localStorage`：`righton.wq-view`）。

---

## 8. Search（筛选）

class 前缀 `.list-filter`。Ant Design 主题：

```ts
{
  colorPrimary: "#7c5cfc",
  colorBorder: "#e4dcf4",
  colorPrimaryHover: "#6b4ef0",
  borderRadius: 10,
  controlHeight: 36,
}
```

### 8.1 结构与优先级

1. **第一行（最醒目）**：复习状态分段 — 全部 / 未复习 / 已复习 / 已掌握。点即筛。
2. **第二行**：知识点（最宽）→ 题型 → 题目 ID（固定约 176px，回车查找）。
3. 有条件时第一行右侧出现文字链「清除条件」。

不要用「标签 + 下拉 + 筛选按钮」的后台表单排法。

### 8.2 分段胶囊

- 轨道底 `#efe8ff`，内边距 3px，圆角 12px
- 项高 32px，未选字 `#5c5670`；选中白底、字 `#5b3fd4`、字重 600、轻阴影
- 与「表格 / 卡片」切换共用这一形态（`.list-view-toggle`）

### 8.3 输入

- 边 `#e4dcf4`，圆角 10px；hover `#cbbef0`；focus 主色 + focus 环
- 已填字段加 `.is-filled`：边 `#cbbef0`，底 `#f6f3fb`
- 控件高 36px；Ant Design 6 的 Select 边框在根节点 `.ant-select` 上，不要再写已移除的 `.ant-select-selector`
- `InputNumber` 不要传 `allowClear`（会漏到 DOM 上报错）

---

## 9. Table

包在 `.list-results` 内，分页与卡片视图**共用**底部 `.list-results-pagination`（右对齐，padding `16px 18px`）。Table 自身 `pagination={false}`。

### 9.1 外观

- 表头底 `#fbfafd`，字 12px / 600 / `#8a829c`
- 行分割 `#f0ecf6`，主文字 `#1c1333`
- 行 hover 底 `#f6f2ff`
- 空态中文：「暂无错题」

### 9.2 行为

- `scroll.x` 约 1178，内容超出时横向滚动
- **操作列 `fixed: "right"`**，白底（表头跟表头色）；滚动时左侧内阴影
- 操作：**图标 + Tooltip**（查看 / 编辑 / 删除），删除用 Popconfirm
- 图标按钮 28×28、圆角 8px；默认字 `#5c5670`；hover 底 `#f6f2ff`、色 `#5b3fd4`；危险 hover `#fff3f3` / `#c43c3c`

### 9.3 值的展示

| 字段 | 展示 |
| --- | --- |
| 复习状态 | 胶囊：未复习橙、已复习紫、已掌握绿 |
| 录入来源 | 手动录入 / 识别录入 |
| 知识点 | 紫胶囊，表格最多 2 个 +N，卡片最多 3 个 |

详情抽屉同样走中文标签，不出现枚举字符串。

---

## 10. 控件与文案

- 文字链（查看、清除、账号「文字按钮」）：`#5b3fd4` / hover `#4a32c4`，字重 600，无边框
- 主按钮：高 40px 量级、字重 600、主色 `#7c5cfc`
- 危险操作必须 Popconfirm，确认文案说清后果
- 角色中文：超管 / 教师 / 学生（`ROLE_LABELS`）

---

## 11. 录入题目

class 前缀 `.entry-*`。页面不要再用 Ant Design `Card` + `Tabs` + 页内标题（侧栏已有「录入题目」）。

### 11.1 结构

```
.entry-panel
  .entry-head          // 分段胶囊：识别录入 / 手动录入
  .entry-body
  .entry-bar           // 粘性底栏：保存 / 确认导入
```

- 面板白 + `#ece8f4` + 圆角 18px，与筛选/结果区同一套
- 模式切换复用 `.list-filter-pills`；文案走 `INGEST_SOURCE_LABELS`（识别录入 / 手动录入）
- 识别是默认主入口；手动是补录
- 控件主题同筛选：`colorPrimary #7c5cfc`、`colorBorder #e4dcf4`、圆角 10、高度 36
- 不要把草稿 UUID、模型名、置信度百分比露给用户

### 11.2 识别录入

1. **空态**：大拖拽区（点选 / 拖入 / 粘贴截图），最多 5 张图；选完再出现「开始识别」
2. **核对**：左原图粘住、右题目卡。卡默认收成摘要（题干、正确/错答、题型、知识点）；缺题型、缺知识点或有 warning 时标「建议核对」并默认展开
3. **预警色**：边 `#f0c4a8`、文 `#c45c26`，不要 Ant Design 默认橙
4. **底栏粘住**：已选 N / M、「全部推荐知识点」、「确认导入已选 N 题」；移除题目用 Popconfirm
5. 识别成功后自动补知识点（已有的不覆盖）；导入成功 toast 带「去查看」

### 11.3 手动录入

- 主路径：题干 → 题型 / 知识点 → 选项 → 正确 / 错答
- 复习状态、难度、做错时间、来源、备注在「更多信息」，默认展开（用 `hidden` 藏，不要卸载以免丢值）
- 难度用 1–5 下拉（入门/基础/中等/较难/挑战），标签旁问号链到 `/help#difficulty`
- 底栏：清空 + 提交保存；新题默认未复习
- 保存成功 toast 带「去查看」，跳 `/wrong-questions?id=`

### 11.4 识别难度口径

识别提示词与 `frontend/src/utils/difficulty.ts` 同一套：评题目认知负担，不评对错；介于两档就低不就高；拿不准标 3。

---

## 12. 帮助中心

- 侧栏末项「帮助中心」，登录即可进，不绑权限
- 现在只有难度等级一篇，无副标题、无页内目录；以后加篇再加导航
- 路由 `/help`；难度问号链到 `/help#difficulty`（锚在页面顶，含「帮助中心」标题，避开 sticky 顶栏）
- 面板复用 `.account-panel`，页面壳 `.help-page`

---

## 13. 清单（做新页面时）

- [ ] 背景是 `#f4f2f8`，面板白 + `#ece8f4` + 圆角 18px
- [ ] 主色紫，没有默认蓝
- [ ] 高频筛选用分段胶囊，不用一排 Form 标签
- [ ] 列表值已转中文
- [ ] 表格超宽可横滑，操作列固定
- [ ] 卡片默认；删除在右上角 hover 替换 `#ID`
- [ ] 录入页用 `.entry-*` 面板 + 胶囊切换，不要 Card/Tabs
- [ ] 样式写进 `shell.css` 的现有前缀，而不是页面内联一大段颜色
