import { useEffect, useRef, useState } from 'react';
import { Link } from '../lib/router.js';
import { useWallet } from '../lib/wallet.jsx';
import { api } from '../lib/api.js';
import { short, colorOf, lamportsToSol, ago } from '../lib/format.js';

export const Pill = () => (
  <svg viewBox="0 0 64 64" aria-hidden="true"><g transform="rotate(-45 32 32)"><rect x="10" y="22" width="44" height="20" rx="10" fill="#86efac" /><path d="M32 22h12a10 10 0 0 1 0 20H32z" fill="#fff" /></g></svg>
);
export const Crown = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8z" /></svg>;
const XIcon = () => <svg className="icon" viewBox="0 0 24 24"><path d="M18.9 2H22l-7.6 8.7L23.3 22h-7l-5.5-7.2L4.5 22H1.4l8.1-9.3L.8 2h7.2l5 6.6L18.9 2zm-1.2 18h1.9L7.4 3.9H5.3L17.7 20z" /></svg>;
/** The site's own X account, once there is one (set here; empty = no icon). */
const SOCIAL_X = 'https://x.com/pump_eco';

export function Header() {
  const w = useWallet();
  return (
    <header className="header">
      <div className="wrap">
        <Link href="/" className="logo"><img src="/icon-48.png" alt="" width="24" height="24" />pump.eco</Link>
        <nav className="nav">
          <Link href="/how" className="bracket">[how it works]</Link>
          <Link href="/create" className="bracket">[launch coin]</Link>
          {SOCIAL_X && <a href={SOCIAL_X} target="_blank" rel="noreferrer" aria-label="X"><XIcon /></a>}
        </nav>
        <div className="right">
          {w.address ? (
            <>
              <span className="row sm"><i className="avatar" style={{ background: colorOf(w.address) }} />{short(w.address)}</span>
              <button className="bracket" onClick={w.disconnect}>[disconnect]</button>
            </>
          ) : (
            <button className="bracket green" onClick={() => w.connect().catch(() => {})}>[connect wallet]</button>
          )}
        </div>
      </div>
    </header>
  );
}

/** The row of recent events at the top: buys, sells and new coins launched here. */
export function Ticker() {
  const [items, setItems] = useState([]);
  const seen = useRef(new Set());
  useEffect(() => {
    let alive = true;
    const load = () => api.ticker().then((t) => { if (alive) setItems(t); }).catch(() => {});
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, 8000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  if (!items.length) return null;
  return (
    <div className="wrap">
      <div className="ticker">
        {items.map((t) => {
          const fresh = !seen.current.has(t.sig);
          seen.current.add(t.sig);
          const text = t.side === 'create' ? `created ${t.symbol}` : `${t.side === 'buy' ? 'bought' : 'sold'} ${lamportsToSol(t.lamports).toFixed(3)} SOL of ${t.symbol}`;
          return (
            <Link key={t.sig} href={`/coin/${t.mint}`} className={`box${fresh ? ' shake' : ''}`} style={{ background: colorOf(t.wallet) }}>
              <i className="avatar" style={{ background: colorOf(t.wallet + 'x') }} />{short(t.wallet, 3)} {text}{t.image && <img src={t.image} alt="" />}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export function Modal({ onClose, children, wide = false }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={wide ? { maxWidth: 560 } : undefined} role="dialog">{children}</div>
    </div>
  );
}

export function WalletPicker() {
  const w = useWallet();
  if (!w.picker) return null;
  return (
    <Modal onClose={w.closePicker}>
      <h2 style={{ textAlign: 'center' }}>connect your wallet</h2>
      {w.providers.length === 0 && <p className="muted">No Solana wallet was found in this browser. Install Phantom, Solflare or Backpack and reload.</p>}
      {w.providers.map((p) => (
        <button key={p.name} className="walletrow" disabled={w.busy} onClick={() => w.connectWith(p).catch(() => {})}>
          {p.icon && <img src={p.icon} alt="" />}<span className="b">{p.name}</span>
        </button>
      ))}
      {w.error && <div className="err">{w.error}</div>}
    </Modal>
  );
}

export function Footer() {
  return null;
}

/** A short status line that disappears. */
export function Toast({ text }) {
  if (!text) return null;
  return <div className="toast">{text}</div>;
}

export function Spinner({ light = false }) {
  return <span className={`spin${light ? ' light' : ''}`} />;
}
export { ago };
