/** Proves the Pinata path end to end: pins an image + metadata exactly as a launch does, reads both back through the
 *  gateway the coin records, compares the bytes. node scripts/check-pinata.mjs <image file> */
import '../api/env.mjs';
import fs from 'node:fs';
import { pinMetadata, PINATA_GATEWAY } from '../api/launch.mjs';
import * as images from '../api/images.mjs';
const bytes = fs.readFileSync(process.argv[2]);
const image = { bytes, type: images.imageType(bytes) };
const form = { name: 'Pump Family', symbol: 'PF', description: 'pinata check', socials: { twitter: 'https://x.com/thepumpfamily', website: 'https://pump.family' } };
const t0 = Date.now();
const p = await pinMetadata({ image, form });
console.log(`pinned in ${Date.now() - t0} ms: ${p.uri}`);
const get = async (u) => { for (let i = 0; i < 6; i++) { const r = await fetch(u, { headers: { 'user-agent': 'Mozilla/5.0' } }); if (r.ok) return r; await new Promise((s) => setTimeout(s, 1500)); } throw new Error(`gateway would not serve ${u}`); };
const json = await (await get(p.uri)).json();
console.log('metadata via gateway:', JSON.stringify(json));
const img = Buffer.from(await (await get(json.image)).arrayBuffer());
console.log(`image via gateway: ${img.length} B, identical to the upload: ${img.equals(bytes)}, gateway ${json.image.startsWith(PINATA_GATEWAY)}`);
process.exit(img.equals(bytes) && json.symbol === 'PF' ? 0 : 1);
