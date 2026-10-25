async function req(path, opts = {}) {
  const r = await fetch(path, { cache: 'no-store', ...opts });
  const text = await r.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch {}
  if (!r.ok) throw Object.assign(new Error(body?.error || `Request failed (${r.status})`), { status: r.status, stage: body?.stage ?? null });
  return body;
}
const post = (path, data) => req(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });

export const api = {
  config: () => req('/api/config'),
  configFor: (wallet) => req(`/api/config?wallet=${encodeURIComponent(wallet)}`),
  coins: (sort, order, q) => req(`/api/coins?sort=${sort}&order=${order}${q ? `&q=${encodeURIComponent(q)}` : ''}`),
  coin: (mint) => req(`/api/coins/${mint}`),
  chart: (mint, interval) => req(`/api/coins/${mint}/chart${interval ? `?interval=${interval}` : ''}`),
  ticker: () => req('/api/ticker'),
  pairs: () => req('/api/pairs'),
  pair: (mint) => req(`/api/pairs/${mint}`),
  reply: (mint, data) => post(`/api/coins/${mint}/replies`, data),
  prepareLaunch: (form) => post('/api/launch/prepare', form),
  submitLaunch: (mint, transaction) => post('/api/launch/submit', { mint, transaction }),
  listTxs: (data) => post('/api/launch/list', data),
  submitList: (mint, transaction) => post('/api/launch/list/submit', { mint, transaction }),
  prepareTrade: (data) => post('/api/trade/prepare', data),
  submitTrade: (transaction) => post('/api/trade/submit', { transaction }),
};
