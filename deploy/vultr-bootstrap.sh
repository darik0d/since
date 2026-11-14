#!/usr/bin/env bash
# FALLBACK ONLY: primary deploy is Aiven Runtime. Not used unless Runtime access fails.
# Run ONCE on a fresh Vultr Ubuntu 24.04 VM as root:  bash vultr-bootstrap.sh
set -euo pipefail
apt-get update
apt-get install -y ca-certificates curl ufw
curl -fsSL https://get.docker.com | sh
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
mkdir -p /opt/since
IP=$(curl -fsS https://api.ipify.org || hostname -I | awk '{print $1}')
echo
echo "Docker ready. Public IP: $IP"
echo "SITE_DOMAIN=${IP//./-}.sslip.io"
echo "PUBLIC_BASE_URL=https://${IP//./-}.sslip.io"
