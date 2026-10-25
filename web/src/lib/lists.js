// Filling a coin's allow/blocklist: the API builds the transactions (24 wallets each), the creator signs a batch in
// one wallet approval, the site relays them in order (the program only ever appends above the last listed wallet).
import { api } from './api.js';

// ⚠ one approval signs a batch against one blockhash, which expires after about a minute, and each transaction is confirmed
// before the next is sent: 4 transactions leave room for a slow chain
const BATCH = 96;

/**
 * Puts `wallets` on the coin's list and, with `seal`, seals it in the last transaction. `signTransactions` is the
 * wallet provider's batch signer. Returns the wallets that could not be added (they sort below the last listed one).
 */
export async function fillList({ mint, wallet, wallets, seal, signTransactions, onProgress = () => {} }) {
  const batches = [];
  for (let i = 0; i < wallets.length; i += BATCH) batches.push(wallets.slice(i, i + BATCH));
  if (!batches.length) batches.push([]);
  let done = 0, tooLate = [];
  for (let b = 0; b < batches.length; b++) {
    const last = b === batches.length - 1;
    const built = await api.listTxs({ mint, wallet, wallets: batches[b], seal: seal && last });
    tooLate = tooLate.concat(built.tooLate ?? []);
    if (!built.transactions.length) continue;
    onProgress(`approve ${built.transactions.length} list transaction${built.transactions.length === 1 ? '' : 's'} in your wallet`);
    const signed = await signTransactions(built.transactions);
    for (let i = 0; i < signed.length; i++) {
      onProgress(`filling the list: ${Math.min(wallets.length, done + (i + 1) * 24)} of ${wallets.length}`); // 24 wallets per transaction (hk/lib/rules.mjs LIST_ADD_MAX)
      await api.submitList(mint, signed[i]);
    }
    done += batches[b].length;
  }
  return { tooLate };
}
