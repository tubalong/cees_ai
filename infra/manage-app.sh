#!/usr/bin/env bash

set -Eeuo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./infra/manage-app.sh <staging|production> [up|down|logs|ps|validate] [service...]

Examples:
  ./infra/manage-app.sh staging
  ./infra/manage-app.sh production
  ./infra/manage-app.sh production logs api
  ./infra/manage-app.sh production ps
  ./infra/manage-app.sh production down

The default action is "up". The script never pulls source code or removes volumes.
EOF
}

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Error: required command is unavailable: $command_name" >&2
    exit 1
  fi
}

read_env_value() {
  local key="$1"
  local line

  line="$(grep -E "^[[:space:]]*${key}=" "$ENV_FILE" | tail -n 1 || true)"
  line="${line#*=}"
  line="${line%$'\r'}"

  if [[ "$line" == \"*\" && "$line" == *\" ]]; then
    line="${line:1:${#line}-2}"
  elif [[ "$line" == \'*\' && "$line" == *\' ]]; then
    line="${line:1:${#line}-2}"
  fi

  printf '%s' "$line"
}

validate_deployment_inputs() {
  if grep -q "change_me" "$ENV_FILE"; then
    echo "Error: $ENV_FILE still contains change_me placeholders." >&2
    exit 1
  fi

  local model_config_path
  local resolved_model_config_path
  model_config_path="$(read_env_value AI_MODEL_CONFIG_HOST_PATH)"

  if [[ -z "$model_config_path" ]]; then
    echo "Error: AI_MODEL_CONFIG_HOST_PATH is missing from $ENV_FILE." >&2
    exit 1
  fi

  if [[ "$model_config_path" == /* ]]; then
    resolved_model_config_path="$model_config_path"
  else
    # Compose resolves relative bind paths from the directory of the first -f file.
    resolved_model_config_path="$ROOT_DIR/infra/$model_config_path"
  fi

  if [[ ! -f "$resolved_model_config_path" ]]; then
    echo "Error: AI model configuration file not found: $resolved_model_config_path" >&2
    exit 1
  fi

  if grep -q "change_me" "$resolved_model_config_path"; then
    echo "Error: AI model configuration still contains change_me placeholders: $resolved_model_config_path" >&2
    exit 1
  fi

  local database_url
  local redis_url
  database_url="$(read_env_value DATABASE_URL)"
  redis_url="$(read_env_value REDIS_URL)"

  if [[ -z "$database_url" || -z "$redis_url" ]]; then
    echo "Error: DATABASE_URL and REDIS_URL are required in $ENV_FILE." >&2
    exit 1
  fi

  if [[ "$database_url" != postgresql://* && "$database_url" != postgres://* ]]; then
    echo "Error: DATABASE_URL must be a PostgreSQL connection URL." >&2
    exit 1
  fi

  if [[ "$redis_url" != redis://* && "$redis_url" != rediss://* ]]; then
    echo "Error: REDIS_URL must be a Redis connection URL." >&2
    exit 1
  fi
}

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENVIRONMENT="${1:-}"
ACTION="${2:-up}"

case "$ENVIRONMENT" in
  staging)
    ENV_FILE=".env.staging"
    ENV_COMPOSE_FILE="infra/docker-compose.staging.yml"
    ;;
  production | prod)
    ENVIRONMENT="production"
    ENV_FILE=".env.production"
    ENV_COMPOSE_FILE="infra/docker-compose.prod.yml"
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

case "$ACTION" in
  up | down | logs | ps | validate)
    ;;
  -h | --help | help)
    usage
    exit 0
    ;;
  *)
    echo "Error: unknown action: $ACTION" >&2
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
  echo "Error: environment file not found: $ROOT_DIR/$ENV_FILE" >&2
  exit 1
fi

COMPOSE=(
  docker compose
  --env-file "$ENV_FILE"
  -f infra/docker-compose.deploy.yml
  -f "$ENV_COMPOSE_FILE"
)

case "$ACTION" in
  up)
    validate_deployment_inputs
    echo "Validating $ENVIRONMENT Compose configuration..."
    "${COMPOSE[@]}" config --quiet

    echo "Building and starting $ENVIRONMENT services..."
    "${COMPOSE[@]}" up -d --build --remove-orphans

    echo
    "${COMPOSE[@]}" ps
    ;;
  down)
    echo "Stopping $ENVIRONMENT services without removing volumes..."
    "${COMPOSE[@]}" down --remove-orphans
    ;;
  logs)
    "${COMPOSE[@]}" logs -f --tail=200 "${@:3}"
    ;;
  ps)
    "${COMPOSE[@]}" ps
    ;;
  validate)
    validate_deployment_inputs
    "${COMPOSE[@]}" config --quiet
    echo "$ENVIRONMENT deployment configuration is valid."
    ;;
esac
