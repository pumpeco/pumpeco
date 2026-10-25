/**
 * The coin's REAL trade history, read from the chain (every trade on its venue, not only the ones placed here), for the
 * chart and the trades tab, exactly as the original showed them. Indexed on demand when a coin page is open: new
 * transactions since the last pass first, then (while a backlog remains) one older page per pass, so a coin with a long
 * history fills in over a few page views without ever reading it all at once. One pass per coin per 20 s at most.
 *
 * Venues: a pump.fun coin's bonding curve (SOL sits in the curve account, tokens in its token account), its PumpSwap pool
 * once graduated (wSOL + token vaults owned by the pool), a window token's Meteora pool (vaults owned by Meteora's pool
 * authority). A trade = tokens leaving (buy) or entering (sell) the venue; its price = SOL moved / tokens moved.
 */
import { PublicKey } from '@solana/web3.js';
import { readParsedTransaction } from '../hk/lib/tx-read.mjs';
import { db, one, all, run, now } from './db.mjs';
import * as sol from './sol.mjs';
import { bondingCurveAddress, poolAddress, coinState, WSOL } from '../lib/pump.mjs';

db.exec(`CREATE TABLE IF NOT EXISTS chain_trades (
  mint TEXT NOT NULL, sig TEXT NOT NULL, slot INTEGER, ts INTEGER NOT NULL, wallet TEXT, side TEXT NOT NULL,
  lamports TEXT NOT NULL, token_units TEXT NOT NULL, price REAL NOT NULL, venue TEXT, PRIMARY KEY (mint, sig)
);
CREATE INDEX IF NOT EXISTS chain_trades_mint_ts ON chain_trades(mint, ts);
CREATE TABLE IF NOT EXISTS chain_index (mint TEXT PRIMARY KEY, venue TEXT, address TEXT, newest_sig TEXT, oldest_sig TEXT, backfilled INTEGER NOT NULL DEFAULT 0, indexed_at INTEGER, gap_before TEXT, gap_until TEXT)`);
try { db.exec('ALTER TABLE chain_index ADD COLUMN gap_before TEXT'); db.exec('ALTER TABLE chain_index ADD COLUMN gap_until TEXT'); } catch {}

const DBC_AUTHORITY = 'FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM';
// ⛔ RPC budget: a pass reads at most PAGE transactions (one paid call each) and runs at most once per COOLDOWN per coin,
//    so an open coin page costs ~PAGE reads a minute while a backlog remains and ~nothing once it is caught up.
const PAGE = Number(process.env.HISTORY_PAGE || 100);
const COOLDOWN_MS = Number(process.env.HISTORY_COOLDOWN_MS || 20_000);
const passes = new Map(); // mint → { at, promise }

/** Where the coin trades right now: { venue, address, owner } (owner = who holds the venue's token accounts). */
async function venueOf(mint) {
  const row = one('SELECT kind, pool FROM launches WHERE mint = ?', mint);
  let tradedMint = mint;
  if (row?.kind === 'window') {
    const w = await (await import('./window.mjs')).summary(mint);
    if (!w) return null;
    if (w.status === 'trading' || !w.pumpMint) return { venue: 'dbc', address: row.pool, owner: DBC_AUTHORITY, tradedMint: mint };
    tradedMint = w.pumpMint;
  }
  const st = await coinState(sol.conn, tradedMint);
  if (!st) return null;
  const m = new PublicKey(tradedMint);
  if (!st.complete) {
    const c = bondingCurveAddress(m);
    const info = await sol.conn.getAccountInfo(c, 'confirmed');
    const curveRent = info ? BigInt(await sol.conn.getMinimumBalanceForRentExemption(info.data.length)) : 0n;
    return { venue: 'curve', address: c.toBase58(), owner: c.toBase58(), tradedMint, isSol: st.isSol, supplyUnits: BigInt(Math.round(st.supply * 1e6)), curveRent };
  }
  const p = poolAddress(m, 0, new PublicKey(st.quoteMint));
  return { venue: 'amm', address: p.toBase58(), owner: p.toBase58(), tradedMint, isSol: st.isSol };
}

/** One trade from a parsed transaction, or null. */
function tradeOf(tx, v) {
  if (!tx?.meta || tx.meta.err) return null;
  const keys = tx.transaction.message.accountKeys.map((k) => (k.pubkey ? k.pubkey.toBase58() : String(k)));
  const bal = (list, sign) => { const out = { tok: 0n, wsol: 0n }; for (const b of list ?? []) { if (b.owner !== v.owner) continue; const a = BigInt(b.uiTokenAmount.amount) * sign; if (b.mint === v.tradedMint) out.tok += a; else if (b.mint === WSOL.toBase58()) out.wsol += a; } return out; };
  const post = bal(tx.meta.postTokenBalances, 1n), pre = bal(tx.meta.preTokenBalances, -1n);
  let dTok = post.tok + pre.tok;
  let dSol = post.wsol + pre.wsol;
  if (v.venue === 'curve') {
    const i = keys.indexOf(v.address); if (i < 0) return null;
    dSol = BigInt(tx.meta.postBalances[i]) - BigInt(tx.meta.preBalances[i]);
    // the launch transaction: the curve is created (its rent is in the SOL delta) and the whole supply minted into it, so the
    // first buy shows as supply − what is left; a launch without a buy moves no SOL out of the buyer and is not a trade
    const hadPre = (tx.meta.preTokenBalances ?? []).some((b) => b.owner === v.owner && b.mint === v.tradedMint);
    if (!hadPre && v.supplyUnits != null) { dTok = post.tok - v.supplyUnits; dSol -= v.curveRent ?? 0n; if (dTok === 0n || dSol <= 0n) return null; }
  }
  if (dTok === 0n || dSol === 0n) return null;
  const side = dTok < 0n ? 'buy' : 'sell';
  if ((side === 'buy') !== (dSol > 0n)) return null; // tokens and SOL must move against each other (a deposit or a mint is not a trade)
  const lamports = dSol < 0n ? -dSol : dSol, units = dTok < 0n ? -dTok : dTok;
  return { sig: tx.transaction.signatures[0], slot: tx.slot, ts: (tx.blockTime ?? 0) * 1000, wallet: keys[0], side, lamports: String(lamports), tokenUnits: String(units), price: (Number(lamports) / 1e9) / (Number(units) / 1e6) };
}

/** Starts a pass for what is new (and one older page while a backlog remains) unless one ran recently. NEVER awaited by a
 *  request: the chart answers with what is indexed and the pass fills the rest in for the next poll. */
export function index(mint) {
  const p = passes.get(mint);
  if (p && (p.promise || now() - p.at < COOLDOWN_MS)) return p.promise ?? Promise.resolve(0);
  const promise = pass(mint).catch((e) => { console.error(`[history] ${mint}: ${e.message}`); return 0; }).finally(() => passes.set(mint, { at: now(), promise: null }));
  passes.set(mint, { at: now(), promise });
  return promise;
}
/** The pass a test can wait for. */
export const indexNow = (mint) => index(mint);
async function pass(mint) {
  const v = await venueOf(mint);
  if (!v || v.isSol === false) return 0;
  let st = one('SELECT * FROM chain_index WHERE mint = ?', mint);
  if (!st || st.address !== v.address) { run('INSERT OR REPLACE INTO chain_index (mint, venue, address, newest_sig, oldest_sig, backfilled, indexed_at) VALUES (?, ?, ?, NULL, NULL, 0, ?)', mint, v.venue, v.address, now()); st = one('SELECT * FROM chain_index WHERE mint = ?', mint); }
  const addr = new PublicKey(v.address);
  let sigs = [];
  // a gap left by an earlier pass that could not read everything new at once: closed first, page by page
  if (st.gap_before) {
    const gap = await sol.conn.getSignaturesForAddress(addr, { before: st.gap_before, limit: PAGE, until: st.gap_until ?? undefined }, 'confirmed');
    sigs.push(...gap);
    if (gap.length < PAGE) run('UPDATE chain_index SET gap_before = NULL, gap_until = NULL WHERE mint = ?', mint);
    else run('UPDATE chain_index SET gap_before = ? WHERE mint = ?', gap[gap.length - 1].signature, mint);
  }
  // newest first, down to the newest signature already seen; more than fits in one pass leaves a gap to close next time
  const fresh = await sol.conn.getSignaturesForAddress(addr, { limit: PAGE, until: st.newest_sig ?? undefined }, 'confirmed');
  if (fresh.length >= PAGE && st.newest_sig && !st.gap_before) run('UPDATE chain_index SET gap_before = ?, gap_until = ? WHERE mint = ?', fresh[fresh.length - 1].signature, st.newest_sig, mint);
  sigs = [...fresh, ...sigs];
  let older = [];
  if (!st.backfilled && sigs.length < PAGE) {
    const beforeOld = st.oldest_sig ?? (sigs.length ? sigs[sigs.length - 1].signature : undefined);
    if (st.oldest_sig || sigs.length) older = await sol.conn.getSignaturesForAddress(addr, { before: beforeOld, limit: PAGE - sigs.length }, 'confirmed');
    if (older.length < PAGE - sigs.length) run('UPDATE chain_index SET backfilled = 1 WHERE mint = ?', mint);
  }
  const batch = [...sigs, ...older].filter((s) => !s.err);
  let n = 0;
  for (const s of batch) {
    if (one('SELECT 1 FROM chain_trades WHERE mint = ? AND sig = ?', mint, s.signature)) continue;
    let tx = null;
    try { tx = await readParsedTransaction(sol.conn, s.signature); } catch {}
    const t = tradeOf(tx, v);
    if (!t) continue;
    run('INSERT OR IGNORE INTO chain_trades (mint, sig, slot, ts, wallet, side, lamports, token_units, price, venue) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', mint, t.sig, t.slot, t.ts || (s.blockTime ?? 0) * 1000, t.wallet, t.side, t.lamports, t.tokenUnits, t.price, v.venue);
    n++;
  }
  const newest = fresh.length ? fresh[0].signature : st.newest_sig;
  const oldest = older.length ? older[older.length - 1].signature : (st.oldest_sig ?? (fresh.length ? fresh[fresh.length - 1].signature : null));
  run('UPDATE chain_index SET newest_sig = ?, oldest_sig = ?, indexed_at = ? WHERE mint = ?', newest, oldest, now(), mint);
  return n;
}

/** Candles over the indexed trades, the live price closing the last one. `priceNow` in SOL per token (null = unknown). */
/** The intervals the chart offers (seconds), like the original: 1m 5m 15m 1h 4h 1D. */
export const INTERVALS = [60, 300, 900, 3600, 14400, 86400];
export function chart(mint, priceNow = null, intervalSecs = null) {
  const rows = all('SELECT ts, price, lamports, side, wallet, sig, token_units AS tokenUnits FROM chain_trades WHERE mint = ? AND ts > 0 ORDER BY ts ASC', mint);
  const first = rows[0]?.ts ?? now(), span = now() - first;
  const auto = span < 3 * 3_600_000 ? 60_000 : span < 24 * 3_600_000 ? 300_000 : span < 7 * 86_400_000 ? 3_600_000 : 14_400_000;
  const interval = INTERVALS.includes(Number(intervalSecs)) ? Number(intervalSecs) * 1000 : auto;
  const candles = [];
  for (const r of rows) {
    const t = Math.floor(r.ts / interval) * interval;
    const last = candles[candles.length - 1];
    if (last && last.t === t) { last.h = Math.max(last.h, r.price); last.l = Math.min(last.l, r.price); last.c = r.price; last.v += Number(r.lamports) / 1e9; }
    else candles.push({ t, o: last ? last.c : r.price, h: r.price, l: r.price, c: r.price, v: Number(r.lamports) / 1e9 });
  }
  if (priceNow != null && priceNow > 0) {
    const t = Math.floor(now() / interval) * interval;
    const last = candles[candles.length - 1];
    if (last && last.t === t) { last.c = priceNow; last.h = Math.max(last.h, priceNow); last.l = Math.min(last.l, priceNow); }
    else candles.push({ t, o: last ? last.c : priceNow, h: priceNow, l: priceNow, c: priceNow, v: 0 });
  }
  const st = one('SELECT backfilled, indexed_at FROM chain_index WHERE mint = ?', mint);
  return { interval, candles: candles.slice(-2000), trades: rows.slice(-100).reverse(), total: rows.length, complete: Boolean(st?.backfilled), indexedAt: st?.indexed_at ?? null };
}
