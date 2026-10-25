/**
 * GO LIVE: lists the operator's own pump.fun coin as the OFFICIAL launch (first on the board, tagged, shown like a coin launched
 * here: its creator, image, cap and chart from the chain) and OPENS launching for everyone. Run on the box:
 *   node scripts/golive.mjs <CA>          (idempotent)   |   node scripts/golive.mjs --close   closes launching again
 */
import '../api/env.mjs';
import { execFileSync } from 'node:child_process';
import { one, run, now, setKv, getKv } from '../api/db.mjs';
const arg = process.argv[2];
if (arg === '--close') { setKv('launchOpen', false); console.log('launching CLOSED'); process.exit(0); }
if (arg === '--status') { console.log('launching', getKv('launchOpen', false) ? 'OPEN' : 'closed', '| official', one("SELECT mint, symbol FROM launches WHERE origin = 'official'") ?? 'none', '| allowed while closed:', (getKv('launchAllow', []) || []).join(' ') || 'nobody'); process.exit(0); }
// --allow <wallet> / --disallow <wallet>: one wallet may launch while the gate is closed (the operator's own test launch)
if (arg === '--allow' || arg === '--disallow') {
  const w = String(process.argv[3] || ''); if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(w)) { console.error('usage: --allow <wallet> | --disallow <wallet>'); process.exit(1); }
  const list = new Set(getKv('launchAllow', []) || []); if (arg === '--allow') list.add(w); else list.delete(w);
  setKv('launchAllow', [...list]); console.log('allowed while closed:', [...list].join(' ') || 'nobody'); process.exit(0);
}
if (!arg) { console.log('usage: node scripts/golive.mjs <CA> | --close | --status | --allow <wallet> | --disallow <wallet>'); process.exit(1); }
const mint = arg;
execFileSync('node', [new URL('./list-coin.mjs', import.meta.url).pathname, mint], { stdio: 'inherit' });
if (!one('SELECT 1 FROM launches WHERE mint = ?', mint)) { console.error('not listed: is it a pump.fun coin?'); process.exit(1); }
run("UPDATE launches SET origin = 'external' WHERE origin = 'official' AND mint <> ?", mint);
run("UPDATE launches SET origin = 'official', bumped_at = ?, updated_at = ? WHERE mint = ?", now(), now(), mint);
setKv('launchOpen', true);
console.log(`OFFICIAL coin set to ${mint}; launching is OPEN.`);
process.exit(0);
