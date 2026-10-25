// The rule picker on the create page (the hook rules a creator can put on a window launch) and the plain-words
// summary of a rules object (the launch modal, the coin page). Catalog, defaults and wording: lib/rulesText.js.
import { CATALOG, GROUPS, withRule, parseWallets, TZS, tzText, myTz } from '../lib/rulesText.js';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const Num = ({ label, k, form, set, min, max, step = 'any', hint }) => (
  <label className="rfield">
    <span>{label}</span>
    <input type="number" min={min} max={max} step={step} value={form[k]} onChange={(e) => set(k, e.target.value)} />
    {hint && <em>{hint}</em>}
  </label>
);

/** The fields of one picked rule. */
function Fields({ id, form, set, maxWalletPct }) {
  switch (id) {
    case 'allowlist': case 'blocklist': {
      const parsed = parseWallets(form.listText);
      return (
        <div className="rfields">
          <label className="rfield wide">
            <span>{id === 'allowlist' ? 'wallets allowed to buy and hold it' : 'wallets that can never buy or hold it'} ({parsed.wallets.length})</span>
            <textarea rows={4} value={form.listText} onChange={(e) => set('listText', e.target.value)} placeholder={'one address per line'} />
            <em>you approve the list in your wallet right after the launch, 24 wallets per transaction. for a day you can keep adding from the coin page.</em>
          </label>
          {parsed.invalid.length > 0 && <div className="err">not wallet addresses: {parsed.invalid.slice(0, 3).join(', ')}{parsed.invalid.length > 3 ? ` and ${parsed.invalid.length - 3} more` : ''}</div>}
          <label className="check"><input type="checkbox" checked={form.seal} onChange={(e) => set('seal', e.target.checked)} /> seal the list right after launch, so nobody can change it</label>
        </div>
      );
    }
    case 'window': return <div className="rfields two"><Num label="for the first (minutes)" k="earlyMins" form={form} set={set} min={1} max={1440} step={1} /><Num label="cap in the window (% of supply)" k="earlyCap" form={form} set={set} min={0.1} max={100} /></div>;
    case 'ramp': return (
      <div className="rfields two">
        <Num label="starts at (% of supply)" k="rampStart" form={form} set={set} min={0.1} hint={maxWalletPct > 0 ? `rises to your max per wallet, ${maxWalletPct}%.` : 'pick a max per wallet above first.'} />
        <Num label="rises over (minutes)" k="rampMins" form={form} set={set} min={1} max={10080} step={1} />
      </div>
    );
    case 'tradeGuard': return <div className="rfields"><Num label="most one buy can move (% of supply)" k="tradeGuard" form={form} set={set} min={0.1} max={100} /></div>;
    case 'snipe': return <div className="rfields three"><Num label="for the first (minutes)" k="snipeMins" form={form} set={set} min={1} max={1440} step={1} /><Num label="max priority fee (micro-lamports per CU)" k="snipeCu" form={form} set={set} min={0} step={1000} /><Num label="max Jito tip (SOL)" k="snipeTip" form={form} set={set} min={0} step={0.0001} /></div>;
    case 'antiDump': return <div className="rfields two"><Num label="max per buy (% of supply)" k="dumpBuy" form={form} set={set} min={0} max={100} hint="0 = no cap on buys. your first buy is exempt." /><Num label="max per sell (% of supply)" k="dumpSell" form={form} set={set} min={0} max={100} hint="your sells too." /></div>;
    case 'sellScale': return <div className="rfields three"><Num label="small holders sell up to (%)" k="gsSmall" form={form} set={set} min={0.02} max={100} /><Num label="biggest bags sell up to (%)" k="gsFloor" form={form} set={set} min={0.01} max={100} /><Num label="from a bag of (%)" k="gsBag" form={form} set={set} min={0.1} max={100} /></div>;
    case 'chapters': return <div className="rfields two"><Num label="max per wallet in chapter 1 (%)" k="chStart" form={form} set={set} min={0.1} max={100} /><Num label="volume per chapter (million tokens)" k="chVolume" form={form} set={set} min={0.001} hint="the cap doubles every time this much more trades." /></div>;
    case 'market': return <div className="rfields"><label className="check"><input type="checkbox" checked={!form.hoursSells} onChange={(e) => set('hoursSells', !e.target.checked)} /> sells stay open around the clock</label></div>;
    case 'hours': return (
      <div className="rfields">
        <div className="days">{DAYS.map((d, i) => <button type="button" key={d} className={form.hoursDays & (1 << i) ? 'on' : ''} onClick={() => set('hoursDays', Number(form.hoursDays) ^ (1 << i))}>{d}</button>)}</div>
        <div className="three">
          <label className="rfield"><span>opens</span><input type="time" value={form.hoursOpen} onChange={(e) => set('hoursOpen', e.target.value)} /></label>
          <label className="rfield"><span>closes</span><input type="time" value={form.hoursClose} onChange={(e) => set('hoursClose', e.target.value)} /></label>
          <label className="rfield"><span>time zone</span><select value={form.tz} onChange={(e) => set('tz', Number(e.target.value))} style={{ width: '100%' }}>{TZS.map((z) => <option key={z} value={z}>{tzText(z)}{z === myTz() ? ' (yours)' : ''}</option>)}</select></label>
        </div>
        <div className="two">
          <label className="rfield"><span>daylight saving</span><select value={form.hoursDst} onChange={(e) => set('hoursDst', Number(e.target.value))} style={{ width: '100%' }}><option value={0}>none: a fixed offset</option><option value={1}>US rules</option><option value={2}>European rules</option></select></label>
          <label className="rfield"><span>outside the hours</span><select value={form.hoursSells ? 1 : 0} onChange={(e) => set('hoursSells', e.target.value === '1')} style={{ width: '100%' }}><option value={0}>buys closed, sells open</option><option value={1}>buys and sells closed</option></select></label>
        </div>
        <em className="muted xs">pick the zone's standard offset; daylight saving adds the hour on chain. closing before opening runs overnight.</em>
      </div>
    );
    default: return null;
  }
}

/** The picker: every rule by group, a checkbox each, its fields when picked. */
export default function RulesPicker({ form, setForm, maxWalletPct = 0, disabled = false }) {
  const set = (k, v) => setForm({ ...form, [k]: v });
  return (
    <div className="rules">
      {GROUPS.map((g) => (
        <div key={g} className="rgroup">
          <div className="muted xs">{g}</div>
          {CATALOG.filter((x) => x.group === g).map((x) => (
            <div key={x.id} className={`rule ${form.on[x.id] ? 'on' : ''}`}>
              <label className="check"><input type="checkbox" checked={Boolean(form.on[x.id])} disabled={disabled} onChange={(e) => setForm(withRule(form, x.id, e.target.checked))} /> <b>{x.t}</b> <span className="muted">{x.s}</span></label>
              {form.on[x.id] && <>
                <p className="muted xs" style={{ margin: 0 }}>{x.d}</p>
                <Fields id={x.id} form={form} set={set} maxWalletPct={maxWalletPct} />
              </>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** A rules object in words: one line per rule. */
export function RulesLines({ lines, className = 'sm' }) {
  if (!lines?.length) return null;
  return <div className={className} style={{ display: 'grid', gap: 4 }}>{lines.map((l) => <div key={l.t}><span className="muted">{l.t}:</span> {l.d}</div>)}</div>;
}
