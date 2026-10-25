/**
 * Window launches end to end on the local validator (e2e/validator-window.sh, :8981): a hooked Meteora token with an
 * opening delay and a deadline, trading through the hook, the graduator filling the curve at the deadline and the
 * token becoming a pump.fun coin in every holder's wallet. Every number is read back from chain.
 *   OPEN=15 CLOSE=100 node e2e/window.mjs
 */
import { Keypair, PublicKey, LAMPORTS_PER_SOL, SystemProgram, Transaction, VersionedTransaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync, getTransferHook, getMint } from "@solana/spl-token";
import { rmSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
const { OnlinePumpSdk } = createRequire(import.meta.url)("@pump-fun/pump-sdk");
process.env.TEST_SIZES = process.env.TEST_SIZES ?? "3";
process.env.FLAT_ONLY = "1";
process.env.VANITY_REQUIRED = "0"; // this suite exercises the hook and the graduator, not the key pool (e2e/api-window.mjs does)
const { connect } = await import("../hk/lib/env.mjs");
const { dbcClient, getPool } = await import("../hk/lib/chain.mjs");
const { ensureConfigs } = await import("../hk/lib/configs.mjs");
const { buildLaunchTx, buildSwapTx, launchStaticKeys } = await import("../hk/lib/launch.mjs");
const { DEFAULT_RULES, decodeRules, hookErrorFromLogs, validateRules } = await import("../hk/lib/rules.mjs");
const { ensureLut, pumpStaticKeys } = await import("../hk/lib/lut.mjs");
const { Graduator } = await import("../hk/lib/graduate.mjs");
const { openDb, getLaunch, registerLaunch, now } = await import("../hk/lib/db.mjs");
const { pumpMarketCap } = await import("../hk/lib/pumpprice.mjs");
const { pumpParams } = await import("../hk/lib/curve.mjs");

const OPEN = Number(process.env.OPEN ?? 15), CLOSE = Number(process.env.CLOSE ?? 100);
const conn = connect(process.env.LOCAL_RPC || "http://127.0.0.1:8981", 0);
const dbc = dbcClient(conn);
const HOOK = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(new URL("../hk/keys/hook-keypair.json", import.meta.url))))).publicKey;
const DATA = new URL("../data/e2e-window/", import.meta.url).pathname;
rmSync(DATA, { recursive: true, force: true }); mkdirSync(DATA, { recursive: true });
let checks = 0, fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("FAIL", m); } else { checks++; console.log("PASS", m); } };
const sol = (l) => (Number(l) / LAMPORTS_PER_SOL).toFixed(4);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fund = async (...kps) => { for (const k of kps) await conn.confirmTransaction(await conn.requestAirdrop(k.publicKey, 200 * LAMPORTS_PER_SOL), "confirmed"); };
async function send(tx, signers) {
  if (tx instanceof VersionedTransaction) {
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
    tx.message.recentBlockhash = blockhash; tx.sign(signers);
    const sig = await conn.sendRawTransaction(tx.serialize(), { preflightCommitment: "confirmed" });
    const r = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
    if (r.value.err) throw new Error(`failed: ${JSON.stringify(r.value.err)}`);
    return sig;
  }
  return sendAndConfirmTransaction(conn, tx, signers, { commitment: "confirmed" });
}
const hookCode = async (fn) => { await sleep(900); try { await fn(); return "passed"; } catch (e) { const c = hookErrorFromLogs(e.transactionLogs ?? e.logs, HOOK); if (c == null) console.log("   (not a hook refusal:", String(e.message).slice(0, 160), (e.transactionLogs ?? e.logs ?? []).slice(-3).join(" | ").slice(0, 300), ")"); return c ?? `other`; } };
const ata = (mint, owner) => getAssociatedTokenAddressSync(mint, owner, true, TOKEN_2022_PROGRAM_ID);
const bal = async (mint, owner) => { const a = await conn.getTokenAccountBalance(ata(mint, owner), "confirmed").catch(() => null); return a ? BigInt(a.value.amount) : 0n; };
const lam = (pk) => conn.getBalance(pk, "confirmed");

const platform = Keypair.generate(), treasury = Keypair.generate(), creator = Keypair.generate();
const A = Keypair.generate(), B = Keypair.generate(), C = Keypair.generate();
await fund(platform, creator, A, B, C);
await send(new Transaction().add(SystemProgram.transfer({ fromPubkey: platform.publicKey, toPubkey: new PublicKey("FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM"), lamports: 2 * LAMPORTS_PER_SOL })), [platform]);
const db = openDb(`${DATA}/ledger.db`);

console.log("\n-- configs (flat fee, test size + pump.fun sizes)");
const { flatConfigs, pump: P } = await ensureConfigs({ conn, platform, hookProgram: HOOK, dataDir: DATA, log: () => {} });
const sizes = Object.keys(flatConfigs).map(Number).sort((a, b) => a - b);
const { graduationSizes } = await import("../hk/lib/curve.mjs");
ok(sizes[0] === 3 && sizes.join("/") === graduationSizes(P).join("/"), `configs made: ${sizes.join("/")} SOL (3 SOL is the test size; the rest is the size table)`);
const SIZE = 3, config = new PublicKey(flatConfigs[SIZE]);
const pumpSdk = new OnlinePumpSdk(conn);
const lut = await ensureLut({ conn, payer: platform, file: `${DATA}/lut.json`, log: () => {},
  keys: [...await pumpStaticKeys({ global: await pumpSdk.fetchGlobal(), feeConfig: await pumpSdk.fetchFeeConfig() }), ...await launchStaticKeys({ dbc, hookProgram: HOOK, configs: Object.values(flatConfigs) })] });
ok(lut.state.addresses.length >= 25, `lookup table: ${lut.state.addresses.length} accounts`);

console.log(`\n-- launch (opens after ${OPEN}s, window ${CLOSE}s)`);
const rules = { ...DEFAULT_RULES, platformOn: true, platform: platform.publicKey, openSecs: OPEN, closeSecs: CLOSE, bundleMax: 1, maxWalletBps: 5_000, holderRewards: true };
ok(validateRules({ ...rules, dev: creator.publicKey }).length === 0, "rules validate");
const URI = "https://ipfs.io/ipfs/bafkreifra3rgfzkyof45xg3jtbdsu6qwwsfed7dhn5arjvys73lx7xkeim";
const DEV_BUY = 300_000_000n; // the creator's first buy, INSIDE the launch transaction
const { tx: launchTx, mint: mintKp, pool } = await buildLaunchTx({ dbc, hookProgram: HOOK, config, creator: creator.publicKey, name: "Window Coin", symbol: "WIN", uri: URI, rules, devBuyLamports: DEV_BUY, lut });
const MINT = mintKp.publicKey;
const t0 = Math.floor(Date.now() / 1000);
await send(launchTx, [creator, mintKp]);
ok(!!(await getTransferHook(await getMint(conn, MINT, "confirmed", TOKEN_2022_PROGRAM_ID)))?.programId.equals(HOOK), "the mint carries our hook");
const onChainRules = decodeRules((await conn.getAccountInfo(PublicKey.findProgramAddressSync([Buffer.from("cfg"), MINT.toBuffer()], HOOK)[0], "confirmed")).data);
ok(onChainRules.openSecs === OPEN && onChainRules.closeSecs === CLOSE && onChainRules.platformOn && onChainRules.platform.equals(platform.publicKey), `rules on chain: open ${onChainRules.openSecs}s close ${onChainRules.closeSecs}s platform set`);
registerLaunch(db, { mint: MINT.toBase58(), pool: pool.toBase58(), config: config.toBase58(), creator: creator.publicKey.toBase58(), name: "Window Coin", symbol: "WIN", uri: URI, gradSol: SIZE, closeAt: onChainRules.launchTs + CLOSE, openSecs: OPEN });

const buy = (kp, lamports) => send(await_(buildSwapTx({ dbc, pool, owner: kp.publicKey, buy: true, amountIn: BigInt(lamports), minimumAmountOut: 1n })), [kp]);
function await_(p) { return p; }
const buyNow = async (kp, lamports) => { const tx = await buildSwapTx({ dbc, pool, owner: kp.publicKey, buy: true, amountIn: BigInt(lamports), minimumAmountOut: 1n }); return send(tx, [kp]); };
const sellNow = async (kp, units) => { const tx = await buildSwapTx({ dbc, pool, owner: kp.publicKey, buy: false, amountIn: units, minimumAmountOut: 1n }); return send(tx, [kp]); };

console.log("\n-- before opening");
const devAtLaunch = await bal(MINT, creator.publicKey);
ok(devAtLaunch > 0n, `the creator's first buy landed inside the launch transaction (${devAtLaunch} units for ${sol(DEV_BUY)} SOL)`);
ok((await hookCode(() => buyNow(A, 0.1e9))) === 26, "a buy right after launch is refused: not open yet (26)");
ok((await hookCode(() => buyNow(creator, 0.1e9))) === 26, "the creator's SECOND buy, a moment after launch, is refused too: no block-zero devving");
// ⛔ wait on the CHAIN's clock (what the hook reads), not this machine's: a loaded validator's clock runs slow
const chainNow = async () => (await conn.getBlockTime(await conn.getSlot("confirmed"))) ?? Math.floor(Date.now() / 1000);
const waitChain = async (target, what) => { let t = await chainNow(); if (t < target) console.log(`   waiting ~${target - t}s (chain clock) for ${what}`); while (t < target) { await sleep(1000); t = await chainNow(); } };
await waitChain(onChainRules.launchTs + OPEN + 2, "buys to open");

console.log("\n-- open");
ok((await hookCode(() => buyNow(A, 0.8e9))) === "passed", "A buys 0.8 SOL once open");
{ const c = await hookCode(() => buyNow(B, 0.4e9)); ok(c === "passed", `B buys 0.4 SOL (${c})`); }
ok((await hookCode(() => buyNow(creator, 0.2e9))) === "passed", "the dev buys like anyone, after opening");
// block zero, part two: two buys in ONE slot: anti-bundle (1 buy per block) refuses the second with code 11
{
  const [t1, t2] = await Promise.all([buildSwapTx({ dbc, pool, owner: A.publicKey, buy: true, amountIn: 50_000_000n, minimumAmountOut: 1n }), buildSwapTx({ dbc, pool, owner: C.publicKey, buy: true, amountIn: 50_000_000n, minimumAmountOut: 1n })]);
  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  t1.recentBlockhash = blockhash; t2.recentBlockhash = blockhash; t1.sign(A); t2.sign(C);
  const [r1, r2] = await Promise.allSettled([conn.sendRawTransaction(t1.serialize(), { skipPreflight: true }), conn.sendRawTransaction(t2.serialize(), { skipPreflight: true })]);
  await sleep(3000);
  const st = await conn.getSignatureStatuses([r1.value, r2.value].filter(Boolean), { searchTransactionHistory: true });
  const landed = st.value.filter((s) => s && !s.err).length, failed = st.value.filter((s) => s && s.err).length;
  const sameSlot = st.value[0] && st.value[1] && st.value[0].slot === st.value[1].slot;
  ok(landed >= 1 && (!sameSlot || failed === 1), `two buys sent at once: ${landed} landed, ${failed} refused${sameSlot ? " (same slot: anti-bundle kept one)" : " (different slots)"}`);
}
// the curve IS pump.fun's: Meteora's price × supply vs pump.fun's cap formula at this raise
{
  const { getPriceFromSqrtPrice } = await import("@meteora-ag/dynamic-bonding-curve-sdk");
  const ps = await getPool(dbc, pool);
  const capSol = Number(getPriceFromSqrtPrice(ps.sqrtPrice, 6, 9)) * 1e9;
  const exp = P.capAt(Number(ps.quoteReserve.toString()) / 1e9);
  ok(Math.abs(capSol - exp) / exp < 0.03, `the window curve prices like pump.fun's curve: ${capSol.toFixed(2)} SOL cap vs pump.fun's ${exp.toFixed(2)} at this raise`);
}
const aHeld = await bal(MINT, A.publicKey), bHeld0 = await bal(MINT, B.publicKey);
ok((await hookCode(() => sellNow(B, bHeld0 / 2n))) === "passed", "B sells half");
const bHeld = await bal(MINT, B.publicKey), cHeld = await bal(MINT, creator.publicKey);
const poolMid = await getPool(dbc, pool);
const raised = BigInt(poolMid.quoteReserve.toString());
console.log(`   raised ${sol(raised)} SOL of ${SIZE}; A ${aHeld} B ${bHeld} dev ${cHeld}`);
ok(raised > 1.3e9 && raised < 1.8e9, "the curve holds the net buys (window not filled)");

console.log("\n-- deadline");
await waitChain(onChainRules.launchTs + CLOSE + 2, "the window to close");
ok((await hookCode(() => buyNow(C, 0.1e9))) === 25, "a buy after the deadline is refused: window closed (25)");
ok((await hookCode(() => sellNow(A, 1_000_000n))) === "passed", "holders can still sell after the deadline");
const aHeld2 = await bal(MINT, A.publicKey);

console.log("\n-- graduation by the graduator");
const g = new Graduator({ conn, db, platform, treasury: treasury.publicKey, hookProgram: HOOK, configs: {}, dataDir: DATA, burnWallet: null, log: (m) => console.log("   graduator:", m) });
g.setConfigs?.([{ sizeSol: SIZE, address: config, retired: false }]);
const platBefore = BigInt(await lam(platform.publicKey));
const quoteBefore = BigInt((await getPool(dbc, pool)).quoteReserve.toString());
for (let i = 0; i < 40 && getLaunch(db, MINT.toBase58()).status !== "done"; i++) { await g.tick(); await sleep(1500); }
const L = getLaunch(db, MINT.toBase58());
ok(L.status === "done", `graduation reached ${L.status}${L.error ? ` (error: ${L.error.slice(0, 200)})` : ""}`);
ok(BigInt(L.fronted ?? 0) > 0n && BigInt(L.front_before) === quoteBefore, `the platform fronted ${sol(L.fronted ?? 0)} SOL to fill the curve (raise before: ${sol(L.front_before)})`);
ok((await getPool(dbc, pool)).isMigrated, "the Meteora pool migrated");
const pumpMint = L.pump_mint && new PublicKey(L.pump_mint);
ok(!!pumpMint && !!(await conn.getAccountInfo(pumpMint, "confirmed")), `pump.fun coin exists: ${L.pump_mint}`);
if (!pumpMint) { console.log(`\n${checks} passed, ${fails} failed`); process.exit(1); }
const settled = JSON.parse(L.settle_json);
console.log("   settled:", settled);
const aPump = await bal(pumpMint, A.publicKey), bPump = await bal(pumpMint, B.publicKey), cPump = await bal(pumpMint, creator.publicKey), pPump = await bal(pumpMint, platform.publicKey);
ok(aPump > 0n && bPump > 0n && cPump > 0n, `holders received pump.fun coins: A ${aPump} B ${bPump} dev ${cPump}`);
const ratio = (p, w) => Number(p) / Number(w);
ok(Math.abs(ratio(aPump, aHeld2) - ratio(bPump, bHeld)) / ratio(aPump, aHeld2) < 0.02 && Math.abs(ratio(aPump, aHeld2) - ratio(cPump, cHeld)) / ratio(aPump, aHeld2) < 0.02, `pro-rata to window holdings (A ${ratio(aPump, aHeld2).toFixed(3)} B ${ratio(bPump, bHeld).toFixed(3)} dev ${ratio(cPump, cHeld).toFixed(3)} coins per token)`);
ok(pPump === 0n, "the platform keeps none of the pump.fun coin (its fronted window tokens were not in the snapshot)");
{ // holder rewards chosen at launch → the pump.fun coin's creator is the holder-rewards PDA (fees go to holders forever)
  const { decodeCurve } = await import("../hk/lib/pumpprice.mjs");
  const { PublicKey: PK } = await import("@solana/web3.js");
  const PUMP = new PK("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
  const curvePda = PK.findProgramAddressSync([Buffer.from("bonding-curve"), pumpMint.toBuffer()], PUMP)[0];
  const hrPda = PK.findProgramAddressSync([Buffer.from("holder-rewards"), pumpMint.toBuffer()], PUMP)[0];
  const info = await conn.getAccountInfo(curvePda, "confirmed");
  const creator = new PK(info.data.subarray(49, 81));
  ok(creator.equals(hrPda), `holder rewards: the pump.fun coin's creator is the holder-rewards PDA (${creator.toBase58().slice(0, 8)}…)`);
}
ok((await bal(MINT, platform.publicKey)) === 0n, "the platform's window tokens were burned");
const platAfter = BigInt(await lam(platform.publicKey));
const cost = platBefore - platAfter;
console.log(`   platform SOL: ${sol(platBefore)} -> ${sol(platAfter)} (cost ${sol(cost)} SOL for a ${sol(L.fronted)} SOL front; treasury got ${sol(await lam(treasury.publicKey))})`);
ok(cost < BigInt(L.fronted) / 20n, "the fronted SOL came back: the platform lost under 5% of it (fees + rent)");
const raise = BigInt(L.front_before);
const cap = await pumpMarketCap(conn, pumpMint.toBase58());
const expectedCap = P.capAt(Number(raise) / 1e9);
console.log(`   pump.fun coin cap ${cap?.marketCapSol?.toFixed(2)} SOL vs the window's cap at ${sol(raise)} SOL raised: ${expectedCap.toFixed(2)} SOL`);
ok(cap?.marketCapSol && Math.abs(cap.marketCapSol - expectedCap) / expectedCap < 0.12, "the coin opened at about the market cap the window ended at");
console.log(`\n${checks} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
