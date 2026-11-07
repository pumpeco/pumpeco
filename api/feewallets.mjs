/**
 * One fee wallet per coin: set as the coin's pump.fun creator at launch, so pump.fun pays its creator fees here and the
 * liquidity keeper (api/liquidity.mjs) turns them into burned liquidity on the coin's pool.
 *
 * ⛔ The secret is written to its own file (data/fee-wallets/<address>.json, mode 0600) BEFORE the launch transaction is
 *    built: a coin must never land with a creator whose key we do not hold. Back the folder up with the database.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Keypair } from '@solana/web3.js';
import { env } from './env.mjs';
import { DB_PATH } from './db.mjs';

export const DIR = env('FEE_WALLET_DIR', '') || path.join(path.dirname(DB_PATH), 'fee-wallets');

export function create() {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  const k = Keypair.generate();
  const file = path.join(DIR, `${k.publicKey.toBase58()}.json`);
  fs.writeFileSync(file, JSON.stringify([...k.secretKey]), { mode: 0o600, flag: 'wx' });
  return k;
}

export function load(address) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(address))) throw new Error('bad fee wallet address');
  const file = path.join(DIR, `${address}.json`);
  const k = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, 'utf8'))));
  if (k.publicKey.toBase58() !== address) throw new Error(`fee wallet file ${address} holds another key`);
  return k;
}
