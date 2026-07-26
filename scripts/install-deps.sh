#!/usr/bin/env bash
# 安装后端 Python（venv）与前端 npm 依赖。
# 在仓库根目录执行：./scripts/install-deps.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PY="${PYTHON:-python3}"

if [[ ! -d .venv ]]; then
  "$PY" -m venv .venv
fi

# shellcheck disable=SC1091
source .venv/bin/activate
# 使用阿里云 PyPI 镜像（HTTPS），避免默认源超时或 HTTP 镜像索引异常
PIP_INDEX_URL="${PIP_INDEX_URL:-https://mirrors.aliyun.com/pypi/simple}"
PIP_TRUSTED_HOST="${PIP_TRUSTED_HOST:-mirrors.aliyun.com}"
pip install -U pip -i "$PIP_INDEX_URL" --trusted-host "$PIP_TRUSTED_HOST"
pip install -r requirements.txt -i "$PIP_INDEX_URL" --trusted-host "$PIP_TRUSTED_HOST"
deactivate

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "已从 .env.example 创建 .env"
fi

# shellcheck disable=SC1091
source "$ROOT/scripts/lib/node-env.sh"
ensure_node "$ROOT"

(
  cd frontend
  if [[ ! -f .env ]]; then
    cp .env.example .env
    echo "已从 frontend/.env.example 创建 frontend/.env"
  fi

  NODE_VERSION_FILE="node_modules/.install-node-version"
  CURRENT_NODE="$(node -v)"
  if [[ -f "$NODE_VERSION_FILE" ]] && [[ "$(<"$NODE_VERSION_FILE")" != "$CURRENT_NODE" ]]; then
    echo "[install-deps] Node 版本变化（$(<"$NODE_VERSION_FILE") -> ${CURRENT_NODE}），清理 node_modules ..."
    rm -rf node_modules
  fi

  # 使用项目内缓存，避免 ~/.npm 权限或损坏导致 npm ci 失败
  NPM_CACHE_DIR="${NPM_CACHE_DIR:-$ROOT/.npm-cache}"
  mkdir -p "$NPM_CACHE_DIR"

  if ! npm ci --cache "$NPM_CACHE_DIR"; then
    echo "[install-deps] npm ci 失败，尝试 npm install ..." >&2
    npm install --cache "$NPM_CACHE_DIR"
  fi

  echo "$CURRENT_NODE" >"$NODE_VERSION_FILE"
)

echo "依赖已装好。"
echo "  后端 venv：.venv"
echo "  开发启动：./scripts/start-dev.sh"
echo "  生产启动：./scripts/start-prod.sh"
