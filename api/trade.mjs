/**
 * Buying and selling on a coin's bonding curve from the user's own wallet: the server builds and simulates the
 * transaction, the browser signs it, the server relays exactly that transaction (never anything else).
 */
import { ComputeBudgetProgram, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token';
import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import { num } from './env.mjs';
import { run, now, one } from './db.mjs';
import * as sol from './sol.mjs';
import { ApiError } from './errors.mjs';
import { TOKEN_2022, ata, buyExactSolInIx, sellIx, loadGlobal, coinState, tokensForSol, solForTokens, tokenAccountAmount } from '../lib/pump.mjs';
import * as coins from './coins.mjs';
import * as window from './window.mjs';

const PRIORITY = num('TRADE_PRIORITY_MICROLAMPORTS', 100_000);
const budget = (units) => [ComputeBudgetProgram.setComputeUnitLimit({ units }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY })];
const msgHash = (tx) => createHash('sha256').update(tx.message.serialize()).digest('hex');
const pending = new Map(); // message hash → what was prepared (relayed once, within 2 minutes)
setInterval(() => { const t = now(); for (const [k, v] of pending) if (t - v.at > 120_000) pending.delete(k); }, 30_000).unref();

const globalShared = sol.shared(() => loadGlobal(sol.conn), 300_000);

export async function prepare(body) {
  const wallet = String(body.wallet || '');
  if (!sol.isAddress(wallet)) throw new ApiError('Connect a wallet first.', 401);
  let mint = sol.requireMint(String(body.mint || ''));
  const side = body.side === 'sell' ? 'sell' : 'buy';
  const slip = Number(body.slippageBps ?? 100);
  if (!Number.isFinite(slip)) throw new ApiError('The slippage must be a number.');
  const slippageBps = Math.min(5000, Math.max(10, Math.round(slip)));
  // a window token trades on its Meteora curve until it graduates; after that, its pump.fun coin
  const row = one('SELECT kind FROM launches WHERE mint = ?', mint.toBase58());
  const coinMint = mint.toBase58();
  if (row?.kind === 'window') {
    const w = await window.summary(coinMint);
    if (!w) throw new ApiError('This coin is not listed yet.', 404);
    if (w.status === 'trading') return windowTrade({ wallet, mint: coinMint, side, body, slippageBps, w });
    if (w.empty) throw new ApiError('This window ended with no holders: there is nothing to trade.', 409);
    if (!w.pumpMint) throw new ApiError('This coin is graduating to pump.fun right now. Trading resumes there in a few minutes.', 409);
    mint = new PublicKey(w.pumpMint);
  }
  const st = await coinState(sol.conn, mint);
  if (!st) throw new ApiError('This coin is not on pump.fun.', 404);
  if (st.isSol === false) throw new ApiError('This coin is paired with another token: trade it on pump.fun.', 409);
  if (st.complete) throw new ApiError('This coin has graduated: its bonding curve is closed and it trades on PumpSwap.', 409);
  const user = new PublicKey(wallet), creator = new PublicKey(st.creator);
  const global = await globalShared();
  let ixs, quote;
  if (side === 'buy') {
    const solIn = Number(body.amount);
    if (!(solIn > 0 && solIn <= 1000)) throw new ApiError('Enter how much SOL to spend.');
    const lamports = BigInt(Math.round(solIn * 1e9));
    const balance = BigInt(await sol.conn.getBalance(user));
    if (balance < lamports + 5_000_000n) throw new ApiError(`This wallet holds ${(Number(balance) / 1e9).toFixed(4)} SOL, not enough for this buy plus fees.`);
    const expected = tokensForSol(st.raw, lamports);
    if (expected <= 0n) throw new ApiError('That amount buys nothing.');
    const minOut = (expected * BigInt(10_000 - slippageBps)) / 10_000n;
    ixs = [...budget(120_000), createAssociatedTokenAccountIdempotentInstruction(user, ata(user, mint, TOKEN_2022), user, mint, TOKEN_2022),
      await buyExactSolInIx(sol.conn, global, { mint, user, creator, lamports, minTokensOut: minOut > 0n ? minOut : 1n })];
    quote = { side, lamports: String(lamports), tokenUnits: String(expected), minTokenUnits: String(minOut) };
  } else {
    const acct = await sol.conn.getAccountInfo(ata(user, mint, TOKEN_2022));
    const held = acct ? tokenAccountAmount(acct.data) : 0n;
    if (held <= 0n) throw new ApiError('This wallet holds none of this coin.');
    let units;
    if (body.amount === 'all' || Number(body.pct) === 100) units = held;
    else if (body.pct != null) {
      const pct = Number(body.pct);
      if (!(pct > 0 && pct <= 100)) throw new ApiError('Pick how much to sell.');
      units = (held * BigInt(Math.round(pct * 100))) / 10_000n;
    } else {
      const n = Number(body.amount);
      if (!(n > 0)) throw new ApiError('Enter how many coins to sell.');
      units = BigInt(Math.round(n * 1e6));
    }
    if (units <= 0n) throw new ApiError('That amount sells nothing.');
    if (units > held) throw new ApiError(`This wallet holds ${(Number(held) / 1e6).toLocaleString('en-US')} ${'coins'}, fewer than that.`);
    const expected = solForTokens(st.raw, units);
    const minOut = (expected * BigInt(10_000 - slippageBps)) / 10_000n;
    ixs = [...budget(100_000), await sellIx(sol.conn, global, { mint, user, creator, amount: units, minSolOut: minOut > 0n ? minOut : 1n })];
    quote = { side, lamports: String(expected), minLamports: String(minOut), tokenUnits: String(units) };
  }
  const { blockhash } = await sol.conn.getLatestBlockhash('confirmed');
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: user, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message());
  const sim = await sol.conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true }).catch(() => null);
  if (sim?.value?.err) {
    const why = JSON.stringify(sim.value.err), logs = (sim.value.logs || []).join(' ');
    console.error(`[trade] simulation failed ${side} ${mint.toBase58()}: ${why} ${(sim.value.logs || []).slice(-3).join(' | ').slice(0, 300)}`);
    if (/6002|TooMuchSolRequired|TooLittleSolReceived|slippage/i.test(why + logs)) throw new ApiError('The price moved: raise the slippage or try again.', 409);
    if (/InsufficientFunds|insufficient lamports/i.test(why + logs)) throw new ApiError('The wallet does not hold enough SOL for this trade plus fees.', 400);
    throw new ApiError(`pump.fun would refuse this trade (${why.slice(0, 100)}). Nothing was sent.`, 400);
  }
  const hash = msgHash(tx);
  pending.set(hash, { at: now(), mint: mint.toBase58(), coin: coinMint, wallet, ...quote });
  return { transaction: sol.b64(tx), quote };
}

/** A trade on a window token's Meteora curve (through the hook). Buys: SOL in; sells: units or a share of the wallet's balance. */
async function windowTrade({ wallet, mint, side, body, slippageBps, w }) {
  const user = new PublicKey(wallet), M = new PublicKey(mint);
  let amountIn, quote;
  if (side === 'buy') {
    const solIn = Number(body.amount);
    if (!(solIn > 0 && solIn <= 1000)) throw new ApiError('Enter how much SOL to spend.');
    amountIn = BigInt(Math.round(solIn * 1e9));
    const balance = BigInt(await sol.conn.getBalance(user));
    if (balance < amountIn + 5_000_000n) throw new ApiError(`This wallet holds ${(Number(balance) / 1e9).toFixed(4)} SOL, not enough for this buy plus fees.`);
  } else {
    const acct = await sol.conn.getAccountInfo(ata(user, M, TOKEN_2022));
    const held = acct ? tokenAccountAmount(acct.data) : 0n;
    if (held <= 0n) throw new ApiError('This wallet holds none of this coin.');
    if (body.amount === 'all' || Number(body.pct) === 100) amountIn = held;
    else if (body.pct != null) { const pct = Number(body.pct); if (!(pct > 0 && pct <= 100)) throw new ApiError('Pick how much to sell.'); amountIn = (held * BigInt(Math.round(pct * 100))) / 10_000n; }
    else { const n = Number(body.amount); if (!(n > 0)) throw new ApiError('Enter how many coins to sell.'); amountIn = BigInt(Math.round(n * 1e6)); }
    if (amountIn <= 0n) throw new ApiError('That amount sells nothing.');
    if (amountIn > held) throw new ApiError(`This wallet holds ${(Number(held) / 1e6).toLocaleString('en-US')} coins, fewer than that.`);
  }
  const { tx, expected, minOut } = await window.swap({ wallet, mint, side, amountIn, slippageBps });
  const sim = await sol.conn.simulateTransaction(tx).catch(() => null);
  // ⛔ the simulation runs on the last confirmed bank: right after someone else's buy it still shows that slot, so the
  //    one-buy-per-block rule (hook code 11) refuses honest buys in SIMULATION only. Those go to the chain and are judged there.
  const bundleOnly = sim?.value?.err && window.hookCode(sim.value.logs) === 11;
  if (sim?.value?.err && !bundleOnly) {
    const why = window.hookReason(sim.value.logs) || JSON.stringify(sim.value.err).slice(0, 100);
    console.error(`[trade] window ${side} ${mint} refused: ${why}`);
    throw new ApiError(`${String(why).replace(/\.$/, '')}. Nothing was sent.`, 400);
  }
  const raw = Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false }));
  const v = VersionedTransaction.deserialize(raw); // the browser signs a versioned envelope either way
  quote = side === 'buy' ? { side, lamports: String(amountIn), tokenUnits: String(expected), minTokenUnits: String(minOut) } : { side, lamports: String(expected), minLamports: String(minOut), tokenUnits: String(amountIn) };
  const hash = msgHash(v);
  pending.set(hash, { at: now(), mint, coin: mint, wallet, skipPreflight: true, ...quote });
  return { transaction: sol.b64(v), quote };
}

export async function submit({ transaction }) {
  const tx = sol.parseTx(transaction, 'The trade');
  const p = pending.get(msgHash(tx));
  if (!p) throw new ApiError('This trade was not prepared here, or it expired. Place it again.', 400);
  if (tx.message.staticAccountKeys[0].toBase58() !== p.wallet) throw new ApiError('Not paid by the trading wallet', 400);
  if (!tx.signatures[0] || tx.signatures[0].every((b) => b === 0)) throw new ApiError('Not signed by the wallet', 400);
  const hash = msgHash(tx);
  if (p.sending) throw new ApiError('This trade is already being sent.', 409);
  p.sending = true;
  let sig;
  try {
    sig = await sol.sendSigned(tx, 'The trade', { skipPreflight: Boolean(p.skipPreflight) });
  } catch (e) {
    const definite = e.stage === 'refused' || e.stage === 'failed' || e.stage === 'expired';
    if (definite) pending.delete(hash);
    else { p.sending = false; later.set(bs58.encode(tx.signatures[0]), { ...p, hash }); } // may still land: settled by settlePending()
    throw e;
  }
  pending.delete(hash);
  return record(sig, p);
}

/** The trade as it SETTLED (SOL and tokens read from the transaction's balances), not as quoted. */
async function record(sig, p) {
  let lamports = p.lamports, tokenUnits = p.tokenUnits;
  try {
    const r = await sol.conn._rpcRequest('getTransaction', [sig, { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]);
    const t = r?.result, meta = t?.meta;
    if (meta && !meta.err) {
      const keys = t.transaction.message.accountKeys, i = keys.indexOf(p.wallet);
      if (i >= 0) {
        const delta = BigInt(meta.postBalances[i]) - BigInt(meta.preBalances[i]) + BigInt(meta.fee);
        lamports = String(delta < 0n ? -delta : delta);
      }
      const tok = (list) => list.filter((b) => b.owner === p.wallet && b.mint === p.mint).reduce((a, b) => a + BigInt(b.uiTokenAmount.amount), 0n);
      const d = tok(meta.postTokenBalances || []) - tok(meta.preTokenBalances || []);
      tokenUnits = String(d < 0n ? -d : d);
    }
  } catch {}
  const coin = p.coin ?? p.mint; // the listed coin (a window token's trades after graduation are on its pump.fun mint)
  run('INSERT OR IGNORE INTO trades (sig, mint, wallet, side, lamports, token_units, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', sig, coin, p.wallet, p.side, lamports, tokenUnits, now());
  if (one('SELECT 1 FROM launches WHERE mint = ?', coin)) run('UPDATE launches SET bumped_at = ? WHERE mint = ?', now(), coin);
  coins.forget(coin);
  coins.sample(coin).catch(() => {});
  return { sig, side: p.side, lamports, tokenUnits };
}

const later = new Map(); // signature → the prepared trade whose outcome was unknown when sent
/** Every 30 s: trades sent with an unknown outcome are recorded once the chain shows them, dropped after 5 minutes. */
export async function settlePending() {
  for (const [sig, p] of later) {
    const st = await sol.txStatus(sig).catch(() => undefined);
    if (st === 'ok') { later.delete(sig); pending.delete(p.hash); await record(sig, p); }
    else if (st === 'failed' || now() - p.at > 5 * 60_000) { later.delete(sig); pending.delete(p.hash); }
  }
}
