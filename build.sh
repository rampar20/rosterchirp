#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# rosterchirp — Docker build & release script
#
# Usage:
#   ./build.sh              # builds rosterchirp:latest
#   ./build.sh 1.2.0        # builds rosterchirp:1.2.0 AND rosterchirp:latest
#   ./build.sh 1.2.0 push   # builds, tags, and pushes to registry
#
# To push to a registry, set REGISTRY env var:
#   REGISTRY=ghcr.io/yourname ./build.sh 1.2.0 push
#   REGISTRY=yourdockerhubuser ./build.sh 1.2.0 push
# ─────────────────────────────────────────────────────────────
set -euo pipefail

VERSION="${1:-0.13.1}"
ACTION="${2:-}"
REGISTRY="${REGISTRY:-}"
IMAGE_NAME="rosterchirp"

# If a registry is set, prefix image name
if [[ -n "$REGISTRY" ]]; then
  FULL_IMAGE="${REGISTRY}/${IMAGE_NAME}"
else
  FULL_IMAGE="${IMAGE_NAME}"
fi

echo "╔══════════════════════════════════════╗"
echo "║      rosterchirp Docker Builder      ║"
echo "╠══════════════════════════════════════╣"
echo "║  Image   : ${FULL_IMAGE}"
echo "║  Version : ${VERSION}"
echo "╚══════════════════════════════════════╝"
echo ""

# Build — npm install runs inside Docker, no host npm required
echo "▶ Building image..."
docker build \
  --build-arg BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg VERSION="${VERSION}" \
  -t "${FULL_IMAGE}:${VERSION}" \
  -t "${FULL_IMAGE}:latest" \
  -f Dockerfile \
  .

echo ""
echo "✔ Built successfully:"
echo "    ${FULL_IMAGE}:${VERSION}"
echo "    ${FULL_IMAGE}:latest"

# Optionally push
if [[ "$ACTION" == "push" ]]; then
  if [[ -z "$REGISTRY" ]]; then
    echo ""
    echo "⚠  No REGISTRY set. Pushing to Docker Hub as '${IMAGE_NAME}'."
    echo "   Set REGISTRY=youruser or REGISTRY=ghcr.io/yourorg to override."
  fi
  echo ""
  echo "▶ Pushing ${FULL_IMAGE}:${VERSION}..."
  docker push "${FULL_IMAGE}:${VERSION}"
  echo "▶ Pushing ${FULL_IMAGE}:latest..."
  docker push "${FULL_IMAGE}:latest"
  echo ""
  echo "✔ Pushed successfully."
fi

echo ""
echo "─────────────────────────────────────────"
echo "To deploy this version, set in your .env:"
echo "    ROSTERCHIRP_VERSION=${VERSION}"
echo ""
echo "Then run:"
echo "    docker compose up -d"
echo "─────────────────────────────────────────"
