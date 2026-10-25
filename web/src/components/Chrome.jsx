import { useEffect, useRef, useState } from 'react';
import { Link, usePath } from '../lib/router.js';
import { useWallet } from '../lib/wallet.jsx';
import { api } from '../lib/api.js';
import { short, colorOf, lamportsToSol, ago } from '../lib/format.js';

export const Pill = () => (
  <svg viewBox="0 0 64 64" aria-hidden="true"><g transform="rotate(-45 32 32)"><rect x="10" y="22" width="44" height="20" rx="10" fill="#86efac" /><path d="M32 22h12a10 10 0 0 1 0 20H32z" fill="#fff" /></g></svg>
);
export const Crown = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8z" /></svg>;
const XIcon = () => <svg className="icon" viewBox="0 0 24 24"><path d="M18.9 2H22l-7.6 8.7L23.3 22h-7l-5.5-7.2L4.5 22H1.4l8.1-9.3L.8 2h7.2l5 6.6L18.9 2zm-1.2 18h1.9L7.4 3.9H5.3L17.7 20z" /></svg>;
const GhIcon = () => <svg className="icon" viewBox="0 0 24 24"><path d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.04 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.58.23 2.75.11 3.04.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.39-5.25 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" /></svg>;
/** The site's own X account, once there is one (set here; empty = no icon). */
const SOCIAL_X = 'https://x.com/pump_eco';
const GITHUB = 'https://github.com/pumpeco/pumpeco';

export function Header() {
  const w = useWallet();
  const path = usePath();
  const nav = (cls) => (
    <nav className={`navpills ${cls}`}>
      <Link href="/how" className={path === '/how' ? 'active' : ''}>[how it works]</Link>
      <Link href="/create" className={path === '/create' ? 'active' : ''}>[launch coin]</Link>
    </nav>
  );
  return (
    <header className="top-wrap">
      <div className="top">
        <Link href="/" className="logo"><img src="/icon-48.png" alt="" width="30" height="30" /><span>pump.eco</span></Link>
        {nav('')}
        <div className="top-right">
          {SOCIAL_X && <a className="iconbtn" href={SOCIAL_X} target="_blank" rel="noreferrer" aria-label="X"><XIcon /></a>}
          <a className="iconbtn" href={GITHUB} target="_blank" rel="noreferrer" aria-label="GitHub"><GhIcon /></a>
          {w.address ? (
            <span className="wallet-pill"><i className="dot" />{short(w.address)}<button className="x" onClick={w.disconnect}>[disconnect]</button></span>
          ) : (
            <button className="wallet-pill connect" onClick={() => w.connect().catch(() => {})}>[connect wallet]</button>
          )}
        </div>
      </div>
      {nav('mobile-nav')}
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
          const verb = t.side === 'create' ? 'created' : t.side === 'buy' ? 'bought' : 'sold';
          const rest = t.side === 'create' ? t.symbol : `${lamportsToSol(t.lamports).toFixed(3)} SOL of ${t.symbol}`;
          return (
            <Link key={t.sig} href={`/coin/${t.mint}`} className={`box${fresh ? ' shake' : ''}`}>
              <i className="avatar" style={{ background: colorOf(t.wallet) }} />{short(t.wallet, 3)} <span className={`v-${t.side}`}>{verb}</span> {rest}{t.image && <img src={t.image} alt="" />}
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
      <div className="modal" style={wide ? { maxWidth: 580 } : undefined} role="dialog">{children}</div>
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
  return (
    <footer className="footer">
      <div className="wrap">
        <div>
          <Link href="/" className="logo"><img src="/icon-48.png" alt="" width="30" height="30" /><span>pump.eco</span></Link>
          <p>Launch a coin that nobody can buy before anyone else. It trades on its own curve, then becomes a real pump.fun coin in every holder's wallet.</p>
          <p className="xs" style={{ color: 'var(--dim)' }}>Not affiliated with pump.fun.</p>
        </div>
        <div className="links"><h4>site</h4><Link href="/how">[how it works]</Link><Link href="/create">[launch coin]</Link></div>
        <div className="links"><h4>elsewhere</h4>
          {SOCIAL_X && <a href={SOCIAL_X} target="_blank" rel="noreferrer"><XIcon />pump_eco</a>}
          <a href={GITHUB} target="_blank" rel="noreferrer"><GhIcon />pumpeco</a>
        </div>
      </div>
    </footer>
  );
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
