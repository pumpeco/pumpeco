/**
 * The board: every coin launched here, priced from its bonding curve (one shared, paced read per coin), with replies,
 * holders and a sampled price history for the chart. Reads are cached and shared so launch-day traffic never stampedes
 * the RPC (every page hits the same cache; a failure serves the last good answer).
 */
import { PublicKey } from '@solana/web3.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';
import { all, one, run, now } from './db.mjs';
import * as sol from './sol.mjs';
import { ApiError } from './errors.mjs';
import { coinState, bondingCurveAddress, ata, TOKEN_2022 } from '../lib/pump.mjs';
import * as window from './window.mjs';

const stateOf = sol.sharedMap((mint) => coinState(sol.conn, mint), 20_000);
/** A quote token's USD price (custom-pair coins), from DexScreener, shared for a minute; null when unknown. */
const quoteUsdOf = sol.sharedMap(async (mint) => {
  const r = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${mint}`, { signal: AbortSignal.timeout(6000), headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`dexscreener ${r.status}`);
  const pairs = (await r.json()).filter((p) => p.baseToken?.address === mint && p.priceUsd).sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
  return pairs.length ? Number(pairs[0].priceUsd) : null;
}, 60_000);
const holdersOf = sol.sharedMap((mint) => readHolders(mint), 30_000);
export const forget = (mint) => { stateOf(mint, { fresh: false }).catch(() => {}); forgetKeys.add(mint); };
const forgetKeys = new Set();

/** The board's own view of a coin: our row + the chain's numbers. */
async function view(row, solUsd) {
  let st = null, win = null;
  if (row.kind === 'window') {
    try { win = await window.summary(row.mint, { fresh: forgetKeys.delete(row.mint) }); } catch (e) { console.error('[window] summary', row.mint, e.message); }
    if (win) st = { complete: win.phase === 'graduated' || win.phase === 'graduating', priceSol: win.priceSol, capSol: win.capSol, progress: win.progress, realSol: win.raisedSol, tokensLeft: null, pool: win.pool, creator: row.launcher };
  } else try {
    st = await stateOf(row.mint, { fresh: forgetKeys.delete(row.mint) });
    // a custom-pair coin: its cap is in the quote token; converted through the quote's USD price and SOL's
    if (st && !st.isSol && st.capQ != null) {
      const qUsd = await quoteUsdOf(st.quoteMint).catch(() => null);
      if (qUsd && solUsd) { st.capSol = (st.capQ * qUsd) / solUsd; st.priceSol = (st.priceQ * qUsd) / solUsd; }
    }
  } catch {}
  const replies = one('SELECT COUNT(*) AS n FROM replies WHERE mint = ?', row.mint).n;
  // A completed curve reads zero until pump.fun's migration makes the pool: show the last price this site sampled.
  if (st?.complete && st.capSol == null) { const last = one('SELECT price_sol AS p, cap_sol AS c FROM prices WHERE mint = ? ORDER BY at DESC LIMIT 1', row.mint); if (last) { st.priceSol = last.p; st.capSol = last.c; } }
  return {
    mint: row.mint, name: row.name, symbol: row.symbol, description: row.description, image: row.image, creator: row.launcher,
    socials: JSON.parse(row.socials_json || '{}'), metadataUri: row.metadata_uri, createdAt: row.live_at || row.created_at, bumpedAt: row.bumped_at, replies,
    sig: row.sig,
    kind: row.kind || 'pump', window: win, holderRewards: Boolean(row.holder_rewards), crownedAt: row.crowned_at, origin: row.origin || 'site',
    quote: st?.isSol === false ? { mint: st.quoteMint, capQ: st.capQ } : null,
    complete: st?.complete ?? false, priceSol: st?.priceSol ?? null, capSol: st?.capSol ?? null, capUsd: st?.capSol != null && solUsd ? st.capSol * solUsd : null,
    progress: st?.progress ?? null, realSol: st?.realSol ?? null, tokensLeft: st?.tokensLeft ?? null, pool: st?.pool ?? null, onChainCreator: st?.creator ?? null,
  };
}

/** King of the hill, like the original: a coin is crowned when its cap first crosses KOTH_USD; the LATEST crowned coin that
 *  is still on its curve wears the crown (a graduated coin leaves the hill). With no crowned coin yet, the highest cap leads. */
export const KOTH_USD = Number(process.env.KOTH_USD || 30_000);
function crown(coins) {
  const onCurve = coins.filter((c) => (c.kind === 'window' ? c.window?.phase === 'trading' || c.window?.phase === 'opening' : !c.complete) && c.capUsd != null);
  for (const c of onCurve) if (c.capUsd >= KOTH_USD && !c.crownedAt) { c.crownedAt = now(); run('UPDATE launches SET crowned_at = ? WHERE mint = ? AND crowned_at IS NULL', c.crownedAt, c.mint); }
  const crowned = onCurve.filter((c) => c.crownedAt).sort((a, b) => b.crownedAt - a.crownedAt);
  const king = crowned[0] ?? (onCurve.length ? onCurve.reduce((a, b) => (b.capUsd > a.capUsd ? b : a)) : null);
  return king ? { ...king, kothUsd: KOTH_USD, crowned: Boolean(king.crownedAt) } : null;
}
const SORTS = { bump: (a, b) => b.bumpedAt - a.bumpedAt, created: (a, b) => b.createdAt - a.createdAt, cap: (a, b) => (b.capUsd ?? -1) - (a.capUsd ?? -1), replies: (a, b) => b.replies - a.replies };
/** The operator's own coin (scripts/golive.mjs): shown first on the board whatever the sort, tagged. */
export const official = () => { const r = one("SELECT mint, symbol FROM launches WHERE origin = 'official' AND status = 'live' ORDER BY live_at DESC LIMIT 1"); return r ? { mint: r.mint, symbol: r.symbol } : null; };
export async function list({ sort = 'bump', order = 'desc', q = '' } = {}) {
  const rows = all("SELECT * FROM launches WHERE status = 'live' ORDER BY bumped_at DESC LIMIT 300");
  const solUsd = await sol.solUsd().catch(() => null);
  const needle = String(q || '').trim().toLowerCase();
  const exact = String(q || '').trim();
  const filtered = needle ? rows.filter((r) => r.name.toLowerCase().includes(needle) || r.symbol.toLowerCase().includes(needle) || r.mint === exact || (r.description || '').toLowerCase().includes(needle)) : rows;
  const out = [];
  for (const r of filtered.slice(0, 120)) out.push(await view(r, solUsd));
  out.sort(SORTS[sort] || SORTS.bump);
  if (order === 'asc') out.reverse();
  // the official coin stays on top
  const oi = out.findIndex((c) => c.origin === 'official');
  if (oi > 0) out.unshift(out.splice(oi, 1)[0]);
  const king = crown(out);
  return { coins: out, king, kothUsd: KOTH_USD, solUsd };
}

export async function coin(mint) {
  const row = one("SELECT * FROM launches WHERE mint = ? AND status IN ('live', 'created')", mint);
  if (!row) throw new ApiError('No such coin here', 404);
  const solUsd = await sol.solUsd().catch(() => null);
  const v = await view(row, solUsd);
  v.status = row.status;
  // the hill, for the page's "dethrone the current king" bar
  try { const b = await list({}); v.king = b.king ? { mint: b.king.mint, symbol: b.king.symbol, capUsd: b.king.capUsd, crownedAt: b.king.crownedAt } : null; v.kothUsd = KOTH_USD; } catch { v.king = null; v.kothUsd = KOTH_USD; }
  const prices = all('SELECT at, price_sol AS priceSol, cap_sol AS capSol FROM prices WHERE mint = ? ORDER BY at ASC LIMIT 2000', mint);
  const trades = all('SELECT sig, wallet, side, lamports, token_units AS tokenUnits, created_at AS at FROM trades WHERE mint = ? ORDER BY created_at DESC LIMIT 100', mint);
  let holders = [];
  // a graduated window token: the holders that matter are the pump.fun coin's
  try { holders = await holdersOf(v.window?.pumpMint || mint); } catch {}
  return { ...v, solUsd, prices, trades, holders, replies: replies(mint), replyCount: v.replies };
}

/** The 20 largest holders, with the bonding curve labelled. One RPC call. */
async function readHolders(mint) {
  const m = new PublicKey(mint);
  const curve = bondingCurveAddress(m);
  const curveAta = ata(curve, m, TOKEN_2022).toBase58();
  const DBC_AUTHORITY = 'FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM';
  const r = await sol.conn.getTokenLargestAccounts(m, 'confirmed');
  const supply = await sol.conn.getTokenSupply(m, 'confirmed');
  const total = Number(supply.value.amount) || 1;
  const rows = r.value.slice(0, 20).map((a) => ({ account: a.address.toBase58(), amount: Number(a.amount), pct: (Number(a.amount) / total) * 100, label: a.address.toBase58() === curveAta ? 'bonding curve' : null }));
  // Owners of the top accounts, one batched read.
  const infos = await sol.conn.getMultipleAccountsInfo(rows.map((x) => new PublicKey(x.account)));
  rows.forEach((x, i) => { const d = infos[i]?.data; x.owner = d && d.length >= 64 ? new PublicKey(d.subarray(32, 64)).toBase58() : null; if (x.owner === DBC_AUTHORITY) x.label = 'bonding curve'; });
  return rows;
}

/* ───────────── price samples (the chart) ───────────── */

export async function sample(mint) {
  const row = one('SELECT kind FROM launches WHERE mint = ?', mint);
  const st = row?.kind === 'window' ? await window.summary(mint, { fresh: true }).then((w) => (w ? { priceSol: w.priceSol, capSol: w.capSol } : null)) : await stateOf(mint, { fresh: true });
  if (!st || st.priceSol == null) return;
  const last = one('SELECT price_sol AS p FROM prices WHERE mint = ? ORDER BY at DESC LIMIT 1', mint);
  if (last && Math.abs(last.p - st.priceSol) / last.p < 0.0005) return;
  run('INSERT OR IGNORE INTO prices (mint, at, price_sol, cap_sol) VALUES (?, ?, ?, ?)', mint, now(), st.priceSol, st.capSol);
}
/** Every minute: the coins live in the last 3 days, oldest sample first, at most 40 a pass (paced by sol.mjs). */
export async function samplePass() {
  const rows = all("SELECT mint FROM launches WHERE status = 'live' AND live_at > ? ORDER BY bumped_at DESC LIMIT 40", now() - 3 * 86_400_000);
  for (const r of rows) await sample(r.mint).catch(() => {});
}

/* ───────────── replies (the thread) ───────────── */

export const REPLY_MAX = 500;
export const replyMessage = (mint, ts, text) => `pump reply\nmint: ${mint}\ntime: ${ts}\n\n${text}`;
export const replies = (mint) => all('SELECT id, wallet, text, created_at AS at FROM replies WHERE mint = ? ORDER BY created_at ASC LIMIT 500', mint);

/** A reply is signed by the wallet that posts it (signMessage), so nobody can post as someone else. */
export function postReply({ mint, wallet, text, ts, signature }) {
  if (!sol.isAddress(String(wallet || ''))) throw new ApiError('Connect a wallet first.', 401);
  // The signature covers the text EXACTLY as the browser sent it; what is stored is the cleaned text.
  const raw = String(text ?? '');
  if (raw.length > REPLY_MAX * 4) throw new ApiError('That reply is too long.');
  const t = raw.normalize('NFKC').replace(/[\p{Cf}]/gu, '').trim().slice(0, REPLY_MAX);
  if (!t) throw new ApiError('Write something first.');
  if (!one("SELECT 1 FROM launches WHERE mint = ? AND status = 'live'", mint)) throw new ApiError('No such coin here', 404);
  const time = Number(ts);
  if (!(Math.abs(now() - time) < 5 * 60_000)) throw new ApiError('This reply is stale: try again.');
  let ok = false;
  try {
    ok = ed25519.verify(bs58.decode(String(signature || '')), new TextEncoder().encode(replyMessage(mint, time, raw)), new PublicKey(wallet).toBytes());
  } catch {}
  if (!ok) throw new ApiError('The signature does not match the wallet.', 401);
  if (one('SELECT 1 FROM replies WHERE wallet = ? AND signed_at = ?', wallet, time)) throw new ApiError('This reply was already posted.', 409);
  if (one('SELECT COUNT(*) AS n FROM replies WHERE wallet = ? AND created_at > ?', wallet, now() - 60_000).n >= 6) throw new ApiError('Slow down a little.', 429);
  run('INSERT INTO replies (mint, wallet, text, signed_at, created_at) VALUES (?, ?, ?, ?, ?)', mint, wallet, t, time, now());
  run('UPDATE launches SET bumped_at = ? WHERE mint = ?', now(), mint);
  return replies(mint);
}

/* ───────────── the ticker at the top ───────────── */

export function ticker() {
  return all(`SELECT t.sig, t.mint, t.wallet, t.side, t.lamports, t.token_units AS tokenUnits, t.created_at AS at, l.symbol, l.image
              FROM trades t JOIN launches l ON l.mint = t.mint WHERE l.status = 'live' ORDER BY t.created_at DESC LIMIT 24`);
}
