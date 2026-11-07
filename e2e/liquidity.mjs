/**
 * Creator fees → burned liquidity, end to end on a local validator with pump.fun + PumpSwap cloned (e2e/validator-window.sh,
 * port 8981): a launch through the site's real code names the coin's fee wallet as creator, trades on the curve pay it
 * fees, the coin graduates and migrates, trades on PumpSwap pay more, then the keeper collects, buys, deposits and burns
 * the LP. Usage: node e2e/liquidity.mjs
 */
import http from 'node:http';
import fsSync from 'node:fs';
import { ComputeBudgetProgram, Keypair, LAMPORTS_PER_SOL, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import BN from 'bn.js';

const DB = `/tmp/oldpump-e2e-liq-${process.pid}.db`;
Object.assign(process.env, { SOLANA_RPC: 'http://127.0.0.1:8981', DB_PATH: DB, DATA_DIR: `/tmp/oldpump-e2e-liq-data-${process.pid}`, VANITY_REQUIRED: '0', LAUNCH_OPEN: '1', PUBLIC_URL: 'http://127.0.0.1:5480', PINATA_JWT: '', LAUNCH_PRIORITY_MICROLAMPORTS: '1000', TRADE_PRIORITY_MICROLAMPORTS: '1000', PRIORITY_MICROLAMPORTS: '1000', LIQ_MIN_SOL: '0.01', LIQ_MIN_COLLECT_SOL: '0.001' });

const sol = await import('../api/sol.mjs');
const launch = await import('../api/launch.mjs');
const trade = await import('../api/trade.mjs');
const coins = await import('../api/coins.mjs');
const feeWallets = await import('../api/feewallets.mjs');
const liq = await import('../api/liquidity.mjs');
const lib = await import('../lib/liquidity.mjs');
const { one, all } = await import('../api/db.mjs');
const pump = await import('../lib/pump.mjs');
const { PUMP_SDK } = await import('@pump-fun/pump-sdk');
const { OnlinePumpAmmSdk, PUMP_AMM_SDK } = await import('@pump-fun/pump-swap-sdk');

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok) }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`); };
const step = async (name, fn) => { try { return await fn(); } catch (e) { check(name, false, String(e.message).slice(0, 400)); return null; } };
const conn = sol.conn;
const fund = async (pk, n) => { const sig = await conn.requestAirdrop(pk, n * LAMPORTS_PER_SOL); await conn.confirmTransaction(sig, 'confirmed'); };
const signB64 = (b64, kps) => { const tx = VersionedTransaction.deserialize(Buffer.from(b64, 'base64')); tx.sign(kps); return Buffer.from(tx.serialize()).toString('base64'); };
const w = (k) => k.publicKey.toBase58();
const img = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const sendIxs = async (payer, ixs, signers) => {
  const { blockhash } = await conn.getLatestBlockhash('confirmed');
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash, instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 800_000 }), ...ixs] }).compileToV0Message());
  tx.sign([payer, ...signers]);
  const sig = await conn.sendTransaction(tx, { skipPreflight: false });
  const r = await conn.confirmTransaction(sig, 'confirmed');
  if (r.value.err) throw new Error(JSON.stringify(r.value.err));
  return sig;
};

const L = Keypair.generate(), B1 = Keypair.generate(), whale = Keypair.generate();
await fund(L.publicKey, 5); await fund(B1.publicKey, 10); await fund(whale.publicKey, 300);
const keeper = liq.keeperKey();
await fund(keeper.publicKey, 1);

/* ── 1. the launch names a fee wallet as creator ── */
const p = await step('prepare (holder rewards asked for: ignored)', () => launch.prepare({ wallet: w(L), name: 'Deep Pool', symbol: 'DEEP', imageData: img, holderRewards: true }));
const MINT = p?.mint;
const row = one('SELECT * FROM launches WHERE mint = ?', MINT);
check('the row has a fee wallet', Boolean(row?.fee_wallet), row?.fee_wallet);
check('the fee wallet key is on disk before the coin exists', fsSync.existsSync(`${feeWallets.DIR}/${row.fee_wallet}.json`) && feeWallets.load(row.fee_wallet).publicKey.toBase58() === row.fee_wallet);
check('holder rewards are not offered on a classic launch', row.holder_rewards === 0);
await step('submit', () => launch.submit({ mint: MINT, transaction: signB64(p.transaction, [L]) }));
let st = await pump.coinState(conn, MINT);
check('the coin is live with the FEE WALLET as its pump.fun creator', st?.creator === row.fee_wallet, `creator ${st?.creator}`);
check('not the launcher', st?.creator !== w(L));
const view = await coins.coin(MINT);
check('coin page shows the launcher as creator and the liquidity line', view.creator === w(L) && view.liquidity?.feeWallet === row.fee_wallet && view.liquidity.added === 0);

/* ── 2. trades on the curve pay the fee wallet; nothing deepens before graduation ── */
for (const k of [B1, whale]) {
  const b = await step('curve buy', () => trade.prepare({ wallet: w(k), mint: MINT, side: 'buy', amount: k === whale ? 84 : 2, slippageBps: 500 }));
  if (b) await step('curve buy submit', () => trade.submit({ transaction: signB64(b.transaction, [k]) }));
}
st = await pump.coinState(conn, MINT);
if (!st.complete) { const b = await step('whale buys the rest', () => trade.prepare({ wallet: w(whale), mint: MINT, side: 'buy', amount: 10, slippageBps: 500 })); if (b) await step('submit rest', () => trade.submit({ transaction: signB64(b.transaction, [whale]) })); st = await pump.coinState(conn, MINT); }
check('curve completed', st.complete);
let fs0 = await lib.feeState(conn, { mint: MINT, feeWallet: row.fee_wallet, reserve: liq.RESERVE });
check('curve fees wait for the fee wallet', fs0.waiting > 0n && !fs0.graduated, `${(Number(fs0.waiting) / 1e9).toFixed(4)} SOL waiting`);
check('the keeper does nothing before the pool exists', (await liq.passCoin(row, keeper)) === 'on its curve');

/* ── 3. graduation: migrate to PumpSwap (pump.fun's migrator does this on mainnet within seconds) ── */
const global = await pump.loadGlobal(conn);
await step('migrate to PumpSwap', async () => sendIxs(whale, [await PUMP_SDK.migrateInstruction({ withdrawAuthority: global.withdraw_authority, mint: new PublicKey(MINT), user: whale.publicKey, tokenProgram: pump.TOKEN_2022 })], []));
fs0 = await lib.feeState(conn, { mint: MINT, feeWallet: row.fee_wallet, reserve: liq.RESERVE });
check('the pool exists', fs0.graduated, fs0.pool);

/* ── 4. trades on PumpSwap pay creator fees on the pool ── */
const amm = new OnlinePumpAmmSdk(conn), pool = new PublicKey(fs0.pool);
for (let i = 0; i < 3; i++) {
  await step(`pool buy ${i + 1}`, async () => sendIxs(B1, await PUMP_AMM_SDK.buyQuoteInput(await amm.swapSolanaState(pool, B1.publicKey), new BN(1 * LAMPORTS_PER_SOL), 5), []));
  const held = (await amm.swapSolanaState(pool, B1.publicKey)).userBaseAccountInfo;
  const units = held ? pump.tokenAccountAmount(held.data) / 3n : 0n;
  if (units > 0n) await step(`pool sell ${i + 1}`, async () => sendIxs(B1, await PUMP_AMM_SDK.sellBaseInput(await amm.swapSolanaState(pool, B1.publicKey), new BN(String(units)), 5), []));
}
fs0 = await lib.feeState(conn, { mint: MINT, feeWallet: row.fee_wallet, reserve: liq.RESERVE });
check('pool trades left creator fees waiting', fs0.waiting > 0n, `${(Number(fs0.waiting) / 1e9).toFixed(4)} SOL waiting (curve ${fs0.curveUnswept}+vault ${fs0.vault}, pool ${fs0.poolUnswept}+amm ${fs0.ammVault})`);

/* ── 5. the keeper: collect, buy, deposit, burn ── */
const poolBefore = await amm.liquiditySolanaState(pool, keeper.publicKey);
const quoteBefore = pump.tokenAccountAmount(poolBefore.poolQuoteAccountInfo?.data ?? (await conn.getAccountInfo(poolBefore.pool.poolQuoteTokenAccount)).data);
const lpSupplyBefore = BigInt((await conn.getTokenSupply(poolBefore.pool.lpMint)).value.amount);
const waitingBefore = fs0.waiting;
const did = await step('keeper pass', () => liq.passCoin(row, keeper));
console.log(`   keeper: ${did}`);
const fs1 = await lib.feeState(conn, { mint: MINT, feeWallet: row.fee_wallet, reserve: liq.RESERVE });
check('every waiting fee was collected (the keeper\'s own trades pay it a little again)', fs1.waiting < 1_000_000n, `${fs1.waiting} lamports left waiting`);
check('the fee wallet spent its SOL down to under the minimum', fs1.spare < 10_000_000n, `spare ${(Number(fs1.spare) / 1e9).toFixed(5)} SOL, tokens ${fs1.tokens}`);
const poolAfter = await amm.liquiditySolanaState(pool, keeper.publicKey);
const quoteAfter = pump.tokenAccountAmount((await conn.getAccountInfo(poolAfter.pool.poolQuoteTokenAccount)).data);
check('the pool holds more SOL', quoteAfter > quoteBefore, `+${(Number(quoteAfter - quoteBefore) / 1e9).toFixed(4)} SOL`);
const lpSupplyAfter = BigInt((await conn.getTokenSupply(poolAfter.pool.lpMint)).value.amount);
check('the LP minted by the deposit was burned (LP supply unchanged)', lpSupplyAfter === lpSupplyBefore, `${lpSupplyBefore} → ${lpSupplyAfter}`);
check('the fee wallet holds no LP', (await lib.lpHeld(conn, { mint: MINT, feeWallet: row.fee_wallet })) === 0n);
const rows = all('SELECT step, lamports, lp FROM liquidity WHERE mint = ?', MINT);
check('collect, buy and deposit recorded', ['collect', 'buy', 'deposit'].every((s) => rows.some((r) => r.step === s)), rows.map((r) => `${r.step}:${(Number(r.lamports) / 1e9).toFixed(4)}`).join(' '));
const v2 = await coins.coin(MINT);
check('coin page shows the SOL added', v2.liquidity.addedSol > 0 && Number(waitingBefore) / 1e9 - v2.liquidity.addedSol < Number(liq.RESERVE) / 1e9 + 0.006, `${v2.liquidity.addedSol.toFixed(4)} SOL added of ${(Number(waitingBefore) / 1e9).toFixed(4)} collected`);
check('a second pass has nothing to do', (await liq.passCoin(row, keeper)) === 'nothing to do');
const passAll = await step('pass over every coin', () => liq.pass(keeper));
check('pass finds the graduated coin', passAll?.graduated === 1);

const fails = results.filter((r) => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} passed${fails.length ? `: FAILED ${fails.map((f) => f.name).join(' | ')}` : ''}`);
process.exit(fails.length ? 1 : 0);
