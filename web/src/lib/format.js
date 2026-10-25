export const short = (a, n = 4) => (a ? `${a.slice(0, n)}…${a.slice(-n)}` : '');
export const shortName = (a) => (a ? a.slice(0, 6) : '');
/** pump.fun's compact dollar figure: $5.2K, $1.03M */
export function usdK(n) {
  if (n == null || !Number.isFinite(n)) return '–';
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}K`;
  return `$${n.toFixed(n >= 1 ? 0 : 2)}`;
}
export const sol = (n, dp = 3) => (n == null || !Number.isFinite(Number(n)) ? '–' : `${Number(n).toLocaleString('en-US', { maximumFractionDigits: dp })} SOL`);
export const lamportsToSol = (l) => Number(l) / 1e9;
export const tokens = (units) => { const n = Number(units) / 1e6; return n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(n < 1 ? 4 : 0); };
export function ago(ms) {
  if (!ms) return '–';
  const s = Math.max(0, (Date.now() - Number(ms)) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
export const pumpLink = (mint) => `https://pump.fun/coin/${mint}`;
/** A stable pastel for an address (the ticker boxes and avatars), like the old site's random user colours. */
const PALETTE = ['#60a5fa', '#f472b6', '#fbbf24', '#34d399', '#a78bfa', '#fb923c', '#f87171', '#22d3ee'];
export const colorOf = (s) => { let h = 0; for (const c of String(s || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; };
