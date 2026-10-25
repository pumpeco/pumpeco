#!/usr/bin/env bash
# Local validator for the window launches: the REAL mainnet bytecode of Meteora DBC + DAMM v2, pump.fun and friends
# cloned, plus our hook (hk/fixtures/oldpump_hook.so at keys/hook-keypair.json) loaded at genesis.
# Port 8981 (stop it by port, never pkill: other sessions run validators too).
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/share/solana/install/releases/4.0.0/solana-release/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
: "${CLONE_RPC_URL:?set CLONE_RPC_URL (a keyed mainnet RPC)}"
PORT="${LOCAL_RPC_PORT:-8981}"
DAMM_CFGS=$(node -e 'import("@meteora-ag/dynamic-bonding-curve-sdk").then(s=>console.log(s.DAMM_V2_MIGRATION_FEE_ADDRESS.map(a=>"--clone "+a).join(" ")))')
HOOK_ID=$(solana-keygen pubkey hk/keys/hook-keypair.json)
rm -rf e2e/ledger
exec solana-test-validator --url "$CLONE_RPC_URL" --rpc-port "$PORT" --faucet-port $((PORT+3)) --gossip-port $((PORT+5)) \
  --dynamic-port-range $((PORT+10))-$((PORT+60)) --ledger e2e/ledger --reset --quiet --limit-ledger-size 500000000 \
  --clone-upgradeable-program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb \
  --clone ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL \
  --clone-upgradeable-program dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN \
  --clone-upgradeable-program cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG \
  $DAMM_CFGS \
  --clone-upgradeable-program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P \
  --clone-upgradeable-program pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ \
  --clone-upgradeable-program pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA \
  --clone ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw \
  --clone C2aFPdENg4A2HQsmrd5rTw5TaYBX5Ku887cWjbFKtZpw --clone 5PHirr8joyTMp9JMm6nW7hNDVyEYdkzDqazxPD7RaTjx \
  --clone-upgradeable-program metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s \
  --clone 4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf --clone Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1 --clone Hq2wp8uJ9jCPsYgNHex8RtqdvMPfVGoYwjvF1ATiwn2Y \
  --clone TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM --clone 8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt --clone 62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV \
  --clone 5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD \
  --clone-upgradeable-program MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e \
  --clone 13ec7XdrjF3h3YcqBTFDSReRcUFwbCnJaAQspM4j6DDJ --clone BwWK17cbHxwWBKZkUYvzxLcNQ1YVyaFezduWbtm2de6s \
  --clone 6z6GDdfb2AjR9ZhJmAUQ5cipJCVxQvLJhB2H8mCwTFBP \
  `# custom pairs: two real pair tokens with a TEST mint authority (hk/test/make-pair-fixtures.mjs)` \
  --account 3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh hk/fixtures/pair-WBTC-mint.json \
  --account XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W hk/fixtures/pair-SPYx-mint.json \
  --account EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v hk/fixtures/pair-USDC-mint.json \
  --bpf-program "$HOOK_ID" hk/fixtures/oldpump_hook.so
