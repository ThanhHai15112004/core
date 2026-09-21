#!/usr/bin/env bash
# ==============================================================================
# Script Khởi Tạo Môi Trường VPS Mới (Ubuntu/Debian) Cho Core Framework
# Chạy script này bằng quyền root: sudo bash deploy/setup-vps.sh
# ==============================================================================
set -e

echo "🚀 [1/5] Cập nhật các gói phần mềm hệ thống..."
apt-get update && apt-get upgrade -y
apt-get install -y curl wget git ufw htop ca-certificates gnupg lsb-release

# ------------------------------------------------------------------------------
# 2. Cấu hình Swap File 2GB (Giúp VPS không bị tràn RAM khi build dự án)
# ------------------------------------------------------------------------------
if [ ! -f /swapfile ]; then
  echo "💾 [2/5] Đang tạo Swap File 2GB..."
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "✅ Đã kích hoạt Swap File 2GB thành công."
else
  echo "✅ [2/5] Swap file đã tồn tại, bỏ qua."
fi

# ------------------------------------------------------------------------------
# 3. Cấu hình Tường Lửa UFW (Bảo vệ VPS)
# ------------------------------------------------------------------------------
echo "🛡️  [3/5] Thiết lập tường lửa UFW..."
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH Port'
ufw allow 80/tcp comment 'HTTP Port'
ufw allow 443/tcp comment 'HTTPS Port'
# Bật UFW không hỏi tương tác
echo "y" | ufw enable
echo "✅ Tường lửa UFW đã bật (Chỉ mở cổng 22, 80, 443)."

# ------------------------------------------------------------------------------
# 4. Cài đặt Docker & Docker Compose Engine (Official Repo)
# ------------------------------------------------------------------------------
if ! command -v docker &> /dev/null; then
  echo "🐳 [4/5] Đang cài đặt Docker Engine chính thức..."
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg

  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
    $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable docker
  systemctl start docker
  echo "✅ Docker Engine đã được cài đặt thành công."
else
  echo "✅ [4/5] Docker đã có sẵn trên VPS."
fi

echo ""
echo "🎉 [5/5] Cấu hình VPS hoàn tất!"
echo "👉 Bạn đã có thể clone mã nguồn và chạy: ./docker-prod.sh up"
