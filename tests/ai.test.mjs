// tests/ai.test.mjs - 棋型识别与搜索
import test from 'node:test';
import assert from 'node:assert/strict';
import { BLACK, WHITE, EMPTY, createEmptyBoard } from '../js/rules/constants.js';
import {
    scoreDirection,
    scoreMove,
    evaluateBoard,
    findThreats,
    hasWinningMove,
    generateCandidates,
    SHAPE_SCORES
} from '../js/ai/patterns.js';
import { search as searchGomoku } from '../js/ai/gomoku-engine.js';
import { search as searchGo, boardKey } from '../js/ai/go-engine.js';

function setup(size, stones) {
    const cells = createEmptyBoard(size);
    for (const [x, y, color] of stones) cells[y][x] = color;
    return cells;
}

test('棋型识别：五连 / 活四 / 冲四', () => {
    const five = setup(15, [3, 4, 5, 6, 7].map((x) => [x, 7, BLACK]));
    const fiveShape = scoreDirection(five, 5, 7, 1, 0, BLACK);
    assert.equal(fiveShape.shape, 'FIVE');

    const openFour = setup(15, [4, 5, 6, 7].map((x) => [x, 7, BLACK]));
    const openShape = scoreDirection(openFour, 6, 7, 1, 0, BLACK);
    assert.equal(openShape.shape, 'OPEN_FOUR');

    const blockedFour = setup(15, [
        [2, 7, WHITE], [3, 7, BLACK], [4, 7, BLACK], [5, 7, BLACK], [6, 7, BLACK]
    ]);
    const rush = scoreDirection(blockedFour, 5, 7, 1, 0, BLACK);
    assert.equal(rush.shape, 'FOUR');
});

test('scoreMove 能识别双活三与四三', () => {
    const cells = setup(15, [
        [5, 7, BLACK], [6, 7, BLACK],
        [7, 5, BLACK], [7, 6, BLACK]
    ]);
    const shape = scoreMove(cells, 7, 7, BLACK);
    assert.equal(shape.openThrees, 2);
    assert.ok(shape.score >= SHAPE_SCORES.OPEN_THREE * 2);
});

test('findThreats 标记对手的四连威胁', () => {
    const cells = setup(15, [
        [5, 7, WHITE], [6, 7, WHITE], [7, 7, WHITE], [8, 7, WHITE]
    ]);
    const threats = findThreats(cells, WHITE);
    const danger = threats.filter((t) => t.level === 'danger');
    assert.ok(danger.length >= 2, `应至少有两个危险点，实际 ${danger.length}`);
    const points = danger.map((t) => `${t.x},${t.y}`);
    assert.ok(points.includes('4,7'));
    assert.ok(points.includes('9,7'));
});

test('evaluateBoard 对己方有利局面给出正分', () => {
    const cells = setup(15, [
        [5, 7, BLACK], [6, 7, BLACK], [7, 7, BLACK]
    ]);
    assert.ok(evaluateBoard(cells, BLACK) > 0);
    assert.ok(evaluateBoard(cells, WHITE) < 0);
});

test('hasWinningMove 与 generateCandidates 基本行为', () => {
    const cells = setup(15, [3, 4, 5, 6].map((x) => [x, 2, BLACK]));
    assert.equal(hasWinningMove(cells, 7, 2, BLACK), true);
    assert.equal(hasWinningMove(cells, 7, 3, BLACK), false);

    const candidates = generateCandidates(cells);
    assert.ok(candidates.length > 0);
    for (const move of candidates) {
        assert.equal(cells[move.y][move.x], EMPTY);
    }
});

test('五子棋引擎在空盘选择中心', () => {
    const cells = createEmptyBoard(15);
    const result = searchGomoku(cells, BLACK, { level: 'hard' });
    assert.ok(result.bestMove);
    assert.equal(result.bestMove.x, 7);
    assert.equal(result.bestMove.y, 7);
});

test('五子棋引擎优先下自己的连五点', () => {
    const cells = setup(15, [
        [5, 7, BLACK], [6, 7, BLACK], [7, 7, BLACK], [8, 7, BLACK],
        [3, 10, WHITE], [4, 10, WHITE]
    ]);
    const result = searchGomoku(cells, BLACK, { level: 'hard' });
    const { x, y } = result.bestMove;
    const next = setup(15, []);
    for (let r = 0; r < 15; r++) next[r] = cells[r].slice();
    next[y][x] = BLACK;
    assert.equal(hasWinningMove(next, x, y, BLACK), true);
});

test('五子棋引擎必须堵对手冲四', () => {
    const cells = setup(15, [
        [4, 7, BLACK],
        [5, 7, WHITE], [6, 7, WHITE], [7, 7, WHITE], [8, 7, WHITE],
        [3, 3, BLACK]
    ]);
    const result = searchGomoku(cells, BLACK, { level: 'hard' });
    const { x, y } = result.bestMove;
    assert.equal(x, 9, `应堵在 (9,7)，实际 (${x},${y})`);
    assert.equal(y, 7);
});

test('五子棋引擎不修改输入盘面且遵守时间预算', () => {
    const stones = [];
    const pattern = [BLACK, WHITE, BLACK, WHITE, BLACK, WHITE, BLACK, WHITE];
    for (let i = 0; i < 12; i++) {
        stones.push([2 + i, 4 + (i % 3), pattern[i % pattern.length]]);
        stones.push([4 + (i % 5), 2 + i % 6, pattern[(i + 1) % pattern.length]]);
    }
    const cells = setup(15, stones);
    const before = cells.map((row) => row.slice());
    const startedAt = Date.now();
    const result = searchGomoku(cells, BLACK, { level: 'hard', timeBudgetMs: 250 });
    const elapsed = Date.now() - startedAt;
    assert.ok(result.bestMove, '应返回候选');
    assert.ok(elapsed < 2000, `搜索耗时过长：${elapsed}ms`);
    assert.ok(result.elapsedMs < 2000);
    assert.deepEqual(cells, before, '搜索不得修改调用方盘面');
    assert.equal(cells[result.bestMove.y][result.bestMove.x], EMPTY);
});

test('五子棋引擎在 easy 难度下可直接选中前几候选', () => {
    const cells = setup(15, [
        [7, 7, BLACK], [8, 8, WHITE]
    ]);
    const result = searchGomoku(cells, BLACK, {
        level: 'easy',
        rng: () => 0
    });
    assert.ok(result.bestMove);
    assert.equal(cells[result.bestMove.y][result.bestMove.x], EMPTY);
});

test('围棋引擎不选择会触发位置超级劫的点', () => {
    const size = 9;
    const cells = setup(size, [
        [2, 2, BLACK], [2, 3, BLACK], [3, 2, BLACK],
        [4, 4, WHITE], [5, 5, WHITE]
    ]);
    const probe = { x: 3, y: 3 };
    const after = cells.map((row) => row.slice());
    after[probe.y][probe.x] = BLACK;
    const historyKeys = [boardKey(after)];

    const forbidden = searchGo(cells, BLACK, {
        level: 'hard',
        komi: 5.5,
        historyKeys,
        rng: () => 0
    });
    if (forbidden.bestMove) {
        assert.ok(!(forbidden.bestMove.x === probe.x && forbidden.bestMove.y === probe.y),
            `不应选择会重复局面的点 (${probe.x},${probe.y})`);
    }

    const allowed = searchGo(cells, BLACK, {
        level: 'hard',
        komi: 5.5,
        historyKeys: [],
        rng: () => 0
    });
    assert.ok(allowed.bestMove || allowed.pass);
});

test('围棋引擎在空盘选择天元附近', () => {
    const cells = createEmptyBoard(19);
    const result = searchGo(cells, BLACK, { level: 'hard', komi: 7.5 });
    assert.ok(result.bestMove);
    const distance = Math.abs(result.bestMove.x - 9) + Math.abs(result.bestMove.y - 9);
    assert.ok(distance <= 6, `应落在中央附近，实际 ${result.bestMove.x},${result.bestMove.y}`);
    assert.equal(cells[result.bestMove.y][result.bestMove.x], EMPTY);
});

test('围棋引擎避开自杀着与打劫禁着', () => {
    const cells = createEmptyBoard(9);
    // 黑棋围住 (4,4)，白棋下 (4,4) 是自杀
    cells[4][3] = BLACK;
    cells[4][5] = BLACK;
    cells[3][4] = BLACK;
    cells[5][4] = BLACK;

    const result = searchGo(cells, WHITE, { level: 'hard', komi: 5.5 });
    assert.ok(result.bestMove);
    const { x, y } = result.bestMove;
    assert.notEqual(`${x},${y}`, '4,4');
    assert.equal(cells[y][x], EMPTY);
});
