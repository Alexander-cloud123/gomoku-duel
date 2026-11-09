// tests/scripts.test.mjs - 校验工具脚本自身的行为（失败时必须让 CI 变红）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'check-ids.mjs');

function run(files) {
    const dir = mkdtempSync(path.join(tmpdir(), 'gomoku-ids-'));
    try {
        mkdirSync(path.join(dir, 'js'));
        writeFileSync(path.join(dir, 'index.html'), files.html);
        writeFileSync(path.join(dir, 'js', 'app.js'), files.app);
        const result = spawnSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8' });
        return { status: result.status, stdout: result.stdout, stderr: result.stderr };
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

test('id 一致时退出码为 0', () => {
    const result = run({
        html: '<div id="a"></div><div id="b"></div>',
        app: "const a = $('a'); const b = $('b');"
    });
    assert.equal(result.status, 0, result.stderr);
});

test('脚本引用缺失 id 时退出码为 1', () => {
    const result = run({
        html: '<div id="a"></div>',
        app: "const a = $('a'); const missing = $('ghost');"
    });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /MISSING: ghost/);
});

test('HTML 存在重复 id 时退出码为 1', () => {
    const result = run({
        html: '<div id="a"></div><div id="a"></div>',
        app: "const a = $('a');"
    });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /duplicate ids: a/);
});
