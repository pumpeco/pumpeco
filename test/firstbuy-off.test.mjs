import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = '/tmp/oldpump-test-fb.db';
delete process.env.FIRST_BUYS;
const { validate, devBuyReady } = await import('../api/launch.mjs');

test('first buys off by default: a first buy is refused at validate, a launch without one passes', async () => {
  assert.throws(() => validate({ name: 'Retro', symbol: 'RET', devBuySol: 0.5 }), /First buys are off/);
  assert.equal(validate({ name: 'Retro', symbol: 'RET', devBuySol: 0 }).devBuyLamports, 0n);
  assert.equal(await devBuyReady(), false);
});
