#!/usr/bin/env node
/**
 * Hides a coin from this site (a test launch, say): off the board, the ticker, the king and the ticker's trades. Its page
 * still answers a direct link so anyone who bought while it was listed can still sell here; the token itself stays on chain.
 *   node scripts/hide-coin.mjs <mint>          hide      |     node scripts/hide-coin.mjs <mint> --show     list it again
 */
import { one, run, now } from '../api/db.mjs';
const [mint, flag] = process.argv.slice(2);
if (!mint) { console.log('usage: node scripts/hide-coin.mjs <mint> [--show]'); process.exit(1); }
const row = one('SELECT mint, symbol, status FROM launches WHERE mint = ?', mint);
if (!row) { console.error(`${mint}: not on this site`); process.exit(1); }
const to = flag === '--show' ? 'live' : 'hidden';
if (!['live', 'hidden'].includes(row.status)) { console.error(`${mint} (${row.symbol}) is '${row.status}', not live: nothing to hide`); process.exit(1); }
run('UPDATE launches SET status = ?, updated_at = ? WHERE mint = ?', to, now(), mint);
console.log(`${mint} (${row.symbol}): ${row.status} → ${to}`);
process.exit(0);
