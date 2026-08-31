#!/usr/bin/env bash
# 以前端构建产物（Vite preview）+ uvicorn 方式启动前后端生产模式。
# 在仓库根目录执行；请先运行 ./scripts/install-deps.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACK_PORT="${BACKEND_PORT:-3001}"
FRONT_PORT="${FRONTEND_PORT:-5174}"
BIND_HOST="${BIND_HOST:-0.0.0.0}"
RUN_MODE="daemon"
RUN_DIR="$ROOT/.run"
LOG_DIR="$ROOT/.logs"
BACK_PID_FILE="$RUN_DIR/prod-backend.pid"
FRONT_PID_FILE="$RUN_DIR/prod-frontend.pid"
BACK_LOG_FILE="$LOG_DIR/prod-backend.log"
FRONT_LOG_FILE="$LOG_DIR/prod-frontend.log"

# shellcheck disable=SC1091
source "$ROOT/scripts/lib/prod-process.sh"

cd "$ROOT"

while (($# > 0)); do
  case "$1" in
    -d|--daemon)
      RUN_MODE="daemon"
      shift
      ;;
    -h|--help)
      cat <<'EOF'
用法：scripts/start-prod.sh [--daemon|--foreground]

默认以常驻进程方式运行（终端关闭后继续运行）。
重复执行会先构建，再停掉旧进程，然后启动新进程。

选项：
  -d, --daemon      常驻运行（默认）
  -f, --foreground  前台运行（关闭终端会停止）
  -h, --help        显示帮助

环境变量：
  BACKEND_PORT     后端端口（默认 3001）
  FRONTEND_PORT    前端端口（默认 5174）
  BIND_HOST        绑定地址（默认 0.0.0.0）
EOF
      exit 0
      ;;
    -f|--foreground)
      RUN_MODE="foreground"
      shift
      ;;
    *)
      echo "未知参数：$1" >&2
      echo "可用参数：--daemon, --foreground, --help" >&2
      exit 1
      ;;
  esac
done

if [[ ! -d .venv ]]; then
  echo "未找到 .venv，请先执行：./scripts/install-deps.sh" >&2
  exit 1
fi

if [[ ! -x .venv/bin/uvicorn ]]; then
  echo "未找到 .venv/bin/uvicorn，请先执行：./scripts/install-deps.sh" >&2
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

VITE_BIN="$ROOT/frontend/node_modules/.bin/vite"
if [[ ! -x "$VITE_BIN" ]]; then
  echo "未找到 $VITE_BIN，请先执行：./scripts/install-deps.sh" >&2
  exit 1
fi

# Swagger / OpenAPI 不对外；生产默认关闭，本机开发仍可用 make dev
ENABLE_DOCS="${ENABLE_DOCS:-false}"
export ENABLE_DOCS

echo "正在构建前端..."
(cd frontend && npm run build)

echo "停止旧的生产进程（如有）..."
bash "$ROOT/scripts/stop-prod.sh"

cleanup() {
  if [[ -n "${BACK_PID:-}" ]]; then
    kill_pid_tree "$BACK_PID"
  fi
  if [[ -n "${FRONT_PID:-}" ]]; then
    kill_pid_tree "$FRONT_PID"
  fi
  stop_listeners_on_port "$BACK_PORT" "后端服务" || true
  stop_listeners_on_port "$FRONT_PORT" "前端服务" || true
}

echo "后端 http://${BIND_HOST}:${BACK_PORT}"
echo "前端 http://${BIND_HOST}:${FRONT_PORT}"
echo "Swagger 已关闭（不对外）。如需临时打开：ENABLE_DOCS=true ./scripts/start-prod.sh"
echo "生产构建下 API 默认走同源 /api（Vite preview 代理到后端 :${BACK_PORT}）；直连后端可设 VITE_API_BASE_URL 后重新 build"

if [[ "$RUN_MODE" == "daemon" ]]; then
  trap cleanup EXIT

  start_daemon "$BACK_PID_FILE" "$BACK_LOG_FILE" "$ROOT" \
    "$ROOT/.venv/bin/uvicorn" app.main:app --host "$BIND_HOST" --port "$BACK_PORT"
  BACK_PID="$DAEMON_PID"

  start_daemon "$FRONT_PID_FILE" "$FRONT_LOG_FILE" "$ROOT/frontend" \
    "$VITE_BIN" preview --host "$BIND_HOST" --port "$FRONT_PORT"
  FRONT_PID="$DAEMON_PID"
  disown -a 2>/dev/null || true

  # 后端启动时会跑 alembic，给足等待时间
  wait_for_pid_and_port "$BACK_PID" "$BACK_PORT" "后端" "$BACK_LOG_FILE" 45
  wait_for_pid_and_port "$FRONT_PID" "$FRONT_PORT" "前端" "$FRONT_LOG_FILE" 20

  trap - EXIT

  echo "已以常驻模式启动。"
  echo "后端 PID: $BACK_PID（$BACK_PID_FILE）"
  echo "前端 PID: $FRONT_PID（$FRONT_PID_FILE）"
  echo "查看日志：tail -f \"$BACK_LOG_FILE\" \"$FRONT_LOG_FILE\""
  echo "停止服务：./scripts/stop-prod.sh"
  echo "重新发布：./scripts/start-prod.sh   （或 make prod）"
  exit 0
fi

trap cleanup EXIT INT TERM

start_daemon "$BACK_PID_FILE" "$BACK_LOG_FILE" "$ROOT" \
  "$ROOT/.venv/bin/uvicorn" app.main:app --host "$BIND_HOST" --port "$BACK_PORT"
BACK_PID="$DAEMON_PID"

start_daemon "$FRONT_PID_FILE" "$FRONT_LOG_FILE" "$ROOT/frontend" \
  "$VITE_BIN" preview --host "$BIND_HOST" --port "$FRONT_PORT"
FRONT_PID="$DAEMON_PID"

wait_for_pid_and_port "$BACK_PID" "$BACK_PORT" "后端" "$BACK_LOG_FILE" 45
wait_for_pid_and_port "$FRONT_PID" "$FRONT_PORT" "前端" "$FRONT_LOG_FILE" 20

echo "前台模式运行中。按 Ctrl+C 停止。"
wait "$BACK_PID" "$FRONT_PID"
