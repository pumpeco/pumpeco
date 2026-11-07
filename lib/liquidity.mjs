/**
 * Creator fees → the coin's own liquidity (operator, 7 Nov 2026: every coin launched from pump.family).
 *
 * Each coin's pump.fun CREATOR is a fee wallet only this site holds (api/feewallets.mjs). pump.fun pays the creator fees to
 * it. While the coin is on its bonding curve nothing can deepen (the curve's reserves are fixed), so the fees wait. Once the
 * coin has its PumpSwap pool, every pass:
 *   1. collect: sweep the curve's and the pool's waiting fee, move PumpSwap's vault into pump.fun's, collect pump.fun's
 *      vault into the fee wallet as SOL (all permissionless: the keeper pays, the fee wallet never signs)
 *   2. buy:     half the fee wallet's spare SOL buys the coin on its pool
 *   3. deposit: the coins plus the matching SOL go into the pool, and the LP tokens it returns are BURNED in the same
 *      transaction, so that liquidity can never be withdrawn by anyone
 * Every step is decided from the fee wallet's balances alone, so a pass that died halfway is finished by the next one.
 */
import { PublicKey } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction, createBurnCheckedInstruction } from '@solana/spl-token';
import { Program, AnchorProvider } from '@coral-xyz/anchor';
import BN from 'bn.js';
import { readFileSync } from 'node:fs';
import { OnlinePumpAmmSdk, PUMP_AMM_SDK, buyQuoteInput as sdkBuyQuoteInput } from '@pump-fun/pump-swap-sdk';
import { PUMP_AMM, TOKEN_PROGRAM, TOKEN_2022, WSOL, ata, programs, globalAddress, bondingCurveAddress, creatorVaultAddress, poolAddress, decodePool, tokenAccountAmount } from './pump.mjs';

export const AMM_GLOBAL_CONFIG = new PublicKey('ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw');
export const LP_DECIMALS = 9;
/** Rent-exempt minimum of a 0-byte account (pump.fun's creator vault keeps it). */
const VAULT_RENT = 890_880n;

/** The coin's PumpSwap pool: against SOL, or (custom pair) against the pair token `quote` ({ mint, tokenProgram }). */
const coinPool = (mint, quote) => poolAddress(new PublicKey(mint), 0, quote ? new PublicKey(quote.mint) : WSOL);
const ammCreatorVaultAuthority = (creator) => PublicKey.findProgramAddressSync([Buffer.from('creator_vault'), creator.toBuffer()], PUMP_AMM)[0];
export const curveCreatorFeeWaiting = (data) => (data && data.length >= 133 ? data.readBigUInt64LE(125) : 0n);
export const poolCreatorFeesWaiting = (data) => (data && data.length >= 287 ? data.readBigUInt64LE(279) : 0n);

// The vendored PumpSwap IDL predates sweep_creator_fee: a newer one is used for that instruction only (proven in ~/pairs, ~/shill).
const ammSweepIdl = JSON.parse(readFileSync(new URL('./pump_amm-sweep.idl.json', import.meta.url)));
const sweepCache = new WeakMap();
const ammSweep = (connection) => {
  let p = sweepCache.get(connection);
  if (!p) { p = new Program(ammSweepIdl, new AnchorProvider(connection, { publicKey: PublicKey.default, signTransaction: async (t) => t, signAllTransactions: async (t) => t }, {})); sweepCache.set(connection, p); }
  return p;
};
const onlineCache = new WeakMap();
const online = (connection) => { let s = onlineCache.get(connection); if (!s) { s = new OnlinePumpAmmSdk(connection); onlineCache.set(connection, s); } return s; };

/**
 * Where a coin's fee wallet stands, in a single batched read. Lamports everywhere.
 * `waiting` = creator fees not yet in the fee wallet (curve + pool unswept, both vaults); `spare` = the fee wallet's SOL
 * above its reserve; `tokens` = coin units it holds (bought, not yet deposited).
 */
export async function feeState(connection, { mint, feeWallet, reserve, quote = null }) {
  const m = new PublicKey(mint), w = new PublicKey(feeWallet), pool = coinPool(m, quote);
  const ammAuth = ammCreatorVaultAuthority(w);
  // a custom pair: every fee is in the PAIR token (the vaults' and the fee wallet's pair accounts); SOL only pays rent
  const Q = quote ? new PublicKey(quote.mint) : WSOL, qProg = quote ? new PublicKey(quote.tokenProgram) : TOKEN_PROGRAM;
  const keys = [bondingCurveAddress(m), pool, quote ? ata(creatorVaultAddress(w), Q, qProg) : creatorVaultAddress(w), ata(ammAuth, Q, qProg), w, ata(w, m, TOKEN_2022), ata(w, Q, qProg)];
  const [curve, poolInfo, vault, ammVault, wallet, coinAta, walletQ] = await connection.getMultipleAccountsInfo(keys, 'confirmed');
  const graduated = Boolean(poolInfo && poolInfo.data.length >= 200);
  const out = {
    graduated, pool: graduated ? pool.toBase58() : null, quote: quote ? quote.mint : null,
    curveUnswept: curve ? curveCreatorFeeWaiting(curve.data) : 0n,
    poolUnswept: graduated ? poolCreatorFeesWaiting(poolInfo.data) : 0n,
    vault: quote ? (vault ? tokenAccountAmount(vault.data) : 0n) : vault ? BigInt(vault.lamports) - VAULT_RENT : 0n,
    ammVault: ammVault ? tokenAccountAmount(ammVault.data) : 0n,
    wallet: wallet ? BigInt(wallet.lamports) : 0n,
    walletQ: walletQ ? tokenAccountAmount(walletQ.data) : 0n,
    tokens: coinAta ? tokenAccountAmount(coinAta.data) : 0n,
  };
  if (out.vault < 0n) out.vault = 0n;
  out.waiting = out.curveUnswept + out.poolUnswept + out.vault + out.ammVault;
  // what can go into the pool: SOL above the reserve, or (custom pair) every pair unit the fee wallet holds
  out.spare = quote ? out.walletQ : out.wallet > BigInt(reserve) ? out.wallet - BigInt(reserve) : 0n;
  out.held = quote ? out.walletQ : out.wallet;
  return out;
}

/** Step 1: every waiting creator fee into the fee wallet as SOL. `payer` signs and pays; the fee wallet does not sign. */
export async function collectIxs(connection, { mint, feeWallet, payer, graduated, quote = null }) {
  // a custom pair: collected IN the pair token into the fee wallet's pair account (ag/pump.mjs, proven in Pairs/pump.family)
  if (quote) { const ag = await import('../ag/pump.mjs'); return ag.collectIxs(connection, { mint, payer: new PublicKey(payer), creator: new PublicKey(feeWallet), quote, graduated }); }
  const m = new PublicKey(mint), w = new PublicKey(feeWallet), p = new PublicKey(payer);
  const curve = bondingCurveAddress(m), vault = creatorVaultAddress(w);
  // ⛔ new pump.fun trades keep the creator fee ON the curve / pool until swept (pump-public-docs SWEEP_FEES.md)
  const ixs = [await programs(connection).pump.methods.sweepCreatorFee()
    .accountsPartial({ payer: p, global: globalAddress(), baseMint: m, quoteMint: WSOL, quoteTokenProgram: TOKEN_PROGRAM, bondingCurve: curve,
      associatedQuoteBondingCurve: ata(curve, WSOL, TOKEN_PROGRAM), recipient: vault, associatedQuoteRecipient: ata(vault, WSOL, TOKEN_PROGRAM) })
    .instruction()];
  if (graduated) {
    const pool = poolAddress(m), info = await connection.getAccountInfo(pool, 'confirmed');
    const auth = ammCreatorVaultAuthority(w);
    ixs.push(
      // PumpSwap's coin creator vault WSOL account may not exist before the first fee lands (refused with 3012 otherwise)
      createAssociatedTokenAccountIdempotentInstruction(p, ata(auth, WSOL, TOKEN_PROGRAM), auth, WSOL, TOKEN_PROGRAM),
      await ammSweep(connection).methods.sweepCreatorFee()
        .accountsPartial({ payer: p, globalConfig: AMM_GLOBAL_CONFIG, pool, quoteMint: WSOL, quoteTokenProgram: TOKEN_PROGRAM,
          poolQuoteTokenAccount: decodePool(info.data).pool_quote_token_account, recipient: auth, recipientTokenAccount: ata(auth, WSOL, TOKEN_PROGRAM) })
        .instruction(),
      await programs(connection).amm.methods.transferCreatorFeesToPump()
        .accountsPartial({ wsolMint: WSOL, tokenProgram: TOKEN_PROGRAM, coinCreator: w, pumpCreatorVault: vault })
        .instruction(),
    );
  }
  ixs.push(await programs(connection).pump.methods.collectCreatorFee().accountsPartial({ creator: w, creatorVault: vault }).instruction());
  return ixs;
}

/**
 * How much of `lamports` (S) to spend on the buy so the coins it returns use up the SOL left for the deposit.
 * ⛔ Not half: PumpSwap PRICES a swap on vault balance + virtual_quote_reserves (lib/pump.mjs) with its fees, but a DEPOSIT
 *    takes the real balances' ratio. Solved by bisection on the SDK's own swap math: x + deposit(coins(x)) = S, with the
 *    pool as it will be right after the buy. Half left ~25% of the SOL over (e2e, 7 Nov).
 */
export async function buyShare(connection, { mint, feeWallet, lamports, quote = null }) {
  const S = BigInt(lamports);
  const st = await online(connection).swapSolanaState(coinPool(mint, quote), new PublicKey(feeWallet));
  const { pool } = st, B0 = BigInt(st.poolBaseAmount.toString()), Q0 = BigInt(st.poolQuoteAmount.toString());
  if (B0 === 0n || Q0 === 0n) return S / 2n;
  const coins = (x) => BigInt(sdkBuyQuoteInput({ quote: new BN(String(x)), slippage: 1, baseReserve: st.poolBaseAmount, quoteReserve: st.poolQuoteAmount,
    virtualQuoteReserves: pool.virtualQuoteReserves, baseMintAccount: st.baseMintAccount, baseMint: st.baseMint, coinCreator: pool.coinCreator, creator: pool.creator,
    feeConfig: st.feeConfig, globalConfig: st.globalConfig, quoteMint: pool.quoteMint, isMayhemMode: pool.isMayhemMode, creatorFeeBps: pool.creatorFeeBps }).base.toString());
  // SOL the deposit then needs for those coins: the real balances' ratio after the buy (fees leave the pool: Q0 + x is high, so this errs to leftover SOL, never coins)
  const need = (x) => { const b = coins(x); return B0 > b ? (b * (Q0 + x)) / (B0 - b) : S; };
  let lo = 0n, hi = S;
  for (let i = 0; i < 40 && hi - lo > 1000n; i++) { const mid = (lo + hi) / 2n; if (mid + need(mid) > S) hi = mid; else lo = mid; }
  return lo;
}

/** Step 2: spend `lamports` of the fee wallet's SOL on the coin, on its own pool. The fee wallet signs. */
export async function buyIxs(connection, { mint, feeWallet, lamports, slippagePct = 3, quote = null }) {
  const w = new PublicKey(feeWallet), pool = coinPool(mint, quote);
  const state = await online(connection).swapSolanaState(pool, w);
  return PUMP_AMM_SDK.buyQuoteInput(state, new BN(String(lamports)), slippagePct);
}

/**
 * Step 3: deposit up to `tokens` coin units with the SOL they need (at most `maxLamports`), then burn every LP token the
 * fee wallet holds. Returns null when even a sliver does not fit. The fee wallet signs.
 */
export async function depositAndBurnIxs(connection, { mint, feeWallet, tokens, maxLamports, slippagePct = 1, quote = null }) {
  const w = new PublicKey(feeWallet), pool = coinPool(mint, quote);
  const state = await online(connection).liquiditySolanaState(pool, w);
  let base = new BN(String(tokens));
  let dq = PUMP_AMM_SDK.depositAutocompleteQuoteAndLpTokenFromBase(state, base, slippagePct);
  // not enough SOL for every coin: deposit the share the SOL covers (the rest waits for the next pass)
  if (BigInt(dq.quote.toString()) > BigInt(maxLamports)) {
    const r = PUMP_AMM_SDK.depositAutocompleteBaseAndLpTokenFromQuote(state, new BN(String((BigInt(maxLamports) * 97n) / 100n)), slippagePct);
    base = r.base;
    dq = PUMP_AMM_SDK.depositAutocompleteQuoteAndLpTokenFromBase(state, base, slippagePct);
  }
  if (dq.lpToken.isZero() || base.isZero()) return null;
  const ixs = await PUMP_AMM_SDK.depositInstructions(state, dq.lpToken, slippagePct);
  const lpMint = state.pool.lpMint, lpAta = ata(w, lpMint, TOKEN_2022);
  // burn exactly the LP this deposit mints (lpToken) plus any LP an earlier pass left unburned
  const leftover = state.userPoolAccountInfo ? tokenAccountAmount(state.userPoolAccountInfo.data) : 0n;
  ixs.push(createBurnCheckedInstruction(lpAta, lpMint, w, BigInt(dq.lpToken.toString()) + leftover, LP_DECIMALS, [], TOKEN_2022));
  return { ixs, lp: BigInt(dq.lpToken.toString()) + leftover, base: BigInt(base.toString()), quoteMax: BigInt(dq.quote.toString()) };
}

/** LP tokens the fee wallet holds (a burn that did not land). */
export async function lpHeld(connection, { mint, feeWallet, quote = null }) {
  const info = await connection.getAccountInfo(coinPool(mint, quote), 'confirmed');
  if (!info) return 0n;
  const a = await connection.getAccountInfo(ata(new PublicKey(feeWallet), decodePool(info.data).lp_mint, TOKEN_2022), 'confirmed');
  return a ? tokenAccountAmount(a.data) : 0n;
}
