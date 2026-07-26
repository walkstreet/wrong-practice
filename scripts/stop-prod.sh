#!/usr/bin/env bash
# 停止 start-prod.sh --daemon 启动的常驻前后端进程。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT/.run"
BACK_PID_FILE="$RUN_DIR/prod-backend.pid"
FRONT_PID_FILE="$RUN_DIR/prod-frontend.pid"

stop_by_pid_file() {
  local pid_file="$1"
  local service_name="$2"

  if [[ ! -f "$pid_file" ]]; then
    echo "${service_name} 未运行 (未找到 PID 文件: ${pid_file})"
    return 0
  fi

  local pid
  pid="$(<"$pid_file")"
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid"
    echo "已停止 ${service_name} (PID: ${pid})"
  else
    echo "${service_name} 进程不存在 (PID: ${pid}), 将清理 PID 文件"
  fi

  rm -f "$pid_file"
}

stop_by_pid_file "$BACK_PID_FILE" "后端服务"
stop_by_pid_file "$FRONT_PID_FILE" "前端服务"
