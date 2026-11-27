#!/usr/bin/env bash
# ==============================================================================
# Phase 15.3 — 1-Command Build-Once Release Builder
#
# Build 1 lần duy nhất toàn bộ 3 production image (backend, frontend, nginx),
# tự động gắn Version + Git Commit SHA + Build Time + OCI Labels, tùy chọn
# `--push` lên Registry và xuất `reports/release-manifest.json` để deploy qua
# Development -> Staging -> Production mà không cần build lại.
#
# Cách dùng:
#   npm run deploy:build                                            # Build local + xuất release-manifest.json
#   npm run deploy:build -- --push --namespace org/core             # Build + Push GHCR + khóa @sha256 digest
#   npm run deploy:build -- --version 1.2.0 --push --registry ...   # Chỉ định version & registry riêng
#   npm run deploy:build -- --dry-run                               # Xem kế hoạch build không thực thi docker
# ==============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

REGISTRY="${IMAGE_REGISTRY:-ghcr.io}"
NAMESPACE="${IMAGE_NAMESPACE:-}"
VERSION="${APP_VERSION:-}"
GIT_REF="${GITHUB_REF:-${CI_COMMIT_REF_NAME:-}}"
SOURCE_URL="${APP_SOURCE_URL:-}"
OUT_MANIFEST="${RELEASE_MANIFEST:-reports/release-manifest.json}"
PUSH=false
DRY_RUN=false

while [ "$#" -gt 0 ]; do
  case "$1" in
    --registry) REGISTRY="$2"; shift 2 ;;
    --namespace) NAMESPACE="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    --git-ref) GIT_REF="$2"; shift 2 ;;
    --source-url) SOURCE_URL="$2"; shift 2 ;;
    --out) OUT_MANIFEST="$2"; shift 2 ;;
    --push) PUSH=true; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

COMMIT_SHA="${APP_GIT_COMMIT:-${GITHUB_SHA:-${CI_COMMIT_SHA:-$(git rev-parse HEAD 2>/dev/null || echo '0000000')}}}"
SHORT_SHA="${COMMIT_SHA:0:7}"
BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
PKG_VERSION="$(node -e "console.log(JSON.parse(require('fs').readFileSync('backend/package.json','utf8')).version || '1.0.0')")"

if [ -z "$GIT_REF" ]; then
  GIT_REF="$(git describe --tags --exact-match 2>/dev/null || git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'local')"
fi

if [ -z "$VERSION" ]; then
  VERSION="$(node -e "import('./scripts/deploy/release-manifest.mjs').then(m => console.log(m.deriveReleaseVersion({ gitRef: process.argv[1], packageVersion: process.argv[2], commitSha: process.argv[3] })))" "$GIT_REF" "$PKG_VERSION" "$COMMIT_SHA")"
fi

if [ -z "$NAMESPACE" ]; then
  if [ -n "${GITHUB_REPOSITORY:-}" ]; then
    NAMESPACE="$(printf '%s' "$GITHUB_REPOSITORY" | tr '[:upper:]' '[:lower:]')"
  elif [ -n "${CI_PROJECT_PATH:-}" ]; then
    NAMESPACE="$(printf '%s' "$CI_PROJECT_PATH" | tr '[:upper:]' '[:lower:]')"
  else
    REMOTE_URL="$(git config --get remote.origin.url 2>/dev/null || true)"
    if [ -n "$REMOTE_URL" ]; then
      NAMESPACE="$(printf '%s' "$REMOTE_URL" | sed -E 's#^(https?://[^/]+/|ssh://[^/]+/|git@[^:]+:)##; s#\.git$##' | tr '[:upper:]' '[:lower:]')"
    else
      NAMESPACE="core"
    fi
  fi
fi

if [ -z "$SOURCE_URL" ]; then
  SOURCE_URL="$(git config --get remote.origin.url 2>/dev/null | sed -E 's#^git@([^:]+):#https://\1/#; s#\.git$##' || true)"
fi

TAG="sha-${SHORT_SHA}"
BACKEND_REPO="${REGISTRY}/${NAMESPACE}/core-backend"
FRONTEND_REPO="${REGISTRY}/${NAMESPACE}/core-frontend"
NGINX_REPO="${REGISTRY}/${NAMESPACE}/core-nginx"

echo "🔨 [build-release] Build-Once Artifact Plan:"
echo "  • Version    : ${VERSION}"
echo "  • Commit SHA : ${COMMIT_SHA} (${SHORT_SHA})"
echo "  • Build Time : ${BUILD_TIME}"
echo "  • Registry   : ${REGISTRY}/${NAMESPACE}"
echo "  • Push       : ${PUSH}"
echo "  • Manifest   : ${OUT_MANIFEST}"

if [ "$DRY_RUN" = true ]; then
  echo "  • Backend    : ${BACKEND_REPO}:${TAG} (+ :${VERSION})"
  echo "  • Frontend   : ${FRONTEND_REPO}:${TAG} (+ :${VERSION})"
  echo "  • Nginx      : ${NGINX_REPO}:${TAG} (+ :${VERSION})"
  echo "✅ [build-release] DRY-RUN hoàn tất — chưa gọi docker build."
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "✗ [build-release] Không tìm thấy Docker CLI trên máy hiện tại." >&2
  exit 1
fi

build_one() {
  local name="$1"
  local dockerfile="$2"
  local repo="$3"
  local extra_args=()

  if [ "$name" = "core-frontend" ]; then
    extra_args+=(--build-arg "VITE_API_BASE_URL=/api/v1")
  fi

  echo ""
  echo "📦 [build-release] Building ${name} (${dockerfile})..."
  docker build -f "$dockerfile" \
    --build-arg "APP_VERSION=${VERSION}" \
    --build-arg "APP_GIT_COMMIT=${COMMIT_SHA}" \
    --build-arg "APP_BUILD_TIME=${BUILD_TIME}" \
    --build-arg "APP_IMAGE=${repo}:${VERSION}" \
    --build-arg "APP_SOURCE_URL=${SOURCE_URL}" \
    "${extra_args[@]}" \
    -t "${repo}:${TAG}" \
    -t "${repo}:${VERSION}" \
    .

  if [ "$PUSH" = true ]; then
    echo "⬆️  [build-release] Pushing ${repo}:${TAG} & :${VERSION}..."
    docker push "${repo}:${TAG}"
    docker push "${repo}:${VERSION}"
  fi
}

extract_digest() {
  local repo="$1"
  if [ "$PUSH" != true ]; then
    printf ''
    return 0
  fi
  docker inspect --format='{{range .RepoDigests}}{{println .}}{{end}}' "${repo}:${TAG}" \
    | grep "^${repo}@sha256:" | head -n 1 | awk -F'@' '{print $2}' || true
}

build_one "core-backend" "docker/backend/Dockerfile.prod" "$BACKEND_REPO"
build_one "core-frontend" "docker/frontend/Dockerfile.prod" "$FRONTEND_REPO"
build_one "core-nginx" "docker/nginx/Dockerfile" "$NGINX_REPO"

BACKEND_DIGEST="$(extract_digest "$BACKEND_REPO")"
FRONTEND_DIGEST="$(extract_digest "$FRONTEND_REPO")"
NGINX_DIGEST="$(extract_digest "$NGINX_REPO")"

MANIFEST_ARGS=(
  --create
  --version "$VERSION"
  --commit "$COMMIT_SHA"
  --git-ref "$GIT_REF"
  --built-at "$BUILD_TIME"
  --registry "$REGISTRY"
  --namespace "$NAMESPACE"
  --tag "$TAG"
  --out "$OUT_MANIFEST"
)

if [ -n "$SOURCE_URL" ]; then MANIFEST_ARGS+=(--source-url "$SOURCE_URL"); fi
if [ -n "$BACKEND_DIGEST" ]; then MANIFEST_ARGS+=(--backend-digest "$BACKEND_DIGEST"); fi
if [ -n "$FRONTEND_DIGEST" ]; then MANIFEST_ARGS+=(--frontend-digest "$FRONTEND_DIGEST"); fi
if [ -n "$NGINX_DIGEST" ]; then MANIFEST_ARGS+=(--nginx-digest "$NGINX_DIGEST"); fi

node scripts/deploy/release-manifest.mjs "${MANIFEST_ARGS[@]}"

if [ "$PUSH" = true ]; then
  node scripts/deploy/release-manifest.mjs --validate "$OUT_MANIFEST" --require-digest
else
  node scripts/deploy/release-manifest.mjs --validate "$OUT_MANIFEST"
fi

echo ""
echo "✅ [build-release] Hoàn tất! Dùng đúng file [${OUT_MANIFEST}] để deploy mọi môi trường (không build lại):"
echo "   npm run deploy:run -- --env staging --manifest ${OUT_MANIFEST} --strategy rolling --base-url https://staging.yourdomain.com"
echo "   npm run deploy:run -- --env production --manifest ${OUT_MANIFEST} --strategy blue-green --base-url https://yourdomain.com"
