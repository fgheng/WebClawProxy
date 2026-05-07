#!/usr/bin/env bash
# scripts/dev-tui.sh
#
# 一键启动 WebClawProxy TUI 开发环境
#   - Proxy & Agent Service 在后台运行，日志写入 .logs/
#   - TUI 独占前台终端（readline 界面不被日志打断）
#   - Ctrl-C 或 TUI 退出后自动 kill 后台进程
#
# 用法：npm run dev:tui

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT_DIR"

mkdir -p .logs
# 清空上次日志
: > .logs/proxy.log
: > .logs/agent.log

cleanup() {
  echo ""
  echo "正在关闭 Proxy & Agent Service..."
  kill "$PROXY_PID" "$AGENT_PID" 2>/dev/null || true
  wait "$PROXY_PID" "$AGENT_PID" 2>/dev/null || true
  echo "已全部退出"
}
trap cleanup EXIT INT TERM

# ── 1. 启动 Proxy（后台，日志写文件）──────────────────────────────────────
echo "[dev:tui] 启动 Proxy..."
npx ts-node src/controller/index.ts >> .logs/proxy.log 2>&1 &
PROXY_PID=$!

echo "[dev:tui] 等待 Proxy 就绪 (port 3000)..."
npx wait-on tcp:3000 --timeout 30000

# ── 2. 启动 Agent Service（后台，日志写文件）───────────────────────────────
echo "[dev:tui] 启动 Agent Service..."
WEBCLAW_AGENT_PORT=8100 WEBCLAW_PROXY_URL=http://localhost:3000 \
  npx ts-node client-core/src/server/index.ts >> .logs/agent.log 2>&1 &
AGENT_PID=$!

echo "[dev:tui] 等待 Agent Service 就绪 (port 8100)..."
npx wait-on tcp:8100 --timeout 30000

echo "[dev:tui] 后台日志：tail -f .logs/proxy.log  |  tail -f .logs/agent.log"
echo ""

# ── 3. 前台运行 TUI（独占终端）─────────────────────────────────────────────
npx ts-node tui/src/index.ts -- --agent-url http://localhost:8100
