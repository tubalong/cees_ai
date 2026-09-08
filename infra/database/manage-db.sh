#!/usr/bin/env bash

set -Eeuo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./manage-db.sh <staging|production> [up|down|logs|ps|validate] [service...]

Examples:
  ./manage-db.sh staging validate
  ./manage-db.sh staging
  ./manage-db.sh staging logs postgres
  ./manage-db.sh production
  ./manage-db.sh production down

The default action is "up". The script never removes data volumes.
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

validate_inputs() {
  if grep -q "change_me" "$ENV_FILE"; then
    echo "Error: $ENV_FILE still contains change_me placeholders." >&2
    exit 1
  fi

  local required_keys=(
    DB_BIND_IP
    POSTGRES_DB
    POSTGRES_USER
    POSTGRES_PASSWORD
    POSTGRES_PORT
    REDIS_PASSWORD
    REDIS_PORT
  )
  local key
  local value

  for key in "${required_keys[@]}"; do
    value="$(read_env_value "$key")"
    if [[ -z "$value" ]]; then
      echo "Error: $key is missing from $ENV_FILE." >&2
      exit 1
    fi
  done

  local bind_ip
  bind_ip="$(read_env_value DB_BIND_IP)"
  if [[ "$bind_ip" == "0.0.0.0" || "$bind_ip" == "::" ]]; then
    echo "Warning: DB_BIND_IP=$bind_ip exposes database ports on all matching interfaces; restrict access with firewall or security-group rules." >&2
  fi

  local postgres_port
  local redis_port
  postgres_port="$(read_env_value POSTGRES_PORT)"
  redis_port="$(read_env_value REDIS_PORT)"

  if [[ ! "$postgres_port" =~ ^[0-9]+$ || ! "$redis_port" =~ ^[0-9]+$ ]]; then
    echo "Error: POSTGRES_PORT and REDIS_PORT must be numeric." >&2
    exit 1
  fi

  if [[ "$postgres_port" == "$redis_port" ]]; then
    echo "Error: PostgreSQL and Redis cannot publish the same host port." >&2
    exit 1
  fi
}

BASE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ENVIRONMENT="${1:-}"
ACTION="${2:-up}"

case "$ENVIRONMENT" in
  staging)
    ENV_FILE="$BASE_DIR/.env.staging"
    PROJECT_NAME="cees-ai-db-staging"
    ;;
  production | prod)
    ENVIRONMENT="production"
    ENV_FILE="$BASE_DIR/.env.production"
    PROJECT_NAME="cees-ai-db-production"
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
  echo "Error: Docker Compose is unavailable." >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: environment file not found: $ENV_FILE" >&2
  exit 1
fi

COMPOSE=(
  docker compose
  --project-name "$PROJECT_NAME"
  --env-file "$ENV_FILE"
  -f "$BASE_DIR/docker-compose.yml"
  -f "$BASE_DIR/docker-compose.server.yml"
)

case "$ACTION" in
  up)
    validate_inputs
    echo "Validating $ENVIRONMENT database configuration..."
    "${COMPOSE[@]}" config --quiet

    echo "Pulling database images..."
    "${COMPOSE[@]}" pull

    echo "Starting $ENVIRONMENT PostgreSQL and Redis..."
    "${COMPOSE[@]}" up -d --wait --wait-timeout 120 --remove-orphans
    "${COMPOSE[@]}" ps
    ;;
  down)
    echo "Stopping $ENVIRONMENT database containers without removing volumes..."
    "${COMPOSE[@]}" down --remove-orphans
    ;;
  logs)
    "${COMPOSE[@]}" logs -f --tail=200 "${@:3}"
    ;;
  ps)
    "${COMPOSE[@]}" ps
    ;;
  validate)
    validate_inputs
    "${COMPOSE[@]}" config --quiet
    echo "$ENVIRONMENT database configuration is valid."
    ;;
esac
