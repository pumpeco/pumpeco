// The hook rules a creator can put on a window launch: the picker's catalog, the form's defaults, the form → rules
// conversion (units as hk/lib/rules.mjs wants them: bps, seconds, base units) and the plain-words description of a
// rules object (the create modal and the coin page). Shared by the site and the API (api/creator-rules.mjs), so the
// words a creator reads before launching are the words everyone reads on the coin page after.
//
// Every rule here is already compiled into the hook on mainnet (hk/hook): the API only switches them on per launch.
// Not offered on pump.eco: plague, hot potato, ping pong and the four oscillator caps (operator, 25 Oct), King of the Hill (a keeper pays SOL from the hot wallet), P2P-only (only the creator could
// fill the curve), FOMO-only / app-only (need a co-signer or clash with the platform wallet), the graduation
// settlement rules (size fee, burn, holder share).
import bs58 from 'bs58';

export const GROUPS = ['who can hold', 'fair launch', 'when it trades'];

/** id → what the picker shows. `s` is the one-liner, `d` the explanation under it when picked. */
export const CATALOG = [
  { id: 'allowlist', group: 'who can hold', t: 'allowlist', s: 'only wallets on your list can buy and hold it.', d: 'only the wallets you list can buy it or be sent it. you fill the list right after launch (one wallet approval per 24 wallets) and can seal it; for a day you can keep adding. sells always work.' },
  { id: 'blocklist', group: 'who can hold', t: 'blocklist', s: 'named wallets can never receive it.', d: 'the wallets you list can never buy it or be sent it while it is on its curve. known snipers and bundlers stay out. anyone else trades as normal.' },
  { id: 'window', group: 'fair launch', t: 'launch window cap', s: 'a tighter max per wallet for the first minutes, against snipers.', d: 'for the first minutes after launch a tighter cap applies, so nobody can load up while the price is lowest. when the window ends the normal cap takes over.' },
  { id: 'ramp', group: 'fair launch', t: 'rising max per wallet', s: 'max per wallet starts small and rises on a timer.', d: 'the max per wallet starts at a small share of supply and rises evenly to the full cap over the time you pick. needs a max per wallet above.' },
  { id: 'tradeGuard', group: 'fair launch', t: 'trade guard', s: 'no single buy can move more than a set share of supply.', d: 'any one buy or transfer can move at most the share of supply you pick. big buyers have to split up. sells are never limited.' },
  { id: 'snipe', group: 'fair launch', t: 'sniper-fee cap', s: 'buys paying sniper-sized priority fees are refused at launch.', d: 'for the first minutes after launch a buy is refused if its transaction pays a priority fee above your cap, or tips a Jito tip account more than your cap in the same transaction.' },
  { id: 'antiDump', group: 'fair launch', t: 'anti-dump caps', s: 'separate caps on one buy and one sell, so nobody dumps a bag at once.', d: 'buys and sells are capped on their own: buyers can come in freely while no single sell can unload a big bag. the sell cap holds for you too.' },
  { id: 'sellScale', group: 'fair launch', t: 'graduated sell caps', s: 'the bigger the bag, the smaller one sell can be.', d: 'small holders sell freely. as a bag grows, the most it can sell in one go shrinks, down to a floor, so a whale can build a position but has to leave in small pieces. you too.' },
  { id: 'chapters', group: 'fair launch', t: 'chapters', s: 'max per wallet starts small and doubles every chapter of volume.', d: 'a max per wallet that grows with the coin: it starts at the share you pick and doubles every time another chapter of volume trades. replaces the max per wallet above. sells always work.' },
  { id: 'hours', group: 'when it trades', t: 'trading hours', s: 'buys only on the days and hours you set, in any time zone.', d: 'it can only be bought on the days and between the times you pick. outside them holders can still sell, unless you close sells too.' },
  { id: 'market', group: 'when it trades', t: 'market hours', s: 'trades like a stock: weekdays 9:30 to 16:00 New York time.', d: 'monday to friday, 9:30 to 16:00 in New York, following daylight saving on chain, closed on US stock market holidays.' },
  { id: 'dexOnly', group: 'when it trades', t: 'trade only', s: 'no wallet-to-wallet sends: every move is a trade.', d: 'it only moves when it is bought from or sold to its curve. a plain wallet-to-wallet send is refused, yours included.' },
];
export const byId = Object.fromEntries(CATALOG.map((x) => [x.id, x]));

/** Picking one of these switches the others off (they cap the same thing). */
export const CLASH = {
  antiDump: ['tradeGuard', 'sellScale'], tradeGuard: ['antiDump'], sellScale: ['antiDump'],
  chapters: ['ramp'], ramp: ['chapters'],
  market: ['hours'], hours: ['market'],
};
/** The time zone the browser is in, as minutes east of UTC (standard time, so daylight saving can be added on chain). */
export const myTz = () => { try { const d = new Date(); const jan = new Date(d.getFullYear(), 0, 1).getTimezoneOffset(), jul = new Date(d.getFullYear(), 6, 1).getTimezoneOffset(); return -Math.max(jan, jul); } catch { return 0; } };
export const TZS = [-720, -660, -600, -540, -480, -420, -360, -300, -240, -210, -180, -120, -60, 0, 60, 120, 180, 210, 240, 270, 300, 330, 345, 360, 390, 420, 480, 540, 570, 600, 660, 720, 780, 840];

/** The form's state: every rule off, with sensible numbers ready for when it is picked. */
export const DEFAULT_FORM = Object.freeze({
  on: {},                                   // id → true when picked
  listText: '', seal: true,
  earlyMins: 5, earlyCap: 0.5,
  rampStart: 0.5, rampMins: 30,
  tradeGuard: 1,
  snipeMins: 5, snipeCu: 100000, snipeTip: 0.0001,
  dumpBuy: 1, dumpSell: 0.25,
  gsSmall: 1, gsFloor: 0.1, gsBag: 3,
  chStart: 1, chVolume: 10,
  hoursDays: 62, hoursOpen: '09:30', hoursClose: '16:00', tz: 0, hoursDst: 0, hoursSells: false,
});

/** Switches a rule on or off, turning off what it clashes with (market hours load their preset). */
export function withRule(form, id, want) {
  const on = { ...form.on };
  let n = { ...form, on };
  if (want) for (const o of CLASH[id] ?? []) delete on[o];
  if (want) on[id] = true; else delete on[id];
  if (want && id === 'market') n = { ...n, hoursDays: 62, hoursOpen: '09:30', hoursClose: '16:00', tz: -300, hoursDst: 1 };
  return n;
}
export const anyOn = (form) => Object.keys(form.on).length > 0;

const bps = (pct) => Math.round(Number(pct) * 100);
const toMin = (hhmm) => { const [h, m] = String(hhmm || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
/**
 * The rules object the API takes (`window.rules`), from the form and the max per wallet picked above it (percent).
 * Keys match hk/lib/rules.mjs; only the rules a creator may set are present.
 */
export function toRules(form, maxWalletPct = 0) {
  const on = form.on;
  const hours = on.hours || on.market;
  const r = {
    maxWalletBps: maxWalletPct > 0 && !on.chapters ? bps(maxWalletPct) : 0,
    earlySecs: on.window ? Math.round(Number(form.earlyMins) * 60) : 0,
    earlyMaxWalletBps: on.window ? bps(form.earlyCap) : 0,
    rampSecs: on.ramp && maxWalletPct > 0 ? Math.round(Number(form.rampMins) * 60) : 0,
    rampStartBps: on.ramp && maxWalletPct > 0 ? bps(form.rampStart) : 0,
    tradeGuardBps: on.tradeGuard ? bps(form.tradeGuard) : 0,
    snipeSecs: on.snipe ? Math.round(Number(form.snipeMins) * 60) : 0,
    snipeMaxCuPrice: on.snipe ? Math.round(Number(form.snipeCu)) : 0,
    snipeMaxTip: on.snipe ? Math.round(Number(form.snipeTip) * 1e9) : 0,
    allowlist: !!on.allowlist, blocklist: !!on.blocklist,
    hoursOn: !!hours, hoursDays: hours ? Number(form.hoursDays) : 0, hoursOpenMin: hours ? toMin(form.hoursOpen) : 0, hoursCloseMin: hours ? toMin(form.hoursClose) : 0,
    tzOffsetMin: hours ? Number(form.tz) : 0, hoursDst: hours ? Number(form.hoursDst) : 0, hoursSells: hours ? !!form.hoursSells : false, hoursHolidays: !!on.market,
    maxBuyBps: on.antiDump ? bps(form.dumpBuy) : 0, maxSellBps: on.antiDump ? bps(form.dumpSell) : 0,
    sellSmallBps: on.sellScale ? bps(form.gsSmall) : 0, sellFloorBps: on.sellScale ? bps(form.gsFloor) : 0, sellBagBps: on.sellScale ? bps(form.gsBag) : 0,
    chapterStartBps: on.chapters ? bps(form.chStart) : 0, chapterVolume: on.chapters ? Math.round(Number(form.chVolume) * 1e12) : 0, // million tokens → base units (6 decimals)
    dexOnly: !!on.dexOnly,
  };
  return r;
}

/** Wallet addresses from pasted text (lines, commas, spaces), unique, with anything unreadable reported. */
export function parseWallets(text) {
  const valid = new Map(), invalid = [];
  for (const raw of String(text ?? '').split(/[\s,;]+/)) {
    const w = raw.trim();
    if (!w) continue;
    try { const b = bs58.decode(w); if (b.length !== 32) throw new Error(); valid.set(w, b); } catch { invalid.push(w); }
  }
  return { wallets: [...valid.keys()], invalid };
}

// ── words ────────────────────────────────────────────────────────────────────────────────────────
const pct = (b) => `${Number((b / 100).toFixed(2))}%`;
const duration = (s) => (s % 86400 === 0 && s >= 86400 ? `${s / 86400} day${s === 86400 ? '' : 's'}` : s % 3600 === 0 && s >= 3600 ? `${s / 3600} hour${s === 3600 ? '' : 's'}` : s % 60 === 0 && s >= 60 ? `${s / 60} minute${s === 60 ? '' : 's'}` : `${s} second${s === 1 ? '' : 's'}`);
const tokens = (units) => { const n = Number(units) / 1e6; return n >= 1e6 ? `${Number((n / 1e6).toFixed(2))}M` : n >= 1e3 ? `${Number((n / 1e3).toFixed(1))}K` : `${Number(n.toFixed(n < 1 ? 6 : 0))}`; };
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
export const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
export const tzText = (off) => (off === 0 ? 'UTC' : `UTC${off > 0 ? '+' : '-'}${Math.floor(Math.abs(off) / 60)}${Math.abs(off) % 60 ? `:${String(Math.abs(off) % 60).padStart(2, '0')}` : ''}`);
const daysText = (mask) => (mask === 127 ? 'every day' : mask === 62 ? 'monday to friday' : mask === 65 ? 'on weekends' : 'on ' + DAYS.filter((_, i) => mask & (1 << i)).join(', '));

/**
 * The rules of a window launch in plain words: [{ t, d }]. `r` is a rules object (the form's `toRules` output or the
 * chain's decoded config). Only the creator-settable rules are described; the window's own fixed rules (opening delay,
 * one buy per block, migration) are worded by the coin page itself.
 */
export function describeRules(r) {
  if (!r) return [];
  const out = [];
  const market = r.hoursOn && r.hoursHolidays && r.hoursDst === 1 && r.tzOffsetMin === -300 && r.hoursDays === 62 && r.hoursOpenMin === 570 && r.hoursCloseMin === 960;
  if (r.earlySecs > 0) out.push({ t: 'launch window cap', d: `for the first ${duration(r.earlySecs)} after launch, no wallet can hold more than ${pct(r.earlyMaxWalletBps)} of supply.` });
  if (r.maxWalletBps > 0 && !(r.rampSecs > 0)) out.push({ t: 'max per wallet', d: `no wallet can hold more than ${pct(r.maxWalletBps)} of supply.` });
  if (r.rampSecs > 0) out.push({ t: 'rising max per wallet', d: `the max per wallet starts at ${pct(r.rampStartBps)} of supply and rises evenly to ${pct(r.maxWalletBps)} over ${duration(r.rampSecs)}.` });
  if (r.allowlist) out.push({ t: 'allowlist', d: 'only wallets on the creator\'s list can buy it or be sent it. the list is public on chain.' });
  if (r.blocklist) out.push({ t: 'blocklist', d: 'wallets on the creator\'s list can never buy it or be sent it. the list is public on chain.' });
  if (r.tradeGuardBps > 0) out.push({ t: 'trade guard', d: `no single buy or transfer can move more than ${pct(r.tradeGuardBps)} of supply. sells are never limited.` });
  if (r.snipeSecs > 0) out.push({ t: 'sniper-fee cap', d: `for the first ${duration(r.snipeSecs)}, a buy paying more than ${Number(r.snipeMaxCuPrice).toLocaleString('en-US')} micro-lamports per compute unit in priority fees, or tipping a Jito tip account more than ${Number((Number(r.snipeMaxTip) / 1e9).toFixed(6))} SOL in the same transaction, is refused.` });
  if (r.hoursOn) {
    const zone = market ? 'New York time' : `${tzText(r.tzOffsetMin)}${r.hoursDst === 1 ? ', plus an hour during US daylight saving' : r.hoursDst === 2 ? ', plus an hour during European summer time' : ''}`;
    out.push({ t: market ? 'market hours' : 'trading hours', d: `it can only be ${r.hoursSells ? 'bought and sold' : 'bought'} ${daysText(r.hoursDays)}, ${hhmm(r.hoursOpenMin)} to ${hhmm(r.hoursCloseMin)} (${zone})${r.hoursHolidays ? ', and not on US stock market holidays' : ''}. ${r.hoursSells ? 'sending between wallets always works.' : 'selling always works.'}` });
  }
  if (r.maxBuyBps > 0 || r.maxSellBps > 0) out.push({ t: 'anti-dump caps', d: [r.maxBuyBps > 0 && `one buy can take at most ${pct(r.maxBuyBps)} of supply.`, r.maxSellBps > 0 && `one sell can move at most ${pct(r.maxSellBps)}, the creator's included.`].filter(Boolean).join(' ') });
  if (r.sellBagBps > 0) out.push({ t: 'graduated sell caps', d: `small holders can sell up to ${pct(r.sellSmallBps)} of supply at once. the bigger the bag, the smaller one sell can be, down to ${pct(r.sellFloorBps)} for wallets holding ${pct(r.sellBagBps)} or more. the creator too.` });
  if (r.plagueDose > 0) out.push({ t: 'plague', d: `nobody can simply buy it: a wallet can only buy once it holds at least ${tokens(r.plagueDose)} tokens, and the first tokens have to be sent by a holder. selling is never restricted.` });
  if (r.dexOnly) out.push({ t: 'trade only', d: 'it only moves in trades with its curve. wallet-to-wallet sends are refused, the creator\'s included.' });
  if (r.potatoOn) out.push({ t: 'hot potato', d: `whoever bought last cannot sell or send until a different wallet buys after them${r.potatoMinBps ? ` (with at least ${pct(r.potatoMinBps)} of supply)` : ''}${r.potatoColdSecs ? `, or nobody buys for ${duration(r.potatoColdSecs)}` : ''}. nobody is exempt, the creator included.` });
  if (r.pingOn) out.push({ t: 'ping pong', d: `buys and sells take turns, for everyone. trades under ${pct(r.pingMinBps)} of supply go through on their own turn without handing it over${r.pingFreeSecs ? `, and after ${duration(r.pingFreeSecs)} without a turn either side can go` : ''}. one transaction cannot take both turns.` });
  if (r.chapterStartBps > 0) out.push({ t: 'chapters', d: `no wallet can hold more than ${pct(r.chapterStartBps)} of supply at first. the cap doubles every time another ${tokens(r.chapterVolume)} tokens trade.` });
  if (r.oscKind === 1) out.push({ t: 'breathing cap', d: `the most one buy can take swings around ${pct(r.oscBaseBps)} of supply by ${r.oscAmpPct}% on a ${duration(r.oscPeriod)} cycle, never below ${pct(r.oscFloorBps)}. sells are never capped.` });
  if (r.oscKind >= 2) out.push({ t: ['', '', 'momentum', 'resonance', 'coupled resonator'][r.oscKind], d: `the most one buy can take rests at ${pct(r.oscBaseBps)} of supply. every buy kicks an oscillator with a ${duration(r.oscPeriod)} period${r.oscKind === 4 ? ` coupled ${r.oscCouplingPct}% to a second one` : ''}, so the cap swings up and back${r.oscKind === 3 ? ', furthest when buys land on its beat' : ''}, and settles at ${r.oscDampPermille / 10}% per second, never below ${pct(r.oscFloorBps)}. sells are never capped.` });
  const exempt = r.maxWalletBps > 0 || r.earlySecs > 0 || r.allowlist || r.blocklist || r.tradeGuardBps > 0 || r.snipeSecs > 0 || r.hoursOn || r.maxBuyBps > 0 || r.plagueDose > 0 || r.chapterStartBps > 0 || r.oscKind > 0;
  if (exempt) out.push({ t: 'creator\'s wallet', d: 'the creator\'s wallet is exempt from the rules about buying and holding (not from sell caps). check what it holds.' });
  return out;
}
