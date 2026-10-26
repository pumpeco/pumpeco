import { useEffect, useRef, useState } from 'react';
import { Link, navigate } from '../lib/router.js';
import { api } from '../lib/api.js';
import { useWallet, cancelled } from '../lib/wallet.jsx';
import { Modal, Spinner } from '../components/Chrome.jsx';
import PairPicker from '../components/PairPicker.jsx';
import { tokens } from '../lib/format.js';
import RulesPicker, { RulesLines, RuleSettings, RULE_COLOR } from '../components/Rules.jsx';
import { DEFAULT_FORM, toRules, describeRules, parseWallets, CATALOG } from '../lib/rulesText.js';
import { fillList } from '../lib/lists.js';

const LOCK_LABEL = { '24h': '24 hours', '3d': '3 days', '7d': '7 days' };
const readFile = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });

export default function Create({ cfg }) {
  const w = useWallet();
  // the gate: open for everyone, or for this wallet alone (the operator's test launch while launching is closed)
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    if (cfg.launchOpen !== false || !w.address) { setAllowed(false); return; }
    let alive = true;
    api.configFor(w.address).then((c) => { if (alive) setAllowed(c.launchOpen === true); }).catch(() => {});
    return () => { alive = false; };
  }, [cfg.launchOpen, w.address]);
  const open = cfg.launchOpen !== false || allowed;
  const [form, setForm] = useState({ name: '', symbol: '', description: '', twitter: '', telegram: '', website: '' });
  const [imageData, setImageData] = useState(null);
  const [modal, setModal] = useState(false);
  const [devBuy, setDevBuy] = useState('');
  const [openSecs, setOpenSecs] = useState(5);
  const [windowMinutes, setWindowMinutes] = useState(60);
  const [sizeSol, setSizeSol] = useState(null);
  const [maxWalletPct, setMaxWalletPct] = useState(0);
  const [rf, setRf] = useState(DEFAULT_FORM); // the hook rules picked (components/Rules.jsx)
  const [live, setLive] = useState(null);    // the coin's mint once it is live but its list is unfinished
  const [rewards, setRewards] = useState('creator');
  const lockOptions = cfg.tickerLocks?.options || [{ id: '24h' }, { id: '3d' }, { id: '7d' }];
  const [tickerLock, setTickerLock] = useState(cfg.tickerLocks?.default || '24h');
  const [pair, setPair] = useState(null); // null = SOL, else { mint, symbol, icon, ... }
  const [pairFee, setPairFee] = useState(0);
  const windows = cfg.window?.ready ? cfg.window : null;
  const sizes = windows?.sizes?.filter((x) => x.available) || [];
  const size = sizeSol ?? sizes.find((x) => x.recommended)?.sizeSol ?? sizes[sizes.length - 1]?.sizeSol ?? null;
  const [step, setStep] = useState(null); // null | 'prepare' | 'sign' | 'send' | 'list'
  const [listStep, setListStep] = useState('');
  const rules = windows?.rules ? toRules(rf, maxWalletPct) : null;
  const ruleLines = rules ? describeRules(rules) : [];
  const picked = windows?.rules ? CATALOG.filter((x) => rf.on[x.id]) : [];
  const capText = (x) => (cfg.solUsd && x.capSol ? `$${Math.round(x.capSol * cfg.solUsd / 1000)}k` : `${Math.round(x.capSol ?? x.sizeSol)} SOL`);
  const sizeNow = sizes.find((x) => x.sizeSol === size);
  const listed = rules && (rf.on.allowlist || rf.on.blocklist) ? parseWallets(rf.listText) : null;
  const [error, setError] = useState(null);
  const fileRef = useRef(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const onFile = async (f) => {
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { setError('The image is over 5 MB'); return; }
    setError(null);
    setImageData(await readFile(f));
  };
  // the ticker lock, checked as the creator types (api/launch.mjs tickerStatus): a hint before the image and the signing,
  // the refusal proper is at prepare and submit
  const [tick, setTick] = useState(null); // { symbol, locked, text } for the symbol typed, or null
  const symbol = form.symbol.trim().toUpperCase();
  useEffect(() => {
    if (!/^[A-Z0-9]{1,10}$/.test(symbol)) { setTick(null); return; }
    let alive = true;
    const id = setTimeout(() => { api.tickerStatus(symbol).then((t) => { if (alive && t?.symbol === symbol) setTick(t); }).catch(() => {}); }, 350);
    return () => { alive = false; clearTimeout(id); };
  }, [symbol]);
  const tickerLocked = Boolean(tick?.locked && tick.symbol === symbol);
  const ready = form.name.trim() && /^[A-Za-z0-9]{1,10}$/.test(form.symbol.trim()) && imageData && !tickerLocked;

  const launch = async () => {
    setError(null);
    let wallet;
    try {
      wallet = (await w.connect()).acct.address;
    } catch (e) { if (!cancelled(e)) setError(e.message); return; }
    try {
      setStep('prepare');
      const p = await api.prepareLaunch({ wallet, ...form, symbol: form.symbol.trim().toUpperCase(), imageData, tickerLock, devBuySol: windows ? 0 : Number(devBuy) || 0,
        holderRewards: rewards === 'holders', ...(windows ? { devBuySol: windows.limits?.firstBuy ? Number(devBuy) || 0 : 0, window: { openSecs, windowMinutes, sizeSol: size, maxWalletPct, holderRewards: rewards === 'holders', pair: pair?.mint || null, pumpCreatorFeeBps: pair ? pairFee : 0, ...(rules ? { rules } : {}) } } : {}) });
      setStep('sign');
      const signed = await w.signTransaction(p.transaction);
      setStep('send');
      const r = await api.submitLaunch(p.mint, signed);
      // an allow/blocklist is filled right after the launch: the creator signs the list transactions in one approval
      // ⛔ an allowlist sealed with nobody on it would be a coin nobody can buy, forever: an empty list is never sealed
      if (listed && listed.wallets.length) {
        setStep('list'); setLive(r.mint);
        try {
          const { tooLate } = await fillList({ mint: r.mint, wallet, wallets: listed.wallets, seal: rf.seal, signTransactions: w.signTransactions, onProgress: setListStep });
          if (tooLate.length) console.warn('not added to the list', tooLate);
        } catch (e) {
          setError(`your coin is live, but its list is not finished${cancelled(e) ? '' : `: ${e.message}`}. you can add the wallets from the coin page for a day.`);
          setStep(null);
          return;
        }
      }
      navigate(`/coin/${r.mint}`); // live, or still confirming: the coin page says which
    } catch (e) {
      setError(cancelled(e) ? 'The launch was cancelled in your wallet. Nothing was sent.' : e.message);
      setStep(null);
    }
  };

  return (
    <main className="wrap">
      <div className="page-head">
        <h1>Launch a <span className="grad">coin</span></h1>
      </div>
      <div className="create">
        <div className="form">
          <div className="panel lsec">
            <div className="lsec-title"><span className="num">1</span><h2>Your coin</h2></div>
            <div className="field two">
              <div className="field"><label>name</label><input value={form.name} onChange={set('name')} maxLength={32} /></div>
              <div className="field"><label>ticker</label><input className="mono-in" value={form.symbol} onChange={set('symbol')} maxLength={10} /></div>
            </div>
            {tickerLocked && <div className="err">{tick.text}</div>}
            {tick && !tick.locked && tick.symbol === symbol && <div className="muted xs">{symbol} is free.</div>}
            <div className="field"><label>Ticker lock</label>
              <select value={tickerLock} onChange={(e) => setTickerLock(e.target.value)} disabled={Boolean(step)} style={{ width: '100%' }}>
                {lockOptions.map((o) => <option key={o.id} value={o.id}>{LOCK_LABEL[o.id] || o.id}</option>)}
              </select>
              <div className="muted xs">nobody can launch a coin with this ticker here until the lock ends, your own wallet included.</div></div>
            <div className="field"><label>description</label><textarea value={form.description} onChange={set('description')} maxLength={1000} /></div>
            <div className="field">
              <label>image</label>
              <div className="drop" onClick={() => fileRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files?.[0]); }}>
                {imageData ? <img className="thumb" src={imageData} alt="" /> : <div className="thumb add">+</div>}
                <div className="drop-t"><b>drag and drop an image</b><span className="muted xs">PNG, JPEG, GIF or WebP, up to 5 MB.</span></div>
                <span className="btn ghost small">{imageData ? 'change file' : 'select file'}</span>
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => onFile(e.target.files?.[0])} />
              </div>
            </div>
            <div className="field two">
              <div className="field"><label>x link</label><input value={form.twitter} onChange={set('twitter')} placeholder="(optional)" /></div>
              <div className="field"><label>website</label><input value={form.website} onChange={set('website')} placeholder="(optional)" /></div>
            </div>
          </div>
          {windows && (
            <div className="panel lsec">
              <div className="lsec-title"><span className="num">2</span><h2>Curve settings</h2></div>
              <div className="field"><label>buying opens</label>
                <select value={openSecs} onChange={(e) => setOpenSecs(Number(e.target.value))} disabled={Boolean(step)} style={{ width: '100%' }}>
                  {[[5, '5 seconds after launch'], [10, '10 seconds after launch'], [30, '30 seconds after launch'], [60, '1 minute after launch']].map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                </select></div>
              {windows.limits?.mode === 'deadline' && <div className="field"><label>window ends</label>
                <select value={windowMinutes} onChange={(e) => setWindowMinutes(Number(e.target.value))} disabled={Boolean(step)} style={{ width: '100%' }}>
                  {[[15, '15 minutes after launch'], [60, '1 hour after launch'], [360, '6 hours after launch'], [1440, '24 hours after launch'], [4320, '3 days after launch'], [10080, '7 days after launch']].filter(([v]) => v * 60 >= openSecs + 60).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                </select></div>}
              <div className="field"><label>Migration</label>
                <div className="sizes">
                  {sizes.map((x) => <button type="button" key={x.sizeSol} disabled={Boolean(step)} className={`size ${x.sizeSol === size ? 'on' : ''}`} onClick={() => setSizeSol(x.sizeSol)}><b>{capText(x)}</b><span>market cap</span></button>)}
                </div>
                <div className="muted xs">when the curve fills at this market cap the coin becomes a pump.fun coin and every holder receives it automatically.</div></div>
              <div className="field"><label>Pair</label>
                <PairPicker value={pair} onChange={(p) => { setPair(p); if (!p) setPairFee(0); }} disabled={Boolean(step)} /></div>
              {pair && pair.kind !== 'usdc' && <div className="field"><label>Pumpfun creator fee</label>
                <select value={pairFee} onChange={(e) => setPairFee(Number(e.target.value))} disabled={Boolean(step)} style={{ width: '100%' }}>
                  {[[0, 'Pumpfun default'], [50, '0.5%'], [100, '1%'], [200, '2%'], [300, '3%']].map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                </select></div>}
              <div className="field"><label>Creator rewards</label>
                <select value={rewards} onChange={(e) => setRewards(e.target.value)} disabled={Boolean(step)} style={{ width: '100%' }}>
                  <option value="creator">Creator</option><option value="holders">Holders</option>
                </select></div>
              {windows.limits?.firstBuy && <div className="field"><label>your first buy (optional)</label>
                <div className="amount"><input type="number" min="0" step="0.01" max={windows.firstBuyMaxSol ?? undefined} value={devBuy} onChange={(e) => setDevBuy(e.target.value)} placeholder={windows.firstBuyMaxSol ? `0.0 (up to ${windows.firstBuyMaxSol.toFixed(2)} SOL, ${windows.firstBuyMaxPct}% of supply)` : '0.0'} disabled={Boolean(step)} /><span className="unit">SOL</span></div></div>}
              <div className="field"><label>max per wallet</label>
                <select value={maxWalletPct} onChange={(e) => setMaxWalletPct(Number(e.target.value))} disabled={Boolean(step)} style={{ width: '100%' }}>
                  {[[0, 'off'], [1, '1% of supply'], [2, '2% of supply'], [5, '5% of supply'], [10, '10% of supply']].map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                </select></div>
            </div>
          )}
          {windows?.rules && (
            <div className="panel lsec">
              <div className="lsec-title"><span className="num">3</span><h2>Rules</h2><span className="muted sm">(optional)</span></div>
              <p className="sec-lede">rules the coin keeps while it is on its curve, until it migrates to pump.fun. the hook on chain enforces them on every trade and send; written at launch, never changed.</p>
              <RulesPicker form={rf} setForm={setRf} disabled={Boolean(step)} />
            </div>
          )}
          {windows?.rules && picked.length > 0 && (
            <div className="panel lsec">
              <div className="lsec-title"><span className="num">4</span><h2>Rule settings</h2></div>
              <RuleSettings form={rf} setForm={setRf} maxWalletPct={maxWalletPct} />
            </div>
          )}
        </div>
        <aside className="aside">
          <div className="panel ptok">
            <div className="ptok-head">
              {imageData ? <img className="ptok-img" src={imageData} alt="" /> : <i className="ptok-img orb" />}
              <div style={{ minWidth: 0 }}>
                <div className="ptok-name">{form.name.trim() || 'Your coin'}</div>
                <div className="ptok-sym">${symbol || 'TICKER'} · 1,000,000,000 supply</div>
              </div>
            </div>
            <div className="ptok-rules">
              {maxWalletPct > 0 && !rf.on.chapters && <div className="prule"><span className="rdot" style={{ background: '#86efac', color: '#86efac' }} /><span className="prule-t">max per wallet {maxWalletPct}%</span><span className="prule-k">fair launch</span></div>}
              {picked.map((x) => <div key={x.id} className="prule"><span className="rdot" style={{ background: RULE_COLOR[x.id], color: RULE_COLOR[x.id] }} /><span className="prule-t">{x.t}</span><span className="prule-k">{x.group}</span></div>)}
              <div className="prule"><span className="rdot" style={{ background: '#f9a8d4', color: '#f9a8d4' }} /><span className="prule-t">ticker lock {LOCK_LABEL[tickerLock] || tickerLock}</span><span className="prule-k">anti-vamp</span></div>
              {!picked.length && !(maxWalletPct > 0) && <div className="prule dim">no rules picked</div>}
            </div>
            {windows && <div className="ptok-foot"><span>{sizeNow ? `${capText(sizeNow)} market cap` : ''}</span><span>then pump.fun</span></div>}
          </div>
          <div className="panel golaunch">
            <p className="muted sm" style={{ margin: 0, textAlign: 'center' }}>tip: coin data cannot be changed after creation</p>
            {error && !modal && <div className="err">{error}</div>}
            <button className="btn wide big" disabled={!ready || !cfg.launchReady || !open || (cfg.windowOnly && !windows)} onClick={() => { setError(null); setModal(true); }}>create coin</button>
            {!cfg.launchReady && <div className="err">Launching is not set up on this server yet.</div>}
            {cfg.launchReady && !open && <div className="ok" style={{ textAlign: 'center' }}>launching opens soon.</div>}
            {cfg.launchReady && open && cfg.windowOnly && !windows && <div className="ok" style={{ textAlign: 'center' }}>launching opens soon.</div>}
          </div>
        </aside>
      </div>
      {modal && windows && (
        <Modal onClose={() => { if (!step) setModal(false); }}>
          <h2>launch [{form.symbol.trim().toUpperCase() || 'your coin'}]</h2>
          <div className="sm" style={{ display: 'grid', gap: 6 }}>
            <div><span className="muted">buying opens:</span> {openSecs >= 3600 ? '1 hour' : openSecs >= 60 ? `${openSecs / 60} minute${openSecs > 60 ? 's' : ''}` : `${openSecs} seconds`} after launch</div>
            {windows.limits?.mode === 'deadline' && <div><span className="muted">window ends:</span> {windowMinutes >= 1440 ? `${windowMinutes / 1440} day(s)` : windowMinutes >= 60 ? `${windowMinutes / 60} hour(s)` : `${windowMinutes} minutes`} after launch</div>}
            <div><span className="muted">migrates to pump.fun at:</span> {(() => { const x = sizes.find((y) => y.sizeSol === size); return x?.capSol ? `${Math.round(x.capSol)} SOL market cap${cfg.solUsd ? ` (~$${Math.round(x.capSol * cfg.solUsd / 1000)}k)` : ''}` : `${size} SOL`; })()}</div>
            <div><span className="muted">pair:</span> {pair ? `${pair.symbol}${pairFee && pair.kind !== 'usdc' ? `, ${pairFee / 100}% Pumpfun creator fee` : ''}` : 'SOL'}</div>
            <div><span className="muted">creator rewards:</span> {rewards === 'holders' ? 'Holders' : 'Creator'}</div>
            <div><span className="muted">max per wallet:</span> {maxWalletPct && !rf.on.chapters ? `${maxWalletPct}% of supply` : 'off'}</div>
            {ruleLines.length > 0 && <div><div className="muted">rules on its curve, until it migrates:</div><RulesLines lines={ruleLines} className="xs" /></div>}
            {listed && listed.wallets.length > 0 && <div><span className="muted">list:</span> {listed.wallets.length} wallet{listed.wallets.length === 1 ? '' : 's'}{rf.seal ? ', sealed right after launch' : ''}. you approve the list transactions in your wallet after the launch.</div>}
            {listed && listed.wallets.length === 0 && <div><span className="muted">list:</span> empty for now. {rf.on.allowlist ? 'nobody but you can buy until you add wallets from the coin page (within a day).' : 'add wallets from the coin page within a day.'}</div>}
            {windows.limits?.firstBuy && Number(devBuy) > 0 && <div><span className="muted">your first buy:</span> {Number(devBuy)} SOL, inside the launch</div>}
          </div>
          <p className="muted xs">everything above is written on chain at launch and cannot be changed after.</p>
          {error && <div className="err">{error}</div>}
          {live && !step ? <Link href={`/coin/${live}`} className="btn wide">go to your coin</Link> : <button className="btn wide" disabled={Boolean(step) || !size || Boolean(listed?.invalid.length)} onClick={launch}>
            {step === 'prepare' ? <><Spinner /> preparing</> : step === 'sign' ? <><Spinner /> approve in your wallet</> : step === 'send' ? <><Spinner /> launching</> : step === 'list' ? <><Spinner /> {listStep || 'filling the list'}</> : 'create coin'}
          </button>}
          {listed?.invalid.length > 0 && <div className="err">the list holds something that is not a wallet address.</div>}
          <p className="muted xs">cost to deploy: ~{windows.deployCostSol} SOL{windows.limits?.firstBuy && Number(devBuy) > 0 ? ` + ${Number(devBuy)} SOL for your first buy` : ''}</p>
        </Modal>
      )}
      {modal && !windows && (
        <Modal onClose={() => { if (!step) setModal(false); }}>
          <h2>choose how many [{form.symbol.trim().toUpperCase() || 'coins'}] you want to buy (optional)</h2>
          <p className="muted sm">tip: it's optional but buying a small amount of coins helps protect your coin from snipers</p>
          <div className="field"><label>creator rewards (fixed at launch)</label>
            <select value={rewards} onChange={(e) => setRewards(e.target.value)} disabled={Boolean(step)} style={{ width: '100%' }}>
              <option value="creator">Creator</option><option value="holders">Holders</option>
            </select></div>
          {cfg.devBuyReady ? (
            <div className="amount">
              <input type="number" min="0" step="0.01" max={cfg.maxDevBuySol} value={devBuy} onChange={(e) => setDevBuy(e.target.value)} placeholder="0.0 (optional)" disabled={Boolean(step)} />
              <span className="unit">SOL</span>
            </div>
          ) : <p className="muted sm">first buys are not available on this server yet: the coin is created without one</p>}
          {error && <div className="err">{error}</div>}
          <button className="btn wide" disabled={Boolean(step)} onClick={launch}>
            {step === 'prepare' ? <><Spinner /> preparing</> : step === 'sign' ? <><Spinner /> approve in your wallet</> : step === 'send' ? <><Spinner /> launching</> : 'create coin'}
          </button>
          <p className="muted xs">cost to deploy: ~{cfg.deployCostSol ?? 0.025} SOL{Number(devBuy) > 0 ? ` + ${Number(devBuy)} SOL for your first buy` : ''}</p>
        </Modal>
      )}
    </main>
  );
}
export { tokens };
