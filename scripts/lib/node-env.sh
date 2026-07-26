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
    # shellcheck disable=SC1091
    source "$NVM_DIR/nvm.sh"
  fi

  if [[ -n "$nvmrc" ]] && declare -F nvm >/dev/null 2>&1; then
    local wanted
    wanted="$(tr -d '[:space:]' <"$nvmrc")"
    if ! nvm use "$wanted" --silent 2>/dev/null; then
      echo "[node-env] 未找到 Node ${wanted}，正在通过 nvm 安装..." >&2
      nvm install "$wanted"
      nvm use "$wanted" --silent
    fi
    echo "[node-env] 使用 Node $(node -v)（来自 ${nvmrc}）" >&2
  else
    echo "[node-env] 使用当前 Node $(node -v)（未加载 nvm 或无 .nvmrc）" >&2
  fi
}
