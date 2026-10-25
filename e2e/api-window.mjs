/**
 * The SITE's own API end to end for a window launch, against the local validator: the server and the graduator run as
 * the real processes, a creator keypair signs where the wallet would. node e2e/api-window.mjs
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';

const ROOT = new URL('..', import.meta.url).pathname;
const DATA = path.join(ROOT, 'data', 'e2e-api');
fs.rmSync(DATA, { recursive: true, force: true }); fs.mkdirSync(DATA, { recursive: true });
const RPC = 'http://127.0.0.1:8981', PORT = 5482;
const conn = new Connection(RPC, 'confirmed');
const platform = Keypair.generate();
fs.writeFileSync(path.join(DATA, 'platform.json'), JSON.stringify([...platform.secretKey]));
const creator = Keypair.generate(), buyer = Keypair.generate();
const fund = async (pk, n = 100) => conn.confirmTransaction(await conn.requestAirdrop(pk, n * LAMPORTS_PER_SOL), 'confirmed');
await fund(platform.publicKey, 100); await fund(creator.publicKey, 20); await fund(buyer.publicKey, 60);
await conn.confirmTransaction(await conn.requestAirdrop(new PublicKey('FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM'), 2 * LAMPORTS_PER_SOL), 'confirmed');
let pins = 0;
const stub = http.createServer((req, res) => { req.resume(); req.on('end', () => { pins++; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: { cid: `bafkrei${bs58.encode(Keypair.generate().publicKey.toBytes()).toLowerCase().slice(0, 52)}` } })); }); }).listen(5399);
// the `…pump` pool, with a 1-character suffix so the test can grind its own keys: 2 keys, 1 held for the graduation
const SUFFIX = 'p';
const grind = () => { for (;;) { const k = Keypair.generate(); if (k.publicKey.toBase58().endsWith(SUFFIX)) return k; } };
fs.mkdirSync(path.join(DATA, 'vanity-incoming'), { recursive: true });
for (const k of [grind(), grind(), grind()]) fs.writeFileSync(path.join(DATA, 'vanity-incoming', `${k.publicKey.toBase58()}.json`), JSON.stringify([...k.secretKey]));
const env = { ...process.env, SOLANA_RPC: RPC, DATA_DIR: DATA, DB_PATH: path.join(DATA, 'oldpump.db'), PORT: String(PORT), PINATA_JWT: 'e2e', PINATA_UPLOADS: 'http://127.0.0.1:5399', WINDOW_MIN_MINUTES: '1', TICK_MS: '3000', LAUNCH_PRIORITY_MICROLAMPORTS: '1000', TRADE_PRIORITY_MICROLAMPORTS: '1000',
  VANITY_SUFFIX: SUFFIX, VANITY_REQUIRED: '1', VANITY_GRADUATION_RESERVE: '1', PUBLIC_URL: `http://127.0.0.1:${PORT}`, LAUNCH_OPEN: '1', KEYS_PER_IP_HOUR: '10', WINDOW_FIRST_BUY: '1', WINDOW_MODE: process.env.FILL ? 'fill' : 'deadline' };
const FILL = Boolean(process.env.FILL);
const procs = [];
const run = (name, args) => { const p = spawn('node', args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] }); p.stdout.on('data', (d) => process.stdout.write(`   [${name}] ${d}`)); p.stderr.on('data', (d) => process.stdout.write(`   [${name}!] ${d}`)); procs.push(p); return p; };
run('grad', ['api/graduator.mjs']);
await new Promise((r) => setTimeout(r, 2500));
run('api', ['api/server.mjs']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (p, body) => { const r = await fetch(`http://127.0.0.1:${PORT}${p}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}); const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status); return j; };
let checks = 0, fails = 0;
const ok = (c, m) => { if (c) { checks++; console.log('PASS', m); } else { fails++; console.log('FAIL', m); } };
const sign = (b64, kp) => { const tx = VersionedTransaction.deserialize(Buffer.from(b64, 'base64')); tx.sign([kp]); return Buffer.from(tx.serialize()).toString('base64'); };
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
try {
  let cfg = null;
  // the graduator makes 4 configs and the lookup table first; a table is usable one slot after its last extension
  for (let i = 0; i < 90 && !(cfg?.window?.ready && cfg.window.sizes.length >= 4); i++) { await sleep(2000); cfg = await api('/api/config').catch(() => null); }
  await sleep(5000);
  ok(cfg?.window?.ready, `window launches ready: sizes ${cfg?.window?.sizes?.map((s) => `${s.sizeSol}${s.available ? '' : '(x)'}`).join('/')}`);
  const size = cfg.window.sizes[0].sizeSol;
  await api('/api/launch/prepare', { wallet: creator.publicKey.toBase58(), name: 'Win', symbol: 'WIN', imageData: `data:image/png;base64,${PNG}`, window: { openSecs: 3, windowMinutes: 1, sizeSol: size } }).then(() => ok(false, 'open delay below the minimum refused'), (e) => ok(/open 5 seconds/.test(e.message), `open delay below the minimum refused (${e.message})`));
  await api('/api/launch/prepare', { wallet: creator.publicKey.toBase58(), name: 'Window Coin', symbol: 'WIN', imageData: `data:image/png;base64,${PNG}`, devBuySol: size, window: { openSecs: 15, windowMinutes: 2, sizeSol: size } }).then(() => ok(false, 'a first buy over a fifth of the curve refused'), (e) => ok(/at most a fifth/.test(e.message), `a first buy over a fifth of the curve refused (${e.message})`));
  const p = await api('/api/launch/prepare', { wallet: creator.publicKey.toBase58(), name: 'Window Coin', symbol: 'WIN', description: 'api e2e', imageData: `data:image/png;base64,${PNG}`, twitter: 'https://x.com/pumpdotfun', holderRewards: true, devBuySol: 0.25, window: { openSecs: 15, windowMinutes: 2, sizeSol: size, maxWalletPct: FILL ? 0 : 50, holderRewards: true } });
  ok(p.kind === 'window' && p.transaction, `prepared a window launch ${p.mint} (${pins} pins)`);
  ok(p.mint.endsWith(SUFFIX), `the window token's address comes from the pool (ends in ${SUFFIX})`);
  // a second window nobody will buy into: it must end cleanly, without the platform fronting anything
  const pe = await api('/api/launch/prepare', { wallet: buyer.publicKey.toBase58(), name: 'Empty Window', symbol: 'EMPTY', imageData: `data:image/png;base64,${PNG}`, window: { openSecs: 15, windowMinutes: 2, sizeSol: size } });
  const se = await api('/api/launch/submit', { mint: pe.mint, transaction: sign(pe.transaction, buyer) });
  ok(se.status === 'live', 'a second window launch (nobody will buy) is live');
  await api('/api/launch/prepare', { wallet: buyer.publicKey.toBase58(), name: 'Other', symbol: 'OTH', imageData: `data:image/png;base64,${PNG}`, window: { openSecs: 15, windowMinutes: 2, sizeSol: size } }).then(() => ok(false, 'a launch with only the graduation reserve left is refused'), (e) => ok(/No pump address/.test(e.message), `a launch with only the graduation reserve left is refused (${e.message})`));
  ok((await api('/api/config')).vanity.available === 0 && (await api('/api/config')).vanity.fresh === 1, 'config shows 1 fresh key, 0 available (held for the graduation)');
  const s = await api('/api/launch/submit', { mint: p.mint, transaction: sign(p.transaction, creator) });
  ok(s.status === 'live', `launch live (${s.sig?.slice(0, 12)})`);
  { const held = await conn.getTokenAccountsByOwner(creator.publicKey, { mint: new PublicKey(p.mint) }); ok(held.value.length > 0, 'the creator holds their first buy right after the launch landed'); }
  { // the token's metadata is hosted by the site, shaped like pump.fun's own, and its image is a real image served by the site
    const { getTokenMetadata, TOKEN_2022_PROGRAM_ID } = await import('@solana/spl-token');
    const m = await getTokenMetadata(conn, new PublicKey(p.mint), 'confirmed', TOKEN_2022_PROGRAM_ID);
    ok(m.name === 'Window Coin' && m.symbol === 'WIN' && m.uri.startsWith(`http://127.0.0.1:${PORT}/meta/`) && m.uri.length < 80, `on-chain metadata: ${m.name} (${m.symbol}) uri ${m.uri}`);
    const r = await fetch(m.uri); const j = await r.json();
    ok(r.status === 200 && j.name === 'Window Coin' && j.symbol === 'WIN' && j.createdOn === 'pump.fun' && j.twitter === 'https://x.com/pumpdotfun' && j.description === 'api e2e' && /\/img\/[0-9a-f]{32}\.png$/.test(j.image), `metadata JSON served by the site in pump.fun's shape: ${JSON.stringify(j).slice(0, 160)}`);
    const ir = await fetch(j.image); const bytes = new Uint8Array(await ir.arrayBuffer());
    ok(ir.status === 200 && ir.headers.get('content-type') === 'image/png' && bytes[0] === 0x89 && bytes[1] === 0x50, `the image URL serves the original PNG (${bytes.length} bytes, ${ir.headers.get('content-type')})`);
  }
  let c = await api(`/api/coins/${p.mint}`);
  ok(c.kind === 'window' && c.window?.phase === 'opening', `coin page: phase ${c.window?.phase} (chain clock ${c.window?.chainNow}, opens ${c.window?.opensAt}), target ${c.window?.targetSol} SOL, cap ${c.capSol?.toFixed(2)} SOL`);
  await api('/api/trade/prepare', { wallet: buyer.publicKey.toBase58(), mint: p.mint, side: 'buy', amount: 0.5 }).then(() => ok(false, 'buy before opening refused'), (e) => ok(/Buying opens in/.test(e.message), `buy before opening refused by the API (${e.message})`));
  await sleep(17_000);
  if (FILL) {
    // pump.eco's way: the curve fills (the buyer buys it out), nothing is fronted, the coin migrates at the cap the creator picked
    ok(c.window.closesAt == null && cfg.window.limits.mode === 'fill', 'fill mode: no deadline on the launch');
    const big = await api('/api/trade/prepare', { wallet: buyer.publicKey.toBase58(), mint: p.mint, side: 'buy', amount: size + 1, slippageBps: 500 });
    const bs = await api('/api/trade/submit', { transaction: sign(big.transaction, buyer) });
    ok(bs.sig, `buyer filled the ${size} SOL curve through the site (partial fill)`);
    for (let i = 0; i < 60 && !(c.window?.pumpMint); i++) { await sleep(4000); c = await api(`/api/coins/${p.mint}`).catch(() => c); }
    ok(c.window?.pumpMint && c.window.fronted == null, `graduated on fill: pump.fun coin ${c.window?.pumpMint}, nothing fronted`);
    for (let i = 0; i < 20 && c.window.status !== 'done'; i++) { await sleep(3000); c = await api(`/api/coins/${p.mint}`); }
    ok(c.window.status === 'done', `graduation ${c.window.status}`);
    const platBal = await conn.getBalance(platform.publicKey);
    ok(platBal > 99.5 * LAMPORTS_PER_SOL, `the hot wallet only paid fees (holds ${(platBal / 1e9).toFixed(3)} of 100 SOL)`);
    for (const pr of procs) pr.kill('SIGTERM'); stub.close(); console.log(`\n${checks} passed, ${fails} failed`); setTimeout(() => process.exit(fails ? 1 : 0), 1500); await new Promise(() => {});
  }
  const tb = await api('/api/trade/prepare', { wallet: buyer.publicKey.toBase58(), mint: p.mint, side: 'buy', amount: 0.5, slippageBps: 300 });
  const ts = await api('/api/trade/submit', { transaction: sign(tb.transaction, buyer) });
  ok(ts.sig && BigInt(ts.tokenUnits) > 0n, `buyer bought on the window curve through the site: ${ts.tokenUnits} units for ${Number(ts.lamports) / 1e9} SOL`);
  const tsell = await api('/api/trade/prepare', { wallet: buyer.publicKey.toBase58(), mint: p.mint, side: 'sell', pct: 25, slippageBps: 300 });
  const ss = await api('/api/trade/submit', { transaction: sign(tsell.transaction, buyer) });
  ok(ss.sig && BigInt(ss.lamports) > 0n, `buyer sold 25% back: ${Number(ss.lamports) / 1e9} SOL`);
  c = await api(`/api/coins/${p.mint}`);
  const good = c.window.phase === 'trading' && c.window.raisedSol > 0.3 && c.trades.length === 3 && c.holders.some((h) => h.label === 'bonding curve');
  ok(good, `coin page while trading: phase ${c.window.phase}, raised ${c.window.raisedSol?.toFixed(3)} SOL, ${c.trades.length} trades, holders labelled ${c.holders.some((h) => h.label === 'bonding curve')}`);
  if (!good) { console.log('   window:', JSON.stringify(c.window)); await sleep(6000); const c2 = await api(`/api/coins/${p.mint}`); console.log('   6s later raised', c2.window.raisedSol, 'phase', c2.window.phase); }
  { await api(`/api/coins/${p.mint}/chart`); await sleep(4000); const ch = await api(`/api/coins/${p.mint}/chart`); ok(ch.total >= 2 && ch.trades.some((t) => t.side === 'buy') && ch.trades.some((t) => t.side === 'sell') && ch.candles.length >= 1, `chart from the Meteora pool's own trades: ${ch.total} trades, ${ch.candles.length} candles`); }
  const board = await api('/api/coins');
  ok(board.coins.length === 2 && board.king?.mint === p.mint, 'board lists both windows, the traded one as king');
  console.log('   waiting for the window to close and the graduator to run');
  for (let i = 0; i < 60 && !(c.window?.pumpMint); i++) { await sleep(4000); c = await api(`/api/coins/${p.mint}`).catch(() => c); }
  ok(c.window?.pumpMint, `graduated: pump.fun coin ${c.window?.pumpMint} (status ${c.window?.status}, fronted ${c.window?.fronted} SOL, raise ${c.window?.raise} SOL)`);
  ok(c.window?.pumpMint?.endsWith(SUFFIX), `the pump.fun coin's address comes from the pool too (ends in ${SUFFIX})`);
  { // the pump.fun coin carries the same metadata and the holder-rewards choice
    const { getTokenMetadata, TOKEN_2022_PROGRAM_ID } = await import('@solana/spl-token');
    const m = await getTokenMetadata(conn, new PublicKey(c.window.pumpMint), 'confirmed', TOKEN_2022_PROGRAM_ID);
    const m0 = await getTokenMetadata(conn, new PublicKey(p.mint), 'confirmed', TOKEN_2022_PROGRAM_ID);
    ok(m.name === m0.name && m.symbol === m0.symbol && m.uri === m0.uri, `the pump.fun coin has the window token's name, ticker and metadata URI`);
    const PUMP = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
    const info = await conn.getAccountInfo(PublicKey.findProgramAddressSync([Buffer.from('bonding-curve'), new PublicKey(c.window.pumpMint).toBuffer()], PUMP)[0], 'confirmed');
    const hr = PublicKey.findProgramAddressSync([Buffer.from('holder-rewards'), new PublicKey(c.window.pumpMint).toBuffer()], PUMP)[0];
    ok(new PublicKey(info.data.subarray(49, 81)).equals(hr) && c.holderRewards === true, 'holder rewards chosen at launch: the pump.fun coin pays its creator fees to holders');
  }
  if (!c.window?.pumpMint) throw new Error('no pump.fun coin');
  const pumpBal = await conn.getTokenAccountsByOwner(buyer.publicKey, { mint: new PublicKey(c.window.pumpMint) }).catch(() => ({ value: [] }));
  ok(pumpBal.value.length > 0, 'the buyer holds the pump.fun coin');
  for (let i = 0; i < 20 && c.window.status !== 'done'; i++) { await sleep(3000); c = await api(`/api/coins/${p.mint}`); }
  ok(c.window.status === 'done', `graduation ${c.window.status}`);
  let ce = await api(`/api/coins/${pe.mint}`);
  for (let i = 0; i < 20 && ce.window.status !== 'done'; i++) { await sleep(3000); ce = await api(`/api/coins/${pe.mint}`); }
  ok(ce.window.status === 'done' && ce.window.empty && ce.window.fronted == null, `the empty window ended cleanly: ${ce.window.status}, no pump.fun coin, nothing fronted`);
  const tb2 = await api('/api/trade/prepare', { wallet: buyer.publicKey.toBase58(), mint: p.mint, side: 'buy', amount: 0.2, slippageBps: 300 });
  const ts2 = await api('/api/trade/submit', { transaction: sign(tb2.transaction, buyer) });
  ok(ts2.sig && BigInt(ts2.tokenUnits) > 0n, `after graduation the same coin page trades the pump.fun coin: bought ${ts2.tokenUnits} units`);
  c = await api(`/api/coins/${p.mint}`);
  ok(c.capSol > 0 && c.complete && c.window.venue, `graduated coin priced from pump.fun: cap ${c.capSol?.toFixed(2)} SOL (${c.window.venue})`);
} catch (e) { fails++; console.log('FAIL (threw)', e.message); }
for (const p of procs) p.kill('SIGTERM');
stub.close();
console.log(`\n${checks} passed, ${fails} failed`);
setTimeout(() => process.exit(fails ? 1 : 0), 1500);
