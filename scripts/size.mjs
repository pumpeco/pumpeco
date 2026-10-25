import { Keypair } from '@solana/web3.js';
import { buildLaunchTx, validate } from '../api/launch.mjs';
const W = 'Pi2E87kTsCF7KkUGwdvQSxARzm3dzwU2zTfCxW3Laac';
const uri = 'https://ipfs.io/ipfs/bafkreibtxkuu6ui7lqabucv75qfrvwuc2celbbgmcseeqaqwfmvvz27ni4';
for (const [name, symbol, buy] of [['Retro Test Coin With Long Name', 'RETROTEST', 0.03], ['Retro', 'RET', 0.03], ['Retro', 'RET', 0]]) {
  const form = validate({ name, symbol, devBuySol: buy });
  try {
    const { tx } = await buildLaunchTx({ mint: Keypair.generate(), launcher: W, form, uri });
    console.log(name, symbol, buy, '→', tx.serialize().length, 'bytes', tx.message.staticAccountKeys.length, 'accounts');
  } catch (e) { console.log(name, symbol, buy, '→', e.message); }
}
