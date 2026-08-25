#!/usr/bin/env bash
# Push mise-managed environment variables to Railway service variables.
#
# Prerequisites:
#   - Railway CLI installed and authenticated (`railway login`)
#   - Project linked in repo root (`railway link`)
#   - Secrets defined in local mise env (typically `.mise.toml`, gitignored)
#
# Usage:
#   mise exec -- pnpm railway:push-secrets
#   mise exec -- pnpm railway:push-secrets -- --dry-run
#   mise exec -- pnpm railway:push-secrets -- --deploy
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

SERVICE="${RAILWAY_SERVICE:-board}"
ENVIRONMENT="${RAILWAY_ENVIRONMENT:-}"
PROJECT="${RAILWAY_PROJECT:-}"

DRY_RUN=false
DEPLOY=false
INCLUDE_SMEE=false

# Plain values (safe to pass as KEY=value on the CLI).
PLAIN_VARS=(
  GITHUB_APP_ID
  GITHUB_APP_SLUG
  GITHUB_CLIENT_ID
)

# Sensitive values (piped via --stdin).
SECRET_VARS=(
  GITHUB_APP_PRIVATE_KEY
  GITHUB_CLIENT_SECRET
  GITHUB_WEBHOOK_SECRET
)

usage() {
  cat <<'EOF'
Push mise-managed env vars to Railway service variables.

Run under mise so local secrets are loaded, for example:
  mise exec -- pnpm railway:push-secrets

Options:
  --dry-run          Print actions without calling Railway
  --deploy           Redeploy the service once after all variables are set
  --include-smee     Also push SMEE_WEBHOOK_URL (local dogfood only; not in IaC)
  --service <name>   Railway service name (default: board)
  --environment <n>  Railway environment name (default: linked environment)
  --project <id>     Railway project id (default: linked project)
  -h, --help         Show this help

Environment overrides:
  RAILWAY_SERVICE, RAILWAY_ENVIRONMENT, RAILWAY_PROJECT

Variables pushed (must be set in the current shell):
  GITHUB_APP_ID, GITHUB_APP_SLUG, GITHUB_CLIENT_ID
  GITHUB_APP_PRIVATE_KEY, GITHUB_CLIENT_SECRET, GITHUB_WEBHOOK_SECRET
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --deploy)
      DEPLOY=true
      shift
      ;;
    --include-smee)
      INCLUDE_SMEE=true
      shift
      ;;
    --service)
      SERVICE="${2:?--service requires a value}"
      shift 2
      ;;
    --environment)
      ENVIRONMENT="${2:?--environment requires a value}"
      shift 2
      ;;
    --project)
      PROJECT="${2:?--project requires a value}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: required command not found: $1" >&2
    exit 1
  fi
}

railway_args() {
  local args=(--service "$SERVICE" --skip-deploys)
  if [[ -n "$ENVIRONMENT" ]]; then
    args+=(--environment "$ENVIRONMENT")
  fi
  if [[ -n "$PROJECT" ]]; then
    args+=(--project "$PROJECT")
  fi
  printf '%s\0' "${args[@]}"
}

redeploy_args() {
  local args=(--service "$SERVICE")
  if [[ -n "$ENVIRONMENT" ]]; then
    args+=(--environment "$ENVIRONMENT")
  fi
  if [[ -n "$PROJECT" ]]; then
    args+=(--project "$PROJECT")
  fi
  printf '%s\0' "${args[@]}"
}

set_plain_var() {
  local key="$1"
  local value="$2"
  local -a args=()
  while IFS= read -r -d '' arg; do
    args+=("$arg")
  done < <(railway_args)

  if [[ "$DRY_RUN" == true ]]; then
    echo "dry-run: railway variable set ${key}=${value} ${args[*]}"
    return 0
  fi

  railway variable set "${key}=${value}" "${args[@]}"
}

set_secret_var() {
  local key="$1"
  local value="$2"
  local -a args=()
  while IFS= read -r -d '' arg; do
    args+=("$arg")
  done < <(railway_args)

  if [[ "$DRY_RUN" == true ]]; then
    echo "dry-run: printf <secret> | railway variable set ${key} --stdin ${args[*]}"
    return 0
  fi

  printf '%s' "$value" | railway variable set "$key" --stdin "${args[@]}"
}

if [[ "$DRY_RUN" != true ]]; then
  require_cmd railway
fi

vars_to_sync=("${PLAIN_VARS[@]}" "${SECRET_VARS[@]}")
if [[ "$INCLUDE_SMEE" == true ]]; then
  vars_to_sync+=(SMEE_WEBHOOK_URL)
fi

missing=()
for key in "${vars_to_sync[@]}"; do
  if [[ -z "${!key:-}" ]]; then
    missing+=("$key")
  fi
done

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "error: missing environment variables (load them with mise first):" >&2
  for key in "${missing[@]}"; do
    echo "  - $key" >&2
  done
  echo >&2
  echo "Example: mise exec -- pnpm railway:push-secrets" >&2
  exit 1
fi

echo "Pushing ${#vars_to_sync[@]} variable(s) to Railway service '${SERVICE}'..."
if [[ -n "$ENVIRONMENT" ]]; then
  echo "  environment: $ENVIRONMENT"
fi
if [[ "$DRY_RUN" == true ]]; then
  echo "  mode: dry-run"
fi

for key in "${PLAIN_VARS[@]}"; do
  set_plain_var "$key" "${!key}"
  echo "  set $key"
done

for key in "${SECRET_VARS[@]}"; do
  set_secret_var "$key" "${!key}"
  echo "  set $key (secret)"
done

if [[ "$INCLUDE_SMEE" == true ]]; then
  set_secret_var SMEE_WEBHOOK_URL "${SMEE_WEBHOOK_URL}"
  echo "  set SMEE_WEBHOOK_URL (secret)"
fi

if [[ "$DRY_RUN" == true ]]; then
  echo "Dry run complete."
  exit 0
fi

echo "Done. Variables updated with --skip-deploys."

if [[ "$DEPLOY" == true ]]; then
  echo "Redeploying service '${SERVICE}'..."
  redeploy=()
  while IFS= read -r -d '' arg; do
    redeploy+=("$arg")
  done < <(redeploy_args)
  railway redeploy "${redeploy[@]}"
  echo "Redeploy requested."
else
  echo "Redeploy to pick up changes: railway redeploy --service ${SERVICE}"
  echo "Or rerun with: mise exec -- pnpm railway:push-secrets -- --deploy"
fi
