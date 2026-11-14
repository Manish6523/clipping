#!/usr/bin/env bash
# Finish setting up a fresh (big) Oracle VM after ./deploy_vps.sh:
#   * nginx reverse proxy for your domain (port 80 -> 127.0.0.1:8080), same config as ORACLE_CLOUD_SETUP.md
#   * port 80 open in the OS firewall
#   * a small safety swap file (2 GB) if the machine has none
#   * config/.env: created from the example if missing, plus tuning for a 4-core / 24 GB machine
#     (only values that are not already set)
#
# Usage:  ./scripts/bootstrap_arm_vps.sh clip.manish.casa
# Safe to run twice.
set -euo pipefail

DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then
  echo "usage: $0 <domain>   e.g. $0 clip.manish.casa" >&2
  exit 2
fi
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$APP_DIR/config/.env"

echo "[1/4] nginx for $DOMAIN"
sudo apt-get update -y >/dev/null
sudo apt-get install -y nginx >/dev/null
sudo tee "/etc/nginx/sites-available/$DOMAIN" >/dev/null <<EOF
server {
    listen 80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
        client_max_body_size 500M;
    }
}
EOF
sudo ln -sf "/etc/nginx/sites-available/$DOMAIN" "/etc/nginx/sites-enabled/$DOMAIN"
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx

echo "[2/4] firewall: allow TCP 80"
if ! sudo iptables -C INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null; then
  sudo iptables -I INPUT 1 -p tcp --dport 80 -j ACCEPT
fi
if command -v netfilter-persistent >/dev/null 2>&1; then
  sudo netfilter-persistent save >/dev/null || true
else
  sudo mkdir -p /etc/iptables && sudo iptables-save | sudo tee /etc/iptables/rules.v4 >/dev/null
fi

echo "[3/4] safety swap"
if [ "$(swapon --show --noheadings | wc -l)" -eq 0 ]; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  # keep the machine in RAM; swap is only a last resort
  echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-autoclip.conf >/dev/null
  sudo sysctl -p /etc/sysctl.d/99-autoclip.conf >/dev/null
  echo "  created 2 GB swap"
else
  echo "  swap already present"
fi

echo "[4/4] tuning config/.env"
if [ ! -f "$ENV_FILE" ]; then
  cp "$APP_DIR/config/.env.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "  created $ENV_FILE from the example - you still have to fill in the Telegram + Gemini values"
fi
set_default() {  # set KEY=VALUE only if KEY is not defined yet
  local key="$1" value="$2"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    echo "  $key already set - left alone"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
    echo "  $key=$value"
  fi
}
set_default WHISPER_CONCURRENCY 2
set_default MAX_CONCURRENT_JOBS 2
set_default LIVE_WHISPER_MODEL small

echo
echo "Done. Next: edit $ENV_FILE (TELEGRAM_BOT_TOKEN, ADMIN_CHAT_ID, GEMINI_API_KEY), then: sudo systemctl start autoclip"
