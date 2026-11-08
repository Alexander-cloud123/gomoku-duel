// tests/room.test.mjs - 房间号与深度链接的基础测试
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateRoomCode, createRoomId, stripAssistant, hasAssistant } from '../js/room.js';

test('generateRoomCode 长度为 6 且只使用无歧义字符', () => {
    const allowed = new Set('ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
    for (let i = 0; i < 200; i++) {
        const code = generateRoomCode();
        assert.equal(code.length, 6);
        for (const ch of code) assert.ok(allowed.has(ch), `非法字符: ${ch}`);
    }
});

test('generateRoomCode 具备足够的随机性', () => {
    const codes = new Set();
    for (let i = 0; i < 500; i++) codes.add(generateRoomCode());
    assert.ok(codes.size > 490, `重复过多: ${codes.size}/500`);
});

test('createRoomId 按模式添加前缀', () => {
    assert.equal(createRoomId('ABCDEF', 'gomoku'), 'gomoku-ABCDEF');
    assert.equal(createRoomId('ABCDEF', 'go'), 'go-ABCDEF');
    assert.equal(createRoomId('ABCDEF'), 'gomoku-ABCDEF');
});

test('stripAssistant / hasAssistant 兼容旧房间号 * 后缀', () => {
    assert.equal(stripAssistant('ABCDEF*'), 'ABCDEF');
    assert.equal(stripAssistant('ABCDEF'), 'ABCDEF');
    assert.equal(hasAssistant('ABCDEF*'), true);
    assert.equal(hasAssistant('ABCDEF'), false);
});
