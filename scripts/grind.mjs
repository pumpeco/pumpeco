// Local grinder: builds tools/grind if needed and fills VANITY_INCOMING with `pump` keys until COUNT (default 5) are waiting.
import '../api/env.mjs';
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { INCOMING } from '../api/vanity.mjs';
const dir = new URL('../tools/grind/', import.meta.url).pathname, bin = path.join(dir, 'target/release/oldpump-grind');
if (!fs.existsSync(bin)) execSync('cargo build --release -q', { cwd: dir, stdio: 'inherit' });
const count = Number(process.argv[2] || 5);
fs.mkdirSync(INCOMING, { recursive: true });
while (fs.readdirSync(INCOMING).filter((f) => f.endsWith('pump.json')).length < count) {
  const r = spawnSync(bin, ['pump', '1', String(Math.max(1, (await import('node:os')).cpus().length - 1)), INCOMING], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status);
}
console.log(`${count} key(s) waiting in ${INCOMING}; the server imports them every minute`);
