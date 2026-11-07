/**
 * The liquidity keeper: every coin launched here has its creator fees turned into BURNED liquidity on its own PumpSwap pool
 * once it graduates (lib/liquidity.mjs has the steps). Its own process:
 *   node api/liquidity.mjs            (env: SOLANA_RPC, DATA_DIR, LIQ_TICK_MS, LIQ_DRY=1 to simulate only)
 *   node api/liquidity.mjs --once     one pass, then exit
 *
 * The keeper wallet (data/liquidity-keeper.json, made on first start; or LIQ_KEEPER_KEY_FILE) pays every transaction fee
 * (~0.0001 SOL a step): fund it with a little SOL. The fee wallets' own SOL only ever goes into their coin's pool.
 * ⛔ Paid RPC: one batched read of the curves per pass (100 coins a call) and one read per GRADUATED coin; coins still on
 *    their curve cost nothing more. Default pass every 10 minutes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Keypair, PublicKey } from '@solana/web3.js';
import { env, num } from './env.mjs';
import { all, run, now, DB_PATH } from './db.mjs';
import * as sol from './sol.mjs';
import * as feeWallets from './feewallets.mjs';
import { bondingCurveAddress } from '../lib/pump.mjs';
import { feeState, collectIxs, buyIxs, depositAndBurnIxs, buyShare } from '../lib/liquidity.mjs';

const TICK_MS = num('LIQ_TICK_MS', 600_000);
const DRY = env('LIQ_DRY', '') === '1';
/** Collect once this much waits for a fee wallet; turn into liquidity once its spare SOL reaches LIQ_MIN. */
const MIN_COLLECT = BigInt(Math.round(num('LIQ_MIN_COLLECT_SOL', 0.01) * 1e9));
const MIN_LIQ = BigInt(Math.round(num('LIQ_MIN_SOL', 0.02) * 1e9));
/** A deposit is only sent when it adds at least this much SOL (smaller ones would cost more in fees than they add). */
const MIN_DEPOSIT = BigInt(Math.round(num('LIQ_MIN_DEPOSIT_SOL', 0.005) * 1e9));
/** Kept in every fee wallet: rent for its coin, LP and temporary WSOL accounts. */
export const RESERVE = BigInt(Math.round(num('LIQ_RESERVE_SOL', 0.01) * 1e9));
const log = (...a) => console.log(new Date().toISOString(), '[liquidity]', ...a);

export function keeperKey() {
  const file = env('LIQ_KEEPER_KEY_FILE', '') || path.join(path.dirname(DB_PATH), 'liquidity-keeper.json');
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify([...Keypair.generate().secretKey]), { mode: 0o600, flag: 'wx' });
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, 'utf8'))));
}

const record = (sig, mint, step, { lamports = 0n, tokens = 0n, lp = 0n } = {}) =>
  run('INSERT OR IGNORE INTO liquidity (sig, mint, step, lamports, tokens, lp, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', sig, mint, step, String(lamports), String(tokens), String(lp), now());

/** Sends one step: the keeper pays, `signers` add theirs. 'ok' only on a positive answer from the chain. */
async function step(keeper, ixs, signers, label) {
  const built = await sol.v0(keeper.publicKey, [...sol.budget(400_000), ...ixs], [keeper, ...signers]);
  await sol.simulate(built.tx);
  if (DRY) { log(`DRY ${label}: simulated OK`); return { result: 'dry' }; }
  let out = await sol.send(built, { skipPreflight: false });
  if (out.result === 'pending') { await sol.sleep(20_000); const s = await sol.txStatus(out.sig).catch(() => null); if (s) out = { ...out, result: s }; }
  log(`${label}: ${out.result} ${out.sig || ''}${out.err ? ` ${JSON.stringify(out.err).slice(0, 160)}` : ''}`);
  return out;
}

/** One coin, one pass. Returns what it did, for the log. */
export async function passCoin(row, keeper) {
  const { mint, fee_wallet: fw, symbol } = row;
  let st = await feeState(sol.conn, { mint, feeWallet: fw, reserve: RESERVE });
  if (!st.graduated) return 'on its curve';
  const did = [];
  if (st.waiting >= MIN_COLLECT) {
    const before = st.wallet;
    const r = await step(keeper, await collectIxs(sol.conn, { mint, feeWallet: fw, payer: keeper.publicKey, graduated: true }), [], `${symbol} collect ${(Number(st.waiting) / 1e9).toFixed(4)} SOL`);
    if (r.result === 'dry') return 'dry';
    st = await feeState(sol.conn, { mint, feeWallet: fw, reserve: RESERVE });
    if (r.result === 'ok') { record(r.sig, mint, 'collect', { lamports: st.wallet - before }); did.push('collected'); }
  }
  const w = feeWallets.load(fw);
  const deposit = async () => {
    const d = await depositAndBurnIxs(sol.conn, { mint, feeWallet: fw, tokens: st.tokens, maxLamports: st.spare });
    if (!d || d.quoteMax < MIN_DEPOSIT) return false; // dust: waits for more fees
    const before = st;
    const r = await step(keeper, d.ixs, [w], `${symbol} deposit ${d.base} units + up to ${(Number(d.quoteMax) / 1e9).toFixed(4)} SOL, burn ${d.lp} LP`);
    if (r.result === 'dry') return 'dry';
    st = await feeState(sol.conn, { mint, feeWallet: fw, reserve: RESERVE });
    if (r.result === 'ok') { record(r.sig, mint, 'deposit', { lamports: before.wallet - st.wallet, tokens: before.tokens - st.tokens, lp: d.lp }); did.push('deposited + burned LP'); }
    return r.result === 'ok';
  };
  // coins left by an earlier pass first, then buy-and-deposit rounds until the spare SOL is under the minimum
  if (st.tokens > 0n && st.spare > 0n && (await deposit()) === 'dry') return 'dry';
  for (let round = 0; round < 3 && st.spare >= MIN_LIQ; round++) {
    const spend = await buyShare(sol.conn, { mint, feeWallet: fw, lamports: st.spare }), before = st;
    const r = await step(keeper, await buyIxs(sol.conn, { mint, feeWallet: fw, lamports: spend }), [w], `${symbol} buy with ${(Number(spend) / 1e9).toFixed(4)} SOL`);
    if (r.result === 'dry') return 'dry';
    st = await feeState(sol.conn, { mint, feeWallet: fw, reserve: RESERVE });
    if (r.result !== 'ok') break;
    record(r.sig, mint, 'buy', { lamports: before.wallet - st.wallet, tokens: st.tokens - before.tokens }); did.push('bought');
    if (!(st.tokens > 0n && st.spare > 0n) || (await deposit()) !== true) break;
  }
  return did.length ? did.join(', ') : 'nothing to do';
}

/** Every live coin with a fee wallet: graduated ones (one batched curve read tells) get a pass. */
export async function pass(keeper) {
  const rows = all("SELECT mint, symbol, fee_wallet FROM launches WHERE fee_wallet IS NOT NULL AND status = 'live' AND kind = 'pump'");
  let graduated = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const curves = await sol.conn.getMultipleAccountsInfo(chunk.map((r) => bondingCurveAddress(new PublicKey(r.mint))), 'confirmed');
    for (let j = 0; j < chunk.length; j++) {
      const c = curves[j];
      if (!c || !c.data[48]) continue; // BondingCurve.complete @48: still on its curve, nothing can deepen yet
      graduated++;
      try { const what = await passCoin(chunk[j], keeper); if (what !== 'nothing to do') log(`${chunk[j].symbol} ${chunk[j].mint.slice(0, 8)}…: ${what}`); }
      catch (e) { log(`${chunk[j].symbol} ${chunk[j].mint.slice(0, 8)}…: ${String(e.message).replace(/api-key=[^&\s"']+/g, 'api-key=…').slice(0, 300)}`); }
    }
  }
  return { coins: rows.length, graduated };
}

/** What the coin page shows: SOL of creator fees put into the pool (the buy half and the deposited half), LP burned. */
export function summary(mint) {
  const rows = all("SELECT step, lamports, lp, created_at FROM liquidity WHERE mint = ? AND step IN ('buy', 'deposit')", mint);
  let lamports = 0n, lp = 0n, last = null;
  for (const r of rows) { lamports += BigInt(r.lamports); lp += BigInt(r.lp); last = Math.max(last ?? 0, r.created_at); }
  return { addedSol: Number(lamports) / 1e9, lpBurned: String(lp), deposits: rows.filter((r) => r.step === 'deposit').length, lastAt: last };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const keeper = keeperKey();
  const bal = await sol.conn.getBalance(keeper.publicKey).catch(() => null);
  log(`keeper ${keeper.publicKey.toBase58()} holds ${bal == null ? '?' : (bal / 1e9).toFixed(4)} SOL${DRY ? ' (DRY: simulate only)' : ''}, every ${TICK_MS / 1000}s`);
  const once = process.argv.includes('--once');
  for (;;) {
    try { const r = await pass(keeper); if (once) log(`pass: ${r.coins} coins, ${r.graduated} graduated`); } catch (e) { log('pass failed:', String(e.message).slice(0, 300)); }
    if (once) process.exit(0);
    await sol.sleep(TICK_MS);
  }
}
