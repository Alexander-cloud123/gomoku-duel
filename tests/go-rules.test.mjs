// tests/go-rules.test.mjs - 围棋规则
import test from 'node:test';
import assert from 'node:assert/strict';
import { BLACK, WHITE, EMPTY, createEmptyBoard } from '../js/rules/constants.js';
import {
    createGoState,
    placeStone,
    groupAt,
    boardKey,
    scoreArea,
    toggleDeadGroup,
    scoreHash
} from '../js/rules/go-rules.js';

test('groupAt 返回棋组与气数', () => {
    const cells = createEmptyBoard(5);
    cells[1][1] = BLACK;
    cells[1][2] = BLACK;
    const group = groupAt(cells, 1, 1, 5);
    assert.equal(group.color, BLACK);
    assert.equal(group.stones.length, 2);
    assert.equal(group.libertiesCount, 6);
});

test('提掉无气棋组并记录被提颜色', () => {
    const state = createGoState(5, { superko: false });
    state.cells[1][1] = WHITE;   // (x=1,y=1)
    state.cells[0][1] = BLACK;   // (1,0)
    state.cells[1][0] = BLACK;   // (0,1)
    state.cells[1][2] = BLACK;   // (2,1)

    const result = placeStone(state, 1, 2, BLACK);
    assert.equal(result.ok, true);
    assert.equal(result.captured.length, 1);
    assert.equal(result.captured[0].color, WHITE);
    assert.equal(state.cells[1][1], EMPTY);
});

test('自杀着被拒绝且盘面不变', () => {
    const state = createGoState(5, { superko: false });
    state.cells[1][0] = BLACK;
    state.cells[0][1] = BLACK;
    state.cells[2][1] = BLACK;
    state.cells[1][2] = BLACK;

    const before = boardKey(state.cells);
    const result = placeStone(state, 1, 1, WHITE);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'suicide');
    assert.equal(boardKey(state.cells), before);
});

test('简单打劫：提子后立即回提被拒绝', () => {
    const state = createGoState(5, { superko: false });
    // 经典劫形：(x,y) 坐标
    state.cells[0][1] = BLACK;   // (1,0)
    state.cells[0][2] = WHITE;   // (2,0)
    state.cells[1][0] = BLACK;   // (0,1)
    state.cells[1][1] = WHITE;   // (1,1)
    state.cells[1][3] = WHITE;   // (3,1)
    state.cells[2][1] = BLACK;   // (1,2)
    state.cells[2][2] = WHITE;   // (2,2)

    const capture = placeStone(state, 2, 1, BLACK);
    assert.equal(capture.ok, true);
    assert.equal(capture.captured.length, 1);
    assert.deepEqual(capture.koPoint, { x: 1, y: 1 });

    const recapture = placeStone(state, 1, 1, WHITE);
    assert.equal(recapture.ok, false);
    assert.equal(recapture.reason, 'ko');
});

test('位置超级劫：回到已出现过的盘面被拒绝', () => {
    const state = createGoState(3, { superko: true });
    const keyAfterMove = (() => {
        const copy = createEmptyBoard(3);
        copy[0][0] = BLACK;
        return boardKey(copy);
    })();
    state.historyKeys.add(keyAfterMove);

    const result = placeStone(state, 0, 0, BLACK);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'superko');
    assert.equal(state.cells[0][0], EMPTY);
});

test('中国规则数子：围地归属、中立点与贴目', () => {
    const size = 5;
    const cells = createEmptyBoard(size);
    for (let x = 0; x < size; x++) {
        cells[0][x] = BLACK;
        cells[size - 1][x] = BLACK;
    }
    for (let y = 0; y < size; y++) {
        cells[y][0] = BLACK;
        cells[y][size - 1] = BLACK;
    }
    // 黑棋围住中间 3x3 空点 => 16 子 + 9 目 = 25
    const score = scoreArea(cells, { komi: 7.5, deadStones: new Set() });
    assert.equal(score.black.stones, 16);
    assert.equal(score.black.territory, 9);
    assert.equal(score.white.total, 7.5);
    assert.equal(score.winner, BLACK);
    assert.equal(score.neutral, 0);
});

test('死子标记后被移除并影响归属', () => {
    const cells = createEmptyBoard(5);
    cells[2][2] = WHITE;
    const dead = new Set();
    assert.equal(toggleDeadGroup(cells, 2, 2, dead, 5), true);
    assert.equal(dead.size, 1);

    const score = scoreArea(cells, { komi: 7.5, deadStones: dead });
    assert.equal(score.deadRemoved, 1);
    assert.equal(score.white.dead, 1);
    assert.equal(score.white.stones, 0);

    assert.equal(toggleDeadGroup(cells, 2, 2, dead, 5), true);
    assert.equal(dead.size, 0);
});

test('scoreHash 随死子标记变化', () => {
    const cells = createEmptyBoard(9);
    cells[4][4] = BLACK;
    const a = scoreHash(cells, new Set());
    const b = scoreHash(cells, new Set(['4,4']));
    assert.notEqual(a, b);
});
