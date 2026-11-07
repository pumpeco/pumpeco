import '../api/env.mjs';
import { conn } from '../api/sol.mjs';
import { Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction, ComputeBudgetProgram } from '@solana/web3.js';
import * as ag from '../ag/pump.mjs';
const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', WSOL = 'So11111111111111111111111111111111111111112';
const user = new PublicKey('DvYs8qsHfp33qynTfNcbonAw93p6X46ht2QszhUxZvSs');
const global = await ag.loadGlobal(conn);
const q = await ag.resolveQuote(conn, BONK);
console.log('resolve', q.ok, q.kind, q.tokenProgram);
for (const maxAccounts of [12, 16, 20, 24]) {
  const quote = await (await fetch(`https://lite-api.jup.ag/swap/v1/quote?inputMint=${WSOL}&outputMint=${BONK}&amount=10000000&slippageBps=100&restrictIntermediateTokens=true&maxAccounts=${maxAccounts}`)).json();
  const si = await (await fetch('https://lite-api.jup.ag/swap/v1/swap-instructions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ quoteResponse: quote, userPublicKey: user.toBase58(), wrapAndUnwrapSol: true }) })).json();
  if (si.error) { console.log(maxAccounts, si.error); continue; }
  const ix = (x) => new TransactionInstruction({ programId: new PublicKey(x.programId), keys: x.accounts.map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })), data: Buffer.from(x.data, 'base64') });
  const jupIxs = [...(si.setupInstructions || []).map(ix), ix(si.swapInstruction), ...(si.cleanupInstruction ? [ix(si.cleanupInstruction)] : [])];
  const mint = Keypair.generate().publicKey;
  const ours = await ag.firstBuyIxs(conn, global, { mint, user, q, currency: 'quote', amountIn: 1000n, minOut: 1n });
  const alts = await Promise.all((si.addressLookupTableAddresses || []).map(async (a) => (await conn.getAddressLookupTable(new PublicKey(a))).value));
  const msg = new TransactionMessage({ payerKey: user, recentBlockhash: '11111111111111111111111111111111', instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 1 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }), ...jupIxs, ...ours] }).compileToV0Message(alts);
  const tx = new VersionedTransaction(msg);
  console.log(`maxAccounts ${maxAccounts}: route ${quote.routePlan?.map(r=>r.swapInfo.label).join('>')} size ${tx.serialize().length} B (jup only ${new VersionedTransaction(new TransactionMessage({ payerKey: user, recentBlockhash: '11111111111111111111111111111111', instructions: jupIxs }).compileToV0Message(alts)).serialize().length})`);
}
process.exit(0);
