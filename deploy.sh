#!/usr/bin/env bash
# Things 一键部署/更新脚本（Linux）
# 用法：
#   ./deploy.sh         # 部署/更新并后台启动服务（自动停止旧进程）
#   ./deploy.sh stop    # 仅停止服务
#   ./deploy.sh status  # 查看服务运行状态
# 每次部署都会：停止旧服务 → 拉取最新代码 → 安装依赖 → 写入 .env → 迁移数据库 → 构建前端 → 后台启动
# 直接修改下方「配置区」即可设置账号、端口等信息，脚本配置优先生效。

set -euo pipefail
cd "$(dirname "$0")"

# ========== 配置区（按需修改）==========
# 登录账号（仅首次启动播种，之后在网页「设置」中修改密码）
AUTH_USERNAME="admin"
AUTH_PASSWORD="admin123"
# 会话签名密钥：默认值仅供快速上手，正式部署请改成自己的随机长字符串
AUTH_SECRET="things-default-secret-please-change-me"
# 服务监听地址与端口
HOST="0.0.0.0"
PORT="3000"
# SQLite 数据库文件路径（相对于 apps/server 目录）
DB_PATH="./data/app.db"
# =======================================

export AUTH_USERNAME AUTH_PASSWORD AUTH_SECRET HOST PORT DB_PATH

# 运行时文件（PID / 日志，位于 apps/server/data/，已被 .gitignore 忽略）
PID_FILE="apps/server/data/things.pid"
LOG_FILE="apps/server/data/things.log"

# 停止已运行的服务（通过 PID 文件，兜底 pgrep 查找）
stop_service() {
  local stopped=0

  if [ -f "$PID_FILE" ]; then
    local pid
    pid="$(cat "$PID_FILE")"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      echo "[deploy] 停止旧服务（PID $pid）..."
      kill "$pid" 2>/dev/null || true
      for _ in $(seq 1 10); do
        kill -0 "$pid" 2>/dev/null || break
        sleep 1
      done
      kill -9 "$pid" 2>/dev/null || true
      stopped=1
    fi
    rm -f "$PID_FILE"
  fi

  # 兜底：查找未被 PID 文件记录的服务进程
  local pids
  pids="$(pgrep -f 'bun src/index\.ts' 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "[deploy] 发现残留服务进程：$pids，停止中..."
    kill $pids 2>/dev/null || true
    sleep 2
    kill -9 $pids 2>/dev/null || true
    stopped=1
  fi

  [ "$stopped" -eq 1 ] && echo "[deploy] 旧服务已停止" || echo "[deploy] 未发现运行中的服务"
}

case "${1:-}" in
  stop)
    stop_service
    exit 0
    ;;
  status)
    if pgrep -f 'bun src/index\.ts' >/dev/null 2>&1; then
      echo "[deploy] 服务运行中：http://127.0.0.1:${PORT}（日志：$LOG_FILE）"
    else
      echo "[deploy] 服务未运行"
    fi
    exit 0
    ;;
esac

# 1. 停止旧服务（更新部署前必须先停掉）
stop_service

# 2. 拉取最新代码（git 仓库才执行；手动上传部署可跳过）
if [ -d .git ] && command -v git >/dev/null 2>&1; then
  echo "[deploy] 拉取最新代码..."
  git pull --ff-only || echo "[deploy] git pull 失败（可能有本地改动或网络问题），继续使用当前代码部署"
fi

# 3. 检查 Bun
if ! command -v bun >/dev/null 2>&1; then
  echo "[deploy] 未检测到 Bun，正在安装..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
fi
echo "[deploy] Bun 版本：$(bun --version)"

# 4. 安装依赖
echo "[deploy] 安装依赖..."
bun install

# 5. 将配置写入 .env（已存在则跳过；脚本导出的环境变量优先级高于 .env）
if [ ! -f apps/server/.env ]; then
  cat > apps/server/.env <<EOF
# 账号（仅首次启动播种，之后可在设置页修改密码）
AUTH_USERNAME=${AUTH_USERNAME}
AUTH_PASSWORD=${AUTH_PASSWORD}
# 会话签名密钥
AUTH_SECRET=${AUTH_SECRET}
# 服务
HOST=${HOST}
PORT=${PORT}
DB_PATH=${DB_PATH}
EOF
  echo "[deploy] 已写入 apps/server/.env"
else
  echo "[deploy] apps/server/.env 已存在，跳过（本次以脚本配置区的环境变量为准）"
fi

# 6. 数据库迁移（服务启动时也会自动迁移，这里提前执行以便尽早报错）
echo "[deploy] 执行数据库迁移..."
bun run db:migrate

# 7. 构建前端
echo "[deploy] 构建前端..."
bun run build

# 8. 后台启动服务
echo "[deploy] 后台启动服务..."
mkdir -p "$(dirname "$LOG_FILE")"
cd apps/server
nohup bun src/index.ts > "$(basename "$LOG_FILE")" 2>&1 &
echo $! > "$(basename "$PID_FILE")"
cd ..

# 9. 等待服务就绪
echo "[deploy] 等待服务启动..."
for _ in $(seq 1 15); do
  if curl -fs "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    echo "[deploy] 服务已启动（PID $(cat "$PID_FILE")）"
    echo "[deploy] 访问地址：http://<本机IP>:${PORT}，日志：$LOG_FILE"
    exit 0
  fi
  sleep 1
done

echo "[deploy] 服务未在预期时间内就绪，请查看日志：tail -n 50 $LOG_FILE" >&2
exit 1
