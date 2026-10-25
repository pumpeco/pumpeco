# pump.eco

The classic pump.fun interface, rebuilt as a fair launchpad on Solana. Live at [pump.eco](https://pump.eco).

Every coin starts on its own bonding curve, shaped exactly like pump.fun's, where nobody can buy before trading opens. When the curve reaches the market cap its creator picked, the coin migrates into a regular pump.fun coin and every holder receives it automatically.

## How it works

- **Launch.** A Token-2022 mint with a transfer hook, a Meteora Dynamic Bonding Curve shaped like pump.fun's, and the coin's rules, all in one transaction. Every address ends in `pump`.
- **No block-zero buys.** The hook refuses every buy until the creator's opening delay has passed, and allows one buy per block after it. The only exception is an optional creator first buy inside the launch transaction itself.
- **Migration.** When the curve fills, the graduator withdraws the raise, creates the pump.fun coin with it in one transaction, and pushes every holder their share.
- **Pairs.** A coin can migrate paired with SOL, USDC, any of pump.fun's custom pairs, or another pump.fun coin.
- **Creator rewards.** Fixed at launch: to the creator under pump.fun's schedule, or to the holders forever.

## Layout

| Path | What |
|---|---|
| `web/` | The site (React + Vite, Wallet Standard). |
| `api/` | HTTP API: launches, trades, the board, on-chain charts. The browser signs every transaction. |
| `api/graduator.mjs` | The graduation service. |
| `hk/hook/` | The transfer hook program (native Rust). |
| `hk/lib/` | Curve shapes, launch builders, graduation, settlement, pairs. |
| `lib/`, `ag/` | pump.fun clients built on its on-chain IDLs. |
| `e2e/`, `hk/test/` | End-to-end suites against a local validator with mainnet programs cloned. |
| `tools/grind/` | Grinder for `…pump` mint addresses. |

## Run locally

```
cp .env.example .env
npm install
npm run build
npm start
```

The end-to-end suites need a local validator: `CLONE_RPC_URL=<mainnet rpc> e2e/validator-window.sh`, then `node e2e/window.mjs`, `node e2e/api-window.mjs` and `node hk/test/e2e-pairs.mjs`.

Hook program on mainnet: `2CXyarqL7smcx2tcLKCixWERctxQK3Wd4eCLqYtYkigy`.

Independent project, not affiliated with pump.fun or Meteora.
