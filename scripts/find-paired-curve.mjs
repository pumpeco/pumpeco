/** Live pump.fun coins on their curve paired with `pair` (Helius getProgramAccountsV2). node scripts/find-paired-curve.mjs <pairMint> */
import '../api/env.mjs';
import { conn } from '../api/sol.mjs';
const pair = process.argv[2];
let cursor = null, found = [];
for (let page = 0; page < 30 && found.length < 5; page++) {
  const r = await conn._rpcRequest('getProgramAccountsV2', ['6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', { encoding: 'base64', dataSlice: { offset: 0, length: 133 }, limit: 1000, ...(cursor ? { paginationKey: cursor } : {}),
    filters: [{ memcmp: { offset: 83, bytes: pair } }, { memcmp: { offset: 48, bytes: '1' } }, { memcmp: { offset: 81, bytes: '1' } }] }]);
  if (r.error) { console.log('rpc error', JSON.stringify(r.error).slice(0, 200)); break; }
  const v = r.result;
  for (const a of v.accounts || []) { const d = Buffer.from(a.account.data[0], 'base64'); const realQ = d.readBigUInt64LE(32); if (realQ > 0n) found.push({ curve: a.pubkey, realQ }); }
  cursor = v.paginationKey; if (!cursor) break;
}
found.sort((a, b) => Number(b.realQ - a.realQ));
console.log(pair, found.slice(0, 5).map((x) => `${x.curve} realQ=${x.realQ}`).join('\n'));
process.exit(0);
