# Antd 前端管理台

用于重写错题 UI（React + TypeScript + Vite + Ant Design），对接后端 `FastAPI` 接口。

## 1. 启动

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

默认访问：`http://127.0.0.1:5174`

## 2. 环境变量

- `VITE_API_BASE_URL`：后端 API 地址，默认 `http://127.0.0.1:3001`

## 3. 当前页面能力

- 错题列表（筛选/分页/删除）
- 错题详情抽屉（题干、选项、答案、来源）
- 练习记录列表
- 错题正确率统计
