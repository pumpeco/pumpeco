/**
 * Stages the official coin BEFORE the operator launches it on pump.fun, so go-live is instant and shows exactly this:
 *   node scripts/stage-official.mjs --image data/official-logo.png --name "Pump Eco" --symbol PUMP --wallet <creator> [--x URL] [--website URL]
 *   node scripts/stage-official.mjs --show
 */
import '../api/env.mjs';
import fs from 'node:fs';
import * as images from '../api/images.mjs';
import { stagePlan, plan } from '../api/official.mjs';
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
if (args.includes('--show') || !args.length) { console.log(JSON.stringify(plan(), null, 2)); process.exit(0); }
const name = opt('--name'), symbol = opt('--symbol'), wallet = opt('--wallet'), image = opt('--image');
if (!name || !symbol) { console.error('usage: --image <file> --name <name> --symbol <ticker> --wallet <creator> [--x URL] [--website URL]'); process.exit(1); }
if (wallet && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) { console.error('bad --wallet'); process.exit(1); }
const imageBytes = image ? fs.readFileSync(image) : null;
const p = stagePlan({ name, symbol, imageBytes, wallet, twitter: opt('--x'), website: opt('--website'), description: opt('--description') });
if (p.image) await images.squareLogo(p.image.split('/').pop()); // the 512 square now, not at go-live
console.log(JSON.stringify(p, null, 2));
process.exit(0);
