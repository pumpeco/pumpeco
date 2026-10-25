import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
process.env.DB_PATH = '/tmp/oldpump-ticker-test.db';
for (const f of ['', '-wal', '-shm']) fs.rmSync(process.env.DB_PATH + f, { force: true });
const { tickerLockedFor, TICKER_LOCK_MS } = await import('../api/launch.mjs');
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
test('anti-vamp: a prepared launch holds the ticker 15 minutes for other wallets only, hidden coins hold it a day', () => {
  row('m4', 'PREP', 'prepared', 'walletA', 60_000);
  assert.ok(tickerLockedFor('PREP', 'walletB') > 0 && tickerLockedFor('PREP', 'walletB') <= 14 * 60_000 + 1000, 'another wallet waits');
  assert.equal(tickerLockedFor('PREP', 'walletA'), 0, 'the same wallet may re-prepare');
  row('m5', 'STALE', 'prepared', 'walletA', 16 * 60_000);
  assert.equal(tickerLockedFor('STALE', 'walletB'), 0, 'an abandoned prepare cannot squat a ticker');
  row('m6', 'HID', 'hidden', 'walletA', 60_000);
  assert.ok(tickerLockedFor('HID', 'walletB') > 0, 'a hidden coin still holds its ticker');
});
