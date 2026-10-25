/**
 * The SITE's API end to end for window launches WITH creator rules (api/creator-rules.mjs), against the local validator
 * (e2e/validator-window.sh on :8981): the real server + graduator, a creator keypair signs where the wallet would.
 *   node e2e/api-rules.mjs
 * Coin A: allowlist + anti-dump caps. The creator fills and seals the list through the list endpoints; an unlisted wallet
 * is refused before signing, a listed one trades within the caps and is refused over them.
 * Coin B: trading hours closed right now (plus a trade guard): buys are refused with the hook's reason.
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
const ROOT = new URL('..', import.meta.url).pathname;
const DATA = path.join(ROOT, 'data', 'e2e-rules');
fs.rmSync(DATA, { recursive: true, force: true }); fs.mkdirSync(DATA, { recursive: true });
const RPC = 'http://127.0.0.1:8981', PORT = 5483;
const conn = new Connection(RPC, 'confirmed');
const platform = Keypair.generate();
fs.writeFileSync(path.join(DATA, 'platform.json'), JSON.stringify([...platform.secretKey]));
const creator = Keypair.generate(), listed = Keypair.generate(), stranger = Keypair.generate();
const fund = async (pk, n = 100) => conn.confirmTransaction(await conn.requestAirdrop(pk, n * LAMPORTS_PER_SOL), 'confirmed');
await fund(platform.publicKey, 100); await fund(creator.publicKey, 20); await fund(listed.publicKey, 20); await fund(stranger.publicKey, 20);
await conn.confirmTransaction(await conn.requestAirdrop(new PublicKey('FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM'), 2 * LAMPORTS_PER_SOL), 'confirmed');
const stub = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: { cid: `bafkrei${bs58.encode(Keypair.generate().publicKey.toBytes()).toLowerCase().slice(0, 52)}` } })); }); }).listen(5398);
const SUFFIX = 'p';
const grind = () => { for (;;) { const k = Keypair.generate(); if (k.publicKey.toBase58().endsWith(SUFFIX)) return k; } };
fs.mkdirSync(path.join(DATA, 'vanity-incoming'), { recursive: true });
for (const k of [grind(), grind(), grind()]) fs.writeFileSync(path.join(DATA, 'vanity-incoming', `${k.publicKey.toBase58()}.json`), JSON.stringify([...k.secretKey]));
const env = { ...process.env, SOLANA_RPC: RPC, DATA_DIR: DATA, DB_PATH: path.join(DATA, 'oldpump.db'), PORT: String(PORT), PINATA_JWT: 'e2e', PINATA_UPLOADS: 'http://127.0.0.1:5398', WINDOW_MIN_MINUTES: '1', TICK_MS: '3000', LAUNCH_PRIORITY_MICROLAMPORTS: '1000', TRADE_PRIORITY_MICROLAMPORTS: '1000',
  VANITY_SUFFIX: SUFFIX, VANITY_REQUIRED: '1', VANITY_GRADUATION_RESERVE: '1', PUBLIC_URL: `http://127.0.0.1:${PORT}`, LAUNCH_OPEN: '1', KEYS_PER_IP_HOUR: '10', WINDOW_FIRST_BUY: '1', WINDOW_MODE: 'fill' };
const procs = [];
const run = (name, args) => { const p = spawn('node', args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] }); p.stdout.on('data', (d) => process.stdout.write(`   [${name}] ${d}`)); p.stderr.on('data', (d) => process.stdout.write(`   [${name}!] ${d}`)); procs.push(p); return p; };
run('grad', ['api/graduator.mjs']);
await new Promise((r) => setTimeout(r, 2500));
run('api', ['api/server.mjs']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (p, body) => { const r = await fetch(`http://127.0.0.1:${PORT}${p}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}); const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status); return j; };
let checks = 0, fails = 0;
const ok = (c, m) => { if (c) { checks++; console.log('PASS', m); } else { fails++; console.log('FAIL', m); } };
const refused = (p, re, m) => p.then(() => ok(false, `${m} (was accepted)`), (e) => ok(re.test(e.message), `${m} (${e.message})`));
const sign = (b64, kp) => { const tx = VersionedTransaction.deserialize(Buffer.from(b64, 'base64')); tx.sign([kp]); return Buffer.from(tx.serialize()).toString('base64'); };
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const W = (k) => k.publicKey.toBase58();
try {
  let cfg = null;
  for (let i = 0; i < 90 && !(cfg?.window?.ready && cfg.window.sizes.length >= 4); i++) { await sleep(2000); cfg = await api('/api/config').catch(() => null); }
  await sleep(5000);
  ok(cfg?.window?.ready && cfg.window.rules === true, `window launches ready, rules advertised (sizes ${cfg?.window?.sizes?.map((s) => s.sizeSol).join('/')})`);
  const size = cfg.window.sizes[0].sizeSol;
  const base = { imageData: `data:image/png;base64,${PNG}`, description: 'rules e2e' };
  const win = (rules, extra = {}) => ({ openSecs: 5, windowMinutes: 1, sizeSol: size, ...extra, rules });
  // refused before anything is pinned or a key taken: the pool is untouched after these
  await refused(api('/api/launch/prepare', { wallet: W(creator), name: 'Bad', symbol: 'BAD', ...base, window: win({ maxBuyBps: 5 }) }), /0\.1% and 100%/, 'a rule out of range is refused');
  await refused(api('/api/launch/prepare', { wallet: W(creator), name: 'Bad', symbol: 'BAD', ...base, window: win({ maxBuyBps: 100, tradeGuardBps: 100 }) }), /pick one/, 'clashing rules are refused');
  await refused(api('/api/launch/prepare', { wallet: W(creator), name: 'Bad', symbol: 'BAD', ...base, window: win({ hoursDays: 62 }) }), /without the rule/, 'hours settings without the rule are refused');
  ok((await api('/api/config')).vanity.fresh === 3, 'refused launches cost no pump key');

  // ── coin A: allowlist + anti-dump caps (max 1% of supply per buy, 0.5% per sell) ──────────────────────────────────
  const pa = await api('/api/launch/prepare', { wallet: W(creator), name: 'Listed Coin', symbol: 'LIST', ...base, devBuySol: 0.05, window: win({ allowlist: true, maxBuyBps: 100, maxSellBps: 50 }) });
  ok(pa.kind === 'window' && pa.transaction, `prepared coin A ${pa.mint} with an allowlist and anti-dump caps`);
  const sa = await api('/api/launch/submit', { mint: pa.mint, transaction: sign(pa.transaction, creator) });
  ok(sa.status === 'live', `coin A live (${sa.sig?.slice(0, 12)})`);
  let ca = await api(`/api/coins/${pa.mint}`);
  for (let i = 0; i < 10 && !ca.window?.rules; i++) { await sleep(1500); ca = await api(`/api/coins/${pa.mint}`); }
  const titles = (c) => (c.window?.rules?.lines ?? []).map((l) => l.t);
  ok(ca.window?.rules?.any && ca.window.rules.allowlist && ca.window.rules.maxBuyBps === 100 && ca.window.rules.maxSellBps === 50, `coin A's rules read back from the chain: ${JSON.stringify({ allowlist: ca.window?.rules?.allowlist, maxBuyBps: ca.window?.rules?.maxBuyBps, maxSellBps: ca.window?.rules?.maxSellBps })}`);
  ok(titles(ca).includes('allowlist') && titles(ca).includes('anti-dump caps') && titles(ca).includes("creator's wallet"), `coin A described: ${titles(ca).join(', ')}`);
  ok(ca.window?.list && ca.window.list.count === 0 && ca.window.list.open && !ca.window.list.sealed, `coin A's list: ${JSON.stringify(ca.window?.list)}`);
  // the list: only the creator; wallets added 24 per transaction, signed by the creator, relayed by the site
  await refused(api('/api/launch/list', { mint: pa.mint, wallet: W(stranger), wallets: [W(stranger)] }), /creator/, 'a stranger cannot change the list');
  await refused(api('/api/launch/list', { mint: pa.mint, wallet: W(creator), wallets: ['nope'] }), /Not a wallet address/, 'junk in the list is refused');
  const extra = Array.from({ length: 30 }, () => W(Keypair.generate()));
  const lt = await api('/api/launch/list', { mint: pa.mint, wallet: W(creator), wallets: [W(listed), ...extra], seal: false });
  ok(lt.added === 31 && lt.transactions.length === 2 && lt.tooLate.length === 0, `list transactions built: ${lt.added} wallets in ${lt.transactions.length} transactions`);
  await refused(api('/api/launch/list/submit', { mint: pa.mint, transaction: sign(pa.transaction, creator) }), /Not a list transaction/, 'the list relay refuses a transaction that is not a list transaction');
  for (const tx of lt.transactions) { const r = await api('/api/launch/list/submit', { mint: pa.mint, transaction: sign(tx, creator) }); ok(Boolean(r.sig), `list transaction landed ${r.sig.slice(0, 12)}`); }
  await sleep(1500);
  ca = await api(`/api/coins/${pa.mint}`);
  for (let i = 0; i < 20 && ca.window.list.count !== 31; i++) { await sleep(1500); ca = await api(`/api/coins/${pa.mint}`); }
  ok(ca.window.list.count === 31 && !ca.window.list.sealed, `coin page shows the list: ${ca.window.list.count} wallets, open`);
  const again = await api('/api/launch/list', { mint: pa.mint, wallet: W(creator), wallets: [W(listed)], seal: false });
  ok(again.added === 0 && again.transactions.length === 0, 'a wallet already listed is skipped, nothing to sign');
  await sleep(6000); // buying opens 5 s after launch
  // trades: an unlisted wallet is refused BEFORE signing (the API simulates and names the hook's reason)
  await refused(api('/api/trade/prepare', { wallet: W(stranger), mint: pa.mint, side: 'buy', amount: 0.1, slippageBps: 300 }), /not on the token's allowlist/, 'an unlisted wallet cannot buy coin A');
  const b1 = await api('/api/trade/prepare', { wallet: W(listed), mint: pa.mint, side: 'buy', amount: 0.1, slippageBps: 300 });
  const s1 = await api('/api/trade/submit', { transaction: sign(b1.transaction, listed) });
  ok(s1.sig && BigInt(s1.tokenUnits) > 0n, `a listed wallet bought 0.1 SOL of coin A: ${s1.tokenUnits} units (${(Number(s1.tokenUnits) / 1e13).toFixed(3)}% of supply)`);
  await refused(api('/api/trade/prepare', { wallet: W(listed), mint: pa.mint, side: 'buy', amount: 1, slippageBps: 500 }), /bigger than this token allows in one go/, 'a buy over 1% of supply is refused by the anti-dump cap');
  await sleep(1200);
  const b2 = await api('/api/trade/prepare', { wallet: W(listed), mint: pa.mint, side: 'buy', amount: 0.1, slippageBps: 300 });
  const s2 = await api('/api/trade/submit', { transaction: sign(b2.transaction, listed) });
  ok(s2.sig, 'the listed wallet bought another 0.1 SOL (its bag is now over 0.5% of supply)');
  await refused(api('/api/trade/prepare', { wallet: W(listed), mint: pa.mint, side: 'sell', pct: 100, slippageBps: 300 }), /sell is bigger than this token allows|Sell in smaller pieces/, 'selling the whole bag (over 0.5% of supply) is refused by the sell cap');
  const sl = await api('/api/trade/prepare', { wallet: W(listed), mint: pa.mint, side: 'sell', pct: 40, slippageBps: 300 });
  const ss = await api('/api/trade/submit', { transaction: sign(sl.transaction, listed) });
  ok(ss.sig && BigInt(ss.lamports) > 0n, `selling 40% of the bag (under the cap) works: ${Number(ss.lamports) / 1e9} SOL back`);
  // seal: afterwards nothing can be added, and the coin page says sealed
  const seal = await api('/api/launch/list', { mint: pa.mint, wallet: W(creator), wallets: [], seal: true });
  ok(seal.transactions.length === 1, 'a seal transaction built');
  await api('/api/launch/list/submit', { mint: pa.mint, transaction: sign(seal.transactions[0], creator) });
  await sleep(1500);
  await refused(api('/api/launch/list', { mint: pa.mint, wallet: W(creator), wallets: [W(stranger)] }), /sealed/, 'a sealed list takes no more wallets');
  ca = await api(`/api/coins/${pa.mint}`);
  for (let i = 0; i < 20 && !ca.window.list.sealed; i++) { await sleep(1500); ca = await api(`/api/coins/${pa.mint}`); }
  ok(ca.window.list.sealed && !ca.window.list.open, `coin page shows the list sealed: ${JSON.stringify(ca.window.list)}`);

  // ── coin B: trading hours closed right now + a 2% trade guard ─────────────────────────────────────────────────────
  const nowMin = Math.floor((Math.floor(Date.now() / 1000) % 86_400) / 60);
  const pb = await api('/api/launch/prepare', { wallet: W(creator), name: 'Hours Coin', symbol: 'HRS', ...base, window: win({ hoursOn: true, hoursDays: 127, hoursOpenMin: (nowMin + 120) % 1440, hoursCloseMin: (nowMin + 180) % 1440, tzOffsetMin: 0, tradeGuardBps: 200 }) });
  const sb = await api('/api/launch/submit', { mint: pb.mint, transaction: sign(pb.transaction, creator) });
  ok(sb.status === 'live', `coin B live with trading hours and a trade guard (${sb.sig?.slice(0, 12)})`);
  let cb = await api(`/api/coins/${pb.mint}`);
  for (let i = 0; i < 10 && !cb.window?.rules; i++) { await sleep(1500); cb = await api(`/api/coins/${pb.mint}`); }
  ok(cb.window?.rules?.hoursOn && cb.window.rules.tradeGuardBps === 200 && titles(cb).includes('trading hours') && titles(cb).includes('trade guard'), `coin B described: ${titles(cb).join(', ')}`);
  ok(!cb.window.list, 'coin B has no list');
  await sleep(6000);
  await refused(api('/api/trade/prepare', { wallet: W(stranger), mint: pb.mint, side: 'buy', amount: 0.1, slippageBps: 300 }), /trading hours/, 'a buy outside the trading hours is refused with the hook\'s reason');
  ok((await api('/api/config')).vanity.fresh === 1, 'two pump keys spent, the graduation reserve left');
} catch (e) { fails++; console.log('FAIL (threw)', e.message); }
for (const p of procs) p.kill('SIGTERM');
stub.close();
console.log(`\n${checks} passed, ${fails} failed`);
setTimeout(() => process.exit(fails ? 1 : 0), 1500);
