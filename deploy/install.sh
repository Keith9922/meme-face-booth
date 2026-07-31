#!/usr/bin/env bash
# 在服务器上把表情包库跑起来（Ubuntu / Debian）。
#
#   ssh 到服务器后：
#     git clone https://github.com/Keith9922/meme-face-booth.git /opt/mimic
#     cd /opt/mimic && sudo bash deploy/install.sh
#
# 装完后：素材管理台带 token 鉴权，现场装置从这里同步素材到本地离线跑。
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE=/etc/systemd/system/mimic.service
ENV_FILE=/etc/mimic.env
PORT="${PORT:-5173}"

[ "$(id -u)" = "0" ] || { echo "请用 root 或 sudo 运行"; exit 1; }

echo "==> 检查 Node"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "==> 拉模型和 wasm（约 51MB）"
sudo -u "${SUDO_USER:-root}" bash "$APP_DIR/setup.sh" || bash "$APP_DIR/setup.sh"

echo "==> 生成管理 token"
if [ -f "$ENV_FILE" ] && grep -q ADMIN_TOKEN "$ENV_FILE"; then
  echo "    已存在，保留原 token（要换就删掉 $ENV_FILE 重跑）"
else
  TOKEN="$(head -c 24 /dev/urandom | base64 | tr -d '/+=' | head -c 32)"
  cat > "$ENV_FILE" <<EOF
HOST=0.0.0.0
PORT=$PORT
ADMIN_TOKEN=$TOKEN
EOF
  chmod 600 "$ENV_FILE"
  echo
  echo "    ┌──────────────────────────────────────────────────┐"
  echo "    │ 管理 token（只显示这一次，记下来）               │"
  echo "    │ $TOKEN"
  echo "    └──────────────────────────────────────────────────┘"
  echo
fi

echo "==> 安装 systemd 服务"
sed "s|__APP_DIR__|$APP_DIR|g" "$APP_DIR/deploy/mimic.service" > "$SERVICE"
systemctl daemon-reload
systemctl enable --now mimic
sleep 1
systemctl --no-pager --lines=5 status mimic || true

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
cat <<EOF

装好了。

  装置        http://$IP:$PORT/
  素材管理    http://$IP:$PORT/admin.html      （首次操作会问 token）
  token 存在  $ENV_FILE

还要做两件事：

  1. 放行端口       ufw allow $PORT/tcp    （或在云厂商安全组里开）
  2. 套上 HTTPS     摄像头需要 secure context，纯 IP + http 打不开摄像头。
                    管理台用 http 没问题；装置页必须 https 或 localhost。
                    建议用 caddy 一行搞定：
                      apt install -y caddy
                      caddy reverse-proxy --from mimic.你的域名 --to 127.0.0.1:$PORT

现场装置不要直连这台服务器跑 —— 网一抖就白屏。用：
  node tools/sync.mjs http://$IP:$PORT
把素材同步到本地，然后本机 node serve.mjs 离线跑。
EOF
