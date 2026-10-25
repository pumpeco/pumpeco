/**
 * Creates the launch lookup table ONCE: the authority key (data/lut-authority.json, made here if missing) pays about
 * 0.003 SOL of rent, the table is filled with every launch-independent account, FROZEN (authority removed, so it can
 * never be closed or changed under a running site), and recorded in the database (kv launchLut).
 * Idempotent: with a complete table recorded it only prints it. `node scripts/make-lut.mjs`
 */
import '../api/env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { AddressLookupTableProgram, Keypair } from '@solana/web3.js';
import * as sol from '../api/sol.mjs';
import { getKv, setKv, DB_PATH } from '../api/db.mjs';
import { launchStaticAccounts, loadLookupTable } from '../lib/pump.mjs';

export function authorityKey() {
  const file = process.env.LUT_KEY_FILE || path.join(path.dirname(DB_PATH), 'lut-authority.json');
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify([...Keypair.generate().secretKey]), { mode: 0o600 });
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, 'utf8'))));
}

/** Returns the table address, or null when the authority is unfunded (after printing what to fund). */
export async function ensureLaunchLut({ authority = authorityKey(), log = console.log } = {}) {
  const wanted = await launchStaticAccounts(sol.conn);
  const existing = getKv('launchLut', null);
  if (existing) {
    const t = await loadLookupTable(sol.conn, existing).catch(() => null);
    const have = new Set((t?.state.addresses || []).map((k) => k.toBase58()));
    if (t && wanted.every((k) => have.has(k.toBase58()))) { log(`launch lookup table ${existing}: ${have.size} accounts, complete${t.state.authority ? '' : ', frozen'}`); return existing; }
    log(`recorded table ${existing} is missing accounts or gone; making a new one`);
  }
  const balance = await sol.conn.getBalance(authority.publicKey);
  log(`authority ${authority.publicKey.toBase58()} holds ${(balance / 1e9).toFixed(4)} SOL; the table needs about 0.004 SOL`);
  if (balance < 4_000_000) { log(`fund it first:\n\n  ${authority.publicKey.toBase58()}\n`); return null; }
  const slot = await sol.conn.getSlot('finalized');
  const [createIx, address] = AddressLookupTableProgram.createLookupTable({ authority: authority.publicKey, payer: authority.publicKey, recentSlot: slot });
  const extendIx = AddressLookupTableProgram.extendLookupTable({ lookupTable: address, authority: authority.publicKey, payer: authority.publicKey, addresses: wanted });
  let b = await sol.v0(authority.publicKey, [...sol.budget(80_000), createIx, extendIx], [authority]);
  let r = await sol.send(b, { skipPreflight: false });
  if (r.result !== 'ok') throw new Error(`create ${r.result} ${JSON.stringify(r.err)} (${r.sig})`);
  log(`created ${address.toBase58()} with ${wanted.length} accounts (${r.sig})`);
  // A table is usable from the slot after the one it was extended in; freezing it in the same slot is refused.
  const started = await sol.conn.getSlot();
  while ((await sol.conn.getSlot()) <= started + 1) await sol.sleep(400);
  b = await sol.v0(authority.publicKey, [...sol.budget(20_000), AddressLookupTableProgram.freezeLookupTable({ lookupTable: address, authority: authority.publicKey })], [authority]);
  r = await sol.send(b, { skipPreflight: false });
  log(r.result === 'ok' ? `frozen (${r.sig})` : `freeze ${r.result}: the table works but stays mutable; rerun later`);
  setKv('launchLut', address.toBase58());
  log(`recorded kv launchLut = ${address.toBase58()}. Restart the server.`);
  return address.toBase58();
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const a = await ensureLaunchLut();
  process.exit(a ? 0 : 2);
}
