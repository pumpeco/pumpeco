/**
 * Solana wallet connection through Wallet Standard (Phantom, Solflare, Backpack … announce themselves), never a
 * `window.solana` global, which with two extensions installed is whichever loaded last.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { getWallets } from '@wallet-standard/app';
import bs58 from 'bs58';

const Ctx = createContext(null);
export const useWallet = () => useContext(Ctx);
const usable = (w) => Boolean(w.features['standard:connect'] && w.features['solana:signTransaction'] && (w.chains || []).some((c) => c.startsWith('solana:')));
const LAST = 'oldpump:last-wallet';
const store = { get: () => { try { return localStorage.getItem(LAST); } catch { return null; } }, set: (v) => { try { v ? localStorage.setItem(LAST, v) : localStorage.removeItem(LAST); } catch {} } };
export const cancelled = (e) => e?.code === 4001 || /reject|cancel|denied|closed/i.test(e?.message || '');

export function WalletProvider({ children }) {
  const [providers, setProviders] = useState([]);
  const [active, setActive] = useState(null);
  const [account, setAccount] = useState(null);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const pending = useRef([]); // every caller waiting on the picker (a trade AND the header button can both be waiting)
  const address = account?.address || null;

  useEffect(() => {
    const reg = getWallets();
    const sync = () => setProviders(reg.get().filter(usable));
    sync();
    const offs = [reg.on('register', sync), reg.on('unregister', sync)];
    return () => { offs.forEach((off) => off()); };
  }, []);

  useEffect(() => {
    if (active) return;
    const name = store.get();
    const w = name && providers.find((x) => x.name === name);
    if (!w) return;
    w.features['standard:connect'].connect({ silent: true }).then(({ accounts }) => {
      if (accounts?.[0]) { setActive(w); setAccount(accounts[0]); }
    }).catch(() => {});
  }, [providers, active]);

  useEffect(() => {
    const ev = active?.features['standard:events'];
    if (!ev) return;
    return ev.on('change', ({ accounts }) => { if (accounts) setAccount(accounts[0] || null); });
  }, [active]);

  const connectWith = useCallback(async (w) => {
    setError(null);
    setBusy(true);
    try {
      const { accounts } = await w.features['standard:connect'].connect();
      const acct = accounts?.[0];
      if (!acct) throw new Error('The wallet returned no account.');
      setActive(w);
      setAccount(acct);
      store.set(w.name);
      setPicker(false);
      pending.current.forEach((x) => x.resolve({ w, acct }));
      pending.current = [];
      return { w, acct };
    } catch (e) {
      setError(cancelled(e) ? 'Connection was cancelled in the wallet.' : e.message);
      pending.current.forEach((x) => x.reject(e));
      pending.current = [];
      throw e;
    } finally {
      setBusy(false);
    }
  }, []);

  const connect = useCallback(() => {
    if (active && account) return Promise.resolve({ w: active, acct: account });
    setPicker(true);
    return new Promise((resolve, reject) => { pending.current.push({ resolve, reject }); });
  }, [active, account]);

  /** Signs ONE base64 transaction with the connected wallet; returns it signed, base64. */
  const signTransaction = useCallback(async (b64) => {
    const { w, acct } = await connect();
    const f = w.features['solana:signTransaction'];
    if (!f) throw new Error('This wallet cannot sign transactions here. Try Phantom, Solflare or Backpack.');
    const [out] = await f.signTransaction({ account: acct, transaction: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), chain: 'solana:mainnet' });
    return btoa(String.fromCharCode(...out.signedTransaction));
  }, [connect]);

  /** Signs a text message; returns the base58 signature. */
  const signMessage = useCallback(async (text) => {
    const { w, acct } = await connect();
    const f = w.features['solana:signMessage'];
    if (!f) throw new Error('This wallet cannot sign messages here.');
    const [out] = await f.signMessage({ account: acct, message: new TextEncoder().encode(text) });
    return bs58.encode(out.signature);
  }, [connect]);

  const disconnect = useCallback(async () => {
    setAccount(null);
    setActive(null);
    store.set(null);
    try { await active?.features['standard:disconnect']?.disconnect(); } catch {}
  }, [active]);

  const closePicker = useCallback(() => {
    setPicker(false);
    pending.current.forEach((x) => x.reject(Object.assign(new Error('closed'), { code: 4001 })));
    pending.current = [];
  }, []);

  const value = useMemo(() => ({ providers, address, busy, error, picker, connect, connectWith, disconnect, closePicker, setError, signTransaction, signMessage }),
    [providers, address, busy, error, picker, connect, connectWith, disconnect, closePicker, signTransaction, signMessage]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
