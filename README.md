# oldpump

A recreation of the classic 2025 pump.fun interface (the bracket-link board, King of the hill, the green create form,
the buy/sell panel with bonding-curve and king-of-the-hill progress, threads) that launches and trades **real pump.fun
coins** on Solana mainnet from the visitor's own wallet. Unofficial; not affiliated with pump.fun.

- `api/` Node server: the board, launches (`create_v2`, one transaction, optional first buy), curve trades
  (`buy_exact_sol_in`, `sell`), wallet-signed replies, price samples. It holds no funds and no user keys.
- `web/` Vite + React site. Wallets through Wallet Standard (Phantom, Solflare, Backpack …).
- `lib/pump.mjs` pump.fun client built on pump.fun's on-chain IDLs.
- `hk/` pump.family's launch stack (Meteora DBC + transfer hook + graduation to pump.fun), with window launches: `api/window.mjs`, `api/graduator.mjs`.
- `tools/grind` Rust grinder for `…pump` mint addresses; `scripts/make-lut.mjs` the launch lookup table.

```
cp .env.example .env     # SOLANA_RPC (Helius), PINATA_JWT (metadata pinning)
npm install && npm run build && npm start      # http://127.0.0.1:5480
node scripts/make-lut.mjs                      # once, enables first buys (needs ~0.004 SOL on the printed address)
npm run grind                                  # optional: `pump` addresses for the pool
```
Flow: the browser posts the form → the server pins image + metadata on IPFS, builds and simulates the transaction,
signs it with the mint key → the wallet signs → the server relays exactly that transaction.
