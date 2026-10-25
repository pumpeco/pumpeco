import { PublicKey } from '@solana/web3.js';
import * as sol from '../api/sol.mjs';
import { coinState } from '../lib/pump.mjs';
const mint = new PublicKey(process.argv[2]);
const st = await coinState(sol.conn, mint);
console.log('complete', st.complete, 'capSol', st.capSol?.toFixed(2), 'progress', st.progress?.toFixed(3));
const r = await sol.conn.getTokenLargestAccounts(mint);
const infos = await sol.conn.getMultipleAccountsInfo(r.value.slice(0, 8).map((a) => a.address));
for (let i = 0; i < infos.length; i++) {
  const owner = new PublicKey(infos[i].data.subarray(32, 64));
  const bal = await sol.conn.getBalance(owner);
  console.log(owner.toBase58(), (Number(r.value[i].amount) / 1e6).toFixed(0), 'tokens', (bal / 1e9).toFixed(3), 'SOL');
}
