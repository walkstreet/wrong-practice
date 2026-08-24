#!/usr/bin/env bash
# 开发环境：确保本机 PostgreSQL 可用、创建数据库、执行 Alembic 迁移。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# shellcheck disable=SC1091
source "$ROOT/scripts/lib/postgres.sh"

DB_NAME="${PGDATABASE:-wrong_questions}"
DB_USER="${PGUSER:-$(whoami)}"
DB_HOST="${PGHOST:-127.0.0.1}"
DB_PORT="${PGPORT:-5432}"
DEV_DATABASE_URL="postgresql+psycopg://${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}"

if [[ ! -d .venv ]]; then
  echo "未找到 .venv，请先执行：./scripts/install-deps.sh" >&2
  exit 1
fi

ensure_postgres_path

if ! pg_isready -h "$DB_HOST" -p "$DB_PORT" -q; then
  if command -v brew >/dev/null 2>&1; then
    echo "PostgreSQL 未就绪，尝试 brew services start postgresql@16 ..."
    brew services start postgresql@16 >/dev/null 2>&1 || brew services start postgresql >/dev/null 2>&1 || true
    for _ in $(seq 1 20); do
      if pg_isready -h "$DB_HOST" -p "$DB_PORT" -q; then
        break
      fi
      sleep 1
    done
  fi
fi

if ! pg_isready -h "$DB_HOST" -p "$DB_PORT" -q; then
  echo "PostgreSQL 仍未运行。请先执行：brew install postgresql@16 && brew services start postgresql@16" >&2
  exit 1
fi

if ! psql -h "$DB_HOST" -p "$DB_PORT" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  createdb -h "$DB_HOST" -p "$DB_PORT" "$DB_NAME"
  echo "已创建数据库 ${DB_NAME}"
else
  echo "数据库 ${DB_NAME} 已存在"
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "已从 .env.example 创建 .env"
fi

export DEV_DATABASE_URL
python3 - <<'PY'
import os
from pathlib import Path

path = Path(".env")
url = os.environ["DEV_DATABASE_URL"]
text = path.read_text(encoding="utf-8")
lines = text.splitlines(keepends=True)
out = []
replaced = False
for line in lines:
    if line.startswith("DATABASE_URL=") and not line.startswith("DATABASE_URL=postgresql"):
        out.append(f"DATABASE_URL={url}\n")
        replaced = True
    else:
        out.append(line)
if not any(item.startswith("DATABASE_URL=") for item in out):
    out.insert(0, f"DATABASE_URL={url}\n")
    replaced = True
if replaced:
    path.write_text("".join(out), encoding="utf-8")
    print(f"已把 .env 的 DATABASE_URL 改为 PostgreSQL（{url}）")
else:
    print(".env 已使用 PostgreSQL，保持不变")
PY

# shellcheck disable=SC1091
source .venv/bin/activate
python -c "import alembic, psycopg" >/dev/null 2>&1 || pip install -r requirements.txt

echo "执行 Alembic 迁移..."
alembic upgrade head

echo "开发数据库已就绪：${DEV_DATABASE_URL}"
echo "启动开发环境：make dev"
