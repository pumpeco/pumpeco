/**
 * The go-live watcher end to end on a local validator (port 8981, websocket 8982): stage the plan, start the REAL watcher
 * process, create a decoy coin (other ticker: must be ignored), then the official coin; measure create → launching open.
 * Usage: node e2e/official-watch.mjs
 */
import { spawn } from 'node:child_process';
import { Keypair, LAMPORTS_PER_SOL, VersionedTransaction } from '@solana/web3.js';
const PID = process.pid;
const ENV = { SOLANA_RPC: 'http://127.0.0.1:8981', DB_PATH: `/tmp/oldpump-e2e-watch-${PID}.db`, DATA_DIR: `/tmp/oldpump-e2e-watch-data-${PID}`, VANITY_REQUIRED: '0', PUBLIC_URL: 'http://127.0.0.1:5480', PINATA_JWT: '', LAUNCH_PRIORITY_MICROLAMPORTS: '1000', WATCH_POLL_MS: '15000' };
Object.assign(process.env, ENV);
const sol = await import('../api/sol.mjs');
const launch = await import('../api/launch.mjs');
const official = await import('../api/official.mjs');
const { one, getKv, setKv } = await import('../api/db.mjs');
const results = [];
const check = (name, ok, detail = '') => { results.push({ ok: Boolean(ok) }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`); };
const op = Keypair.generate();
await sol.conn.confirmTransaction(await sol.conn.requestAirdrop(op.publicKey, 5 * LAMPORTS_PER_SOL), 'confirmed');
const img = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const fs = await import('node:fs');
official.stagePlan({ name: 'Pump Family', symbol: 'PF', imageBytes: fs.readFileSync(new URL('../web/public/icon-512.png', import.meta.url)), wallet: op.publicKey.toBase58(), twitter: 'https://x.com/thepumpfamily', website: 'https://pump.family' });
setKv('launchOpen', false);
// the operator's creates: launched through the site's code with the gate opened for this wallet only (a pump.fun create signed by it)
setKv('launchAllow', [op.publicKey.toBase58()]);
const create = async (symbol) => { const p = await launch.prepare({ wallet: op.publicKey.toBase58(), name: symbol === 'PF' ? 'Pump Family' : 'Decoy', symbol, imageData: img }); const tx = VersionedTransaction.deserialize(Buffer.from(p.transaction, 'base64')); tx.sign([op]); await launch.submit({ mint: p.mint, transaction: Buffer.from(tx.serialize()).toString('base64') }); return p.mint; };

const w = spawn('node', ['scripts/watch-official.mjs'], { env: { ...process.env, ...ENV }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
w.stdout.on('data', (d) => { out += d; process.stdout.write(`   [watcher] ${d}`); });
w.stderr.on('data', (d) => { if (!/Experimental|trace-warnings|bigint/.test(String(d))) process.stdout.write(`   [watcher!] ${d}`); });
const wait = async (re, ms) => { const t = Date.now(); while (Date.now() - t < ms) { if (re.test(out)) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };
check('watcher started with the websocket', await wait(/subscription on the wallet is open/, 15000));
const decoy = await create('DECOY');
check('a decoy coin (other ticker) is ignored', await wait(/ticker DECOY, not PF: ignored/, 20000) && !getKv('launchOpen', false), decoy);
const t0 = Date.now();
const mint = await create('PF');
const tSubmit = Date.now();
const live = await wait(/launching is OPEN/, 30000);
const tLive = Date.now();
check('the PF coin went live by itself', live, `${tLive - tSubmit} ms after the create confirmed (${tLive - t0} ms after it was sent)`);
const row = one('SELECT * FROM launches WHERE mint = ?', mint);
check('listed as the official coin with the staged name, ticker and image', row?.origin === 'official' && row.name === 'Pump Family' && row.symbol === 'PF' && Boolean(row.image));
check('launching is OPEN for everyone', getKv('launchOpen', false) === true);
const coins = await import('../api/coins.mjs');
check('the board and config show it', coins.official()?.mint === mint && (await coins.list({})).coins[0]?.mint === mint);
await new Promise((r) => setTimeout(r, 500));
check('the watcher exited', w.exitCode === 0, `exit ${w.exitCode}`);
w.kill();
const fails = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
process.exit(fails ? 1 : 0);
