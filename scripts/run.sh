#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${BACKEND_PORT:-${PORT:-3001}}"
# 默认监听 0.0.0.0，便于手机/平板在同一局域网访问
HOST="${HOST:-0.0.0.0}"

cd "$ROOT_DIR"

if [[ ! -d ".venv" ]]; then
  echo "[run] 未检测到 .venv，正在创建虚拟环境..."
  python3 -m venv .venv
fi

source ".venv/bin/activate"

if [[ ! -f ".env" ]]; then
  echo "[run] 未检测到 .env，已从 .env.example 创建"
  cp ".env.example" ".env"
fi

if ! python -c "import fastapi, uvicorn, sqlalchemy, multipart, alembic, psycopg" >/dev/null 2>&1; then
  echo "[run] 依赖缺失，正在安装 requirements.txt ..."
  pip install -r requirements.txt
fi

if command -v lsof >/dev/null 2>&1; then
  EXISTING_PIDS="$(lsof -ti tcp:${PORT} -sTCP:LISTEN || true)"
  if [[ -n "${EXISTING_PIDS}" ]]; then
    echo "[run] 端口 ${PORT} 已被占用。"
    echo "[run] 占用进程 PID: ${EXISTING_PIDS}"
    echo "[run] 可执行：kill -9 <PID> 后重试，或使用 PORT=8000 bash scripts/run.sh"
    exit 1
  fi
fi

# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/lib/postgres.sh"

echo "[run] 启动服务: http://${HOST}:${PORT}"
if grep -qE '^DATABASE_URL=postgresql' .env 2>/dev/null; then
  ensure_postgres_path
  if ! pg_isready -h "${PGHOST:-127.0.0.1}" -p "${PGPORT:-5432}" -q; then
    echo "[run] PostgreSQL 未运行。请先执行：./scripts/setup-dev-db.sh" >&2
    exit 1
  fi
  alembic upgrade head
else
  # 仍使用 SQLite 时，避免继承生产环境的 SQLITE_DATA_DIR
  export SQLITE_DATA_DIR=""
fi
exec uvicorn app.main:app --reload --host "${HOST}" --port "${PORT}"
