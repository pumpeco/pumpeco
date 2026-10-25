/** Every mainnet account the site's instructions touch, as validator clone flags. Usage: node e2e/clone-list.mjs > e2e/clones.txt */
import { Keypair, PublicKey } from '@solana/web3.js';
import * as sol from '../api/sol.mjs';
import { createV2Ix, buyExactSolInIx, sellIx, loadGlobal } from '../lib/pump.mjs';
const mint = Keypair.generate().publicKey, user = Keypair.generate().publicKey;
const global = await loadGlobal(sol.conn);
const ixs = [await createV2Ix(sol.conn, { mint, user, name: 'x', symbol: 'X', uri: 'https://x', creator: user }), await buyExactSolInIx(sol.conn, global, { mint, user, creator: user, lamports: 1n }), await sellIx(sol.conn, global, { mint, user, creator: user, amount: 1n })];
const keys = [...new Set(ixs.flatMap((ix) => [ix.programId, ...ix.keys.map((k) => k.pubkey)]).map((k) => k.toBase58()))];
const BUILTIN = new Set(['11111111111111111111111111111111', 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', 'SysvarRent111111111111111111111111111111111', 'ComputeBudget111111111111111111111111111111']);
const out = [];
const infos = await sol.conn.getMultipleAccountsInfo(keys.map((k) => new PublicKey(k)));
keys.forEach((k, j) => { const a = infos[j]; if (!a || BUILTIN.has(k)) return; if (a.executable) out.push(`--clone-upgradeable-program ${k}`); else if (!a.owner.equals(new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111'))) out.push(`--clone ${k}`); });
// the mayhem program create_v2 reaches through CPI, and wrapped SOL
out.push('--clone-upgradeable-program MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e', '--clone So11111111111111111111111111111111111111112');
console.log([...new Set(out)].join('\n'));
process.exit(0);
