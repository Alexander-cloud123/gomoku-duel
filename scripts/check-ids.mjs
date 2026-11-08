import { readFileSync } from 'node:fs';

const html = readFileSync('index.html', 'utf8');
const app = readFileSync('js/app.js', 'utf8');
const ids = [...app.matchAll(/\$\('([a-zA-Z0-9-]+)'\)/g)].map((m) => m[1]);
const unique = [...new Set(ids)];
const missing = unique.filter((id) => !html.includes(`id="${id}"`));
console.log(`referenced ids: ${unique.length}`);
console.log(missing.length ? `MISSING: ${missing.join(', ')}` : 'all ids exist');

const htmlIds = [...html.matchAll(/id="([a-zA-Z0-9-]+)"/g)].map((m) => m[1]);
const dupes = htmlIds.filter((id, i) => htmlIds.indexOf(id) !== i);
console.log(dupes.length ? `duplicate ids: ${dupes.join(', ')}` : 'no duplicate ids');
