import { Link } from '../lib/router.js';
import { usdK, ago, shortName, colorOf } from '../lib/format.js';

export default function CoinCard({ c, flash = false, className = '' }) {
  return (
    <Link href={`/coin/${c.mint}`} className={`card${flash ? ' flash' : ''} ${className}`}>
      <img src={c.image} alt="" loading="lazy" />
      <div className="body">
        <div className="muted">created by <i className="avatar" style={{ background: colorOf(c.creator) }} /> <span className="blue">{shortName(c.creator)}</span> {ago(c.createdAt)}{c.origin === 'official' && <span className="yellow b"> · official</span>}</div>
        <div className="green">market cap: {usdK(c.capUsd)}{c.kind === 'window' ? <span className="yellow"> {c.window?.phase === 'graduated' ? 'on pump.fun' : c.window?.phase === 'opening' ? 'opens soon' : c.window?.phase === 'trading' ? (c.window.closesAt ? `window ${ago(c.window.closesAt * 1000).replace(' ago', '')}` : `${Math.round((c.window.progress ?? 0) * 100)}% to pump.fun`) : 'migrating'}</span> : c.complete && <span className="yellow"> graduated</span>}</div>
        <div className="muted">replies: {c.replies}</div>
        <div className="desc"><span className="b" style={{ color: '#fff' }}>{c.name} ({c.symbol})</span>{c.description ? `: ${c.description}` : ''}</div>
      </div>
    </Link>
  );
}
