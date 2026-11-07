import { useCallback, useEffect, useState } from 'react';
import { Link } from '../lib/router.js';
import { api } from '../lib/api.js';
import { useWallet, cancelled } from '../lib/wallet.jsx';
import Chart from '../components/Chart.jsx';
import { Modal, Spinner } from '../components/Chrome.jsx';
import { usdK, ago, short, shortName, colorOf, lamportsToSol, tokens, pumpLink } from '../lib/format.js';
import { RulesLines } from '../components/Rules.jsx';
import { parseWallets } from '../lib/rulesText.js';
import { fillList } from '../lib/lists.js';

const fmtLeft = (secs) => { const s = Math.max(0, Math.floor(secs)); if (s >= 86400) return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`; if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`; if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`; return `${s}s`; };
function useNow(skew = 0) { const [t, setT] = useState(Date.now() / 1000 + skew); useEffect(() => { const id = setInterval(() => setT(Date.now() / 1000 + skew), 1000); return () => clearInterval(id); }, [skew]); return t; }

/** The window token's state: countdowns, the raise, where it is in its graduation, the pump.fun coin once it exists. */
function WindowPanel({ c }) {
  const w = c.window, t = useNow(w.chainNow ? w.chainNow - Date.now() / 1000 : 0); // the chain's clock, which the hook decides on
  const phaseText = w.phase === 'ended' ? 'the window ended with no holders: nothing migrated'
    : w.phase === 'opening' ? `buying opens in ${fmtLeft(w.opensAt - t)}`
    : w.phase === 'trading' ? (w.closesAt ? `window ends in ${fmtLeft(w.closesAt - t)}` : `on its curve: migrates to pump.fun when it fills`)
    : w.phase === 'closing' ? 'window closed: migrating to pump.fun now'
    : w.phase === 'graduating' ? `migrating to pump.fun (${w.status})`
    : 'migrated to pump.fun';
  const pct = Math.round((w.progress ?? 0) * 100);
  return (
    <div className="panel sm">
      <div className="b yellow">{phaseText}</div>
      {w.phase === 'graduated' && w.pumpMint && <div>pump.fun coin: <a className="green" href={pumpLink(w.pumpMint)} target="_blank" rel="noreferrer">{short(w.pumpMint, 6)}</a>{w.settled ? ` · ${w.settled.holders} holders received their share` : ''}</div>}
      {w.phase !== 'graduated' && w.phase !== 'ended' && <>
        <div>curve progress: {pct}%</div>
        <div className="bar"><i style={{ width: `${pct}%` }} /></div>
        <p className="muted xs" style={{ margin: 0 }}>
          {w.raisedSol != null ? `${w.raisedSol.toFixed(3)} SOL raised of ${w.targetSol?.toFixed(1)} SOL. ` : ''}
          {w.closesAt ? 'when the window ends the coin migrates to pump.fun at whatever market cap it has reached; every holder receives the pump.fun coin automatically. if the curve fills first it migrates right away.' : `when the curve fills (${w.targetSol?.toFixed(1)} SOL raised) the coin migrates to pump.fun and every holder receives the pump.fun coin automatically.`}
          {' '}nobody could buy before the opening, the creator included, and only one buy lands per block.
        </p>
      </>}
      {w.phase === 'graduated' && w.raise != null && <p className="muted xs" style={{ margin: 0 }}>the window raised {w.raise.toFixed(3)} SOL; the coin opened on pump.fun at that market cap.</p>}
      {w.phase === 'graduated' && w.raise == null && <p className="muted xs" style={{ margin: 0 }}>the curve filled; the coin opened on pump.fun at that market cap.</p>}
      {c.holderRewards && <div className="muted xs">creator rewards go to the holders (pump.fun holder rewards).</div>}
      {w.rules?.any && w.phase !== 'graduated' && w.phase !== 'ended' && <div className="xs" style={{ display: 'grid', gap: 4 }}>
        <div className="muted">rules on its curve, enforced by the hook on every trade and send until it migrates to pump.fun:</div>
        <RulesLines lines={w.rules.lines} className="xs" />
      </div>}
      {w.list && w.phase !== 'graduated' && w.phase !== 'ended' && <div className="muted xs">{w.rules?.allowlist ? 'allowlist' : 'blocklist'}: {w.list.count} wallet{w.list.count === 1 ? '' : 's'}{w.list.sealed ? ', sealed' : w.list.open ? ', the creator can still add wallets for a day after launch' : ', closed'}.</div>}
      {w.pair && w.phase !== 'graduated' && <div className="muted xs">migrates into a Pumpfun coin paired with a custom pair{w.pair.creatorFeeBps ? `, ${w.pair.creatorFeeBps / 100}% creator fee` : ''}.</div>}
    </div>
  );
}

/** The creator's own list panel while the list is open: paste wallets, add them, seal it. */
function ListPanel({ c, onDone }) {
  const w = useWallet();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState(null);
  if (!w.address || w.address !== c.creator) return null;
  const parsed = parseWallets(text);
  const go = async (seal) => {
    setErr(null); setBusy('starting');
    try {
      const { tooLate } = await fillList({ mint: c.mint, wallet: w.address, wallets: parsed.wallets, seal, signTransactions: w.signTransactions, onProgress: setBusy });
      setText(''); if (tooLate.length) setErr(`${tooLate.length} wallet${tooLate.length === 1 ? '' : 's'} could not be added: the list only grows upwards and they sort below its last wallet.`);
      onDone?.();
    } catch (e) { setErr(cancelled(e) ? 'cancelled in your wallet. nothing was sent.' : e.message); }
    setBusy('');
  };
  return (
    <div className="panel sm">
      <div className="b">your {c.window.rules?.allowlist ? 'allowlist' : 'blocklist'}</div>
      <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="wallet addresses, one per line" disabled={Boolean(busy)} />
      {parsed.invalid.length > 0 && <div className="err">not wallet addresses: {parsed.invalid.slice(0, 3).join(', ')}</div>}
      {err && <div className="err">{err}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn small" disabled={Boolean(busy) || !parsed.wallets.length || parsed.invalid.length > 0} onClick={() => go(false)}>{busy ? <><Spinner /> {busy}</> : `add ${parsed.wallets.length || ''} wallets`}</button>
        <button className="btn small ghost" disabled={Boolean(busy) || parsed.invalid.length > 0 || (c.window.rules?.allowlist && (c.window.list?.count ?? 0) + parsed.wallets.length === 0)} onClick={() => go(true)}>{parsed.wallets.length ? 'add and seal' : 'seal the list'}</button>
      </div>
      <div className="muted xs">24 wallets per transaction, one approval per batch. sealing is for good{c.window.rules?.allowlist ? '; an allowlist cannot be sealed empty' : ''}.</div>
    </div>
  );
}

const GRADUATION_SOL = 85; // real SOL in the curve when it completes (pump.fun, SOL pair)
const KOTH_USD = 30_000;

export default function Coin({ mint, cfg }) {
  const [c, setC] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('thread');
  const [chart, setChart] = useState(null);
  const [interval, setIntervalSecs] = useState(300);
  const load = useCallback(() => {
    api.chart(mint, interval).then((d) => setChart((prev) => (location.pathname.endsWith(mint) ? d : prev))).catch(() => {});
    // a server restart (deploy) answers 502/503 for a few seconds: keep the page and retry on the next poll instead of showing an error
    return api.coin(mint).then((d) => { if (d.mint === mint) { setC(d); setError(null); } }).catch((e) => { if (e.status !== 502 && e.status !== 503 && e.status) setError(e.message); });
  }, [mint, interval]);
  useEffect(() => { setC(null); setChart(null); }, [mint]);
  useEffect(() => {
    setError(null);
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, 10_000);
    return () => clearInterval(id);
  }, [load]);

  if (error) return <main className="wrap"><div className="narrow"><Link href="/" className="bracket">[go back]</Link><div className="err">{error}</div></div></main>;
  if (!c) return <main className="wrap"><div className="empty">loading…</div></main>;
  const curveProgress = Math.round((c.progress ?? 0) * 100);
  // the bar to beat: the current king's cap, or the crown's threshold when nobody is crowned yet
  const kothBar = Math.max(c.kothUsd ?? KOTH_USD, c.king && c.king.mint !== c.mint ? c.king.capUsd ?? 0 : 0);
  const isKing = Boolean(c.king && c.king.mint === c.mint);
  const koth = isKing ? 100 : Math.min(100, Math.round(((c.capUsd ?? 0) / kothBar) * 100));
  return (
    <main className="wrap">
      <div style={{ marginTop: 8 }}><Link href="/" className="bracket">[go back]</Link></div>
      {c.status === 'created' && <div className="ok">your launch was sent and is confirming on chain. this page updates by itself; the coin is tradeable once it shows up on pump.fun.</div>}
      <div className="coinhead">
        <span className="b">{c.name} ({c.symbol})</span>
        <span className="muted">created by <i className="avatar" style={{ background: colorOf(c.creator) }} /> <span className="blue">{shortName(c.creator)}</span></span>
        <span className="green">market cap: {usdK(c.capUsd)}</span>
        <span className="muted">replies: {c.replyCount}</span>
        {c.kind !== 'window' && c.holderRewards && <span className="yellow sm">creator rewards to holders</span>}
        {c.kind === 'window' ? (c.window?.pumpMint && <a className="bracket sm" href={pumpLink(c.window.pumpMint)} target="_blank" rel="noreferrer">[view on pump.fun]</a>) : <a className="bracket sm" href={pumpLink(c.mint)} target="_blank" rel="noreferrer">[view on pump.fun]</a>}
      </div>
      <div className="cols">
        <section>
          <Chart mint={mint} data={chart} solUsd={c.solUsd} interval={interval} setInterval={setIntervalSecs} />
          <div className="tabs">
            <button className={`bracket${tab === 'thread' ? ' green' : ''}`} onClick={() => setTab('thread')}>[thread]</button>
            <button className={`bracket${tab === 'trades' ? ' green' : ''}`} onClick={() => setTab('trades')}>[trades]</button>
          </div>
          {tab === 'thread' ? <Thread c={c} onPosted={(replies) => setC({ ...c, replies, replyCount: replies.length })} /> : <Trades c={c} chart={chart} />}
        </section>
        <aside className="side">
          {c.kind === 'window' && c.window && <WindowPanel c={c} />}
          {c.kind === 'window' && c.window?.list?.open && <ListPanel c={c} onDone={load} />}
          <TradePanel c={c} cfg={cfg} onTraded={load} />
          <div className="panel">
            <div className="info">
              <img src={c.image} alt="" />
              <div className="sm">
                <div className="b">{c.name} ({c.symbol})</div>
                <div className="muted" style={{ wordBreak: 'break-word' }}>{c.description}</div>
                <div className="wrapgap" style={{ marginTop: 6 }}>
                  {c.socials?.twitter && <a className="bracket xs" href={c.socials.twitter} target="_blank" rel="noreferrer">[twitter]</a>}
                  {c.socials?.telegram && <a className="bracket xs" href={c.socials.telegram} target="_blank" rel="noreferrer">[telegram]</a>}
                  {c.socials?.website && <a className="bracket xs" href={c.socials.website} target="_blank" rel="noreferrer">[website]</a>}
                </div>
              </div>
            </div>
            <div className="xs muted" style={{ wordBreak: 'break-all' }}>contract address: <a className="blue" href={`${cfg.explorer}/token/${c.mint}`} target="_blank" rel="noreferrer">{c.mint}</a></div>
          </div>
          <div className="panel sm">
            {c.kind !== 'window' && <>
            <div>bonding curve progress: {curveProgress}%</div>
            <div className="bar"><i style={{ width: `${curveProgress}%` }} /></div>
            <p className="muted xs" style={{ margin: 0 }}>
              {c.complete ? 'this coin has graduated: its liquidity moved to PumpSwap, where it trades now.' :
                <>when the market cap reaches {usdK(GRADUATION_SOL * 1.35 * (c.solUsd || 0))} all the liquidity from the bonding curve will be deposited into the token on Pumpfun.</>}
            </p>
            </>}
            <div>king of the hill progress: {koth}%</div>
            <div className="bar koth"><i style={{ width: `${koth}%` }} /></div>
            <p className="muted xs" style={{ margin: 0 }}>{isKing ? `this coin is the king of the hill${c.crownedAt ? `, crowned ${ago(c.crownedAt)}` : ''}` : c.king ? `dethrone the current king (${c.king.symbol}) at ${usdK(kothBar)} mcap` : `take the crown at ${usdK(kothBar)} mcap`}</p>
          </div>
          <div className="panel sm">
            <div className="b">holder distribution</div>
            <div className="holders">
              {c.holders.length === 0 && <div className="muted">reading holders…</div>}
              {c.holders.map((h, i) => (
                <div key={h.account}>
                  <span>{i + 1}. <a className="blue" href={`${cfg.explorer}/account/${h.owner || h.account}`} target="_blank" rel="noreferrer">{shortName(h.owner || h.account)}</a>{h.label ? ` (${h.label})` : h.owner === c.creator ? ' (dev)' : ''}</span>
                  <span>{h.pct.toFixed(2)}%</span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

function Thread({ c, onPosted }) {
  const w = useWallet();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const post = async () => {
    setError(null);
    setBusy(true);
    try {
      const { acct } = await w.connect();
      const ts = Date.now();
      const body = text.trim();
      // Signed and sent as the SAME string: the server verifies exactly what it receives.
      const signature = await w.signMessage(`pump reply\nmint: ${c.mint}\ntime: ${ts}\n\n${body}`);
      const replies = await api.reply(c.mint, { wallet: acct.address, text: body, ts, signature });
      onPosted(replies);
      setText('');
      setOpen(false);
    } catch (e) {
      if (!cancelled(e)) setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="thread">
      <div className="reply">
        <div className="meta"><i className="avatar" style={{ background: colorOf(c.creator) }} /><span className="blue">{shortName(c.creator)}</span> (dev) <span>{ago(c.createdAt)}</span>{c.sig && <a className="muted" href={`https://solscan.io/tx/${c.sig}`} target="_blank" rel="noreferrer">launch tx</a>}</div>
        <div className="row" style={{ alignItems: 'flex-start' }}><img src={c.image} alt="" style={{ width: 96, height: 96, borderRadius: 6, objectFit: 'cover' }} /><div><span className="b">{c.name} ({c.symbol})</span>{c.description ? `: ${c.description}` : ''}</div></div>
      </div>
      {c.replies.map((r) => (
        <div className="reply" key={r.id}>
          <div className="meta"><i className="avatar" style={{ background: colorOf(r.wallet) }} /><span className="blue">{shortName(r.wallet)}</span>{r.wallet === c.creator && ' (dev)'}<span>{ago(r.at)}</span><span>#{r.id}</span></div>
          <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{r.text}</div>
        </div>
      ))}
      <button className="bracket" style={{ justifySelf: 'start' }} onClick={() => setOpen(true)}>[post a reply]</button>
      {open && (
        <Modal onClose={() => !busy && setOpen(false)}>
          <h2>add a comment</h2>
          <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="comment" />
          {error && <div className="err">{error}</div>}
          <div className="row">
            <button className="btn" disabled={busy || !text.trim()} onClick={post}>{busy ? <><Spinner /> signing</> : 'post reply'}</button>
            <button className="bracket" onClick={() => setOpen(false)}>[cancel]</button>
          </div>
          <p className="muted xs">your wallet signs the comment (no transaction, no fee) so nobody can post as you.</p>
        </Modal>
      )}
    </div>
  );
}

function Trades({ c, chart }) {
  // every trade on the coin's venue, read from the chain (the site's own trades are among them)
  const rows = chart?.trades?.length ? chart.trades.map((t) => ({ ...t, at: t.ts })) : c.trades;
  if (!rows.length) return <div className="empty">{chart && !chart.complete ? 'reading the trades from the chain…' : 'no trades yet.'}</div>;
  return (
    <table className="trades">
      <thead><tr><th>account</th><th>type</th><th>SOL</th><th>{c.symbol}</th><th>date</th><th>transaction</th></tr></thead>
      <tbody>
        {rows.map((t) => (
          <tr key={t.sig}>
            <td><i className="avatar" style={{ background: colorOf(t.wallet) }} /> <span className="blue">{shortName(t.wallet)}</span></td>
            <td className={t.side === 'sell' ? 'red' : 'green'}>{t.side}</td>
            <td>{lamportsToSol(t.lamports).toFixed(4)}</td>
            <td>{t.side === 'create' ? '–' : tokens(t.tokenUnits)}</td>
            <td className="muted">{ago(t.at)}</td>
            <td><a className="muted" href={`https://solscan.io/tx/${t.sig}`} target="_blank" rel="noreferrer">{short(t.sig, 3)}</a></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TradePanel({ c, cfg, onTraded }) {
  const w = useWallet();
  const [side, setSide] = useState('buy');
  const [amount, setAmount] = useState('');
  const [pct, setPct] = useState(null);
  const [slippage, setSlippage] = useState('5');
  const [slipOpen, setSlipOpen] = useState(false);
  const [step, setStep] = useState(null);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);

  const trade = async () => {
    setError(null);
    setMsg(null);
    try {
      const wallet = (await w.connect()).acct.address;
      setStep('prepare');
      const body = { wallet, mint: c.mint, side, slippageBps: Math.round((Number(slippage) || 1) * 100) };
      if (side === 'buy') body.amount = Number(amount);
      else if (pct != null) body.pct = pct;
      else body.amount = Number(amount);
      const p = await api.prepareTrade(body);
      setStep('sign');
      const signed = await w.signTransaction(p.transaction);
      setStep('send');
      const r = await api.submitTrade(signed);
      setMsg(`${side === 'buy' ? 'bought' : 'sold'} ${tokens(r.tokenUnits)} ${c.symbol} for ${lamportsToSol(r.lamports).toFixed(4)} SOL`);
      setAmount('');
      setPct(null);
      onTraded();
    } catch (e) {
      setError(cancelled(e) ? 'cancelled in your wallet. nothing was sent.' : e.message);
    } finally {
      setStep(null);
    }
  };
  const win = c.kind === 'window' ? c.window : null;
  const blocked = win ? (win.phase === 'opening' ? 'buying has not opened yet' : win.phase === 'ended' ? 'this window ended with no holders' : win.phase === 'closing' || win.phase === 'graduating' ? 'migrating to pump.fun: trading resumes there in a few minutes' : null) : c.complete ? 'graduated' : null;
  const disabled = Boolean(step) || Boolean(c.quote) || (blocked && !(win && win.phase === 'opening' && side === 'sell')) || (side === 'buy' ? !(Number(amount) > 0) : !(pct != null || Number(amount) > 0));
  return (
    <div className="panel">
      <div className="tabbtns">
        <button className={`buy${side === 'buy' ? ' on' : ''}`} onClick={() => { setSide('buy'); setError(null); }}>buy</button>
        <button className={`sell${side === 'sell' ? ' on' : ''}`} onClick={() => { setSide('sell'); setError(null); }}>sell</button>
      </div>
      <div className="row sm" style={{ justifyContent: 'center' }}>
        <button className="btn ghost small" onClick={() => setSlipOpen(true)}>set max slippage</button>
      </div>
      {side === 'buy' ? (
        <>
          <div className="amount"><input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0" disabled={Boolean(step)} /><span className="unit">SOL</span></div>
          <div className="quick">
            <button onClick={() => setAmount('')}>reset</button>
            {[0.1, 0.5, 1].map((v) => <button key={v} onClick={() => setAmount(String(v))}>{v} SOL</button>)}
          </div>
        </>
      ) : (
        <>
          <div className="amount"><input type="number" min="0" value={pct != null ? '' : amount} onChange={(e) => { setPct(null); setAmount(e.target.value); }} placeholder={pct != null ? `${pct}% of your ${c.symbol}` : '0.0'} disabled={Boolean(step)} /><span className="unit">{c.symbol}</span></div>
          <div className="quick">
            <button onClick={() => { setPct(null); setAmount(''); }}>reset</button>
            {[25, 50, 75, 100].map((v) => <button key={v} onClick={() => { setPct(v); setAmount(''); }}>{v}%</button>)}
          </div>
        </>
      )}
      {!win && c.complete && <div className="muted xs">this coin graduated: the curve is closed, trade it on <a className="green" href={pumpLink(c.mint)} target="_blank" rel="noreferrer">pump.fun</a> (PumpSwap).</div>}
      {win && blocked && <div className="muted xs">{blocked}.</div>}
      {c.quote && <div className="muted xs">this coin is paired with another token: trade it on <a className="green" href={pumpLink(c.mint)} target="_blank" rel="noreferrer">pump.fun</a>.</div>}
      {win && win.phase === 'graduated' && <div className="muted xs">trades here go to the pump.fun coin.</div>}
      {error && <div className="err">{error}</div>}
      {msg && <div className="ok">{msg}</div>}
      <button className="btn wide" disabled={disabled} onClick={trade}>
        {step === 'prepare' ? <><Spinner /> preparing</> : step === 'sign' ? <><Spinner /> approve in your wallet</> : step === 'send' ? <><Spinner /> sending</> : 'place trade'}
      </button>
      {slipOpen && (
        <Modal onClose={() => setSlipOpen(false)}>
          <h2>set max slippage (%)</h2>
          <input type="number" min="0.1" max="50" step="0.1" value={slippage} onChange={(e) => setSlippage(e.target.value)} onBlur={() => { const n = Number(slippage); setSlippage(String(n >= 0.1 && n <= 50 ? n : 5)); }} />
          <p className="muted sm">this is the maximum amount of slippage you are willing to accept when placing trades</p>
          <button className="btn" onClick={() => setSlipOpen(false)}>close</button>
        </Modal>
      )}
    </div>
  );
}
