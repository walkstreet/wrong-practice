# 供其它脚本 source：定位本机 PostgreSQL 客户端。

find_postgres_bin() {
  local prefix=""
  local candidate=""
  local formula=""

  if command -v brew >/dev/null 2>&1; then
    for formula in postgresql@16 postgresql@17 postgresql@15 postgresql; do
      prefix="$(brew --prefix "$formula" 2>/dev/null || true)"
      if [[ -n "$prefix" && -x "$prefix/bin/psql" ]]; then
        echo "$prefix/bin"
        return 0
      fi
    done
  fi

  # macOS 12 无法通过 Homebrew 安装预编译包，需用 EDB 安装器（/Library/PostgreSQL/16）
  for candidate in \
    /Library/PostgreSQL/16/bin \
    /opt/homebrew/opt/postgresql@16/bin \
    /opt/homebrew/opt/postgresql@17/bin \
    /opt/homebrew/opt/postgresql@15/bin \
    /usr/local/opt/postgresql@16/bin; do
    if [[ -x "$candidate/psql" ]]; then
      echo "$candidate"
      return 0
    fi
  done

  if command -v psql >/dev/null 2>&1; then
    dirname "$(command -v psql)"
    return 0
  fi

  return 1
}

ensure_postgres_path() {
  local bin_dir=""
  bin_dir="$(find_postgres_bin || true)"
  if [[ -z "$bin_dir" ]]; then
    echo "未找到 PostgreSQL 客户端（psql）。请先执行：brew install postgresql@16 && brew services start postgresql@16" >&2
    return 1
  fi
  case ":$PATH:" in
    *":$bin_dir:"*) ;;
    *) PATH="$bin_dir:$PATH" ;;
  esac
  export PATH
}
