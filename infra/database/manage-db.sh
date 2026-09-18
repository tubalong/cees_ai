#!/usr/bin/env bash

set -Eeuo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./manage-db.sh <staging|production> [up|down|logs|ps|validate|create-vector-db|create-vector-indexes] [service...]

Examples:
  ./manage-db.sh staging validate
  ./manage-db.sh staging logs postgres
  ./manage-db.sh staging ps
  ./manage-db.sh production down
  ./manage-db.sh staging create-vector-db
  ./manage-db.sh staging create-vector-indexes

Use deploy-db.sh for deployment. The default action remains "up" for operational
compatibility, but it only uses images already prepared locally and never pulls.
The script never removes data volumes.
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
  else
    local host_addresses=""
    if command -v ip >/dev/null 2>&1; then
      host_addresses="$(ip -o addr show 2>/dev/null | awk '{split($4, address, "/"); print address[1]}' || true)"
    fi
    if [[ -z "$host_addresses" ]]; then
      host_addresses="$(hostname -I 2>/dev/null || true)"
    fi

    if [[ -n "$host_addresses" ]]; then
      local address
      local address_found="false"
      while IFS= read -r address; do
        if [[ "$address" == "$bind_ip" ]]; then
          address_found="true"
          break
        fi
      done <<< "$host_addresses"

      if [[ "$address_found" != "true" ]]; then
        echo "Error: DB_BIND_IP=$bind_ip is not assigned to any interface on this host." >&2
        echo "Hint: use the private address reported by 'ip -4 addr show'. Cloud public addresses (for example a Tencent Cloud EIP) are NAT-mapped and cannot be bound by Docker." >&2
        echo "Local addresses: $(printf '%s ' $host_addresses)" >&2
        exit 1
      fi
    fi
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
  production)
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
  up | down | logs | ps | validate | create-vector-db | create-vector-indexes)
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

    echo "Starting $ENVIRONMENT PostgreSQL and Redis from prepared local images..."
    "${COMPOSE[@]}" up -d --pull never --wait --wait-timeout 120 --remove-orphans
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
  create-vector-db)
    validate_inputs
    local postgres_user
    local postgres_container
    postgres_user="$(read_env_value POSTGRES_USER)"
    postgres_container="$("${COMPOSE[@]}" ps -q postgres)"
    if [[ -z "$postgres_container" ]]; then
      echo "Error: postgres container is not running; start it with 'up' first." >&2
      exit 1
    fi
    echo "Ensuring the cees_ai_vectors database exists on $ENVIRONMENT..."
    docker exec -i "$postgres_container" \
      psql -U "$postgres_user" -d postgres -v ON_ERROR_STOP=1 <<'SQL'
SELECT 'CREATE DATABASE cees_ai_vectors'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'cees_ai_vectors')\gexec
SQL
    echo "cees_ai_vectors database is ready."
    ;;
  create-vector-indexes)
    validate_inputs
    local postgres_user
    local postgres_container
    postgres_user="$(read_env_value POSTGRES_USER)"
    postgres_container="$("${COMPOSE[@]}" ps -q postgres)"
    if [[ -z "$postgres_container" ]]; then
      echo "Error: postgres container is not running; start it with 'up' first." >&2
      exit 1
    fi
    echo "Ensuring the knowledge_chunks HNSW index exists on $ENVIRONMENT..."
    echo "Note: PGVectorStore stores embeddings in the data_knowledge_chunks table,"
    echo "created by ai-service on first use; this action requires the table to exist."
    docker exec -i "$postgres_container" \
      psql -U "$postgres_user" -d cees_ai_vectors -v ON_ERROR_STOP=1 <<'SQL'
CREATE INDEX IF NOT EXISTS data_knowledge_chunks_embedding_idx
ON data_knowledge_chunks USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
SQL
    echo "knowledge_chunks HNSW index is ready."
    ;;
esac
