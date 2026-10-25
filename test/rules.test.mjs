import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PublicKey } from '@solana/web3.js';
process.env.DB_PATH = '/tmp/oldpump-rules-test.db';
const { creatorRules, publicRules, anyCreatorRule, CREATOR_RULE_KEYS } = await import('../api/creator-rules.mjs');
const { DEFAULT_RULES, encodeRules, decodeRules } = await import('../hk/lib/rules.mjs');
const { DEFAULT_FORM, toRules, withRule, describeRules, parseWallets, CATALOG } = await import('../web/src/lib/rulesText.js');

const DEV = new PublicKey('11111111111111111111111111111112');
const onChain = (creator) => decodeRules(encodeRules({ ...DEFAULT_RULES, ...creator, dev: DEV, platformOn: true, platform: DEV, openSecs: 5, closeSecs: 0, bundleMax: 1 }));

test('creatorRules: nothing sent = nothing on; unknown fields ignored; the window max per wallet carried', () => {
  assert.deepEqual(creatorRules(undefined), {});
  assert.deepEqual(creatorRules({ kingOn: true, fomoOnly: true, platformOn: false, bundleMax: 20, feeCapBps: 500 }), {}); // never creator-settable
  assert.deepEqual(creatorRules({}, { maxWalletBps: 200 }), { maxWalletBps: 200 });
  assert.equal(anyCreatorRule({}), false);
  assert.equal(anyCreatorRule({ maxWalletBps: 100 }), true);
});
test('creatorRules: ranges and clashes refused in the form\'s words', () => {
  assert.throws(() => creatorRules({ maxBuyBps: 5 }), /0\.1% and 100%/);
  assert.throws(() => creatorRules({ maxBuyBps: 100, tradeGuardBps: 100 }), /pick one/);
  assert.throws(() => creatorRules({ hoursDays: 62 }), /without the rule/);
  assert.throws(() => creatorRules({ potatoMinBps: 'abc' }), /whole number/);
  assert.throws(() => creatorRules({ oscKind: 9 }), /out of range/);
  assert.throws(() => creatorRules({ rampSecs: 60, rampStartBps: 50 }), /Rising max per wallet needs a max per wallet/);
  assert.throws(() => creatorRules([1]), /object/);
});
test('creatorRules: chapters replace the max per wallet', () => {
  const r = creatorRules({ chapterStartBps: 100, chapterVolume: 1e12 }, { maxWalletBps: 300 });
  assert.equal(r.maxWalletBps, 0); assert.equal(r.chapterStartBps, 100);
});
test('every picked rule in the form encodes, decodes and reads back the same (and the hook accepts it)', () => {
  for (const x of CATALOG) {
    const form = withRule({ ...DEFAULT_FORM, listText: '' }, x.id, true);
    const maxWallet = x.id === 'ramp' ? 3 : 0;
    const sent = toRules(form, maxWallet);
    const clean = creatorRules(sent, { maxWalletBps: maxWallet * 100 });
    const back = publicRules(onChain(clean));
    assert.ok(back.any, `${x.id} reads back as on`);
    for (const k of CREATOR_RULE_KEYS) assert.equal(back[k], clean[k] ?? (typeof back[k] === 'boolean' ? false : 0), `${x.id}: ${k} survives the chain`);
    assert.ok(back.lines.length >= 1 && back.lines.some((l) => l.t !== 'creator\'s wallet'), `${x.id} is described: ${back.lines.map((l) => l.t).join(', ')}`);
    assert.deepEqual(back.lines, describeRules(sent), `${x.id}: the modal's words are the coin page's words`);
  }
});
test('market hours read back as market hours, with daylight saving and holidays', () => {
  const form = withRule(DEFAULT_FORM, 'market', true);
  const back = publicRules(onChain(creatorRules(toRules(form))));
  assert.ok(back.hoursHolidays && back.hoursDst === 1 && back.tzOffsetMin === -300 && back.hoursDays === 62);
  assert.match(back.lines[0].d, /monday to friday, 09:30 to 16:00 \(New York time\), and not on US stock market holidays/);
});
test('clashing picks switch each other off', () => {
  let f = withRule(DEFAULT_FORM, 'antiDump', true);
  f = withRule(f, 'tradeGuard', true);
  assert.ok(f.on.tradeGuard && !f.on.antiDump);
  f = withRule(f, 'breath', true); f = withRule(f, 'coupled', true);
  assert.ok(f.on.coupled && !f.on.breath && f.oscCoupling === 20);
});
test('parseWallets: unique, reports junk', () => {
  const r = parseWallets(`${DEV.toBase58()}\n${DEV.toBase58()}, nope`);
  assert.deepEqual(r.wallets, [DEV.toBase58()]); assert.deepEqual(r.invalid, ['nope']);
});
