/**
 * The graduation service for window launches (pump.eco's, hk/lib/graduate.mjs), as its own process: makes the Meteora configs
 * and the lookup table once (the hot wallet pays), then every few seconds takes every launch whose curve filled or whose
 * window closed through graduation to a pump.fun coin in every holder's wallet. One instance per ledger (a lock enforces it).
 *   node api/graduator.mjs      (env: SOLANA_RPC, DATA_DIR, TREASURY, HOOK_PROGRAM, TICK_MS)
 */
import { randomUUID } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import { env, num } from './env.mjs';
process.env.FLAT_ONLY = '1';
const { ledger, platformKeypair, HOOK_PROGRAM, DATA_DIR } = await import('./window.mjs');
const { takeLock, releaseLock } = await import('../hk/lib/db.mjs');
const { Graduator } = await import('../hk/lib/graduate.mjs');
const { ensureConfigs, configEntries } = await import('../hk/lib/configs.mjs');
const { connect } = await import('../hk/lib/env.mjs');

const log = (...a) => console.log(new Date().toISOString(), ...a);
process.on('uncaughtException', (e) => console.error(new Date().toISOString(), 'graduator uncaught:', String(e?.stack ?? e).replace(/api-key=[^&\s"']+/g, 'api-key=…')));
process.on('unhandledRejection', (e) => console.error(new Date().toISOString(), 'graduator unhandled:', String(e?.stack ?? e).replace(/api-key=[^&\s"']+/g, 'api-key=…')));

const me = randomUUID();
if (!takeLock(ledger, me)) { console.error('another graduator holds the ledger lock; exiting'); process.exit(1); }
const platform = platformKeypair();
const treasury = env('TREASURY', '') ? new PublicKey(env('TREASURY')) : null;
if (treasury && treasury.equals(platform.publicKey)) { console.error('TREASURY must not be the hot wallet'); process.exit(1); }
const conn = connect(env('SOLANA_RPC', 'http://127.0.0.1:8981'), num('RPC_RPS', 0));
log(`graduator: hot wallet ${platform.publicKey.toBase58()}, hook ${HOOK_PROGRAM.toBase58()}, treasury ${treasury?.toBase58() ?? 'none (no sweep)'}, data ${DATA_DIR}`);

const refreshConfigs = async (g) => {
  const st = await ensureConfigs({ conn, platform, hookProgram: HOOK_PROGRAM, dataDir: DATA_DIR, log });
  if (g) { g.setConfigs(configEntries(st)); if (st.changed) { g.lut = null; await g.ensureLut(); } }
  return st;
};
let st = null;
while (!st) {
  try { st = await refreshConfigs(); } catch (e) {
    const bal = await conn.getBalance(platform.publicKey, 'confirmed').catch(() => 0);
    log(`configs not ready (${e.message.slice(0, 160)}); hot wallet holds ${bal / 1e9} SOL. Fund it:\n\n  ${platform.publicKey.toBase58()}\n`);
    await new Promise((r) => setTimeout(r, 60_000));
  }
}
const g = new Graduator({ conn, db: ledger, platform, treasury: treasury ?? platform.publicKey, hookProgram: HOOK_PROGRAM, configs: {}, dataDir: DATA_DIR, burnWallet: null, log });
await refreshConfigs(g);
await g.ensureLut();
log(`configs: ${Object.keys(st.flatConfigs).join('/')} SOL (start cap ${st.pump.capAt(0).toFixed(1)} SOL)`);
const TICK_MS = num('TICK_MS', 8_000), CONFIGS_MS = num('CONFIGS_MS', 600_000), SWEEP_MS = num('SWEEP_MS', 900_000);
let lastConfigs = Date.now(), lastSweep = Date.now(), stopping = false;
process.on('SIGTERM', () => { stopping = true; releaseLock(ledger, me); });
process.on('SIGINT', () => { stopping = true; releaseLock(ledger, me); });
while (!stopping) {
  if (!takeLock(ledger, me)) { console.error('lost the ledger lock; exiting'); process.exit(1); }
  try {
    if (Date.now() - lastConfigs > CONFIGS_MS) { await refreshConfigs(g); lastConfigs = Date.now(); }
    const finished = await g.tick();
    if (treasury && (finished > 0 || Date.now() - lastSweep > SWEEP_MS)) { await g.sweep(); lastSweep = Date.now(); }
  } catch (e) { log(`pass failed: ${e.message}`); }
  await new Promise((r) => setTimeout(r, TICK_MS));
}
releaseLock(ledger, me);
log('graduator stopped');
