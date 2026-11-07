/** The coin mint of a pump.fun bonding curve (its own Token-2022 account). node scripts/curve-mint.mjs <curve> */
import '../api/env.mjs';
import { PublicKey } from '@solana/web3.js';
import { conn } from '../api/sol.mjs';
import { TOKEN_2022, bondingCurveAddress } from '../lib/pump.mjs';
for (const c of process.argv.slice(2)) {
  const r = await conn.getParsedTokenAccountsByOwner(new PublicKey(c), { programId: TOKEN_2022 });
  const m = r.value.map((a) => a.account.data.parsed.info.mint).find((x) => bondingCurveAddress(new PublicKey(x)).toBase58() === c);
  console.log(c, '→', m);
}
process.exit(0);
