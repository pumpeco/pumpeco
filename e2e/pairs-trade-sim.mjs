/**
 * Custom-pair TRADES against MAINNET by SIMULATION ONLY (trade.prepare simulates before returning; nothing is sent).
 * Usage: SIM_WALLET=<wallet with SOL> node e2e/pairs-trade-sim.mjs buy <coinMint> [...]
 *        node e2e/pairs-trade-sim.mjs sell <coinMint>   (uses the coin's largest non-curve holder as the simulated seller)
 */
import { PublicKey } from '@solana/web3.js';
Object.assign(process.env, { DB_PATH: `/tmp/oldpump-pairtrade-${process.pid}.db`, DATA_DIR: `/tmp/oldpump-pairtrade-data-${process.pid}` });
const trade = await import('../api/trade.mjs');
const sol = await import('../api/sol.mjs');
const pump = await import('../lib/pump.mjs');
const [side, ...mints] = process.argv.slice(2);
let fails = 0;
for (const mint of mints) {
  try {
    let wallet = process.env.SIM_WALLET;
    if (side === 'sell') {
      const curveAta = pump.ata(pump.bondingCurveAddress(new PublicKey(mint)), new PublicKey(mint), pump.TOKEN_2022).toBase58();
      const top = (await sol.conn.getTokenLargestAccounts(new PublicKey(mint))).value.filter((a) => a.address.toBase58() !== curveAta && Number(a.amount) > 0);
      for (const t of top) { const info = await sol.conn.getParsedAccountInfo(t.address); const owner = info.value?.data?.parsed?.info?.owner; if (owner && PublicKey.isOnCurve(new PublicKey(owner).toBytes()) && (await sol.conn.getBalance(new PublicKey(owner))) > 3_000_000) { wallet = owner; break; } }
    }
    const r = await trade.prepare({ wallet, mint, side, amount: side === 'buy' ? 0.01 : undefined, pct: side === 'sell' ? 50 : undefined, slippageBps: 500 });
    const n = Buffer.from(r.transaction, 'base64').length;
    console.log(`PASS ${side} ${mint}: simulated OK, ${n} B, ${side === 'buy' ? `${(Number(r.quote.tokenUnits) / 1e6).toFixed(0)} coins (min ${(Number(r.quote.minTokenUnits) / 1e6).toFixed(0)})` : `${(Number(r.quote.lamports) / 1e9).toFixed(6)} SOL (min ${(Number(r.quote.minLamports) / 1e9).toFixed(6)})`}`);
  } catch (e) { fails++; console.log(`FAIL ${side} ${mint}: ${e.message.slice(0, 300)}`); }
}
process.exit(fails ? 1 : 0);
