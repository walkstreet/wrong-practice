#!/usr/bin/env bash
# 开发模式：同时启动 uvicorn --reload 与 Vite dev server。
# 在仓库根目录执行；请先运行 ./scripts/install-deps.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACK_PORT="${BACKEND_PORT:-3001}"
FRONT_PORT="${FRONTEND_PORT:-5174}"
BIND_HOST="${BIND_HOST:-0.0.0.0}"

cd "$ROOT"

if [[ ! -d .venv ]]; then
  echo "未找到 .venv，请先执行：./scripts/install-deps.sh" >&2
  exit 1
fi

if [[ ! -d frontend/node_modules ]]; then
  echo "未找到 frontend/node_modules，请先执行：./scripts/install-deps.sh" >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  echo "未找到 .env，已从 .env.example 创建"
  cp .env.example .env
fi

# shellcheck disable=SC1091
source "$ROOT/scripts/lib/node-env.sh"
ensure_node "$ROOT"

check_port_free() {
  local port="$1"
  local service_name="$2"
  if command -v lsof >/dev/null 2>&1; then
    local existing_pids
    existing_pids="$(lsof -ti "tcp:${port}" -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -n "${existing_pids}" ]]; then
      echo "${service_name} 端口 ${port} 已被占用，PID: ${existing_pids}" >&2
      echo "可执行 kill -9 <PID> 后重试，或通过 BACKEND_PORT / FRONTEND_PORT 更换端口。" >&2
      exit 1
    fi
  fi
}

check_port_free "$BACK_PORT" "后端"
check_port_free "$FRONT_PORT" "前端"

cleanup() {
  if [[ -n "${BACK_PID:-}" ]]; then
    kill "$BACK_PID" 2>/dev/null || true
  fi
  if [[ -n "${FRONT_PID:-}" ]]; then
    kill "$FRONT_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

echo "正在启动开发环境（热加载）..."
echo "后端 http://127.0.0.1:${BACK_PORT}/docs"
echo "前端 http://127.0.0.1:${FRONT_PORT}"
echo "API 默认走同源 /api（Vite 代理到后端 :${BACK_PORT}）；可在 frontend/.env 设置 VITE_API_BASE_URL 覆盖"

(
  cd "$ROOT"
  # shellcheck disable=SC1091
  source .venv/bin/activate
  # 开发模式固定使用项目内 wrong_questions.db，不继承生产环境的 SQLITE_DATA_DIR
  export SQLITE_DATA_DIR=""
  exec uvicorn app.main:app --reload --host "$BIND_HOST" --port "$BACK_PORT"
) &
BACK_PID=$!

sleep 1

(
  cd "$ROOT/frontend"
  exec npm run dev -- --host "$BIND_HOST" --port "$FRONT_PORT"
) &
FRONT_PID=$!

wait "$BACK_PID" "$FRONT_PID"
