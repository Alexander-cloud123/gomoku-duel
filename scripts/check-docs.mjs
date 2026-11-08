// scripts/check-docs.mjs - 校验 Markdown 中的相对链接与图片是否存在
// 用法：node scripts/check-docs.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY_DIRS = ['docs', 'lib', '.github'];
const ROOT_FILES = ['README.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md', 'THIRD_PARTY_NOTICES.md'];
const SKIP_SCHEMES = /^(?:https?:|mailto:|tel:|ftp:|data:|javascript:|\/\/)/i;

function collectMarkdown(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) collectMarkdown(full, out);
        else if (entry.name.endsWith('.md')) out.push(full);
    }
    return out;
}

function markdownFiles() {
    const files = [...ROOT_FILES.map((name) => path.join(ROOT, name)).filter((file) => fs.existsSync(file))];
    for (const dir of ENTRY_DIRS) {
        const full = path.join(ROOT, dir);
        if (fs.existsSync(full)) collectMarkdown(full, files);
    }
    return [...new Set(files)];
}

// 去掉代码块，避免把示例里的链接当成真实链接
function stripCodeBlocks(text) {
    return text.replace(/```[\s\S]*?```/g, '').replace(/~~~[\s\S]*?~~~/g, '');
}

function extractLinks(text) {
    const links = [];
    const pattern = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
    let match;
    while ((match = pattern.exec(text)) !== null) {
        let target = match[1].trim();
        if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
        links.push({ target, index: match.index });
    }
    return links;
}

function lineOf(text, index) {
    return text.slice(0, index).split('\n').length;
}

const problems = [];
let checkedLinks = 0;
let checkedFiles = 0;

for (const file of markdownFiles()) {
    checkedFiles += 1;
    const text = stripCodeBlocks(fs.readFileSync(file, 'utf8'));
    const relativeFile = path.relative(ROOT, file);
    for (const { target, index } of extractLinks(text)) {
        if (!target || SKIP_SCHEMES.test(target) || target.startsWith('#')) continue;
        const withoutHash = target.split('#')[0].split('?')[0];
        if (!withoutHash) continue;
        checkedLinks += 1;
        const resolved = path.resolve(path.dirname(file), decodeURI(withoutHash));
        if (!fs.existsSync(resolved)) {
            problems.push(`${relativeFile}:${lineOf(text, index)} → ${target}`);
        }
    }
}

if (problems.length > 0) {
    console.error(`发现 ${problems.length} 个失效链接：`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
}

console.log(`文档链接检查通过：${checkedFiles} 个 Markdown 文件，${checkedLinks} 个相对链接`);
