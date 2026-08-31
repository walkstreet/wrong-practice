#!/usr/bin/env bash
# 停止 start-prod.sh 启动的常驻前后端进程（含 PID 文件对不上、子进程残留、端口占用）。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/scripts/lib/prod-process.sh"

BACK_PORT="${BACKEND_PORT:-3001}"
FRONT_PORT="${FRONTEND_PORT:-5174}"
RUN_DIR="$ROOT/.run"
BACK_PID_FILE="$RUN_DIR/prod-backend.pid"
FRONT_PID_FILE="$RUN_DIR/prod-frontend.pid"

if [[ -f "$BACK_PID_FILE" ]]; then
  stop_by_pid_file "$BACK_PID_FILE" "后端服务" || true
fi
if [[ -f "$FRONT_PID_FILE" ]]; then
  stop_by_pid_file "$FRONT_PID_FILE" "前端服务" || true
fi

# PID 文件经常只记到 nohup/bash/npm 包装进程，真正的 uvicorn / vite 会变成孤儿。
stop_listeners_on_port "$BACK_PORT" "后端服务" || true
stop_listeners_on_port "$FRONT_PORT" "前端服务" || true

# 最后按命令行兜底，覆盖端口探测工具缺失的情况。
stop_matching_processes "uvicorn app.main:app" "后端 uvicorn" || true
stop_matching_processes "vite preview" "前端 vite" || true

back_left="$(listening_pids_on_port "$BACK_PORT" || true)"
front_left="$(listening_pids_on_port "$FRONT_PORT" || true)"
if [[ -n "$back_left" || -n "$front_left" ]]; then
  echo "仍有进程未退出。可手动执行：" >&2
  [[ -n "$back_left" ]] && echo "  kill -9 ${back_left}" >&2
  [[ -n "$front_left" ]] && echo "  kill -9 ${front_left}" >&2
  exit 1
fi

echo "生产进程已停止。"
