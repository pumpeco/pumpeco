#!/usr/bin/env bash
# Local validator with pump.fun cloned from mainnet (e2e/clones.txt). ⛔ Other sessions run validators too: this one is
# port 8981; stop it by its port (lsof -ti :8981 | xargs kill), never pkill.
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.local/share/solana/install/releases/4.0.0/solana-release/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
: "${CLONE_RPC_URL:?set CLONE_RPC_URL (a keyed mainnet RPC)}"
PORT="${LOCAL_RPC_PORT:-8981}"
rm -rf ledger
# shellcheck disable=SC2046
exec solana-test-validator --url "$CLONE_RPC_URL" --rpc-port "$PORT" --faucet-port $((PORT + 3)) --gossip-port $((PORT + 5)) \
  --dynamic-port-range $((PORT + 10))-$((PORT + 40)) --ledger ledger --reset --quiet $(cat clones.txt)
