/**
 * The OFFICIAL coin: the operator's own pump.fun coin, listed first on the board and tagged, launched on pump.fun itself.
 *
 *   stagePlan()   before the launch: name, ticker, image (stored here, so nothing is fetched at go-live), links, the wallet
 *                 that will create it (scripts/stage-official.mjs). Kept in kv `officialPlan`.
 *   goLive(mint)  lists the coin as official (plan first, chain second) and OPENS launching for everyone. Idempotent.
 *   pumpCreateBy  recognises a pump.fun create / create_v2 SIGNED by a wallet in a jsonParsed transaction (the watcher,
 *                 scripts/watch-official.mjs). ⛔ An address index lists mere mentions too: the wallet must be a signer.
 */
import { PublicKey } from '@solana/web3.js';
import { getTokenMetadata, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import bs58 from 'bs58';
import * as sol from './sol.mjs';
import * as images from './images.mjs';
import * as coins from './coins.mjs';
import { one, run, now, setKv, getKv } from './db.mjs';
import { coinState, PUMP, pumpIdl } from '../lib/pump.mjs';

export const plan = () => getKv('officialPlan', null);

/** Stores the plan (and the image under its hash). `imageBytes` optional: without it the chain's image is used at go-live. */
export function stagePlan({ name, symbol, imageBytes = null, wallet = null, twitter = null, website = null, description = null }) {
  const image = imageBytes ? images.storeImage(imageBytes) : null;
  const p = { name: String(name), symbol: String(symbol), image, wallet, socials: { twitter, website, telegram: null }, description, stagedAt: now() };
  setKv('officialPlan', p);
  return p;
}

/** Lists `mint` as the official coin and opens launching. Fast by design: the plan carries what the site shows; the chain's
 *  metadata JSON is best effort (6 s) and only fills what the plan left out. */
export async function goLive(mint, { log = console.log, plan: p = plan() } = {}) {
  const m = sol.requireMint(mint);
  mint = m.toBase58();
  const st = await coinState(sol.conn, m);
  if (!st) throw new Error(`${mint} is not a pump.fun coin`);
  let md = null;
  try { md = await getTokenMetadata(sol.conn, m, 'confirmed', TOKEN_2022_PROGRAM_ID); } catch {}
  let json = {};
  if (md?.uri) try { json = await (await fetch(md.uri, { signal: AbortSignal.timeout(6000), headers: { 'user-agent': 'Mozilla/5.0' } })).json(); } catch (e) { log(`metadata JSON not readable yet (${String(e.message).slice(0, 60)}): the plan fills in`); }
  const name = p?.name || md?.name || json.name || mint.slice(0, 6);
  const symbol = p?.symbol || md?.symbol || json.symbol || '';
  const image = p?.image || (await images.cacheImage(json.image).catch(() => null)) || null;
  const socials = { twitter: p?.socials?.twitter || json.twitter || null, website: p?.socials?.website || json.website || null, telegram: null };
  const description = p?.description || json.description || '';
  if (p && md && (md.name !== p.name || md.symbol !== p.symbol)) log(`⚠ on chain the coin is "${md.name}" (${md.symbol}); the site shows the staged "${p.name}" (${p.symbol})`);
  if (one('SELECT 1 FROM launches WHERE mint = ?', mint)) {
    run("UPDATE launches SET name = ?, symbol = ?, description = ?, image = COALESCE(?, image), socials_json = ?, status = 'live', origin = 'official', bumped_at = ?, updated_at = ? WHERE mint = ?",
      name, symbol, description, image, JSON.stringify(socials), now(), now(), mint);
  } else {
    run(`INSERT INTO launches (mint, launcher, name, symbol, description, image, metadata_uri, socials_json, dev_buy_lamports, status, kind, origin, created_at, live_at, bumped_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, '0', 'live', 'pump', 'official', ?, ?, ?, ?)`, mint, st.creator, name, symbol, description, image, md?.uri ?? null, JSON.stringify(socials), now(), now(), now(), now());
  }
  run("UPDATE launches SET origin = 'external' WHERE origin = 'official' AND mint <> ?", mint);
  setKv('launchOpen', true);
  setKv('officialLive', { mint, at: now() });
  coins.forget(mint);
  log(`OFFICIAL coin set to ${mint} (${name}, ${symbol}, image ${image ?? 'from chain later'}); launching is OPEN.`);
  return { mint, name, symbol, image };
}

const CREATE = Object.fromEntries(pumpIdl.instructions.filter((i) => i.name === 'create' || i.name === 'create_v2').map((i) => [Buffer.from(i.discriminator).toString('hex'), i.name]));
/** { mint, via, sig } when the jsonParsed transaction `tx` holds a pump.fun create signed by `wallet` (top level or inner), else null. */
export function pumpCreateBy(tx, wallet) {
  const keys = tx?.transaction?.message?.accountKeys ?? [];
  if (tx?.meta?.err || !keys.some((k) => (k.pubkey ?? k) === wallet && k.signer)) return null;
  const all = [...(tx.transaction.message.instructions ?? []), ...(tx.meta?.innerInstructions ?? []).flatMap((x) => x.instructions ?? [])];
  for (const ix of all) {
    if (ix.programId !== PUMP.toBase58() || typeof ix.data !== 'string' || !ix.accounts?.length) continue;
    let d; try { d = Buffer.from(bs58.decode(ix.data)); } catch { continue; }
    const via = CREATE[d.subarray(0, 8).toString('hex')];
    if (via) return { mint: ix.accounts[0], via, sig: tx.transaction.signatures[0] };
  }
  return null;
}
