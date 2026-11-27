#!/usr/bin/env bash
# ==============================================================================
# 15.2.4 & 15.2.7 — Quét Docker Image (OS & Library CVE) và sinh Image SBOM (CycloneDX)
#
# Cách dùng:
#   bash scripts/security/scan-docker-images.sh                    # Build & quét 3 image prod
#   bash scripts/security/scan-docker-images.sh --skip-build       # Chỉ quét image đã có sẵn local
#   bash scripts/security/scan-docker-images.sh --dry-run          # Kiểm tra kế hoạch quét không build
# ==============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

SKIP_BUILD=false
DRY_RUN=false
SEVERITY_FAIL="CRITICAL,HIGH"
TRIVY_DOCKER_IMAGE="${TRIVY_DOCKER_IMAGE:-aquasec/trivy:0.58.1}"
OUT_DIR="${REPO_ROOT}/reports"
SBOM_DIR="${OUT_DIR}/sbom"

for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=true ;;
    --dry-run) DRY_RUN=true ;;
  esac
done

mkdir -p "$OUT_DIR" "$SBOM_DIR"

IMAGES=(
  "core-backend:ci-scan|docker/backend/Dockerfile.prod"
  "core-frontend:ci-scan|docker/frontend/Dockerfile.prod"
  "core-nginx:ci-scan|docker/nginx/Dockerfile"
)

if [ "$DRY_RUN" = true ]; then
  echo "🔍 [security:images] Dry-run danh sách Docker Image sẽ quét (fail threshold: ${SEVERITY_FAIL}):"
  for item in "${IMAGES[@]}"; do
    IFS='|' read -r tag dockerfile <<< "$item"
    echo "  • ${tag}  ←  ${dockerfile}"
  done
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "✗ [security:images] Không tìm thấy Docker CLI trên môi trường hiện tại." >&2
  exit 1
fi

run_trivy() {
  if command -v trivy >/dev/null 2>&1; then
    trivy "$@"
  else
    docker run --rm \
      -v /var/run/docker.sock:/var/run/docker.sock:ro \
      -v "${REPO_ROOT}:/workspace" \
      -v "${HOME}/.cache/trivy:/root/.cache/" \
      -w /workspace \
      "$TRIVY_DOCKER_IMAGE" "$@"
  fi
}

OVERALL_RC=0
SUMMARY_ENTRIES=()

for item in "${IMAGES[@]}"; do
  IFS='|' read -r image_tag dockerfile <<< "$item"
  short_name="${image_tag%%:*}"

  if [ "$SKIP_BUILD" = false ]; then
    echo "🔨 [security:images] Building ${image_tag} từ ${dockerfile}..."
    docker build -f "$dockerfile" -t "$image_tag" .
  fi

  json_rel="reports/trivy-image-${short_name}.json"
  sbom_rel="reports/sbom/${short_name}-image.cdx.json"

  echo "🔍 [security:images] Scanning OS & Library vulnerabilities: ${image_tag}..."
  rc=0
  run_trivy image \
    --ignorefile .trivyignore \
    --severity "$SEVERITY_FAIL" \
    --ignore-unfixed \
    --format json \
    --output "$json_rel" \
    --exit-code 1 \
    "$image_tag" || rc=$?

  echo "📦 [security:images] Generating CycloneDX Image SBOM: ${sbom_rel}..."
  run_trivy image \
    --format cyclonedx \
    --output "$sbom_rel" \
    "$image_tag" || true

  if [ "$rc" -ne 0 ]; then
    echo "✗ [security:images] ${image_tag} phát hiện lỗ hổng mức ${SEVERITY_FAIL} (chi tiết: ${json_rel})"
    OVERALL_RC=1
    SUMMARY_ENTRIES+=("{\"image\":\"${image_tag}\",\"dockerfile\":\"${dockerfile}\",\"report\":\"${json_rel}\",\"sbom\":\"${sbom_rel}\",\"passed\":false}")
  else
    echo "✓ [security:images] ${image_tag}: đạt ngưỡng bảo mật (${SEVERITY_FAIL})."
    SUMMARY_ENTRIES+=("{\"image\":\"${image_tag}\",\"dockerfile\":\"${dockerfile}\",\"report\":\"${json_rel}\",\"sbom\":\"${sbom_rel}\",\"passed\":true}")
  fi
done

# Xuất báo cáo tổng hợp để `ci-report.mjs` thu thập
IMAGES_JSON=$(IFS=,; echo "[${SUMMARY_ENTRIES[*]}]")
node -e "
  const fs = require('node:fs');
  const images = ${IMAGES_JSON};
  const findings = [];
  for (const img of images) {
    if (!fs.existsSync(img.report)) continue;
    const raw = JSON.parse(fs.readFileSync(img.report, 'utf8'));
    for (const r of raw.Results || []) {
      for (const v of r.Vulnerabilities || []) {
        const sev = String(v.Severity || 'MEDIUM').toUpperCase();
        findings.push({
          rule: 'IMAGE-CVE:' + (v.VulnerabilityID || 'UNKNOWN'),
          image: img.image,
          target: r.Target || img.image,
          package: v.PkgName || 'unknown',
          installedVersion: v.InstalledVersion || '',
          fixedVersion: v.FixedVersion || '',
          severity: sev === 'CRITICAL' ? 'Critical' : sev === 'HIGH' ? 'High' : sev === 'MEDIUM' ? 'Medium' : 'Low',
          status: (sev === 'CRITICAL' || sev === 'HIGH') ? 'FAIL' : 'WARN',
          category: 'Docker Image Scan',
          file: img.dockerfile,
          line: 1,
          message: '[' + img.image + '] ' + (v.PkgName || '') + '@' + (v.InstalledVersion || '') + ' (' + sev + '): ' + (v.Title || v.VulnerabilityID),
          remediation: v.FixedVersion ? ('Nâng cấp lên phiên bản >= ' + v.FixedVersion + ' hoặc cập nhật base image.') : 'Cập nhật base image mới nhất và theo dõi bản vá.'
        });
      }
    }
  }
  const fail = findings.filter(f => f.status === 'FAIL').length;
  const warn = findings.filter(f => f.status === 'WARN').length;
  const out = {
    generatedAt: new Date().toISOString(),
    gate: 'Security Docker Image Scan',
    failThreshold: '${SEVERITY_FAIL}',
    images,
    summary: { total: findings.length, fail, warn },
    passed: fail === 0 && ${OVERALL_RC} === 0,
    findings
  };
  fs.writeFileSync('reports/security-docker-report.json', JSON.stringify(out, null, 2) + '\n');
"

exit "$OVERALL_RC"
