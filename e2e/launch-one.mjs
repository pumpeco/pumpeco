// Launches one window coin through the running site API (port 5482) with a fresh funded keypair; prints the mint. For browser checks.
import { Connection, Keypair, LAMPORTS_PER_SOL, VersionedTransaction } from '@solana/web3.js';
const conn = new Connection('http://127.0.0.1:8981', 'confirmed');
const creator = Keypair.generate();
await conn.confirmTransaction(await conn.requestAirdrop(creator.publicKey, 20 * LAMPORTS_PER_SOL), 'confirmed');
const api = async (p, body) => { const r = await fetch(`http://127.0.0.1:5482${p}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}); const j = await r.json(); if (!r.ok) throw new Error(j.error); return j; };
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const cfg = await api('/api/config');
const p = await api('/api/launch/prepare', { wallet: creator.publicKey.toBase58(), name: process.argv[2] || 'Window Demo', symbol: process.argv[3] || 'WDEMO', description: 'a coin on its own curve first; migrates to pump.fun when the window ends', imageData: `data:image/png;base64,${PNG}`, window: { openSecs: Number(process.argv[4] || 120), windowMinutes: Number(process.argv[5] || 60), sizeSol: cfg.window.sizes[0].sizeSol, maxWalletPct: 5 } });
const tx = VersionedTransaction.deserialize(Buffer.from(p.transaction, 'base64')); tx.sign([creator]);
const s = await api('/api/launch/submit', { mint: p.mint, transaction: Buffer.from(tx.serialize()).toString('base64') });
console.log(s.status, p.mint);
