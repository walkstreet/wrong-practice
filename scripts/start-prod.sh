#!/usr/bin/env bash
# 以前端构建产物（Vite preview）+ uvicorn 方式启动前后端生产模式。
# 在仓库根目录执行；请先运行 ./scripts/install-deps.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACK_PORT="${BACKEND_PORT:-3001}"
FRONT_PORT="${FRONTEND_PORT:-5174}"
BIND_HOST="${BIND_HOST:-0.0.0.0}"
export USE_EXTERNAL_DB="${USE_EXTERNAL_DB:-1}"
SQLITE_DATA_DIR="${SQLITE_DATA_DIR:-}"
RUN_MODE="daemon"
RUN_DIR="$ROOT/.run"
LOG_DIR="$ROOT/.logs"
BACK_PID_FILE="$RUN_DIR/prod-backend.pid"
FRONT_PID_FILE="$RUN_DIR/prod-frontend.pid"
BACK_LOG_FILE="$LOG_DIR/prod-backend.log"
FRONT_LOG_FILE="$LOG_DIR/prod-frontend.log"

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

选项：
  -d, --daemon      常驻运行（默认）
  -f, --foreground  前台运行（关闭终端会停止）
  -h, --help        显示帮助

环境变量：
  BACKEND_PORT     后端端口（默认 3001）
  FRONTEND_PORT    前端端口（默认 5174）
  BIND_HOST        绑定地址（默认 0.0.0.0）
  USE_EXTERNAL_DB  是否把 SQLite 放到仓库外（默认 1，目录为 ../db）
  SQLITE_DATA_DIR  自定义 SQLite 数据目录（覆盖 USE_EXTERNAL_DB 默认路径）
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

is_pid_running() {
  local pid="$1"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

check_already_running() {
  local pid_file="$1"
  local service_name="$2"
  if [[ -f "$pid_file" ]]; then
    local pid
    pid="$(<"$pid_file")"
    if is_pid_running "$pid"; then
      echo "${service_name} 已在运行（PID: $pid），请先停止后再启动。" >&2
      exit 1
    fi
    rm -f "$pid_file"
  fi
}

(cd frontend && npm run build)

cleanup() {
  if [[ -n "${BACK_PID:-}" ]]; then
    kill "$BACK_PID" 2>/dev/null || true
  fi
  if [[ -n "${FRONT_PID:-}" ]]; then
    kill "$FRONT_PID" 2>/dev/null || true
  fi
}

echo "后端 http://127.0.0.1:${BACK_PORT}"
echo "前端 http://127.0.0.1:${FRONT_PORT}"
echo "生产构建下 API 默认走同源 /api（Vite preview 代理到后端 :${BACK_PORT}）；直连后端可设 VITE_API_BASE_URL 后重新 build"

if [[ "$USE_EXTERNAL_DB" == "1" && -z "$SQLITE_DATA_DIR" ]]; then
  SQLITE_DATA_DIR="$ROOT/../db"
fi
if [[ -n "$SQLITE_DATA_DIR" ]]; then
  mkdir -p "$SQLITE_DATA_DIR"
  echo "SQLite 数据目录: $SQLITE_DATA_DIR"
  SRC_DB="$ROOT/wrong_questions.db"
  DST_DB="$SQLITE_DATA_DIR/wrong_questions.db"
  if [[ ! -f "$DST_DB" && -f "$SRC_DB" ]]; then
    mv "$SRC_DB" "$DST_DB"
    echo "已迁移数据库: $SRC_DB -> $DST_DB"
  fi
fi

if [[ "$RUN_MODE" == "daemon" ]]; then
  mkdir -p "$RUN_DIR" "$LOG_DIR"
  check_already_running "$BACK_PID_FILE" "后端服务"
  check_already_running "$FRONT_PID_FILE" "前端服务"

  nohup env ROOT="$ROOT" BIND_HOST="$BIND_HOST" BACK_PORT="$BACK_PORT" SQLITE_DATA_DIR="$SQLITE_DATA_DIR" bash -c \
    'cd "$ROOT" && exec .venv/bin/uvicorn app.main:app --host "$BIND_HOST" --port "$BACK_PORT"' \
    >>"$BACK_LOG_FILE" 2>&1 &
  BACK_PID=$!
  echo "$BACK_PID" >"$BACK_PID_FILE"

  nohup env ROOT="$ROOT" BIND_HOST="$BIND_HOST" FRONT_PORT="$FRONT_PORT" bash -c \
    'source "$ROOT/scripts/lib/node-env.sh" && ensure_node "$ROOT" && cd "$ROOT/frontend" && exec npm run preview -- --host "$BIND_HOST" --port "$FRONT_PORT"' \
    >>"$FRONT_LOG_FILE" 2>&1 &
  FRONT_PID=$!
  echo "$FRONT_PID" >"$FRONT_PID_FILE"

  sleep 1

  if ! is_pid_running "$BACK_PID"; then
    echo "后端启动失败，请查看日志：$BACK_LOG_FILE" >&2
    exit 1
  fi

  if ! is_pid_running "$FRONT_PID"; then
    echo "前端启动失败，请查看日志：$FRONT_LOG_FILE" >&2
    exit 1
  fi

  echo "已以常驻模式启动。"
  echo "后端 PID: $BACK_PID（$BACK_PID_FILE）"
  echo "前端 PID: $FRONT_PID（$FRONT_PID_FILE）"
  echo "查看日志：tail -f \"$BACK_LOG_FILE\" \"$FRONT_LOG_FILE\""
  echo "停止服务：./scripts/stop-prod.sh"
  exit 0
fi

trap cleanup EXIT INT TERM

(
  cd "$ROOT"
  # shellcheck disable=SC1091
  source .venv/bin/activate
  export SQLITE_DATA_DIR="$SQLITE_DATA_DIR"
  exec uvicorn app.main:app --host "$BIND_HOST" --port "$BACK_PORT"
) &
BACK_PID=$!

sleep 1

(
  cd "$ROOT/frontend"
  exec npm run preview -- --host "$BIND_HOST" --port "$FRONT_PORT"
) &
FRONT_PID=$!

wait "$BACK_PID" "$FRONT_PID"
