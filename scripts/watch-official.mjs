/**
 * Watches the operator's wallet for its pump.fun create and runs go-live the moment it lands: lists the coin as the official
 * one (from the staged plan: scripts/stage-official.mjs) and OPENS launching for everyone. Exits 0 when done.
 *
 * Fast: a websocket log subscription on the wallet (pushed by the RPC within about a second of the create confirming),
 * with a slow poll as the backstop if the socket drops. Safe: the create must be SIGNED by the wallet (an address index
 * lists mere mentions) and the coin's on-chain ticker must be the plan's (a test coin from the same wallet is ignored).
 * Env: WATCH_WALLET (default: the plan's wallet), WATCH_POLL_MS (15000), WATCH_SINCE_TS (default: 10 min before the plan was
 * staged), WATCH_ANY_SYMBOL=1 (accept any ticker), DRY=1 (report, change nothing).
 */
import '../api/env.mjs';
import { PublicKey } from '@solana/web3.js';
import { getTokenMetadata, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import * as sol from '../api/sol.mjs';
import { plan, goLive, pumpCreateBy } from '../api/official.mjs';
import { setKv } from '../api/db.mjs';
import { bondingCurveAddress } from '../lib/pump.mjs';

const log = (...a) => console.log(new Date().toISOString(), ...a);
const P = plan();
const WALLET = process.env.WATCH_WALLET || P?.wallet;
if (!WALLET) { console.error('no wallet to watch: stage the plan with --wallet or set WATCH_WALLET'); process.exit(1); }
const POLL = Number(process.env.WATCH_POLL_MS || 15000);
const DRY = process.env.DRY === '1';
const WANT = process.env.WATCH_ANY_SYMBOL === '1' ? null : (P?.symbol || null);
const SINCE = Number(process.env.WATCH_SINCE_TS || (P?.stagedAt ? Math.floor(P.stagedAt / 1000) - 600 : Math.floor(Date.now() / 1000) - 600));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wallet = new PublicKey(WALLET);
log(`watching ${WALLET} (websocket + poll every ${POLL} ms) for a pump.fun create${WANT ? ` with ticker ${WANT}` : ''}, since ${new Date(SINCE * 1000).toISOString()}${DRY ? ' (DRY)' : ''}; plan: ${P ? `${P.name} (${P.symbol}) image ${P.image ?? 'none'}` : 'NONE'}`);

const seen = new Set();
let done = false, busy = Promise.resolve();
/** One signature: is it the wallet's create of the official coin? Returns true when go-live ran. */
async function check(sig, blockTime = null) {
  if (done || seen.has(sig)) return false;
  if (blockTime != null && blockTime < SINCE) { seen.add(sig); return false; }
  let tx = null;
  for (let i = 0; i < 8 && !tx; i++) { // a pushed signature can be ahead of getTransaction by a moment
    tx = (await sol.conn._rpcRequest('getTransaction', [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]))?.result;
    if (!tx) await sleep(400);
  }
  if (!tx) { log(`${sig.slice(0, 12)}… not readable yet, the poll retries it`); return false; }
  seen.add(sig);
  if ((tx.blockTime ?? 0) < SINCE) return false;
  const c = pumpCreateBy(tx, WALLET);
  if (!c) return false;
  let curve = null;
  for (let i = 0; i < 10 && !curve; i++) { curve = await sol.conn.getAccountInfo(bondingCurveAddress(new PublicKey(c.mint)), 'confirmed'); if (!curve) await sleep(300); }
  if (!curve) { seen.delete(sig); log(`${c.sig.slice(0, 12)}… creates ${c.mint} but its curve is not readable yet, retrying`); return false; }
  if (WANT) {
    const md = await getTokenMetadata(sol.conn, new PublicKey(c.mint), 'confirmed', TOKEN_2022_PROGRAM_ID).catch(() => null);
    if (md && md.symbol.trim().toUpperCase() !== WANT.toUpperCase()) { log(`${WALLET} created ${c.mint} with ticker ${md.symbol}, not ${WANT}: ignored, still watching`); return false; }
  }
  log(`✅ ${WALLET} created the pump.fun coin ${c.mint} (${c.via}, ${c.sig})`);
  if (DRY) { log('DRY: would list it as the official coin and open launching'); done = true; process.exit(0); }
  done = true;
  const out = await goLive(c.mint, { log });
  setKv('officialWatch', { wallet: WALLET, found: c, at: Date.now() });
  log(`done: ${out.name} (${out.symbol}) is the official coin and launching is OPEN. Watcher exiting.`);
  process.exit(0);
}
const queue = (sig, bt) => { busy = busy.then(() => check(sig, bt)).catch((e) => log(`check ${sig.slice(0, 12)}… failed: ${String(e.message).slice(0, 140)}`)); return busy; };

// the push: every transaction mentioning the wallet, about a second after it confirms
try {
  sol.conn.onLogs(wallet, (l) => { if (!l.err) queue(l.signature, null); }, 'confirmed');
  log('websocket subscription on the wallet is open');
} catch (e) { log(`websocket unavailable (${e.message}); polling only`); }

// the backstop poll (also catches anything sent while the socket was reconnecting)
let polls = 0;
for (;;) {
  try {
    const sigs = await sol.conn.getSignaturesForAddress(wallet, { limit: 20 }, 'confirmed');
    for (const s of sigs.reverse()) if (!s.err) await queue(s.signature, s.blockTime ?? null);
    if (polls++ % 40 === 0) setKv('officialWatch', { wallet: WALLET, polls, lastPollAt: Date.now() });
  } catch (e) { log(`poll failed: ${String(e.message).slice(0, 140)}`); }
  await sleep(POLL);
}
