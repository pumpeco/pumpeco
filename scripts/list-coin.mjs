/**
 * Lists an EXISTING pump.fun coin on the board (origin 'external'): reads its name, ticker and metadata from the chain, keeps a
 * copy of its image, and inserts a live row. Run on the box: node scripts/list-coin.mjs <mint> [<mint> ...]
 */
import '../api/env.mjs';
import { PublicKey } from '@solana/web3.js';
import { getTokenMetadata, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import * as sol from '../api/sol.mjs';
import * as images from '../api/images.mjs';
import { one, run, now } from '../api/db.mjs';
import { coinState } from '../lib/pump.mjs';

for (const mint of process.argv.slice(2)) {
  const m = sol.requireMint(mint);
  const st = await coinState(sol.conn, m);
  if (!st) { console.log(`${mint}: not a pump.fun coin`); continue; }
  const md = await getTokenMetadata(sol.conn, m, 'confirmed', TOKEN_2022_PROGRAM_ID);
  let json = {};
  try { json = await (await fetch(md.uri, { signal: AbortSignal.timeout(10_000), headers: { 'user-agent': 'Mozilla/5.0' } })).json(); } catch (e) { console.log(`  metadata JSON not readable (${e.message.slice(0, 60)}): listing without description`); }
  const image = (await images.cacheImage(json.image)) ?? null;
  const socials = { twitter: json.twitter || null, telegram: json.telegram || null, website: json.website || null };
  if (one('SELECT 1 FROM launches WHERE mint = ?', mint)) { run("UPDATE launches SET name = ?, symbol = ?, description = ?, image = COALESCE(?, image), socials_json = ?, status = 'live', updated_at = ? WHERE mint = ?", md.name, md.symbol, json.description || '', image, JSON.stringify(socials), now(), mint); console.log(`${mint}: updated`); continue; }
  run(`INSERT INTO launches (mint, launcher, name, symbol, description, image, metadata_uri, socials_json, dev_buy_lamports, status, kind, origin, created_at, live_at, bumped_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '0', 'live', 'pump', 'external', ?, ?, ?, ?)`, mint, st.creator, md.name, md.symbol, json.description || '', image, md.uri, JSON.stringify(socials), now(), now(), now(), now());
  console.log(`${mint}: listed ${md.name} (${md.symbol}) ${st.complete ? 'graduated' : 'on curve'}${st.isSol ? ` cap ${st.capSol?.toFixed(1)} SOL` : ' (custom pair)'} image ${image ?? 'none'}`);
}
process.exit(0);
