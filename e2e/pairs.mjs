/**
 * Custom pairs end to end on a local validator (e2e/validator-window.sh: pump.fun + PumpSwap + quote-control cloned, WBTC
 * and SPYx with a TEST mint authority so the test can hold them). Covers every pump.fun leg; the Jupiter leg (SOL ↔ a
 * listed pair) cannot run locally and is proven by mainnet simulation (e2e/pairs-trade-sim.mjs).
 *   1. launches paired with WBTC (SPL) and SPYx (Token-2022): the curve's quote is the pair, the creator the fee wallet
 *   2. the listed-pair legs: pair → coin and coin → pair (what follows / precedes Jupiter)
 *   3. a pump coin as the pair: buy with SOL (SOL → pair → coin) and sell for SOL through the site's trade API
 *   4. graduation of a WBTC coin, PumpSwap trades, then the liquidity keeper IN WBTC: rent, collect, buy, deposit, burn
 * Usage: node e2e/pairs.mjs
 */
import fsSync from 'node:fs';
import { ComputeBudgetProgram, Keypair, LAMPORTS_PER_SOL, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction } from '@solana/spl-token';
import BN from 'bn.js';

Object.assign(process.env, { SOLANA_RPC: 'http://127.0.0.1:8981', DB_PATH: `/tmp/oldpump-e2e-pairs-${process.pid}.db`, DATA_DIR: `/tmp/oldpump-e2e-pairs-data-${process.pid}`, VANITY_REQUIRED: '0', LAUNCH_OPEN: '1', PUBLIC_URL: 'http://127.0.0.1:5480', PINATA_JWT: '', LAUNCH_PRIORITY_MICROLAMPORTS: '1000', TRADE_PRIORITY_MICROLAMPORTS: '1000', PRIORITY_MICROLAMPORTS: '1000', LIQ_MIN_SOL: '0.01', LIQ_MIN_COLLECT_SOL: '0.0001', LIQ_MIN_DEPOSIT_SOL: '0.001' });

const sol = await import('../api/sol.mjs');
const launch = await import('../api/launch.mjs');
const trade = await import('../api/trade.mjs');
const pairs = await import('../api/pairs.mjs');
const liq = await import('../api/liquidity.mjs');
const lib = await import('../lib/liquidity.mjs');
const ag = await import('../ag/pump.mjs');
const { one, all } = await import('../api/db.mjs');
const { OnlinePumpAmmSdk, PUMP_AMM_SDK } = await import('@pump-fun/pump-swap-sdk');

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok) }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`); };
const step = async (name, fn) => { try { return await fn(); } catch (e) { check(name, false, String(e.message).slice(0, 400)); return null; } };
const conn = sol.conn;
const fund = async (pk, n) => { const sig = await conn.requestAirdrop(pk, n * LAMPORTS_PER_SOL); await conn.confirmTransaction(sig, 'confirmed'); };
const signB64 = (b64, kps) => { const tx = VersionedTransaction.deserialize(Buffer.from(b64, 'base64')); tx.sign(kps); return Buffer.from(tx.serialize()).toString('base64'); };
const w = (k) => k.publicKey.toBase58();
const img = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const send = async (payer, ixs, signers = []) => {
  const { blockhash } = await conn.getLatestBlockhash('confirmed');
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash, instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 900_000 }), ...ixs] }).compileToV0Message());
  tx.sign([payer, ...signers]);
  const sig = await conn.sendTransaction(tx, { skipPreflight: false });
  const r = await conn.confirmTransaction(sig, 'confirmed');
  if (r.value.err) throw new Error(JSON.stringify(r.value.err));
  return sig;
};
const bal = async (owner, mint, prog) => { const a = await conn.getAccountInfo(ag.ata(owner, new PublicKey(mint), new PublicKey(prog))); return a ? ag.tokenAccountAmount(a.data) : 0n; };
const auth = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fsSync.readFileSync(new URL('../hk/keys/test-pair-authority.json', import.meta.url)))));
const mintTo = async (q, owner, amount) => send(whale, [createAssociatedTokenAccountIdempotentInstruction(whale.publicKey, ag.ata(owner, new PublicKey(q.mint), new PublicKey(q.tokenProgram)), owner, new PublicKey(q.mint), new PublicKey(q.tokenProgram)),
  createMintToInstruction(new PublicKey(q.mint), ag.ata(owner, new PublicKey(q.mint), new PublicKey(q.tokenProgram)), auth.publicKey, amount, [], new PublicKey(q.tokenProgram))], [auth]);

const WBTC = '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh', SPYX = 'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W';
const L = Keypair.generate(), B1 = Keypair.generate(), whale = Keypair.generate();
await fund(L.publicKey, 20); await fund(B1.publicKey, 50); await fund(whale.publicKey, 400); await fund(auth.publicKey, 1);
const keeper = liq.keeperKey(); await fund(keeper.publicKey, 2);
const global = await ag.loadGlobal(conn);

/* ── 1. launches paired with listed tokens ── */
const launchWith = async (pair, symbol) => {
  const p = await launch.prepare({ wallet: w(L), name: `Paired ${symbol}`, symbol, imageData: img, ...(pair ? { pair } : {}) });
  await launch.submit({ mint: p.mint, transaction: signB64(p.transaction, [L]) });
  return p.mint;
};
const coinW = await step('launch paired with WBTC', () => launchWith(WBTC, 'PWBTC'));
const rowW = one('SELECT * FROM launches WHERE mint = ?', coinW);
const stW = await ag.coinState(conn, coinW, { quoteMint: WBTC, quoteDecimals: 8 });
const pumpLib = await import('../lib/pump.mjs');
const cs = await pumpLib.coinState(conn, coinW);
check('WBTC coin: curve quote is WBTC, creator is the fee wallet', cs?.quoteMint === WBTC && cs.creator === rowW.fee_wallet && rowW.pair === WBTC, `pair_symbol ${rowW.pair_symbol}`);
const coinS = await step('launch paired with SPYx (Token-2022)', () => launchWith(SPYX, 'PSPYX'));
check('SPYx coin recorded with its pair', one('SELECT pair FROM launches WHERE mint = ?', coinS)?.pair === SPYX);

/* ── 2. listed-pair legs: pair → coin, coin → pair ── */
for (const [coin, pairMint, amount] of [[coinW, WBTC, 10_000_000n], [coinS, SPYX, 1_000_000_000n]]) {
  const q = await pairs.quoteOf(pairMint);
  await step(`mint ${pairMint.slice(0, 4)} to the buyer`, () => mintTo(q, B1.publicKey, amount));
  const before = await bal(B1.publicKey, coin, ag.TOKEN_2022);
  await step(`${pairMint.slice(0, 4)} → coin`, async () => send(B1, await pairs.pairToCoinIxs({ user: B1.publicKey, mint: new PublicKey(coin), q, global, amountIn: amount / 2n, minOut: 1n })));
  const got = (await bal(B1.publicKey, coin, ag.TOKEN_2022)) - before;
  check(`pair → coin bought coins (${pairMint.slice(0, 4)})`, got > 0n, `${got} units`);
  const qBefore = await bal(B1.publicKey, pairMint, q.tokenProgram);
  await step(`coin → ${pairMint.slice(0, 4)}`, async () => send(B1, await pairs.coinToPairIxs({ user: B1.publicKey, mint: new PublicKey(coin), q, global, units: got / 2n, minOut: 1n })));
  check(`coin → pair returned the pair token (${pairMint.slice(0, 4)})`, (await bal(B1.publicKey, pairMint, q.tokenProgram)) > qBefore);
}

/* ── 3. a pump coin as the pair, traded with SOL through the site ── */
const coinQ = await step('launch the pair coin (SOL)', () => launchWith(null, 'PAIRQ'));
const qb = await step('buy some of the pair coin', () => trade.prepare({ wallet: w(whale), mint: coinQ, side: 'buy', amount: 5, slippageBps: 500 }));
if (qb) await step('submit', () => trade.submit({ transaction: signB64(qb.transaction, [whale]) }));
const coinX = await step('launch paired with the pump coin', () => launchWith(coinQ, 'PCOINX'));
const solBefore = BigInt(await conn.getBalance(B1.publicKey));
const xb = await step('buy with SOL (SOL → pair coin → coin)', () => trade.prepare({ wallet: w(B1), mint: coinX, side: 'buy', amount: 1, slippageBps: 500 }));
if (xb) await step('submit buy', () => trade.submit({ transaction: signB64(xb.transaction, [B1]) }));
const heldX = await bal(B1.publicKey, coinX, ag.TOKEN_2022);
check('bought the pump-coin-paired coin with SOL', heldX > 0n && heldX >= BigInt(xb?.quote?.minTokenUnits ?? 1), `${heldX} units, quoted ${xb?.quote?.tokenUnits}`);
const xs = await step('sell for SOL (coin → pair coin → SOL)', () => trade.prepare({ wallet: w(B1), mint: coinX, side: 'sell', pct: 100, slippageBps: 500 }));
if (xs) await step('submit sell', () => trade.submit({ transaction: signB64(xs.transaction, [B1]) }));
check('sold it all for SOL', (await bal(B1.publicKey, coinX, ag.TOKEN_2022)) === 0n);
const solAfter = BigInt(await conn.getBalance(B1.publicKey));
check('the round trip cost only fees and price impact', solBefore - solAfter < 100_000_000n, `${(Number(solBefore - solAfter) / 1e9).toFixed(4)} SOL`);
check('trades were recorded with SOL amounts', all("SELECT side, lamports FROM trades WHERE mint = ? AND side IN ('buy','sell')", coinX).every((r) => BigInt(r.lamports) > 0n));

/* ── 4. graduation of the WBTC coin, then the liquidity keeper in WBTC ── */
const qW = await pairs.quoteOf(WBTC);
await step('mint WBTC to the whale', () => mintTo(qW, whale.publicKey, 100_000_000_000n));
for (let i = 0; i < 8; i++) {
  const r = await ag.coinReserves(conn, coinW, qW);
  if (!r || r.kind !== 'curve') break;
  await step(`whale buys with WBTC ${i + 1}`, async () => send(whale, await pairs.pairToCoinIxs({ user: whale.publicKey, mint: new PublicKey(coinW), q: qW, global, amountIn: 10_000_000_000n, minOut: 1n })));
}
let rW = await ag.coinReserves(conn, coinW, qW);
check('WBTC coin curve completed', rW?.kind === 'migrating' || rW?.kind === 'pool', rW?.kind);
await step('migrate_v2 to a WBTC pool', async () => send(whale, [await ag.migrateV2Ix(conn, global, { mint: new PublicKey(coinW), user: whale.publicKey, quote: qW })]));
const fs0 = await lib.feeState(conn, { mint: coinW, feeWallet: rowW.fee_wallet, reserve: liq.RESERVE, quote: qW });
check('the WBTC pool exists and fees wait in WBTC', fs0.graduated && fs0.waiting > 0n, `${fs0.waiting} WBTC units waiting`);
const amm = new OnlinePumpAmmSdk(conn), pool = new PublicKey(fs0.pool);
for (let i = 0; i < 2; i++) await step(`pool buy ${i + 1}`, async () => send(B1, await PUMP_AMM_SDK.buyQuoteInput(await amm.swapSolanaState(pool, B1.publicKey), new BN(1_000_000), 5)));
const lpMint = (await amm.liquiditySolanaState(pool, keeper.publicKey)).pool.lpMint;
const lpBefore = BigInt((await conn.getTokenSupply(lpMint)).value.amount);
const quoteVault = (await amm.liquiditySolanaState(pool, keeper.publicKey)).pool.poolQuoteTokenAccount;
const qPoolBefore = ag.tokenAccountAmount((await conn.getAccountInfo(quoteVault)).data);
// the keeper's thresholds price WBTC through DexScreener (the real WBTC mint, so the real price)
const did = await step('keeper pass in WBTC', () => liq.passCoin({ ...rowW, pair: WBTC, pair_symbol: 'WBTC' }, keeper));
console.log(`   keeper: ${did}`);
const fs1 = await lib.feeState(conn, { mint: coinW, feeWallet: rowW.fee_wallet, reserve: liq.RESERVE, quote: qW });
check('fees collected in WBTC', fs1.waiting < fs0.waiting, `${fs1.waiting} left`);
check('the pool holds more WBTC', ag.tokenAccountAmount((await conn.getAccountInfo(quoteVault)).data) > qPoolBefore);
check('LP from the deposit burned', BigInt((await conn.getTokenSupply(lpMint)).value.amount) === lpBefore);
const steps = all('SELECT step FROM liquidity WHERE mint = ?', coinW).map((r) => r.step);
check('rent, collect, buy and deposit recorded', ['rent', 'collect', 'buy', 'deposit'].every((s) => steps.includes(s)), steps.join(','));

const fails = results.filter((r) => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} passed${fails.length ? `: FAILED ${fails.map((f) => f.name).join(' | ')}` : ''}`);
process.exit(fails.length ? 1 : 0);
