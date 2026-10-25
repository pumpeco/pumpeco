import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = '/tmp/oldpump-test.db';
const { validate, readImage, checkLaunchTx } = await import('../api/launch.mjs');
const { tokensForSol, solForTokens } = await import('../lib/pump.mjs');
const BN = (await import('bn.js')).default;

test('validate: name, ticker, links, first buy', () => {
  const f = validate({ name: ' Retro ', symbol: 'ret', description: 'x', devBuySol: 0.5, twitter: 'x.com/pumpdotfun', website: 'https://example.com' });
  assert.equal(f.name, 'Retro'); assert.equal(f.symbol, 'RET'); assert.equal(f.devBuyLamports, 500_000_000n);
  assert.equal(f.socials.twitter, 'https://x.com/pumpdotfun'); assert.equal(f.socials.telegram, null);
  assert.throws(() => validate({ name: '', symbol: 'A' }), /name/);
  assert.throws(() => validate({ name: 'a', symbol: 'TOO LONG!' }), /ticker/);
  assert.throws(() => validate({ name: 'a', symbol: 'A', devBuySol: 999 }), /first buy/);
  assert.throws(() => validate({ name: 'a', symbol: 'A', twitter: 'https://evil.com/x' }), /x.com/);
  assert.equal(validate({ name: 'a​b', symbol: 'A' }).name, 'ab');
});
test('readImage: type from bytes, not the label', () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
  assert.equal(readImage({ imageData: `data:image/jpeg;base64,${png.toString('base64')}` }).type, 'image/png');
  assert.throws(() => readImage({ imageData: `data:image/png;base64,${Buffer.alloc(32).toString('base64')}` }), /PNG, JPG/);
  assert.throws(() => readImage({}), /image/);
});
test('curve math: a fresh curve, buy then sell round trip loses only the fees', () => {
  const curve = { virtual_token_reserves: new BN('1073000000000000'), virtual_quote_reserves: new BN('30000000000'), real_token_reserves: new BN('793100000000000') };
  const out = tokensForSol(curve, 1_000_000_000n);
  assert.ok(out > 30_000_000_000_000n && out < 36_000_000_000_000n, String(out));
  // Selling into the curve as it stands AFTER the buy returns the SOL minus both fees (~2.5%).
  const after = { virtual_token_reserves: curve.virtual_token_reserves.sub(new BN(String(out))), virtual_quote_reserves: curve.virtual_quote_reserves.add(new BN('987500000')) };
  const back = solForTokens(after, out);
  assert.ok(back > 960_000_000n && back < 1_000_000_000n, String(back));
  assert.ok(solForTokens(curve, out) < back); // the fresh curve pays less: its price is lower
  assert.equal(tokensForSol(curve, 10n ** 15n), 793100000000000n); // never more than the curve holds
});
test('checkLaunchTx refuses a transaction that is not the prepared one', () => {
  const fake = { message: { staticAccountKeys: [{ toBase58: () => 'A' }], serialize: () => Buffer.from('x') }, signatures: [new Uint8Array(64), new Uint8Array(64)] };
  assert.throws(() => checkLaunchTx(fake, { launcher: 'B', tx_hash: 'h' }), /launching wallet/);
  assert.throws(() => checkLaunchTx(fake, { launcher: 'A', tx_hash: 'h' }), /not the transaction/i);
});
