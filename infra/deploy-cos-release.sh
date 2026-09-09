#!/usr/bin/env bash

set -Eeuo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./infra/deploy-cos-release.sh <staging|production> [latest|release-id]

Examples:
  ./infra/deploy-cos-release.sh staging
  ./infra/deploy-cos-release.sh staging latest
  ./infra/deploy-cos-release.sh production 20260908T171625Z-cacea3d755e6

Environment variables:
  CEES_RELEASE_COS_ALIAS   COSCLI bucket alias (default: cees-release)
  CEES_RELEASE_COS_CONFIG  COSCLI config path (default: $HOME/.cos.yaml)
  CEES_RELEASE_COS_PREFIX  COS object prefix (default: releases)
  CEES_RELEASE_CACHE_DIR   Local release cache (default: <repo>/.release-cache)

The script downloads a completed release from COS, verifies its metadata and SHA-256,
loads the Docker images, updates API_IMAGE/AI_SERVICE_IMAGE/IMAGE_TAG in the target
environment file, and starts the application without building or pulling images.
EOF
}

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Error: required command is unavailable: $command_name" >&2
    exit 1
  fi
}

json_string_value() {
  local file="$1"
  local field="$2"
  awk -F '"' -v field="$field" '$2 == field { print $4; exit }' "$file"
}

read_release_value() {
  local file="$1"
  local key="$2"
  local line

  line="$(grep -E "^${key}=" "$file" | tail -n 1 || true)"
  line="${line%$'\r'}"
  printf '%s' "${line#*=}"
}

validate_release_id() {
  local release_id="$1"
  if [[ -z "$release_id" || ${#release_id} -gt 128 || ! "$release_id" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]*$ ]]; then
    echo "Error: invalid release id: $release_id" >&2
    exit 1
  fi
}

cos_download() {
  local object_key="$1"
  local destination="$2"

  rm -f -- "$destination"
  echo "Downloading cos://${COS_ALIAS}/${object_key}"
  coscli cp \
    "cos://${COS_ALIAS}/${object_key}" \
    "$destination" \
    --config-path "$COS_CONFIG" \
    --log-path "$COS_LOG_DIR" \
    --process-log-path "$COS_LOG_DIR" \
    --fail-output-path "$COS_LOG_DIR" \
    --err-retry-num 10 \
    --err-retry-interval 3
}

update_deployment_env() {
  local env_file="$1"
  local api_image="$2"
  local ai_service_image="$3"
  local image_tag="$4"
  local temp_file

  temp_file="$(mktemp "${env_file}.release.XXXXXX")"
  awk \
    -v api_image="$api_image" \
    -v ai_service_image="$ai_service_image" \
    -v image_tag="$image_tag" '
      BEGIN {
        api_seen = 0
        ai_seen = 0
        tag_seen = 0
      }
      /^API_IMAGE=/ {
        print "API_IMAGE=" api_image
        api_seen = 1
        next
      }
      /^AI_SERVICE_IMAGE=/ {
        print "AI_SERVICE_IMAGE=" ai_service_image
        ai_seen = 1
        next
      }
      /^IMAGE_TAG=/ {
        print "IMAGE_TAG=" image_tag
        tag_seen = 1
        next
      }
      {
        sub(/\r$/, "")
        print
      }
      END {
        if (!api_seen) print "API_IMAGE=" api_image
        if (!ai_seen) print "AI_SERVICE_IMAGE=" ai_service_image
        if (!tag_seen) print "IMAGE_TAG=" image_tag
      }
    ' "$env_file" > "$temp_file"

  chmod --reference="$env_file" "$temp_file" 2>/dev/null || chmod 600 "$temp_file"
  mv -f -- "$temp_file" "$env_file"
}

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENVIRONMENT="${1:-}"
RELEASE_REFERENCE="${2:-latest}"
if [[ $# -gt 2 ]]; then
  usage >&2
  exit 2
fi

case "$ENVIRONMENT" in
  staging)
    RELEASE_CHANNEL="staging"
    MANAGE_ENVIRONMENT="staging"
    ENV_FILE="$ROOT_DIR/.env.staging"
    ;;
  production | prod)
    RELEASE_CHANNEL="prod"
    MANAGE_ENVIRONMENT="production"
    ENV_FILE="$ROOT_DIR/.env.production"
    ;;
  -h | --help | help)
    usage
    exit 0
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

COS_ALIAS="${CEES_RELEASE_COS_ALIAS:-cees-release}"
COS_CONFIG="${CEES_RELEASE_COS_CONFIG:-$HOME/.cos.yaml}"
COS_PREFIX="${CEES_RELEASE_COS_PREFIX:-releases}"
RELEASE_CACHE_DIR="${CEES_RELEASE_CACHE_DIR:-$ROOT_DIR/.release-cache}"
COS_LOG_DIR="$RELEASE_CACHE_DIR/coscli-output"

require_command coscli
require_command docker
require_command sha256sum
require_command awk
require_command grep
require_command mktemp

if ! docker compose version >/dev/null 2>&1; then
  echo "Error: Docker Compose v2 is unavailable." >&2
  exit 1
fi

if [[ ! -f "$COS_CONFIG" ]]; then
  echo "Error: COSCLI configuration file not found: $COS_CONFIG" >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: deployment environment file not found: $ENV_FILE" >&2
  exit 1
fi

mkdir -p -- "$RELEASE_CACHE_DIR" "$COS_LOG_DIR"

if [[ "$RELEASE_REFERENCE" == "latest" ]]; then
  latest_file="$RELEASE_CACHE_DIR/latest.json"
  cos_download "$COS_PREFIX/$RELEASE_CHANNEL/latest.json" "$latest_file"
  RELEASE_ID="$(json_string_value "$latest_file" releaseId)"
else
  RELEASE_ID="$RELEASE_REFERENCE"
fi
validate_release_id "$RELEASE_ID"

RELEASE_DIR="$RELEASE_CACHE_DIR/$RELEASE_ID"
mkdir -p -- "$RELEASE_DIR"
COS_LOG_DIR="$RELEASE_DIR/coscli-output"
mkdir -p -- "$COS_LOG_DIR"
REMOTE_RELEASE_PREFIX="$COS_PREFIX/$RELEASE_CHANNEL/$RELEASE_ID"

manifest_file="$RELEASE_DIR/manifest.json"
release_env_file="$RELEASE_DIR/release.env"
checksum_file="$RELEASE_DIR/SHA256SUMS"

# manifest.json is uploaded last by the publisher and acts as the release-complete marker.
cos_download "$REMOTE_RELEASE_PREFIX/manifest.json" "$manifest_file"
cos_download "$REMOTE_RELEASE_PREFIX/release.env" "$release_env_file"
cos_download "$REMOTE_RELEASE_PREFIX/SHA256SUMS" "$checksum_file"

# Releases created on Windows before the LF-only publisher fix may contain CRLF.
# Normalize the checksum file so both metadata parsing and sha256sum use the real filename.
checksum_normalized_file="${checksum_file}.normalized"
awk '{ sub(/\r$/, ""); print }' "$checksum_file" > "$checksum_normalized_file"
mv -f -- "$checksum_normalized_file" "$checksum_file"

manifest_release_id="$(json_string_value "$manifest_file" releaseId)"
manifest_environment="$(json_string_value "$manifest_file" environment)"
manifest_sha256="$(json_string_value "$manifest_file" sha256)"

if [[ "$manifest_release_id" != "$RELEASE_ID" ]]; then
  echo "Error: manifest release id mismatch: expected $RELEASE_ID, got $manifest_release_id" >&2
  exit 1
fi
if [[ "$manifest_environment" != "$RELEASE_CHANNEL" ]]; then
  echo "Error: manifest environment mismatch: expected $RELEASE_CHANNEL, got $manifest_environment" >&2
  exit 1
fi

release_env_id="$(read_release_value "$release_env_file" CEES_RELEASE_ID)"
image_tag="$(read_release_value "$release_env_file" IMAGE_TAG)"
api_image="$(read_release_value "$release_env_file" API_IMAGE)"
ai_service_image="$(read_release_value "$release_env_file" AI_SERVICE_IMAGE)"
artifact_key="$(read_release_value "$release_env_file" CEES_RELEASE_ARTIFACT)"
release_sha256="$(read_release_value "$release_env_file" CEES_RELEASE_SHA256)"

if [[ "$release_env_id" != "$RELEASE_ID" || "$image_tag" != "$RELEASE_ID" ]]; then
  echo "Error: release.env does not match release id $RELEASE_ID" >&2
  exit 1
fi
if [[ "$api_image" != "cees-api" || "$ai_service_image" != "cees-ai-service" ]]; then
  echo "Error: unexpected image names in release.env" >&2
  exit 1
fi
if [[ ! "$release_sha256" =~ ^[0-9a-f]{64}$ || "$manifest_sha256" != "$release_sha256" ]]; then
  echo "Error: release SHA-256 metadata is invalid or inconsistent" >&2
  exit 1
fi
if [[ "$artifact_key" != "$REMOTE_RELEASE_PREFIX/"* ]]; then
  echo "Error: artifact key is outside the selected release prefix: $artifact_key" >&2
  exit 1
fi

artifact_name="${artifact_key##*/}"
if [[ -z "$artifact_name" || "$artifact_name" == *'/'* || ! "$artifact_name" =~ ^[A-Za-z0-9_.-]+\.tar(\.gz)?$ ]]; then
  echo "Error: invalid release artifact name: $artifact_name" >&2
  exit 1
fi
artifact_file="$RELEASE_DIR/$artifact_name"
cos_download "$artifact_key" "$artifact_file"

checksum_line="$(grep -E '^[0-9a-fA-F]{64}  [A-Za-z0-9_.-]+$' "$checksum_file" | head -n 1 || true)"
checksum_hash="${checksum_line%%  *}"
checksum_name="${checksum_line#*  }"
if [[ "$checksum_name" != "$artifact_name" || "${checksum_hash,,}" != "$release_sha256" ]]; then
  echo "Error: SHA256SUMS does not match release metadata" >&2
  echo "  Expected file : $artifact_name" >&2
  echo "  Checksum file : ${checksum_name:-<missing>}" >&2
  echo "  Metadata hash : $release_sha256" >&2
  echo "  Checksum hash : ${checksum_hash:-<missing>}" >&2
  exit 1
fi

(
  cd "$RELEASE_DIR"
  sha256sum --check SHA256SUMS
)

echo "Loading Docker images from $artifact_file..."
docker image load --input "$artifact_file"

docker image inspect "${api_image}:${image_tag}" >/dev/null
docker image inspect "${ai_service_image}:${image_tag}" >/dev/null

echo "Updating $ENV_FILE to release $RELEASE_ID..."
update_deployment_env "$ENV_FILE" "$api_image" "$ai_service_image" "$image_tag"

echo "Starting $MANAGE_ENVIRONMENT from preloaded images..."
bash "$ROOT_DIR/infra/manage-app.sh" "$MANAGE_ENVIRONMENT" up

printf '%s\n' "$RELEASE_ID" > "$RELEASE_CACHE_DIR/deployed-release"

echo
echo "CEES AI release deployed successfully."
echo "  Environment : $MANAGE_ENVIRONMENT"
echo "  Release ID  : $RELEASE_ID"
echo "  API image   : ${api_image}:${image_tag}"
echo "  AI image    : ${ai_service_image}:${image_tag}"
echo "  Cache       : $RELEASE_DIR"