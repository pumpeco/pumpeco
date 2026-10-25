import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
process.env.DB_PATH = '/tmp/oldpump-ticker-test.db';
for (const f of ['', '-wal', '-shm']) fs.rmSync(process.env.DB_PATH + f, { force: true });
const { tickerLockedFor, tickerStatus, TICKER_LOCK_MS } = await import('../api/launch.mjs');
const { run, now } = await import('../api/db.mjs');
const row = (mint, symbol, status, launcher, agoMs) => run(`INSERT INTO launches (mint, launcher, name, symbol, metadata_uri, status, created_at, bumped_at, updated_at) VALUES (?, ?, ?, ?, 'u', ?, ?, ?, ?)`, mint, launcher, symbol, symbol, status, now() - agoMs, now(), now());

test('anti-vamp: a ticker launched here is locked for a day, for everyone, case-insensitively', () => {
  row('m1', 'PEPE', 'live', 'walletA', 3_600_000);
  const left = tickerLockedFor('pepe', 'walletB');
  assert.ok(left > 22 * 3_600_000 && left <= 23 * 3_600_000, `locked for ${left} ms`);
  assert.ok(tickerLockedFor('PEPE', 'walletA') > 0, 'the launcher cannot relaunch its own ticker either');
  assert.equal(tickerLockedFor('DOGE', 'walletB'), 0, 'another ticker is free');
});
test('anti-vamp: the lock ends after a day; failed launches never hold it', () => {
  row('m2', 'OLD', 'live', 'walletA', TICKER_LOCK_MS + 1000);
  assert.equal(tickerLockedFor('OLD', 'walletB'), 0);
  row('m3', 'BAD', 'failed', 'walletA', 1000);
  assert.equal(tickerLockedFor('BAD', 'walletB'), 0);
});
test('anti-vamp at submit (landedOnly): only landed coins count, so two wallets prepared at once do not refuse each other', () => {
  row('m7', 'RACE', 'prepared', 'walletA', 60_000);
  assert.ok(tickerLockedFor('RACE', 'walletB') > 0, 'at prepare the other wallet waits');
  assert.equal(tickerLockedFor('RACE', 'walletB', { landedOnly: true }), 0, 'at submit a prepared row does not block');
  row('m8', 'RACE', 'created', 'walletC', 1000);
  assert.ok(tickerLockedFor('RACE', 'walletB', { landedOnly: true }) > 0, 'a landed (confirming) coin blocks the submit');
});
test('anti-vamp: a prepared launch holds the ticker 15 minutes for other wallets only, hidden coins hold it a day', () => {
  row('m4', 'PREP', 'prepared', 'walletA', 60_000);
  assert.ok(tickerLockedFor('PREP', 'walletB') > 0 && tickerLockedFor('PREP', 'walletB') <= 14 * 60_000 + 1000, 'another wallet waits');
  assert.equal(tickerLockedFor('PREP', 'walletA'), 0, 'the same wallet may re-prepare');
  row('m5', 'STALE', 'prepared', 'walletA', 16 * 60_000);
  assert.equal(tickerLockedFor('STALE', 'walletB'), 0, 'an abandoned prepare cannot squat a ticker');
  row('m6', 'HID', 'hidden', 'walletA', 60_000);
  assert.ok(tickerLockedFor('HID', 'walletB') > 0, 'a hidden coin still holds its ticker');
});

test('tickerStatus (the create page hint): landed coins lock, prepared rows and junk do not, case and spaces ignored', () => {
  row('t7', 'HINT', 'live', 'walletA', 2 * 3_600_000);
  const t = tickerStatus(' hint ');
  assert.equal(t.symbol, 'HINT'); assert.equal(t.locked, true);
  assert.ok(t.left > 21 * 3_600_000 && t.left <= 22 * 3_600_000, 'about 22 hours left');
  assert.match(t.text, /HINT was launched here in the last 24 hours.*come back in 22 hours/);
  row('t8', 'SOON', 'prepared', 'walletA', 60_000);
  assert.equal(tickerStatus('SOON').locked, false, 'a prepare in flight is not shown as taken');
  assert.deepEqual(tickerStatus('not a ticker!'), { symbol: 'NOT A TICKER!', locked: false, left: 0, text: null });
  assert.equal(tickerStatus('').locked, false);
  row('t9', 'OLD', 'live', 'walletA', TICKER_LOCK_MS + 60_000);
  assert.equal(tickerStatus('OLD').locked, false, 'free again after a day');
});
