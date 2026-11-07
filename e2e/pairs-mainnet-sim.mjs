/**
 * Custom pairs against MAINNET by SIMULATION ONLY: the real launch prepare (create_v2 against each pair, simulated by the
 * site before any wallet would sign) for a listed pair, USDC and pump coin pairs. Nothing is ever sent.
 * Usage: SIM_WALLET=<a wallet holding >= 0.03 SOL> node e2e/pairs-mainnet-sim.mjs [pairMint ...]
 */
const DB = `/tmp/oldpump-pairsim-${process.pid}.db`;
Object.assign(process.env, { DB_PATH: DB, DATA_DIR: `/tmp/oldpump-pairsim-data-${process.pid}`, VANITY_REQUIRED: '0', LAUNCH_OPEN: '1', PUBLIC_URL: 'https://pump.family', PINATA_JWT: '' });
const launch = await import('../api/launch.mjs');
const wallet = process.env.SIM_WALLET;
const img = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAAJJRU5ErkJggg==';
const pairsToTry = process.argv.slice(2);
let fails = 0;
for (const pair of pairsToTry) {
  try {
    const p = await launch.prepare({ wallet, name: 'Sim Pair', symbol: `S${Math.random().toString(36).slice(2, 7).toUpperCase()}`, imageData: img, pair });
    const bytes = Buffer.from(p.transaction, 'base64').length;
    console.log(`PASS launch paired with ${pair}: simulated OK on mainnet, ${bytes} B`);
  } catch (e) { fails++; console.log(`FAIL launch paired with ${pair}: ${e.message.slice(0, 300)}`); }
}
process.exit(fails ? 1 : 0);
