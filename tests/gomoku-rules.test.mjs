// tests/gomoku-rules.test.mjs - 五子棋规则
import test from 'node:test';
import assert from 'node:assert/strict';
import { BLACK, WHITE, EMPTY, createEmptyBoard } from '../js/rules/constants.js';
import {
    place,
    remove,
    getRun,
    checkWin,
    isFull,
    scanWin,
    isLegal
} from '../js/rules/gomoku-rules.js';

function boardWith(size, stones) {
    const cells = createEmptyBoard(size);
    for (const [x, y, color] of stones) cells[y][x] = color;
    return cells;
}

test('place 拒绝越界、已占用位置，成功后写入颜色', () => {
    const cells = createEmptyBoard(15);
    assert.equal(place(cells, -1, 0, BLACK), false);
    assert.equal(place(cells, 15, 0, BLACK), false);
    assert.equal(isLegal(cells, 0, 0), true);
    assert.equal(place(cells, 0, 0, BLACK), true);
    assert.equal(place(cells, 0, 0, WHITE), false);
    assert.equal(cells[0][0], BLACK);
    assert.equal(remove(cells, 0, 0), true);
    assert.equal(cells[0][0], EMPTY);
});

test('水平五连判胜并返回完整连线', () => {
    const stones = [];
    for (let x = 5; x <= 9; x++) stones.push([x, 6, BLACK]);
    const cells = boardWith(15, stones);
    const win = checkWin(cells, 9, 6, BLACK);
    assert.ok(win);
    assert.equal(win.winner, BLACK);
    assert.equal(win.length, 5);
    assert.deepEqual(win.direction, [1, 0]);
    assert.deepEqual(win.line.map((p) => p.x), [5, 6, 7, 8, 9]);
});

test('垂直、主/副对角线五连判胜', () => {
    const vertical = boardWith(15, [0, 1, 2, 3, 4].map((y) => [3, y, WHITE]));
    assert.ok(checkWin(vertical, 3, 4, WHITE));

    const diagonal = boardWith(15, [0, 1, 2, 3, 4].map((i) => [2 + i, 2 + i, BLACK]));
    assert.ok(checkWin(diagonal, 6, 6, BLACK));

    const anti = boardWith(15, [0, 1, 2, 3, 4].map((i) => [2 + i, 8 - i, WHITE]));
    assert.ok(checkWin(anti, 6, 4, WHITE));
});

test('四连不判胜，六连默认判胜（无禁手）', () => {
    const four = boardWith(15, [0, 1, 2, 3].map((x) => [x, 0, BLACK]));
    assert.equal(checkWin(four, 3, 0, BLACK), null);

    const six = boardWith(15, [0, 1, 2, 3, 4, 5].map((x) => [x, 0, BLACK]));
    assert.ok(checkWin(six, 5, 0, BLACK));

    // 严格五连规则下六连不算胜
    assert.equal(checkWin(six, 5, 0, BLACK, { overlineWins: false }), null);
});

test('getRun 只返回指定方向连续同色棋子', () => {
    const cells = boardWith(15, [
        [3, 3, BLACK],
        [4, 3, BLACK],
        [5, 3, BLACK],
        [5, 4, WHITE]
    ]);
    const run = getRun(cells, 4, 3, 1, 0, BLACK);
    assert.deepEqual(run.map((p) => p.x), [3, 4, 5]);
    assert.deepEqual(getRun(cells, 4, 3, 0, 1, BLACK), [{ x: 4, y: 3 }]);
});

test('isFull 与 scanWin 覆盖整盘', () => {
    const size = 15;
    const cells = createEmptyBoard(size);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) cells[y][x] = (x + y) % 2 === 0 ? BLACK : WHITE;
    }
    assert.equal(isFull(cells), true);
    assert.ok(scanWin(cells));
});
