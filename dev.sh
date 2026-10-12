#!/usr/bin/env bash
# Start the whole stack — Postgres, our backend, the Vite dev server — against either
# komreg-backend.
#
#   ./dev.sh          same as ./dev.sh local
#   ./dev.sh local    komreg-backend on your own machine (start it on PORT=8081)
#   ./dev.sh dev      komreg-backend in atkv3-dev, with your Entra token
#
# The one thing this script exists for: the backend container has no `az` and no Azure
# login, so for `dev` the token is fetched HERE, on the host, and passed in. It does not
# refresh — re-run this script when it expires (roughly hourly).
set -euo pipefail
cd "$(dirname "$0")"

TARGET="${1:-local}"

case "$TARGET" in
  local)
    # Set, not left to compose.yml's default: an exported KOMREG_TARGET=dev from an earlier
    # shell would otherwise win, and `./dev.sh local` would run against dev.
    export KOMREG_TARGET=local
    exec docker compose up --build
    ;;
  dev)
    if ! command -v az >/dev/null 2>&1; then
      echo "az (Azure CLI) finnes ikke på PATH. Installer den, og kjør:" >&2
      echo "  az login --allow-no-subscriptions" >&2
      exit 1
    fi

    # Same client id the backend defaults to, and the same one komreg-backend's own
    # Bruno collection uses. Overridable for the same reason it is there.
    CLIENT_ID="${KOMREG_DEV_CLIENT_ID:-6f6f58a9-c0fa-47b7-9db5-3624dbcfd893}"

    echo "Henter Entra-token for komreg-backend i dev…" >&2
    if ! KOMREG_DEV_TOKEN=$(az account get-access-token \
        --scope "$CLIENT_ID/.default" --query accessToken -o tsv 2>/dev/null); then
      echo "Fikk ikke token. Kjør «az login --allow-no-subscriptions», og sjekk at du er" >&2
      echo "medlem av Entra-gruppa AAD_TF_TEAM_SMIA." >&2
      exit 1
    fi
    export KOMREG_DEV_TOKEN
    export KOMREG_TARGET=dev

    echo "Mot DEV (komreg-backend.atkv3-dev.kartverket-intern.cloud)." >&2
    echo "Krever Kartverket-nettet (VPN/Tailscale). Token varer ~1 time." >&2
    exec docker compose up --build
    ;;
  *)
    echo "Ukjent mål «$TARGET». Bruk: ./dev.sh [local|dev]" >&2
    exit 1
    ;;
esac
