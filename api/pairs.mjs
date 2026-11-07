/**
 * Custom pairs on classic launches (operator, 7 Nov 2026): a coin may be paired with any token pump.fun accepts (its
 * quote-control list, USDC, or any pump.fun coin), and is always BOUGHT AND SOLD WITH SOL here, in ONE transaction:
 *
 *   pair is a pump.fun coin  → pump.fun's own multi_hop_swap: SOL → pair (its curve or pool) → coin, and back
 *   any other pair (listed)  → Jupiter's SOL → pair route + our pair → coin hop, and back (coin → pair, pair → SOL)
 *
 * ⛔ Atomic on purpose: a buyer never ends up holding the pair token because the second half failed. Measured 1,046 B
 *    with Jupiter's route capped at 16 accounts (scripts/pair-tx-size.mjs); a route that does not fit is retried smaller.
 * The pair amount handed from one half to the other is the first half's GUARANTEED minimum, so the difference (the first
 * half's slippage) stays in the wallet as a little of the pair token.
 */
import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token';
import BN from 'bn.js';
import { env } from './env.mjs';
import * as sol from './sol.mjs';
import { ApiError } from './errors.mjs';
import * as ag from '../ag/pump.mjs';

export const USDC = ag.USDC.toBase58();
const WSOL = ag.WSOL.toBase58();

/* ───────────── which pair ───────────── */

const quoteShared = sol.sharedMap(async (mint) => {
  if (mint === USDC) return { ok: true, kind: 'listed', mint: USDC, tokenProgram: ag.TOKEN_PROGRAM.toBase58(), decimals: 6, curve: null, pool: null, usdc: true };
  return ag.resolveQuote(sol.conn, mint);
}, 30_000, 500);
/** The pair as pump.fun sees it NOW (a pump coin pair may have graduated since the coin launched). Throws when unusable. */
export async function quoteOf(mint) {
  const q = await quoteShared(String(mint));
  if (!q?.ok) throw new ApiError(`That pair cannot be used: ${q?.reason || 'Pumpfun does not accept it'}.`);
  return q;
}
export const isPumpCoin = (q) => q.kind === 'curve' || q.kind === 'pool';

/* ───────────── Jupiter (listed pairs only) ───────────── */

const JUP = () => (env('JUPITER_API_KEY', '') ? 'https://api.jup.ag/swap/v1' : 'https://lite-api.jup.ag/swap/v1');
async function jup(path, body) {
  for (let tries = 0; ; tries++) {
    const res = await fetch(`${JUP()}${path}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(env('JUPITER_API_KEY', '') ? { 'x-api-key': env('JUPITER_API_KEY') } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(12_000) });
    if (res.status === 429 && tries < 2) { await sol.sleep(1500 * (tries + 1)); continue; }
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.error) throw new ApiError(res.status === 429 ? 'The swap route is busy. Try again in a few seconds.' : `No swap route for this pair right now (${String(j.error || res.status).slice(0, 80)}).`, 503);
    return j;
  }
}
const toIx = (x) => new TransactionInstruction({ programId: new PublicKey(x.programId), keys: x.accounts.map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })), data: Buffer.from(x.data, 'base64') });
/** An ExactIn route `amount` input → output for `user`, as instructions + its lookup tables. */
async function jupRoute({ inputMint, outputMint, amount, slippageBps, user, maxAccounts }) {
  // maxAccounts 0 = the smallest route there is: a single direct pool
  const params = { inputMint, outputMint, amount: String(amount), slippageBps: String(slippageBps), swapMode: 'ExactIn', restrictIntermediateTokens: 'true', ...(maxAccounts ? { maxAccounts: String(maxAccounts) } : { onlyDirectRoutes: 'true' }) };
  const quote = await jup(`/quote?${new URLSearchParams(params)}`);
  const si = await jup('/swap-instructions', { quoteResponse: quote, userPublicKey: user.toBase58(), wrapAndUnwrapSol: true, dynamicComputeUnitLimit: false });
  const ixs = [...(si.setupInstructions || []).map(toIx), toIx(si.swapInstruction), ...(si.cleanupInstruction ? [toIx(si.cleanupInstruction)] : [])];
  const alts = (await Promise.all((si.addressLookupTableAddresses || []).map(async (a) => (await sol.conn.getAddressLookupTable(new PublicKey(a))).value))).filter(Boolean);
  return { ixs, alts, out: BigInt(quote.outAmount), minOut: BigInt(quote.otherAmountThreshold) };
}

/* ───────────── pump.fun multi_hop_swap ───────────── */

const acc = (k, w = false) => ({ pubkey: new PublicKey(k), isSigner: false, isWritable: w });
/** The coin's own hop while it is on its curve (curve phase only: a graduated coin trades on PumpSwap, not here). */
const coinHop = (mint, q) => { const Q = new PublicKey(q.mint), prog = new PublicKey(q.tokenProgram), curve = ag.bondingCurveAddress(mint); return [acc(mint), acc(Q), acc(curve, true), acc(ag.ata(curve, mint, ag.TOKEN_2022), true), acc(ag.ata(curve, Q, prog), true)]; };
/** A pump coin pair's own hop against SOL: its curve, or its PumpSwap pool. */
const pairHop = (q) => {
  const Q = new PublicKey(q.mint), prog = new PublicKey(q.tokenProgram);
  if (q.kind === 'pool') return [acc(Q), acc(ag.WSOL), acc(q.pool.address, true), acc(q.pool.base, true), acc(q.pool.quote, true)];
  const c = new PublicKey(q.curve);
  return [acc(Q), acc(ag.WSOL), acc(c, true), acc(ag.ata(c, Q, prog), true), acc(ag.ata(c, ag.WSOL, ag.TOKEN_PROGRAM), true)];
};
async function multiHop({ user, userIn, userOut, buybackAta, amountIn, minOut, hops }) {
  return ag.programs(sol.conn).amm.methods.multiHopSwap(new BN(String(amountIn)), new BN(String(minOut > 0n ? minOut : 1n)))
    .accountsPartial({
      user, userInTokenAccount: userIn, userOutTokenAccount: userOut, globalConfig: ag.AMM_GLOBAL_CONFIG, feeConfig: ag.AMM_FEE_CONFIG,
      userVolumeAccumulator: ag.userVolumeAccumulatorAmm(user), buybackFeeRecipient: buybackAta, tokenProgram: ag.TOKEN_PROGRAM,
      token2022Program: ag.TOKEN_2022, systemProgram: new PublicKey('11111111111111111111111111111111'), eventAuthority: ag.AMM_EVENT_AUTHORITY, program: ag.PUMP_AMM,
      pumpProgram: ag.PUMP, pumpGlobal: ag.globalAddress(), pumpFeeConfig: ag.PUMP_FEE_CONFIG, pumpEventAuthority: ag.PUMP_EVENT_AUTHORITY,
    })
    .remainingAccounts(hops.flat())
    .instruction();
}

/** pair → coin on the coin's curve, from the user's pair account (the leg after Jupiter's SOL → pair). */
export async function pairToCoinIxs({ user, mint, q, global, amountIn, minOut }) {
  const Q = new PublicKey(q.mint), prog = new PublicKey(q.tokenProgram), buyback = ag.buybackWallet(global), userCoin = ag.ata(user, mint, ag.TOKEN_2022);
  return [createAssociatedTokenAccountIdempotentInstruction(user, userCoin, user, mint, ag.TOKEN_2022),
    createAssociatedTokenAccountIdempotentInstruction(user, ag.ata(buyback, Q, prog), buyback, Q, prog),
    await multiHop({ user, userIn: ag.ata(user, Q, prog), userOut: userCoin, buybackAta: ag.ata(buyback, Q, prog), amountIn, minOut, hops: [coinHop(mint, q)] })];
}
/** coin → pair on the coin's curve, into the user's pair account (the leg before Jupiter's pair → SOL). */
export async function coinToPairIxs({ user, mint, q, global, units, minOut }) {
  const Q = new PublicKey(q.mint), prog = new PublicKey(q.tokenProgram), buyback = ag.buybackWallet(global), userQ = ag.ata(user, Q, prog);
  return [createAssociatedTokenAccountIdempotentInstruction(user, userQ, user, Q, prog),
    createAssociatedTokenAccountIdempotentInstruction(user, ag.ata(buyback, Q, prog), buyback, Q, prog),
    await multiHop({ user, userIn: ag.ata(user, mint, ag.TOKEN_2022), userOut: userQ, buybackAta: ag.ata(buyback, Q, prog), amountIn: units, minOut, hops: [coinHop(mint, q)] })];
}

/* ───────────── pricing (estimates; the chain checks the minimums) ───────────── */

const FEE_BPS = 150n; // pump.fun's curve + PumpSwap fees per hop, estimated high
const afterFee = (x) => (x * (10_000n - FEE_BPS)) / 10_000n;
const swapOut = (x, rIn, rOut) => (rIn > 0n && rOut > 0n ? (afterFee(x) * rOut) / (rIn + afterFee(x)) : 0n);
const withSlip = (x, bps) => (x * BigInt(10_000 - bps)) / 10_000n;

/* ───────────── buy / sell with SOL ───────────── */

/**
 * Buy `mint` (paired with `q`, on its curve) with `lamports` SOL. Returns { ixs, alts, expected, minOut } (coin units).
 */
export async function buyWithSol({ user, mint, q, lamports, slippageBps }) {
  const global = await ag.loadGlobal(sol.conn);
  const r = await ag.coinReserves(sol.conn, mint, q);
  if (!r || r.kind !== 'curve') throw new ApiError('This coin has graduated: it trades on PumpSwap now.', 409);
  const Q = new PublicKey(q.mint), prog = new PublicKey(q.tokenProgram), buyback = ag.buybackWallet(global), userCoin = ag.ata(user, mint, ag.TOKEN_2022);
  if (isPumpCoin(q)) {
    const qr = await ag.quoteReserves(sol.conn, q);
    if (!qr) throw new ApiError('Could not read the pair. Try again.', 503);
    const qOut = swapOut(lamports, qr.quote, qr.base);
    let expected = swapOut(qOut, r.quote, r.base);
    if (expected > r.realBase) expected = r.realBase;
    const minOut = withSlip(expected, slippageBps);
    const ixs = await ag.firstBuyIxs(sol.conn, global, { mint, user, q, currency: 'sol', amountIn: lamports, minOut });
    return { ixs, alts: [], expected, minOut };
  }
  // listed pair: Jupiter SOL → pair, then pair → coin with the route's guaranteed minimum
  for (const maxAccounts of [16, 10, 0]) {
    const route = await jupRoute({ inputMint: WSOL, outputMint: q.mint, amount: lamports, slippageBps: Math.min(slippageBps, 300), user, maxAccounts });
    let expected = swapOut(route.minOut, r.quote, r.base);
    if (expected > r.realBase) expected = r.realBase;
    const minOut = withSlip(expected, slippageBps);
    const ixs = [...route.ixs, ...(await pairToCoinIxs({ user, mint, q, global, amountIn: route.minOut, minOut }))];
    if (await fits(user, ixs, route.alts)) return { ixs, alts: route.alts, expected, minOut, pairLeft: route.out - route.minOut };
  }
  throw new ApiError('No route for this pair fits in one transaction right now. Try a different amount.', 503);
}

/** Sell `units` of `mint` (paired with `q`, on its curve) for SOL. Returns { ixs, alts, expected, minOut } (lamports). */
export async function sellForSol({ user, mint, q, units, slippageBps }) {
  const global = await ag.loadGlobal(sol.conn);
  const r = await ag.coinReserves(sol.conn, mint, q);
  if (!r || r.kind !== 'curve') throw new ApiError('This coin has graduated: it trades on PumpSwap now.', 409);
  const Q = new PublicKey(q.mint), prog = new PublicKey(q.tokenProgram), buyback = ag.buybackWallet(global), userCoin = ag.ata(user, mint, ag.TOKEN_2022);
  const qOut = swapOut(units, r.base, r.quote), qMin = withSlip(qOut, Math.min(slippageBps, 300));
  if (isPumpCoin(q)) {
    const qr = await ag.quoteReserves(sol.conn, q);
    if (!qr) throw new ApiError('Could not read the pair. Try again.', 503);
    const expected = swapOut(qOut, qr.base, qr.quote), minOut = withSlip(expected, slippageBps);
    const userSol = ag.ata(user, ag.WSOL, ag.TOKEN_PROGRAM), buybackSol = ag.ata(buyback, ag.WSOL, ag.TOKEN_PROGRAM);
    const { createCloseAccountInstruction } = await import('@solana/spl-token');
    const ixs = [createAssociatedTokenAccountIdempotentInstruction(user, userSol, user, ag.WSOL, ag.TOKEN_PROGRAM),
      createAssociatedTokenAccountIdempotentInstruction(user, buybackSol, buyback, ag.WSOL, ag.TOKEN_PROGRAM),
      createAssociatedTokenAccountIdempotentInstruction(user, ag.ata(buyback, Q, prog), buyback, Q, prog),
      await multiHop({ user, userIn: userCoin, userOut: userSol, buybackAta: buybackSol, amountIn: units, minOut, hops: [coinHop(mint, q), pairHop(q)] }),
      createCloseAccountInstruction(userSol, user, user, [], ag.TOKEN_PROGRAM)];
    return { ixs, alts: [], expected, minOut };
  }
  // listed pair: coin → pair (at least qMin), then Jupiter pair → SOL for exactly qMin
  const first = await coinToPairIxs({ user, mint, q, global, units, minOut: qMin });
  for (const maxAccounts of [16, 10, 0]) {
    const route = await jupRoute({ inputMint: q.mint, outputMint: WSOL, amount: qMin, slippageBps, user, maxAccounts });
    const ixs = [...first, ...route.ixs];
    if (await fits(user, ixs, route.alts)) return { ixs, alts: route.alts, expected: route.out, minOut: route.minOut, pairLeft: qOut - qMin };
  }
  throw new ApiError('No route for this pair fits in one transaction right now. Try a different amount.', 503);
}

async function fits(user, ixs, alts) {
  const { TransactionMessage, VersionedTransaction, ComputeBudgetProgram } = await import('@solana/web3.js');
  const m = new TransactionMessage({ payerKey: user, recentBlockhash: '11111111111111111111111111111111', instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 1 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }), ...ixs] }).compileToV0Message(alts);
  try { return new VersionedTransaction(m).serialize().length <= 1232; } catch { return false; }
}
