#!/usr/bin/env bash
# 生产启停共用：按 PID 树 / 端口清理进程。由其它脚本 source。

is_pid_running() {
  local pid="${1:-}"
  [[ "$pid" =~ ^[0-9]+$ ]] && ((pid > 1)) && kill -0 "$pid" 2>/dev/null
}

read_pid_file() {
  local file="$1"
  local pid=""
  if [[ -f "$file" ]]; then
    pid="$(tr -d '[:space:]' <"$file" 2>/dev/null || true)"
  fi
  if [[ "$pid" =~ ^[0-9]+$ ]]; then
    printf '%s\n' "$pid"
  fi
}

list_descendant_pids() {
  local pid="$1"
  local child
  local children
  children="$(pgrep -P "$pid" 2>/dev/null || true)"
  for child in $children; do
    list_descendant_pids "$child"
    printf '%s\n' "$child"
  done
}

_unique_pids() {
  awk '($1+0) > 1 { print $1+0 }' | sort -u
}

listening_pids_on_port() {
  local port="$1"
  local out=""
  local chunk=""

  if command -v lsof >/dev/null 2>&1; then
    chunk="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)"
    [[ -n "${chunk//[$' \t\n']/}" ]] || chunk="$(lsof -nP -iTCP:"$port" -t 2>/dev/null || true)"
    [[ -n "${chunk//[$' \t\n']/}" ]] || chunk="$(lsof -nP -i :"${port}" -t 2>/dev/null || true)"
    out="${out}"$'\n'"${chunk}"
  fi
  if command -v fuser >/dev/null 2>&1; then
    chunk="$(fuser "${port}/tcp" 2>/dev/null || true)"
    [[ -n "${chunk//[$' \t\n']/}" ]] || chunk="$(fuser -n tcp "$port" 2>/dev/null || true)"
    out="${out}"$'\n'"${chunk}"
  fi
  if command -v ss >/dev/null 2>&1; then
    chunk="$(ss -lptn "sport = :${port}" 2>/dev/null | grep -oE 'pid=[0-9]+' | grep -oE '[0-9]+' || true)"
    out="${out}"$'\n'"${chunk}"
  fi

  printf '%s\n' $out | grep -E '^[0-9]+$' | _unique_pids || true
}

port_is_listening() {
  local port="$1"
  local host="${2:-127.0.0.1}"
  local pids

  pids="$(listening_pids_on_port "$port")"
  if [[ -n "$pids" ]]; then
    return 0
  fi

  if command -v python3 >/dev/null 2>&1; then
    python3 - "$host" "$port" <<'PY' >/dev/null 2>&1
import socket, sys
host, port = sys.argv[1], int(sys.argv[2])
s = socket.socket()
s.settimeout(0.4)
try:
    raise SystemExit(0 if s.connect_ex((host, port)) == 0 else 1)
finally:
    s.close()
PY
    return $?
  fi

  return 1
}

kill_pid_tree() {
  local pid="$1"
  local extra=""
  local child
  local i=0

  if ! is_pid_running "$pid"; then
    return 0
  fi

  extra="$(list_descendant_pids "$pid" | tr '\n' ' ')"
  # shellcheck disable=SC2086
  kill -TERM "$pid" $extra 2>/dev/null || true

  while ((i < 10)); do
    if ! is_pid_running "$pid"; then
      return 0
    fi
    sleep 1
    i=$((i + 1))
  done

  # shellcheck disable=SC2086
  kill -KILL "$pid" $extra 2>/dev/null || true
  sleep 0.3
  for child in $extra; do
    kill -KILL "$child" 2>/dev/null || true
  done
  kill -KILL "$pid" 2>/dev/null || true
}

stop_by_pid_file() {
  local pid_file="$1"
  local service_name="$2"
  local pid=""

  if [[ ! -f "$pid_file" ]]; then
    echo "${service_name} 未找到 PID 文件"
    return 0
  fi

  pid="$(read_pid_file "$pid_file")"
  rm -f "$pid_file"

  if [[ -z "$pid" ]]; then
    echo "${service_name} PID 文件无效，已清理"
    return 0
  fi

  if ! is_pid_running "$pid"; then
    echo "${service_name} 进程不存在 (PID: ${pid})，已清理 PID 文件"
    return 0
  fi

  echo "正在停止 ${service_name} (PID: ${pid}) ..."
  kill_pid_tree "$pid"
  if is_pid_running "$pid"; then
    echo "${service_name} 未能停止 (PID: ${pid})" >&2
    return 1
  fi
  echo "已停止 ${service_name} (PID: ${pid})"
}

stop_matching_processes() {
  local pattern="$1"
  local service_name="$2"
  local pid
  local pids=""

  if ! command -v pgrep >/dev/null 2>&1; then
    return 0
  fi

  pids="$(pgrep -f "$pattern" 2>/dev/null || true)"
  if [[ -z "$pids" ]]; then
    return 0
  fi

  echo "${service_name} 仍有匹配进程，继续清理：$(echo "$pids" | tr '\n' ' ')"
  for pid in $pids; do
    if [[ "$pid" == "$$" || "$pid" == "$PPID" ]]; then
      continue
    fi
    kill_pid_tree "$pid"
  done
}

stop_listeners_on_port() {
  local port="$1"
  local service_name="$2"
  local pid
  local pids
  local leftover=0

  pids="$(listening_pids_on_port "$port")"
  if [[ -z "$pids" ]]; then
    return 0
  fi

  echo "${service_name} 端口 ${port} 仍被占用，继续清理：$(echo "$pids" | tr '\n' ' ')"
  for pid in $pids; do
    kill_pid_tree "$pid"
  done

  pids="$(listening_pids_on_port "$port")"
  for pid in $pids; do
    leftover=1
    echo "${service_name} 端口 ${port} 仍有进程 PID ${pid}" >&2
  done
  return "$leftover"
}

wait_for_pid_and_port() {
  local pid="$1"
  local port="$2"
  local name="$3"
  local log_file="$4"
  local attempts="${5:-30}"
  local i=0

  while ((i < attempts)); do
    if ! is_pid_running "$pid"; then
      echo "${name} 启动失败（进程已退出），请查看日志：${log_file}" >&2
      if [[ -f "$log_file" ]]; then
        echo "---- ${log_file} 末尾 ----" >&2
        tail -n 40 "$log_file" >&2 || true
      fi
      return 1
    fi
    if port_is_listening "$port"; then
      return 0
    fi
    sleep 1
    i=$((i + 1))
  done

  echo "${name} 进程还在，但端口 ${port} 未就绪，请查看日志：${log_file}" >&2
  if [[ -f "$log_file" ]]; then
    echo "---- ${log_file} 末尾 ----" >&2
    tail -n 40 "$log_file" >&2 || true
  fi
  return 1
}

# 在后台启动进程，PID 写入 pid_file，并通过全局变量 DAEMON_PID 返回。
# 不要用 $(start_daemon) 取值：命令替换会一直等到后台进程退出。
start_daemon() {
  local pid_file="$1"
  local log_file="$2"
  local workdir="$3"
  local saved="$PWD"
  shift 3

  mkdir -p "$(dirname "$pid_file")" "$(dirname "$log_file")"
  cd "$workdir"
  nohup "$@" </dev/null >>"$log_file" 2>&1 &
  DAEMON_PID=$!
  cd "$saved"
  printf '%s\n' "$DAEMON_PID" >"$pid_file"
}
