/**
 * Watches the operator's wallet for its pump.fun create and runs go-live the moment it lands: lists the coin as the official
 * one (from the staged plan: scripts/stage-official.mjs) and OPENS launching for everyone. Exits 0 when done (the service
 * stays stopped). Env: WATCH_WALLET (default: the plan's wallet), WATCH_POLL_MS (4000), WATCH_SINCE_TS (default: 10 min
 * before the plan was staged; older creates by the wallet are ignored), WATCH_LIMIT (20), DRY=1 (report, do nothing).
 */
import '../api/env.mjs';
import { PublicKey } from '@solana/web3.js';
import * as sol from '../api/sol.mjs';
import { plan, goLive, pumpCreateBy } from '../api/official.mjs';
import { setKv } from '../api/db.mjs';
import { bondingCurveAddress } from '../lib/pump.mjs';

const log = (...a) => console.log(new Date().toISOString(), ...a);
const P = plan();
const WALLET = process.env.WATCH_WALLET || P?.wallet;
if (!WALLET) { console.error('no wallet to watch: stage the plan with --wallet or set WATCH_WALLET'); process.exit(1); }
const POLL = Number(process.env.WATCH_POLL_MS || 4000);
const LIMIT = Number(process.env.WATCH_LIMIT || 20);
const DRY = process.env.DRY === '1';
const SINCE = Number(process.env.WATCH_SINCE_TS || (P?.stagedAt ? Math.floor(P.stagedAt / 1000) - 600 : Math.floor(Date.now() / 1000) - 600));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
log(`watching ${WALLET} for a pump.fun create every ${POLL} ms, creates since ${new Date(SINCE * 1000).toISOString()}${DRY ? ' (DRY: nothing is changed)' : ''}; plan: ${P ? `${P.name} (${P.symbol}) image ${P.image ?? 'none'}` : 'NONE (chain metadata will be used)'}`);

const seen = new Set();
let polls = 0;
for (;;) {
  try {
    const sigs = await sol.conn.getSignaturesForAddress(new PublicKey(WALLET), { limit: LIMIT }, 'confirmed');
    for (const s of sigs.reverse()) { // oldest first: the first create wins
      if (seen.has(s.signature) || s.err) continue;
      if ((s.blockTime ?? 0) < SINCE) { seen.add(s.signature); continue; }
      const r = await sol.conn._rpcRequest('getTransaction', [s.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]);
      const tx = r?.result;
      if (!tx) { log(`${s.signature.slice(0, 12)}… not readable yet, retrying next poll`); continue; }
      const c = pumpCreateBy(tx, WALLET);
      if (!c) { seen.add(s.signature); continue; }
      const curve = await sol.conn.getAccountInfo(bondingCurveAddress(new PublicKey(c.mint)), 'confirmed');
      if (!curve) { log(`${c.sig.slice(0, 12)}… creates ${c.mint} but its curve is not readable yet, retrying`); continue; }
      log(`✅ ${WALLET} created the pump.fun coin ${c.mint} (${c.via}, ${c.sig})`);
      if (DRY) { log('DRY: would list it as the official coin and open launching'); process.exit(0); }
      const out = await goLive(c.mint, { log });
      setKv('officialWatch', { wallet: WALLET, found: c, at: Date.now() });
      log(`done: ${out.name} (${out.symbol}) is the official coin and launching is OPEN. Watcher exiting.`);
      process.exit(0);
    }
    polls++;
    if (polls % 150 === 1) { setKv('officialWatch', { wallet: WALLET, polls, lastPollAt: Date.now() }); if (polls > 1) log(`still watching (${polls} polls)`); }
  } catch (e) {
    log(`poll failed: ${String(e.message).slice(0, 140)}`);
  }
  await sleep(POLL);
}
