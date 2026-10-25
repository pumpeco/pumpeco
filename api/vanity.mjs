/**
 * ONE pool of `…pump` mint keys for every address this site creates: the window token's mint at launch and the pump.fun
 * coin's mint at graduation (hk/lib/vanity.mjs on the graduator's ledger, with its graduation reserve). Keys arrive in
 * data/vanity-incoming from tools/grind (`npm run grind`, deploy/keep-vanity.sh) and are imported every minute.
 *
 * ⛔ A key is ISSUED ONCE. Once a mint address has left this server (in a transaction the launcher may never sign), anyone
 * who saw it can pre-create accounts at it and make the launch fail for that address forever. The same launcher retrying
 * within 15 minutes gets the same key back, so retries cannot drain the pool.
 */
import { env } from './env.mjs';
import * as hk from '../hk/lib/vanity.mjs';
import { ledger, DATA_DIR } from './window.mjs';

export const SUFFIX = hk.SUFFIX;
/** Every CA ends in `pump` (operator, 24 Oct 2026): an empty pool refuses the launch. VANITY_REQUIRED=0 is for tests only. */
export const REQUIRED = env('VANITY_REQUIRED', '1') !== '0';
export const RESERVATION_MS = hk.RESERVATION_SECS * 1000;
export const GRADUATION_RESERVE = hk.GRADUATION_RESERVE;
hk.initVanity(ledger);
export const INCOMING = hk.incomingDir(DATA_DIR);

/** A fresh key for `launcher` (the same one back within the reservation); null when only the graduation reserve is left. */
export const issueKey = (launcher, ip = null) => hk.issueForLaunch(ledger, launcher, ip);
export const markLaunched = (pubkey) => hk.markLaunched(ledger, pubkey);
export const freshCount = () => hk.freshCount(ledger);
/** Keys a launch may take right now (the rest is held for graduations). */
export const available = () => Math.max(0, freshCount() - GRADUATION_RESERVE);
export const issuedToWalletSince = (launcher, secs) => ledger.prepare("SELECT COUNT(*) n FROM vanity WHERE holder = ? AND state IN ('issued', 'launched') AND issued_at > ?").get(launcher, Math.floor(Date.now() / 1000) - secs).n;
export const issuedToIpSince = (ip, secs) => hk.issuedToIpSince(ledger, ip, Math.floor(Date.now() / 1000) - secs);
export const hasReservation = (launcher) => Boolean(ledger.prepare("SELECT 1 FROM vanity WHERE state = 'issued' AND holder = ? AND issued_at > ?").get(launcher, Math.floor(Date.now() / 1000) - hk.RESERVATION_SECS));
export const importIncoming = () => hk.importIncoming(ledger, INCOMING);
