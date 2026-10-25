/**
 * Window launches: a Token-2022 coin with our transfer hook on a Meteora curve shaped like pump.fun's (the stack ported from
 * pump.eco, hk/). The creator sets when buying opens (nobody, the creator included, can buy before: no block-zero devving) and
 * when the window closes. At the close the graduator (api/graduator.mjs) fills what is left of the curve, takes 99% of the
 * SOL back out through Meteora's migration fee, creates the pump.fun coin with the real raise and pushes every holder their
 * share: the coin lands on pump.fun at whatever market cap the window ended at. If buyers fill the curve earlier, it
 * graduates right then.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Keypair, PublicKey } from '@solana/web3.js';
import { getPriceFromSqrtPrice, getCurrentPoint, SwapMode } from '@meteora-ag/dynamic-bonding-curve-sdk';
import BN from 'bn.js';
import { env, num, ROOT } from './env.mjs';
import { ApiError } from './errors.mjs';
import * as sol from './sol.mjs';
import { dbcClient, getPool, getConfig, priorityFee } from '../hk/lib/chain.mjs';
import { buildLaunchTx, buildSwapTx, launchSize } from '../hk/lib/launch.mjs';
import { DEFAULT_RULES, validateRules, decodeRules, hookPdas, hookErrorFromLogs, HOOK_ERRORS } from '../hk/lib/rules.mjs';
import { loadConfigState } from '../hk/lib/configs.mjs';
import { loadLut } from '../hk/lib/lut.mjs';
import { openDb, getLaunch as ledgerLaunch, registerLaunch } from '../hk/lib/db.mjs';
import { LAUNCHED_STATUSES } from '../hk/lib/graduate.mjs';
import { pumpMarketCap } from '../hk/lib/pumpprice.mjs';
import { listPairs, lookupPair, MAX_CREATOR_FEE_BPS, USDC_ENTRY } from '../hk/lib/pairs.mjs';
import { recordIntent } from '../hk/lib/db.mjs';

export const DATA_DIR = path.resolve(ROOT, env('DATA_DIR', 'data'));
fs.mkdirSync(DATA_DIR, { recursive: true });
export const HOOK_PROGRAM = new PublicKey(env('HOOK_PROGRAM', '') || Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(new URL('../hk/keys/hook-keypair.json', import.meta.url), 'utf8')))).publicKey.toBase58());
export const ledger = openDb(path.join(DATA_DIR, 'ledger.db'));
export const dbc = dbcClient(sol.conn);

/** The platform (hot) wallet: fills curves at their deadline, makes configs, launches the pump.fun coins. One key file. */
export function platformKeypair() {
  const file = env('PLATFORM_KEY', path.join(DATA_DIR, 'platform.json'));
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify([...Keypair.generate().secretKey]), { mode: 0o600 });
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, 'utf8'))));
}
export const PLATFORM = platformKeypair().publicKey;

/**
 * WINDOW_MODE: 'fill' (default, pump.eco's way) = the coin migrates to pump.fun when its curve FILLS at the cap the creator picked;
 * buying never closes, nothing is fronted, the hot wallet only needs a fee float. 'deadline' = the creator also sets a time
 * window; at its end the platform fills the rest of the curve (capital on the hot wallet) and the coin migrates at whatever cap.
 */
export const MODE = env('WINDOW_MODE', 'fill') === 'deadline' ? 'deadline' : 'fill';
/** What the hot wallet keeps for fees in fill mode (configs + lookup table once, then transaction fees and migrations). */
const FEE_FLOAT = 300_000_000n;
/** The creator's first buy inside the launch transaction: ON only once the hook that allows it is live on this chain. */
export const FIRST_BUY = env('WINDOW_FIRST_BUY', '0') === '1';
/** The creator's first buy may take at most this share of the total supply (operator, 25 Oct 2026). */
export const FIRST_BUY_MAX_SUPPLY_PCT = 3;
/**
 * The most SOL a first buy may spend so it receives at most FIRST_BUY_MAX_SUPPLY_PCT of the supply, on the curve as it opens
 * (pump.fun's shape: tokens(q) = vt − k/(vs + q)), with Meteora's 1% first-swap fee on top. Null until the configs exist.
 */
export async function firstBuyMaxLamports() {
  const st = await configs().catch(() => null);
  const p = st?.pump; if (!p) return null;
  const target = (p.supply * FIRST_BUY_MAX_SUPPLY_PCT) / 100;
  const q = (p.virtualSol * p.virtualTokens) / (p.virtualTokens - target) - p.virtualSol;
  return BigInt(Math.floor((q / 0.99) * 1e9 * 0.999)); // a hair under, so rounding never lets it exceed the share
}
export const LIMITS = Object.freeze({ mode: MODE, firstBuy: FIRST_BUY, openSecsMin: 5, openSecsMax: 86_400, windowMinMinutes: num('WINDOW_MIN_MINUTES', 5), windowMaxMinutes: 30 * 24 * 60, maxWalletPctMax: 50 });
/** The hot wallet must hold the curve's whole size (what it may have to front) before a launch of that size is offered. */
const CAPITAL_MARGIN = 100_000_000n;

// ⛔ "not there yet" is never cached: the moment the graduator writes configs.json / lut.json the next call sees them
const configsShared = sol.shared(async () => loadConfigState(DATA_DIR), 20_000);
const configs = async () => { const v = await configsShared(); if (!v) configsShared.forget(); return v; };
const lutRaw = sol.shared(async () => loadLut(sol.conn, path.join(DATA_DIR, 'lut.json')).catch(() => null), 60_000);
const lutShared = async () => { const v = await lutRaw(); if (!v) lutRaw.forget(); return v; };
const platformBalance = sol.shared(async () => BigInt(await sol.conn.getBalance(PLATFORM, 'confirmed')), 20_000);
const configOf = sol.sharedMap((addr) => getConfig(dbc, new PublicKey(addr)), 3_600_000);
const poolOf = sol.sharedMap((addr) => getPool(dbc, new PublicKey(addr)), 5_000);
/** The CHAIN's clock (what the hook decides on), not this machine's: a lagging clock would show the wrong phase. */
const chainClock = sol.shared(async () => { const slot = await sol.conn.getSlot('confirmed'); const t = await sol.conn.getBlockTime(slot); return { t: t ?? Math.floor(Date.now() / 1000), at: Date.now() }; }, 5_000);
export const chainNow = async () => { const c = await chainClock().catch(() => null); return c ? c.t + Math.floor((Date.now() - c.at) / 1000) : Math.floor(Date.now() / 1000); };

/** The curve sizes a creator may pick right now: configs exist and the hot wallet can cover them. */
export async function sizes() {
  const st = await configs().catch(() => null);
  if (!st) return [];
  let bal = 0n;
  try { bal = await platformBalance(); } catch {}
  const covered = (s) => (MODE === 'deadline' ? bal >= BigInt(Math.round(s * 1e9)) + CAPITAL_MARGIN : bal >= FEE_FLOAT);
  return Object.keys(st.flatConfigs || {}).map(Number).sort((a, b) => a - b).map((s) => ({ sizeSol: s, capSol: st.pump ? st.pump.capAt(s) : null, startCapSol: st.pump ? st.pump.capAt(0) : null, available: covered(s) }));
}
export async function ready() { const s = await sizes(); return s.some((x) => x.available) && Boolean(await lutShared()); }

/** Validates the creator's window settings. */
export function validateWindow(w) {
  const openSecs = Math.round(Number(w?.openSecs ?? 60));
  // fill mode: no deadline at all (closeSecs 0): the coin trades on its curve until it fills, like pump.eco
  const windowMinutes = MODE === 'deadline' ? Math.round(Number(w?.windowMinutes ?? 60)) : 0;
  const sizeSol = Number(w?.sizeSol);
  const maxWalletPct = Number(w?.maxWalletPct ?? 0);
  if (!(openSecs >= LIMITS.openSecsMin && openSecs <= LIMITS.openSecsMax)) throw new ApiError(`Buying must open ${LIMITS.openSecsMin} seconds to a day after launch`);
  if (MODE === 'deadline') {
    if (!(windowMinutes >= LIMITS.windowMinMinutes && windowMinutes <= LIMITS.windowMaxMinutes)) throw new ApiError(`The window is ${LIMITS.windowMinMinutes} minutes to 30 days`);
    if (windowMinutes * 60 < openSecs + 60) throw new ApiError('The window must end at least a minute after buying opens');
  }
  if (!(maxWalletPct >= 0 && maxWalletPct <= LIMITS.maxWalletPctMax)) throw new ApiError(`Max per wallet is 0 (off) to ${LIMITS.maxWalletPctMax}%`);
  if (!(sizeSol > 0)) throw new ApiError('Pick a curve size');
  return { openSecs, windowMinutes, sizeSol, maxWalletBps: Math.round(maxWalletPct * 100) };
}

/** The launch transaction: Meteora pool + hook rules in one, signed by the mint. The creator (payer) signs in the browser. */
export async function build({ launcher, name, symbol, uri, window: w, mint, devBuyLamports = 0n }) {
  if (devBuyLamports > 0n && !FIRST_BUY) throw new ApiError('A first buy is not available yet.');
  { const max = await firstBuyMaxLamports(); if (devBuyLamports > 0n && (max == null || devBuyLamports > max)) throw new ApiError(`The first buy can take at most ${FIRST_BUY_MAX_SUPPLY_PCT}% of the supply: ${max ? (Number(max) / 1e9).toFixed(3) : '?'} SOL at most.`); }
  const st = await configs();
  if (!st?.flatConfigs?.[w.sizeSol]) throw new ApiError('That curve size is not available right now', 503);
  const avail = (await sizes()).find((s) => s.sizeSol === w.sizeSol);
  if (!avail?.available) throw new ApiError('That curve size is not available right now (the platform cannot cover it). Pick a smaller one.', 503);
  const lut = await lutShared();
  if (!lut) throw new ApiError('Launching is being set up (lookup table). Try again in a few minutes.', 503);
  // holderRewards rides in the hook's rules (public, immutable): the graduation launches the pump.fun coin with it
  const rules = { ...DEFAULT_RULES, dev: new PublicKey(launcher), platformOn: true, platform: PLATFORM, openSecs: w.openSecs, closeSecs: w.windowMinutes * 60, bundleMax: 1, maxWalletBps: w.maxWalletBps, holderRewards: Boolean(w.holderRewards) };
  const errs = validateRules(rules);
  if (errs.length) throw new ApiError(errs.join(' '));
  const config = new PublicKey(st.flatConfigs[w.sizeSol]);
  const built = await buildLaunchTx({ dbc, hookProgram: HOOK_PROGRAM, config, creator: launcher, name, symbol, uri, rules, devBuyLamports, mint, lut, priority: await priorityFee(sol.conn) });
  if (launchSize(built.tx) > 1232) throw new ApiError(`This launch does not fit in one transaction (${launchSize(built.tx)} bytes): shorten the name`);
  const { blockhash } = await sol.conn.getLatestBlockhash('confirmed');
  built.tx.message.recentBlockhash = blockhash;
  built.tx.sign([mint]);
  return { tx: built.tx, pool: built.pool.toBase58(), config: config.toBase58(), rules };
}

export const ledgerHas = (mint) => Boolean(ledgerLaunch(ledger, mint));
/** The token's rules as they are on chain (null until the launch landed). */
export async function rulesOnChain(mint) {
  const a = await sol.conn.getAccountInfo(hookPdas(HOOK_PROGRAM, mint).cfg, 'confirmed');
  return a && a.owner.equals(HOOK_PROGRAM) ? decodeRules(a.data) : null;
}
export const onChain = async (mint) => Boolean(await rulesOnChain(mint));

/** Puts a landed launch in the graduator's ledger (idempotent), with its deadline read from the chain's launch time. */
export async function register(row) {
  const r = await rulesOnChain(row.mint);
  if (!r) return false;
  registerLaunch(ledger, { mint: row.mint, pool: row.pool, config: row.config, creator: row.launcher, name: row.name, symbol: row.symbol, uri: row.metadata_uri, gradSol: row.size_sol, closeAt: r.closeSecs ? r.launchTs + r.closeSecs : null, openSecs: r.openSecs, createdAt: r.launchTs });
  return true;
}

/** Where a window token stands, for the board and the coin page. */
export async function summary(mint, { fresh = false } = {}) {
  const l = ledgerLaunch(ledger, mint);
  if (!l) return null;
  const cfg = await configOf(l.config).catch(() => null);
  const pool = l.status === 'trading' ? await poolOf(l.pool, { fresh }).catch(() => null) : null;
  const threshold = cfg ? Number(cfg.migrationQuoteThreshold.toString()) / 1e9 : l.grad_sol;
  const raisedSol = pool ? Number(pool.quoteReserve.toString()) / 1e9 : null;
  const t = await chainNow();
  const opensAt = l.created_at + (l.open_secs ?? 0), closesAt = l.close_at || null;
  const launched = LAUNCHED_STATUSES.has(l.status) || (l.status === 'stalled' && LAUNCHED_STATUSES.has(l.stalled_from)) ? Boolean(l.pump_mint) : false;
  const empty = l.status === 'done' && !l.pump_mint;
  let phase = 'trading';
  if (empty) phase = 'ended';
  else if (l.status !== 'trading') phase = launched ? 'graduated' : 'graduating';
  else if (t < opensAt) phase = 'opening';
  else if (closesAt && t >= closesAt) phase = 'closing';
  let priceSol = null, capSol = null, venue = 'window';
  if (l.status === 'trading' && pool) { priceSol = Number(getPriceFromSqrtPrice(pool.sqrtPrice, 6, 9)); capSol = priceSol * 1e9; }
  else if (l.pump_mint && launched) {
    const pc = await pumpCapOf(`${l.pump_mint}:${['swapped', 'direct'].includes(l.pair_state) ? l.pair_mint : ''}`).catch(() => null);
    capSol = pc?.marketCapSol ?? null; priceSol = capSol != null ? capSol / 1e9 : null; venue = pc?.venue ?? 'pump.fun';
  }
  return {
    kind: 'window', status: l.status, phase, venue, pool: l.pool, opensAt, closesAt, chainNow: t, raisedSol, targetSol: threshold, progress: raisedSol != null && threshold ? Math.min(1, raisedSol / threshold) : (l.status === 'trading' ? 0 : 1),
    priceSol, capSol, fronted: l.fronted != null ? Number(l.fronted) / 1e9 : null, raise: l.front_before != null ? Number(l.front_before) / 1e9 : null,
    pumpMint: launched ? l.pump_mint : null, settled: l.settle_json ? JSON.parse(l.settle_json) : null, error: l.status === 'stalled' ? 'graduation needs attention' : null,
    feesTo: l.fee_to ?? null,
    pair: l.pair_mint ? { mint: l.pair_mint, state: l.pair_state, creatorFeeBps: l.pair_cfee ?? 0 } : null,
    // a window that ended with nobody holding anything: no pump.fun coin was made (nothing to migrate)
    empty,
  };
}
// "<pumpMint>:<pairMint or empty>": a coin paired with a custom pair holds the PAIR token in its curve/pool (its own decimals),
// so its cap needs the pair's SOL price; read as SOL it was off by the pair's decimals (25 Oct 2026 review)
const pumpCapOf = sol.sharedMap(async (key) => { const [m, pair] = key.split(':'); return pumpMarketCap(sol.conn, m, pair ? { quote: await pairQuote(pair) } : {}); }, 30_000);
const pairQuote = sol.sharedMap(async (pair) => {
  const [usd, solUsd, info] = await Promise.all([sol.quoteUsdOf(pair), sol.solUsd(), sol.conn.getAccountInfo(new PublicKey(pair), 'confirmed')]);
  if (!(usd > 0) || !(solUsd > 0) || !info || info.data.length < 82) return null; // pumpMarketCap refuses a null quote: cap unknown, not wrong
  return { mint: pair, solPerUnit: usd / solUsd, decimals: info.data[44] };
}, 60_000);

/** pump.fun's custom pairs a coin may migrate into (its quote-control list, deep liquidity only), shared for 10 minutes. */
export const pairs = sol.shared(async () => [USDC_ENTRY, ...(await listPairs(sol.conn))], 600_000);
/** A pasted CA, looked up once per 10 minutes per mint. */
export const lookup = sol.sharedMap(async (mint) => {
  const r = await lookupPair(sol.conn, mint);
  if (r.transient) { const e = new Error(r.why); e.transient = true; throw e; } // a blip is answered but never cached for 10 minutes
  return r;
}, 600_000, 500);
export { MAX_CREATOR_FEE_BPS };
/** Validates a creator's pair choice: null (SOL) or { mint, symbol, creatorFeeBps }. */
export async function validatePair(mint, creatorFeeBps) {
  if (!mint) { if (creatorFeeBps) throw new ApiError('A Pumpfun creator fee needs a custom pair (Pumpfun ignores it on SOL).'); return null; }
  let p = (await pairs().catch(() => [])).find((x) => x.mint === String(mint));
  if (!p) { const r = await lookup(String(mint)).catch(() => null); if (!r?.ok) throw new ApiError(r?.why ? `That pair cannot be used: ${r.why}.` : 'That pair cannot be checked right now. Try again.'); p = r.pair; }
  const fee = creatorFeeBps == null || creatorFeeBps === '' ? 0 : Number(creatorFeeBps);
  if (!Number.isInteger(fee) || fee < 0 || fee > MAX_CREATOR_FEE_BPS) throw new ApiError('The Pumpfun creator fee is 0% to 3%.');
  // USDC is one of pump.fun's built-in quotes: its creator fee follows pump.fun's schedule and cannot be set
  return { mint: p.mint, symbol: p.symbol, kind: p.kind ?? 'control', creatorFeeBps: p.kind === 'usdc' ? 0 : fee };
}
/** Records the pair the graduator migrates this coin into (the ledger's launch_intents; overwritten on a re-prepare). */
export function recordPair(mint, pair) {
  if (pair) recordIntent(ledger, mint, pair.mint, pair.creatorFeeBps);
  else ledger.prepare('DELETE FROM launch_intents WHERE mint = ?').run(mint);
}

/** A buy (lamports in) or sell (units in) on the window token's curve, quoted from the live curve with slippage. */
export async function swap({ wallet, mint, side, amountIn, slippageBps }) {
  const l = ledgerLaunch(ledger, mint);
  if (!l) throw new ApiError('Not a window token', 404);
  if (l.status !== 'trading') throw new ApiError('This coin is graduating to pump.fun. It can be traded there in a few minutes.', 409);
  const r = await rulesOnChain(mint);
  const t = await chainNow();
  const buy = side === 'buy';
  if (buy && r && t < r.launchTs + r.openSecs) throw new ApiError(`Buying opens in ${r.launchTs + r.openSecs - t} seconds. Nobody can buy before that, the creator included.`, 409);
  if (buy && r && r.closeSecs && t >= r.launchTs + r.closeSecs) throw new ApiError('The window has closed: this coin is graduating to pump.fun.', 409);
  const [poolState, cfg] = await Promise.all([getPool(dbc, new PublicKey(l.pool)), configOf(l.config)]);
  if (!poolState) throw new ApiError('Could not read the curve. Try again.', 503);
  let minOut;
  try {
    const q = dbc.pool.swapQuote2({ virtualPool: { poolState }, config: cfg, swapBaseForQuote: !buy, hasReferral: false, eligibleForFirstSwapWithMinFee: false,
      currentPoint: await getCurrentPoint(sol.conn, cfg.activationType), slippageBps, swapMode: buy ? SwapMode.PartialFill : SwapMode.ExactIn, amountIn: new BN(amountIn.toString()) });
    minOut = BigInt(q.minimumAmountOut.toString());
    var expected = BigInt(q.amountOut?.toString?.() ?? q.minimumAmountOut.toString());
  } catch (e) { throw new ApiError(`Cannot quote that trade: ${String(e.message).slice(0, 120)}`, 400); }
  const tx = await buildSwapTx({ dbc, pool: l.pool, owner: wallet, buy, amountIn, minimumAmountOut: minOut, priority: await priorityFee(sol.conn) });
  tx.recentBlockhash = (await sol.conn.getLatestBlockhash('confirmed')).blockhash;
  return { tx, expected, minOut };
}

/** A hook refusal in failed-transaction logs, in words. */
export const hookReason = (logs) => { const c = hookErrorFromLogs(logs, HOOK_PROGRAM); return c ? HOOK_ERRORS[c] ?? `hook refused (${c})` : null; };
export const hookCode = (logs) => hookErrorFromLogs(logs, HOOK_PROGRAM);
