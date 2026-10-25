// Upgrades the hook on MAINNET to hk/fixtures/oldpump_hook.so (ported from pump.eco). The upgrade authority is the COLD wallet,
// which lives in a browser wallet, so the cold key never touches this Mac's disk:
//
//   1. node scripts/upgrade-hook-mainnet.mjs buffer     the deployer key writes the new program into a
//      (DEPLOYER=hk/keys/deployer.json, ≈1.3 SOL) buffer, hands the buffer to the cold wallet, and
//                                                       grows the program account to fit (mainnet still
//                                                       takes the authority-free ExtendProgram)
//   2. node scripts/upgrade-hook-mainnet.mjs serve      a page on http://localhost:5399 for the cold
//                                                       wallet to sign the upgrade (one transaction),
//                                                       simulated on mainnet before it is offered
//   3. the page sends them and checks the deployed bytes against the build
//
// The buffer's rent comes back to the cold wallet when the upgrade lands. Nothing here runs on its own:
// each mainnet step is typed by hand.
import { Connection, Keypair, PublicKey, Transaction, ComputeBudgetProgram } from "@solana/web3.js";
import { extendUncheckedIx, upgradeIx, programDataOf, extendNeeded, sameProgram } from "../hk/lib/upgrade.mjs";
import { sendAndConfirmTransaction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import http from "node:http";

const ROOT = new URL("..", import.meta.url).pathname;
const RPC = process.env.MAINNET_RPC || "https://api.mainnet-beta.solana.com";
const CLI = `${process.env.HOME}/.local/share/solana/install/releases/4.0.0/solana-release/bin/solana`;
const PROGRAM = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${ROOT}hk/keys/hook-keypair.json`, "utf8")))).publicKey;
const COLD = new PublicKey("himYSjpEF2wmuMEMK56RZf9hM77YxDGkitCor9EJPBP");
const SO = `${ROOT}hk/fixtures/oldpump_hook.so`;
const STATE = `${ROOT}data/upgrade-hook.json`;
/** Extra room in the program account beyond the new build, so a small fix later needs no extend. */
const MARGIN = 8 * 1024;
const conn = new Connection(RPC, "confirmed");
const so = readFileSync(SO);
const sha = createHash("sha256").update(so).digest("hex");
const programData = programDataOf(PROGRAM);
const cmd = process.argv[2];

const upgrade = (buffer) => upgradeIx({ program: PROGRAM, buffer, authority: COLD });

async function programDataLen() { return (await conn.getAccountInfo(programData, "confirmed")).data.length; }
/** programdata = 45-byte header + the program; the extend must make room for the new build. */
async function extendBy() { return extendNeeded(await programDataLen(), so.length, MARGIN); }
async function deployedMatches() { return sameProgram((await conn.getAccountInfo(programData, "confirmed")).data, so); }

if (cmd === "buffer") {
  const DEPLOYER = process.env.DEPLOYER || `${ROOT}hk/keys/deployer.json`;
  console.log(`program ${PROGRAM.toBase58()}\nbinary  ${so.length} bytes  sha256 ${sha.slice(0, 16)}…`);
  console.log(`deployer balance: ${execFileSync(CLI, ["balance", "-u", RPC, "-k", DEPLOYER]).toString().trim()} (needs ≈${((so.length + 37) * 6960 / 1e9 + (45 + so.length + MARGIN - (await programDataLen())) * 6960 / 1e9 + 0.03).toFixed(2)} SOL: the buffer, returned to the cold wallet by the upgrade, and the program account's extra rent, kept by the program)`);
  if (process.env.GO !== "1") { console.log("\nset GO=1 to write the buffer (costs SOL on mainnet)"); process.exit(0); }
  const out = execFileSync(CLI, ["program", "write-buffer", "-u", RPC, "-k", DEPLOYER, "--buffer-authority", DEPLOYER, "--with-compute-unit-price", "50000", "--max-sign-attempts", "100", SO]).toString();
  const buffer = /Buffer: (\w+)/.exec(out)?.[1];
  if (!buffer) { console.error(out); process.exit(1); }
  const b = (await conn.getAccountInfo(new PublicKey(buffer), "confirmed")).data.subarray(37);
  if (!b.subarray(0, so.length).equals(so)) { console.error("the buffer does not hold the build: stop"); process.exit(1); }
  execFileSync(CLI, ["program", "set-buffer-authority", "-u", RPC, "-k", DEPLOYER, buffer, "--new-buffer-authority", COLD.toBase58()], { stdio: "inherit" });
  writeFileSync(STATE, JSON.stringify({ buffer, sha, at: new Date().toISOString() }, null, 2));
  const extra = await extendBy();
  if (extra > 0) {
    const deployer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(DEPLOYER, "utf8"))));
    const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20_000 }),
      extendUncheckedIx({ program: PROGRAM, payer: deployer.publicKey, bytes: extra })), [deployer], { commitment: "confirmed" });
    console.log(`program account grown by ${extra.toLocaleString()} bytes (${sig})`);
  }
  console.log(`\nbuffer ${buffer} holds the build and belongs to the cold wallet. Next: node scripts/upgrade-hook-mainnet.mjs serve`);
} else if (cmd === "serve") {
  if (!existsSync(STATE)) { console.error("no buffer yet: run `buffer` first"); process.exit(1); }
  const st = JSON.parse(readFileSync(STATE, "utf8"));
  if (st.sha !== sha) { console.error("hk/fixtures/oldpump_hook.so changed since the buffer was written: write a new buffer"); process.exit(1); }
  const buffer = new PublicKey(st.buffer);
  let built = null; // the exact messages handed to the page: only these come back to be sent
  const page = readFileSync(new URL("./upgrade-hook-page.html", import.meta.url), "utf8")
    .replaceAll("%COLD%", COLD.toBase58()).replaceAll("%PROGRAM%", PROGRAM.toBase58()).replaceAll("%SHA%", sha.slice(0, 16));
  const json = (res, code, o) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
  http.createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/") { res.writeHead(200, { "content-type": "text/html" }); return res.end(page); }
      if (req.method === "GET" && req.url === "/txs") {
        if (await deployedMatches()) return json(res, 200, { done: true });
        if ((await extendBy()) > 0) return json(res, 400, { error: "the program account is still too small: run the buffer step again (it extends it)" });
        const { blockhash } = await conn.getLatestBlockhash("confirmed");
        const ixs = [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20_000 }), ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), upgrade(buffer)];
        // ⛔ never offer a transaction that would fail: simulate it as the cold wallet first
        const sim = await conn.simulateTransaction(new VersionedTransaction(new TransactionMessage({ payerKey: COLD, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message()), { sigVerify: false });
        if (sim.value.err) return json(res, 400, { error: `the upgrade would fail on mainnet: ${JSON.stringify(sim.value.err)} ${(sim.value.logs ?? []).slice(-3).join(" ")}` });
        const txs = [new Transaction({ feePayer: COLD, recentBlockhash: blockhash }).add(...ixs)];
        built = txs.map((t) => t.serializeMessage().toString("base64"));
        return json(res, 200, { extend: 0, txs: txs.map((t) => t.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64")) });
      }
      if (req.method === "POST" && req.url === "/send") {
        let body = ""; for await (const c of req) body += c;
        const signed = JSON.parse(body).txs.map((b) => Transaction.from(Buffer.from(b, "base64")));
        if (!built || signed.length !== built.length || signed.some((t, i) => t.serializeMessage().toString("base64") !== built[i] || !t.verifySignatures()))
          return json(res, 400, { error: "these are not the transactions this page built, or they are not signed by the cold wallet" });
        const sigs = [];
        for (let i = 0; i < signed.length; i++) {
          const sig = await conn.sendRawTransaction(signed[i].serialize(), { preflightCommitment: "confirmed" });
          const r = await conn.confirmTransaction(sig, "confirmed");
          if (r.value.err) return json(res, 400, { error: `transaction ${i + 1} failed: ${JSON.stringify(r.value.err)}`, sigs: [...sigs, sig] });
          sigs.push(sig);
          // a program extended in a block cannot be upgraded in the same block
          if (i < signed.length - 1) { const s0 = await conn.getSlot("confirmed"); while ((await conn.getSlot("confirmed")) < s0 + 2) await new Promise((r2) => setTimeout(r2, 400)); }
        }
        built = null;
        const ok = await deployedMatches();
        return json(res, 200, { sigs, matches: ok });
      }
      json(res, 404, { error: "not found" });
    } catch (e) { json(res, 500, { error: String(e.message).slice(0, 300) }); }
  }).listen(5399, "127.0.0.1", () => console.log("open http://localhost:5399 and connect the COLD wallet"));
} else if (cmd === "check") {
  console.log(`deployed bytes ${await deployedMatches() ? "MATCH" : "do NOT match"} the build (sha256 ${sha.slice(0, 16)}…); program account ${await programDataLen()} bytes, needs ${45 + so.length}`);
} else {
  console.log("usage: node scripts/upgrade-hook-mainnet.mjs buffer|serve|check");
}
