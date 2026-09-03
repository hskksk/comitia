#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

TMUX_ARGS=()
if [[ -f /exec-daemon/tmux.portal.conf ]]; then
  TMUX_ARGS=(-f /exec-daemon/tmux.portal.conf)
fi

tmux_cmd() {
  tmux "${TMUX_ARGS[@]}" "$@"
}

PORT="${COMITIA_DOGFOOD_PORT:-8787}"
BOARD_URL="${COMITIA_DOGFOOD_BOARD_URL:-http://127.0.0.1:${PORT}}"
DATABASE_URL="${DATABASE_URL:-postgres://comitia:comitia@127.0.0.1:5432/comitia}"
BOARD_PUBLIC_URL="${BOARD_PUBLIC_URL:-$BOARD_URL}"
HOST="${HOST:-0.0.0.0}"
WEB_DIST="${WEB_DIST:-$ROOT_DIR/packages/web/dist}"
OWNER_NAME="${COMITIA_DOGFOOD_OWNER_NAME:-ハル}"
PROJECT_NAME="${COMITIA_DOGFOOD_PROJECT_NAME:-comitia}"
REPO_URL="${COMITIA_DOGFOOD_REPO_URL:-https://github.com/hskksk/comitia}"
AGENT_NAME="${COMITIA_DOGFOOD_AGENT_NAME:-ミカ}"
SESSION_BOARD="${COMITIA_DOGFOOD_TMUX_BOARD:-comitia-board}"
SESSION_SMEE="${COMITIA_DOGFOOD_TMUX_SMEE:-comitia-smee}"

export COMITIA_DOGFOOD_BOARD_URL="$BOARD_URL"
export COMITIA_DOGFOOD_OWNER_NAME="$OWNER_NAME"
export COMITIA_DOGFOOD_PROJECT_NAME="$PROJECT_NAME"
export COMITIA_DOGFOOD_REPO_URL="$REPO_URL"
export COMITIA_DOGFOOD_AGENT_NAME="$AGENT_NAME"
export COMITIA_DOGFOOD_TMUX_SESSIONS="${SESSION_BOARD},${SESSION_SMEE}"

node_lib() {
  node "$ROOT_DIR/scripts/dogfood/lib.mjs" run "$@"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: required command not found: $1" >&2
    exit 1
  fi
}

check_secrets() {
  local missing=()
  for key in \
    GITHUB_APP_ID \
    GITHUB_APP_PRIVATE_KEY \
    GITHUB_CLIENT_ID \
    GITHUB_CLIENT_SECRET \
    GITHUB_WEBHOOK_SECRET; do
    if [[ -z "${!key:-}" ]]; then
      missing+=("$key")
    fi
  done
  if [[ ${#missing[@]} -gt 0 ]]; then
    COMITIA_DOGFOOD_MISSING_SECRETS="$(IFS=,; echo "${missing[*]}")"
    export COMITIA_DOGFOOD_MISSING_SECRETS
    echo "warning: missing secrets (board GitHub features may be limited): ${missing[*]}" >&2
  fi
  if [[ -z "${SMEE_WEBHOOK_URL:-}" ]]; then
    echo "warning: SMEE_WEBHOOK_URL not set — webhooks will not forward (inbox poll fallback only)" >&2
  fi
  if ! command -v claude >/dev/null 2>&1 && [[ ! -x "$HOME/.local/bin/claude" ]]; then
    echo "warning: claude CLI not found — install before agent connect (see https://code.claude.com/docs/en/setup)" >&2
  fi
}

ensure_postgres() {
  require_cmd psql
  if command -v pg_isready >/dev/null 2>&1 && ! pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
    if command -v pg_ctlcluster >/dev/null 2>&1; then
      sudo pg_ctlcluster 16 main start >/dev/null 2>&1 || sudo service postgresql start >/dev/null 2>&1 || true
    elif command -v service >/dev/null 2>&1; then
      sudo service postgresql start >/dev/null 2>&1 || true
    fi
    sleep 2
  fi
  if ! pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
    echo "error: PostgreSQL is not running on 127.0.0.1:5432" >&2
    echo "hint: install and start PostgreSQL, or set DATABASE_URL" >&2
    exit 1
  fi
  if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='comitia'" | grep -q 1; then
    sudo -u postgres psql -c "CREATE USER comitia WITH PASSWORD 'comitia';" >/dev/null
  fi
  if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='comitia'" | grep -q 1; then
    sudo -u postgres psql -c "CREATE DATABASE comitia OWNER comitia;" >/dev/null
  fi
}

resolve_github_slug() {
  if [[ -n "${GITHUB_APP_SLUG:-}" ]]; then
    return
  fi
  local slug
  slug="$(node_lib resolve-slug 2>/dev/null || true)"
  if [[ -n "$slug" ]]; then
    export GITHUB_APP_SLUG="$slug"
  fi
}

build_packages() {
  echo "==> Installing dependencies and building packages..." >&2
  pnpm install
  pnpm --filter @comitia/shared build
  pnpm --filter @comitia/web build
  pnpm --filter @comitia/board build
  pnpm --filter enginebay build
  pnpm --filter @comitia/agent build
}

ensure_work_dir() {
  # COMITIA_WORK_DIR is opt-in. When unset, clone into the named XDG
  # workspace (`comitia-{agent-name}`) so connect does not share ~/.comitia/work.
  local work_dir
  work_dir="$(node_lib resolve-work-dir)"
  mkdir -p "$work_dir"
  if [[ "${COMITIA_DOGFOOD_CLONE_REPO:-1}" == "1" ]] && [[ ! -d "$work_dir/.git" ]]; then
    echo "==> Cloning work repo into $work_dir ..." >&2
    git clone "$REPO_URL" "$work_dir"
  fi
}

start_tmux_session() {
  local session="$1"
  local command="$2"
  if tmux_cmd has-session -t "=$session" 2>/dev/null; then
    tmux_cmd send-keys -t "$session:0.0" C-c || true
    sleep 1
  else
    tmux_cmd new-session -d -s "$session" -c "$ROOT_DIR" -- "${SHELL:-bash}" -l
  fi
  tmux_cmd send-keys -t "$session:0.0" "$command" C-m
}

start_board() {
  local board_env
  board_env="export DATABASE_URL='$DATABASE_URL' BOARD_PUBLIC_URL='$BOARD_PUBLIC_URL' WEB_DIST='$WEB_DIST' HOST='$HOST' PORT='$PORT'"
  if [[ -n "${GITHUB_APP_SLUG:-}" ]]; then
    board_env+=" GITHUB_APP_SLUG='$GITHUB_APP_SLUG'"
  fi
  start_tmux_session "$SESSION_BOARD" \
    "$board_env && cd '$ROOT_DIR' && pnpm --filter @comitia/board start"
}

start_smee() {
  if [[ -z "${SMEE_WEBHOOK_URL:-}" ]]; then
    return
  fi
  start_tmux_session "$SESSION_SMEE" \
    "cd '$ROOT_DIR' && pnpm dlx smee-client -u \"\$SMEE_WEBHOOK_URL\" -t ${BOARD_URL}/v1/github/webhook"
}

wait_for_health() {
  echo "==> Waiting for board /healthz ..." >&2
  for _ in $(seq 1 30); do
    if curl -sf "${BOARD_URL}/healthz" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "error: board did not become healthy at ${BOARD_URL}/healthz" >&2
  exit 1
}

main() {
  require_cmd pnpm
  require_cmd curl
  require_cmd tmux
  require_cmd node
  require_cmd git

  check_secrets
  ensure_postgres
  resolve_github_slug
  build_packages
  ensure_work_dir
  start_board
  start_smee
  wait_for_health

  echo "==> Ensuring board init and agent registration ..." >&2
  DATABASE_URL="$DATABASE_URL" node_lib init-if-needed || true
  node_lib register-agent-if-needed || true
  node_lib connect-github-if-needed || true

  export WEB_DIST
  node_lib summary
}

main "$@"
