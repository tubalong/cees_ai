#!/usr/bin/env bash

set -Eeuo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./deploy-db.sh <staging|production>

Examples:
  ./deploy-db.sh staging
  ./deploy-db.sh production

The script looks for Docker image archives in the deployment directory and its
images/ subdirectory. Supported suffixes are .tar, .tar.gz, and .tgz.

When archives are present, they are loaded first and only required images that
are still missing are pulled. When no archive is present, all Compose images
are pulled before PostgreSQL and Redis are started.
EOF
}

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Error: required command is unavailable: $command_name" >&2
    exit 1
  fi
}

BASE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ENVIRONMENT="${1:-}"

case "$ENVIRONMENT" in
  staging)
    ENV_FILE="$BASE_DIR/.env.staging"
    ;;
  production | prod)
    ENVIRONMENT="production"
    ENV_FILE="$BASE_DIR/.env.production"
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

require_command docker
if ! docker compose version >/dev/null 2>&1; then
  echo "Error: Docker Compose v2 is unavailable. Install the Docker Compose plugin." >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: environment file not found: $ENV_FILE" >&2
  exit 1
fi

echo "Validating $ENVIRONMENT database deployment..."
bash "$BASE_DIR/manage-db.sh" "$ENVIRONMENT" validate

COMPOSE=(
  docker compose
  --project-name "cees-ai-db-$ENVIRONMENT"
  --env-file "$ENV_FILE"
  -f "$BASE_DIR/docker-compose.yml"
  -f "$BASE_DIR/docker-compose.server.yml"
)

required_images=()
declare -A seen_images=()
while IFS= read -r image; do
  image="${image%$'\r'}"
  if [[ -n "$image" && -z "${seen_images[$image]+present}" ]]; then
    required_images+=("$image")
    seen_images["$image"]=1
  fi
done < <("${COMPOSE[@]}" config --images)

if [[ ${#required_images[@]} -eq 0 ]]; then
  echo "Error: Compose configuration did not resolve any database images." >&2
  exit 1
fi

image_archives=()
declare -A seen_archives=()
shopt -s nullglob
for archive in \
  "$BASE_DIR"/*.tar \
  "$BASE_DIR"/*.tar.gz \
  "$BASE_DIR"/*.tgz \
  "$BASE_DIR/images"/*.tar \
  "$BASE_DIR/images"/*.tar.gz \
  "$BASE_DIR/images"/*.tgz; do
  if [[ -f "$archive" && -z "${seen_archives[$archive]+present}" ]]; then
    image_archives+=("$archive")
    seen_archives["$archive"]=1
  fi
done
shopt -u nullglob

if [[ ${#image_archives[@]} -gt 0 ]]; then
  echo "Found ${#image_archives[@]} local Docker image archive(s)."
  for archive in "${image_archives[@]}"; do
    echo "Loading image archive: $archive"
    docker image load --input "$archive"
  done

  for image in "${required_images[@]}"; do
    if docker image inspect "$image" >/dev/null 2>&1; then
      echo "Using local image: $image"
    else
      echo "Local archives do not contain $image; pulling it now..."
      docker pull "$image"
    fi
  done
else
  echo "No local Docker image archive found; pulling database images..."
  "${COMPOSE[@]}" pull
fi

for image in "${required_images[@]}"; do
  if ! docker image inspect "$image" >/dev/null 2>&1; then
    echo "Error: required database image is unavailable after image preparation: $image" >&2
    exit 1
  fi
done

echo "Starting $ENVIRONMENT PostgreSQL and Redis..."
bash "$BASE_DIR/manage-db.sh" "$ENVIRONMENT" up
