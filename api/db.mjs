// One SQLite file (node:sqlite, no native build).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, env } from './env.mjs';

export const DB_PATH = env('DB_PATH', path.join(ROOT, 'data', 'oldpump.db'));
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
export const db = new DatabaseSync(DB_PATH);
// busy_timeout FIRST: switching the journal mode needs an exclusive lock, and two processes (API + graduator) open this file
db.exec('PRAGMA busy_timeout = 5000;');
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
CREATE TABLE IF NOT EXISTS launches (
  mint TEXT PRIMARY KEY,
  launcher TEXT NOT NULL,          -- the wallet that paid and signed: pump.fun's creator
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  description TEXT,
  image TEXT,                      -- our own copy: /api/logos/<hash>.<ext>
  metadata_uri TEXT NOT NULL,
  socials_json TEXT NOT NULL DEFAULT '{}',
  dev_buy_lamports TEXT NOT NULL DEFAULT '0',
  tx_hash TEXT,                    -- sha256 of the prepared message: submit relays only that transaction
  mint_secret TEXT,                -- the mint keypair until the coin exists (then deleted)
  status TEXT NOT NULL,            -- prepared | created | live | failed
  sig TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  live_at INTEGER,
  bumped_at INTEGER NOT NULL,      -- last launch / trade / reply: "bump order"
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS launches_status ON launches(status, bumped_at);
CREATE TABLE IF NOT EXISTS replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mint TEXT NOT NULL,
  wallet TEXT NOT NULL,
  text TEXT NOT NULL,
  signed_at INTEGER,               -- the timestamp inside the signed message: a captured reply cannot be re-posted
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS replies_mint ON replies(mint, created_at);
CREATE TABLE IF NOT EXISTS trades (
  sig TEXT PRIMARY KEY,
  mint TEXT NOT NULL,
  wallet TEXT NOT NULL,
  side TEXT NOT NULL,              -- buy | sell | create
  lamports TEXT NOT NULL,
  token_units TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS trades_mint ON trades(mint, created_at);
CREATE TABLE IF NOT EXISTS prices (
  mint TEXT NOT NULL,
  at INTEGER NOT NULL,
  price_sol REAL NOT NULL,
  cap_sol REAL NOT NULL,
  PRIMARY KEY (mint, at)
);
CREATE TABLE IF NOT EXISTS vanity (
  pubkey TEXT PRIMARY KEY,
  secret TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'fresh',   -- fresh | issued | launched
  launcher TEXT,
  issued_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

// Columns added after a table first shipped: CREATE TABLE IF NOT EXISTS never adds them to an existing database.
const addColumn = (table, col, type) => { if (!db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`); };
addColumn('replies', 'signed_at', 'INTEGER');
// window launches (Oct 2026): kind 'pump' (straight on pump.fun) | 'window' (hooked Meteora curve that graduates to pump.fun)
addColumn('launches', 'kind', "TEXT NOT NULL DEFAULT 'pump'");
addColumn('launches', 'pool', 'TEXT');
addColumn('launches', 'config', 'TEXT');
addColumn('launches', 'size_sol', 'REAL');
addColumn('launches', 'open_secs', 'INTEGER');
addColumn('launches', 'window_minutes', 'INTEGER');
addColumn('launches', 'holder_rewards', 'INTEGER NOT NULL DEFAULT 0');
// King of the hill: when the coin's market cap first crossed the bar (unix ms); the latest crowned coin still on its curve is king
addColumn('launches', 'crowned_at', 'INTEGER');
// origin 'site' (launched here) | 'external' (a pump.fun coin listed by the operator, scripts/list-coin.mjs)
addColumn('launches', 'origin', "TEXT NOT NULL DEFAULT 'site'");
// anti-vamp: the ticker lock the creator picked at launch, in ms (NULL = launched before the choice: 7 days)
addColumn('launches', 'lock_ms', 'INTEGER');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS replies_signed ON replies(wallet, signed_at)');

export const now = () => Date.now();
export const one = (sql, ...params) => db.prepare(sql).get(...params);
export const all = (sql, ...params) => db.prepare(sql).all(...params);
export const run = (sql, ...params) => db.prepare(sql).run(...params);
export const getKv = (k, fallback = null) => { const r = one('SELECT value FROM kv WHERE key = ?', k); return r ? JSON.parse(r.value) : fallback; };
export const setKv = (k, v) => run('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, JSON.stringify(v));
