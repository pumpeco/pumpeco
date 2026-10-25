/**
 * pump.fun client, driven by the IDLs pump.fun publishes on chain (vendored beside this file; create_v2,
 * buy_exact_sol_in and the account layouts are proven in ~/shill and ~/pumpeco). SOL-paired coins only.
 *
 * ⛔ A graduated coin's BondingCurve reads ALL ZEROES with complete = 1: price it from the PumpSwap pool.
 * ⛔ PumpSwap prices against vault balance + virtual_quote_reserves (signed i128 @245 since 30 Sep 2026).
 */
import { AnchorProvider, BorshCoder, Program } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import { readFileSync } from 'node:fs';

export const PUMP = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
export const PUMP_AMM = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
export const PFEE = new PublicKey('pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ');
export const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const TOKEN_2022 = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
export const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
export const WSOL = new PublicKey('So11111111111111111111111111111111111111112');
export const COIN_DECIMALS = 6;
/** Real tokens a fresh SOL-paired curve sells before it completes. */
export const CURVE_TOKENS_FOR_SALE = 793_100_000_000_000n;

const load = (f) => JSON.parse(readFileSync(new URL(f, import.meta.url)));
export const pumpIdl = load('./pump.idl.json');
export const pumpAmmIdl = load('./pump_amm.idl.json');
export const feesIdl = load('./pump_fees.idl.json');
const pumpCoder = new BorshCoder(pumpIdl);
const ammCoder = new BorshCoder(pumpAmmIdl);

const pda = (seeds, program = PUMP) => PublicKey.findProgramAddressSync(seeds, program)[0];
export const globalAddress = () => pda([Buffer.from('global')]);
export const bondingCurveAddress = (mint) => pda([Buffer.from('bonding-curve'), mint.toBuffer()]);
export const bondingCurveV2Address = (mint) => pda([Buffer.from('bonding-curve-v2'), mint.toBuffer()]);
export const creatorVaultAddress = (creator) => pda([Buffer.from('creator-vault'), creator.toBuffer()]);
export const mayhemStateAddress = (mint) => pda([Buffer.from('mayhem-state'), mint.toBuffer()]);
/** The creator of a holder-rewards coin: its creator fees accrue here and pump.fun pays them out to holders. */
export const holderRewardsAddress = (mint) => pda([Buffer.from('holder-rewards'), mint.toBuffer()]);
export const poolAuthority = (mint) => pda([Buffer.from('pool-authority'), mint.toBuffer()]);
export const poolAddress = (mint, index = 0, quoteMint = WSOL) => {
  const idx = Buffer.alloc(2);
  idx.writeUInt16LE(index);
  return pda([Buffer.from('pool'), idx, poolAuthority(mint).toBuffer(), mint.toBuffer(), quoteMint.toBuffer()], PUMP_AMM);
};
export const ata = (owner, mint, tokenProgram = TOKEN_2022) => pda([owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()], ATA_PROGRAM);

export const decodeGlobal = (data) => pumpCoder.accounts.decode('Global', data);
/** BondingCurve, read leniently: an older coin's account is shorter than the newest layout; missing fields are defaults. */
export function decodeBondingCurve(data) {
  try {
    return pumpCoder.accounts.decode('BondingCurve', data);
  } catch {
    const u64 = (o) => (data.length >= o + 8 ? new BN(data.readBigUInt64LE(o).toString()) : new BN(0));
    const key = (o) => (data.length >= o + 32 ? new PublicKey(data.subarray(o, o + 32)) : PublicKey.default);
    const byte = (o) => (data.length > o ? data[o] : 0);
    return {
      virtual_token_reserves: u64(8), virtual_quote_reserves: u64(16), real_token_reserves: u64(24), real_quote_reserves: u64(32),
      token_total_supply: u64(40), complete: Boolean(byte(48)), creator: key(49), is_mayhem_mode: Boolean(byte(81)),
      is_cashback_coin: Boolean(byte(82)), quote_mint: key(83), creator_fee_bps: u64(115), is_holder_reward: Boolean(byte(124)),
    };
  }
}
export const decodePool = (data) => ammCoder.accounts.decode('Pool', data);
export const poolVirtualQuote = (data) => {
  if (data.length >= 261) return data.readBigInt64LE(253) * (1n << 64n) + data.readBigUInt64LE(245);
  return data.length >= 253 ? data.readBigUInt64LE(245) : 0n;
};
export const tokenAccountAmount = (data) => data.readBigUInt64LE(64);
export const unitsToNumber = (units, decimals) => Number(units) / 10 ** decimals;

const readOnly = { publicKey: PublicKey.default, signTransaction: async (t) => t, signAllTransactions: async (t) => t };
const cache = new WeakMap();
/** Read-only Programs bound to a connection (instruction building needs lookups, never a wallet). */
export function programs(connection) {
  let p = cache.get(connection);
  if (!p) {
    const provider = new AnchorProvider(connection, readOnly, {});
    p = { pump: new Program(pumpIdl, provider), amm: new Program(pumpAmmIdl, provider) };
    cache.set(connection, p);
  }
  return p;
}

export async function loadGlobal(connection) {
  const acc = await connection.getAccountInfo(globalAddress());
  if (!acc) throw new Error('pump.fun Global not found: wrong cluster?');
  return decodeGlobal(acc.data);
}
const feeRecipientOf = (global) => [global.fee_recipient, ...global.fee_recipients].find((k) => !k.equals(PublicKey.default));
const buybackOf = (global) => global.buyback_fee_recipients.find((k) => !k.equals(PublicKey.default));
/** A buy or sell on a SOL curve needs the v2 curve account and the buyback wallet as remaining accounts (pump.fun, 2026). */
const curveExtras = (mint, global) => [
  { pubkey: bondingCurveV2Address(mint), isSigner: false, isWritable: true },
  { pubkey: buybackOf(global), isSigner: false, isWritable: true },
];

/** SOL-paired Token-2022 coin, pump.fun's default fee schedule; creator rewards to `creator`, or (holderRewards) to its holders forever. */
export async function createV2Ix(connection, { mint, user, name, symbol, uri, creator, holderRewards = false }) {
  return programs(connection).pump.methods
    .createV2(name, symbol, uri, creator, false, { 0: false }, { 0: new BN(0) }, { 0: Boolean(holderRewards) })
    .accountsPartial({ mint, user, mayhemTokenVault: ata(mayhemStateAddress(mint), mint, TOKEN_2022) })
    .instruction();
}

/** `buy_exact_sol_in`: spend `lamports`, receive at least `minTokensOut`. `creator` is the curve's creator. */
export async function buyExactSolInIx(connection, global, { mint, user, creator, lamports, minTokensOut = 1n }) {
  return programs(connection).pump.methods
    .buyExactSolIn(new BN(String(lamports)), new BN(String(minTokensOut)), { 0: true }, { 0: true }) // track volume; partial fill: a buy past the curve's end takes what is left and refunds the rest
    .accountsPartial({ mint, user, feeRecipient: feeRecipientOf(global), tokenProgram: TOKEN_2022, associatedUser: ata(user, mint, TOKEN_2022), creatorVault: creatorVaultAddress(creator) })
    .remainingAccounts(curveExtras(mint, global))
    .instruction();
}

/** `sell`: sell `amount` token units for at least `minSolOut` lamports. */
export async function sellIx(connection, global, { mint, user, creator, amount, minSolOut = 1n }) {
  return programs(connection).pump.methods
    .sell(new BN(String(amount)), new BN(String(minSolOut)))
    .accountsPartial({ mint, user, feeRecipient: feeRecipientOf(global), tokenProgram: TOKEN_2022, associatedUser: ata(user, mint, TOKEN_2022), creatorVault: creatorVaultAddress(creator) })
    .remainingAccounts(curveExtras(mint, global))
    .instruction();
}

/* ───────────── pricing ───────────── */

/** pump.fun's curve fee on a trade, as a fraction, estimated high (protocol + creator; the chain decides the exact tier). */
export const CURVE_FEE = 0.0125;

/** Tokens (units) a buy of `lamports` returns on this curve, before pump.fun's fee is taken off the SOL. */
export function tokensForSol(curve, lamports) {
  const vt = BigInt(curve.virtual_token_reserves.toString()), vq = BigInt(curve.virtual_quote_reserves.toString()), real = BigInt(curve.real_token_reserves.toString());
  const net = BigInt(Math.floor(Number(lamports) * (1 - CURVE_FEE)));
  if (vt <= 0n || vq <= 0n || net <= 0n) return 0n;
  const out = vt - (vq * vt) / (vq + net);
  return out > real ? real : out;
}
/** Lamports a sale of `tokens` units returns on this curve, after pump.fun's fee. */
export function solForTokens(curve, tokens) {
  const vt = BigInt(curve.virtual_token_reserves.toString()), vq = BigInt(curve.virtual_quote_reserves.toString());
  const t = BigInt(tokens);
  if (vt <= 0n || vq <= 0n || t <= 0n) return 0n;
  const gross = vq - (vq * vt) / (vt + t);
  return BigInt(Math.floor(Number(gross) * (1 - CURVE_FEE)));
}

/**
 * Where a SOL-paired coin stands: its curve (price, progress, reserves) or, graduated, its PumpSwap pool.
 * Null when the mint has no pump.fun curve.
 */
export async function coinState(connection, mint) {
  const m = mint instanceof PublicKey ? mint : new PublicKey(mint);
  const curveAddr = bondingCurveAddress(m);
  const [curveInfo, mintInfo] = await connection.getMultipleAccountsInfo([curveAddr, m]);
  if (!curveInfo || !mintInfo) return null;
  const c = decodeBondingCurve(curveInfo.data);
  const supplyUnits = mintInfo.data.length >= 44 ? mintInfo.data.readBigUInt64LE(36) : BigInt(c.token_total_supply.toString());
  // ⛔ a custom-pair coin (pump.fun quote-control, or a pump coin as quote) is priced in its QUOTE token, not SOL: priceQ/capQ
  //    are in that token, and the caller converts with the quote's price. SOL-quoted coins get priceSol/capSol as before.
  const quoteMint = c.quote_mint && !c.quote_mint.equals(PublicKey.default) ? c.quote_mint : WSOL;
  const isSol = quoteMint.equals(WSOL);
  let quoteDecimals = 9;
  if (!isSol) { const qi = await connection.getAccountInfo(quoteMint); quoteDecimals = qi && qi.data.length >= 45 ? qi.data[44] : 6; }
  const out = {
    mint: m.toBase58(), curve: curveAddr.toBase58(), creator: c.creator.toBase58(), complete: Boolean(c.complete),
    quoteMint: quoteMint.toBase58(), quoteDecimals, isSol,
    supply: unitsToNumber(supplyUnits, COIN_DECIMALS), priceSol: null, capSol: null, priceQ: null, capQ: null, progress: null, pool: null,
    realSol: isSol ? unitsToNumber(BigInt(c.real_quote_reserves.toString()), 9) : null, realQ: unitsToNumber(BigInt(c.real_quote_reserves.toString()), quoteDecimals), tokensLeft: unitsToNumber(BigInt(c.real_token_reserves.toString()), COIN_DECIMALS),
    raw: c,
  };
  if (!c.complete) {
    const vt = BigInt(c.virtual_token_reserves.toString()), vq = BigInt(c.virtual_quote_reserves.toString()), real = BigInt(c.real_token_reserves.toString());
    out.progress = Math.max(0, Math.min(1, 1 - Number(real) / Number(CURVE_TOKENS_FOR_SALE)));
    if (vt > 0n) {
      out.priceQ = unitsToNumber(vq, quoteDecimals) / unitsToNumber(vt, COIN_DECIMALS);
      out.capQ = out.priceQ * out.supply;
      if (isSol) { out.priceSol = out.priceQ; out.capSol = out.capQ; }
    }
    return out;
  }
  out.progress = 1;
  const poolAddr = poolAddress(m, 0, quoteMint), info = await connection.getAccountInfo(poolAddr);
  if (!info || info.data.length < 200) return out;
  const pool = decodePool(info.data);
  out.pool = poolAddr.toBase58();
  const [b, q] = await connection.getMultipleAccountsInfo([pool.pool_base_token_account, pool.pool_quote_token_account]);
  if (b && q) {
    const bb = unitsToNumber(tokenAccountAmount(b.data), COIN_DECIMALS), qq = unitsToNumber(tokenAccountAmount(q.data) + poolVirtualQuote(info.data), quoteDecimals);
    if (bb > 0 && qq > 0) { out.priceQ = qq / bb; out.capQ = out.priceQ * out.supply; if (isSol) { out.priceSol = out.priceQ; out.capSol = out.capQ; } }
  }
  return out;
}

/* ───────────── the launch lookup table ─────────────
 * create_v2 + first buy is ~1,240 B plain, over Solana's 1,232: the launch-independent accounts (programs, pump.fun's
 * global, fee config, buyback wallet …) come from one address lookup table, made once by scripts/make-lut.mjs. */

const keysOfIxs = (ixs) => new Set(ixs.flatMap((ix) => [ix.programId.toBase58(), ...ix.keys.map((k) => k.pubkey.toBase58())]));
/** Every account two unrelated launches (different mint, user) share: what the table holds. */
export async function launchStaticAccounts(connection) {
  const { Keypair, ComputeBudgetProgram } = await import('@solana/web3.js');
  const global = await loadGlobal(connection);
  const sets = [];
  for (let i = 0; i < 2; i++) {
    const mint = Keypair.generate().publicKey, user = Keypair.generate().publicKey;
    const ixs = [ComputeBudgetProgram.setComputeUnitLimit({ units: 1 }), await createV2Ix(connection, { mint, user, name: 'x', symbol: 'X', uri: 'https://x', creator: user }),
      await buyExactSolInIx(connection, global, { mint, user, creator: user, lamports: 1n, minTokensOut: 1n })];
    sets.push(keysOfIxs(ixs));
  }
  return [...sets[0]].filter((k) => sets[1].has(k)).map((k) => new PublicKey(k));
}
export async function loadLookupTable(connection, address) {
  const r = await connection.getAddressLookupTable(new PublicKey(address));
  return r.value;
}
