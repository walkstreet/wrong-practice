#!/usr/bin/env bash
# 在脚本中 source 后调用 ensure_node "$ROOT"，自动切换 .nvmrc 指定的 Node 版本。

ensure_node() {
  local root="${1:?root directory required}"
  local nvmrc=""

  if [[ -f "$root/.nvmrc" ]]; then
    nvmrc="$root/.nvmrc"
  elif [[ -f "$root/frontend/.nvmrc" ]]; then
    nvmrc="$root/frontend/.nvmrc"
  fi

  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [[ -s "$NVM_DIR/nvm.sh" ]]; then
    # nvm.sh 使用未定义变量，不能在 set -u 下直接 source（make 非交互环境尤其容易踩中）
    set +eu
    # shellcheck disable=SC1091
    source "$NVM_DIR/nvm.sh"
    set -euo pipefail
  fi

  if [[ -n "$nvmrc" ]] && declare -F nvm >/dev/null 2>&1; then
    local wanted
    wanted="$(tr -d '[:space:]' <"$nvmrc")"
    set +eu
    if ! nvm use "$wanted" --silent 2>/dev/null; then
      echo "[node-env] 未找到 Node ${wanted}，正在通过 nvm 安装..." >&2
      nvm install "$wanted"
      nvm use "$wanted" --silent
    fi
    set -euo pipefail
  fi

  if ! command -v node >/dev/null 2>&1; then
    echo "[node-env] 未找到 node。请安装 Node，或确保 nvm 可用（make prod 不会加载 ~/.bashrc）。" >&2
    return 1
  fi

  if [[ -n "$nvmrc" ]] && declare -F nvm >/dev/null 2>&1; then
    echo "[node-env] 使用 Node $(node -v)（来自 ${nvmrc}）" >&2
  else
    echo "[node-env] 使用当前 Node $(node -v)（未加载 nvm 或无 .nvmrc）" >&2
  fi
}
