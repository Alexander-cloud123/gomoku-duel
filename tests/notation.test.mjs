// tests/notation.test.mjs - 坐标记谱与 Zobrist
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    columnLabel,
    rowLabel,
    formatCoord,
    formatMove,
    normalizeSize,
    isValidSize,
    MODES
} from '../js/rules/constants.js';
import { createZobrist } from '../js/rules/zobrist.js';
import { createEmptyBoard } from '../js/rules/constants.js';
import { BLACK, WHITE } from '../js/rules/constants.js';

test('列标跳过字母 I', () => {
    assert.equal(columnLabel(0), 'A');
    assert.equal(columnLabel(7), 'H');
    assert.equal(columnLabel(8), 'J');
    assert.equal(columnLabel(14), 'P');
    assert.equal(columnLabel(18), 'T');
});

test('行号自下而上', () => {
    assert.equal(rowLabel(0, 15), 15);
    assert.equal(rowLabel(14, 15), 1);
    assert.equal(rowLabel(0, 19), 19);
});

test('formatCoord 与棋盘标注一致', () => {
    assert.equal(formatCoord(0, 0, 15), 'A15');
    assert.equal(formatCoord(7, 7, 15), 'H8');
    assert.equal(formatCoord(8, 0, 19), 'J19');
    assert.equal(formatMove({ x: 7, y: 7 }, 15), 'H8');
    assert.equal(formatMove({ pass: true }, 19), 'Pass');
});

test('棋盘尺寸白名单', () => {
    assert.equal(isValidSize(MODES.GOMOKU, 15), true);
    assert.equal(isValidSize(MODES.GOMOKU, 19), false);
    assert.equal(isValidSize(MODES.GO, 19), true);
    assert.equal(isValidSize(MODES.GO, 15), false);
    assert.equal(normalizeSize(MODES.GO, 13), 13);
    assert.equal(normalizeSize(MODES.GO, 15), 19);
    assert.equal(normalizeSize(MODES.GOMOKU, 99), 15);
});

test('Zobrist 哈希确定且区分颜色与位置', () => {
    const z = createZobrist(15);
    const empty = createEmptyBoard(15);
    const a = z.hash(empty);
    assert.deepEqual(a, [0, 0]);

    empty[7][7] = BLACK;
    const blackCenter = z.hash(empty);
    empty[7][7] = WHITE;
    const whiteCenter = z.hash(empty);
    assert.notDeepEqual(blackCenter, whiteCenter);

    const b1 = z.hash(empty);
    empty[0][0] = BLACK;
    const b2 = z.hash(empty);
    assert.notDeepEqual(b1, b2);
    assert.equal(typeof z.key(...blackCenter), 'string');
});
