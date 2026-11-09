// scripts/check-ids.mjs - 校验页面元素 id 与脚本引用是否一致
// 用法：node scripts/check-ids.mjs [仓库根目录]
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || process.cwd());
const html = readFileSync(path.join(root, 'index.html'), 'utf8');
const app = readFileSync(path.join(root, 'js', 'app.js'), 'utf8');

const ids = [...app.matchAll(/\$\('([a-zA-Z0-9-]+)'\)/g)].map((m) => m[1]);
const unique = [...new Set(ids)];
const missing = unique.filter((id) => !html.includes(`id="${id}"`));

const htmlIds = [...html.matchAll(/id="([a-zA-Z0-9-]+)"/g)].map((m) => m[1]);
const dupes = [...new Set(htmlIds.filter((id, i) => htmlIds.indexOf(id) !== i))];

console.log(`referenced ids: ${unique.length}`);
console.log(missing.length ? `MISSING: ${missing.join(', ')}` : 'all ids exist');
console.log(dupes.length ? `duplicate ids: ${dupes.join(', ')}` : 'no duplicate ids');

if (missing.length > 0 || dupes.length > 0) {
    console.error('页面 id 校验失败：脚本引用了不存在的元素，或 HTML 存在重复 id');
    process.exitCode = 1;
}
