import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
// An old database (replies without signed_at) must open: the migration adds the column before the unique index.
test('an existing database from before signed_at opens', async () => {
  const p = `/tmp/oldpump-old-${process.pid}.db`;
  const old = new DatabaseSync(p);
  old.exec('CREATE TABLE replies (id INTEGER PRIMARY KEY AUTOINCREMENT, mint TEXT NOT NULL, wallet TEXT NOT NULL, text TEXT NOT NULL, created_at INTEGER NOT NULL)');
  old.exec("INSERT INTO replies (mint, wallet, text, created_at) VALUES ('m', 'w', 'hi', 1)");
  old.close();
  process.env.DB_PATH = p;
  const db = await import('../api/db.mjs');
  assert.ok(db.all("SELECT name FROM pragma_table_info('replies')").some((c) => c.name === 'signed_at'));
  assert.equal(db.one('SELECT text FROM replies').text, 'hi');
});
