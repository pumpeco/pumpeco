import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { Modal } from './Chrome.jsx';
import { short } from '../lib/format.js';

const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const liq = (n) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${n}`);
const SolIcon = () => <span className="pair-icon" style={{ background: 'linear-gradient(135deg,#9945ff,#14f195)' }} />;
const Icon = ({ src }) => (src ? <img className="pair-icon" src={src} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} /> : <span className="pair-icon" />);

/**
 * The pair picker, like Pumpfun's: SOL by default, or any of Pumpfun's custom pairs, searched by name or ticker, or by
 * pasting a token address (checked against Pumpfun's custom-pair list and its liquidity).
 */
export default function PairPicker({ value, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState([]);
  const [q, setQ] = useState('');
  const [found, setFound] = useState(null); // { ok, pair, why } for a pasted address
  const [checking, setChecking] = useState(false);

  useEffect(() => { api.pairs().then((d) => setList(d.pairs || [])).catch(() => {}); }, []);
  const query = q.trim();
  const isCa = B58.test(query);
  useEffect(() => {
    setFound(null);
    setChecking(false);
    if (!isCa) return;
    const inList = list.find((p) => p.mint === query);
    if (inList) { setFound({ ok: true, pair: inList }); return; }
    let alive = true;
    setChecking(true);
    api.pair(query).then((r) => { if (alive) setFound(r); }).catch((e) => { if (alive) setFound({ ok: false, why: e.message }); }).finally(() => { if (alive) setChecking(false); });
    return () => { alive = false; setChecking(false); };
  }, [query, isCa, list]);

  const shown = useMemo(() => {
    if (isCa) return [];
    const n = query.toLowerCase();
    return n ? list.filter((p) => p.symbol.toLowerCase().includes(n) || p.name.toLowerCase().includes(n)) : list;
  }, [list, query, isCa]);

  const pick = (p) => { onChange(p); setOpen(false); setQ(''); setFound(null); };

  return (
    <>
      <button type="button" className="pair-button" disabled={disabled} onClick={() => setOpen(true)}>
        {value ? <><Icon src={value.icon} /><span className="b">{value.symbol}</span><span className="muted xs">{short(value.mint)}</span></> : <><SolIcon /><span className="b">SOL</span></>}
        <span className="muted" style={{ marginLeft: 'auto' }}>change</span>
      </button>
      {open && (
        <Modal onClose={() => setOpen(false)}>
          <h2 style={{ textAlign: 'center' }}>select pair</h2>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="search by name or ticker, or paste a token address" />
          {isCa && (
            <div>
              {checking && <div className="muted sm">checking the token…</div>}
              {found?.ok && <button className="pair-row" onClick={() => pick(found.pair)}><Icon src={found.pair.icon} /><span><span className="b">{found.pair.symbol}</span> <span className="muted xs">{found.pair.name}</span></span><span className="muted xs" style={{ marginLeft: 'auto' }}>{found.pair.kind === 'usdc' ? 'stablecoin' : `${liq(found.pair.liquidity)} liquidity${found.pair.kind === 'pumpcoin' ? ', Pumpfun coin' : ''}`}</span></button>}
              {found && !found.ok && <div className="err">{found.why}</div>}
            </div>
          )}
          {!isCa && (
            <div className="pair-list">
              <button className="pair-row" onClick={() => pick(null)}><SolIcon /><span className="b">SOL</span><span className="muted xs" style={{ marginLeft: 'auto' }}>default</span></button>
              {shown.map((p) => (
                <button key={p.mint} className="pair-row" onClick={() => pick(p)}>
                  <Icon src={p.icon} /><span><span className="b">{p.symbol}</span> <span className="muted xs">{p.name}</span></span>
                  <span className="muted xs" style={{ marginLeft: 'auto' }}>{p.kind === 'usdc' ? 'stablecoin' : liq(p.liquidity)}</span>
                </button>
              ))}
              {!shown.length && <div className="muted sm" style={{ textAlign: 'center' }}>no pair matches "{query}". paste its address to check it.</div>}
            </div>
          )}
          <p className="muted xs" style={{ margin: 0 }}>your coin trades in SOL on its curve. at migration the Pumpfun coin is created paired with this token: the raise is swapped into it, or for a Pumpfun coin bought through its own pool. if the pair cannot be used at that moment, it migrates against SOL.</p>
        </Modal>
      )}
    </>
  );
}
