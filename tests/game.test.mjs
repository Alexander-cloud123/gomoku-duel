// tests/game.test.mjs - 对局状态机
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, PHASES } from '../js/game.js';
import { BLACK, WHITE, MODES } from '../js/rules/constants.js';

function newGame(mode = MODES.GOMOKU, size, settings) {
    return new Game({ mode, size, settings });
}

test('未开始/非本方回合的落子被拒绝', () => {
    const game = newGame();
    assert.equal(game.applyMove(BLACK, 7, 7).ok, false);
    assert.equal(game.applyMove(BLACK, 7, 7).reason, 'not-playing');

    game.start({ myColor: BLACK });
    assert.equal(game.applyMove(WHITE, 7, 7).ok, false);
    assert.equal(game.applyMove(WHITE, 7, 7).reason, 'not-your-turn');
    assert.equal(game.applyMove(BLACK, 7, 7).ok, true);
    assert.equal(game.turn, WHITE);
});

test('连五后终局并锁定后续落子', () => {
    const game = newGame();
    game.start({ myColor: BLACK });
    // 黑下第五列，白下别处
    for (let y = 0; y < 4; y++) {
        assert.equal(game.applyMove(BLACK, y, 0).ok, true);
        assert.equal(game.applyMove(WHITE, y, 10).ok, true);
    }
    assert.equal(game.applyMove(BLACK, 4, 0).ok, true);
    assert.equal(game.isOver, true);
    assert.equal(game.result.winner, BLACK);
    assert.equal(game.result.reason, 'five');
    assert.equal(game.applyMove(WHITE, 0, 1).ok, false);
    assert.equal(game.moveHistory.length, 9);
});

test('悔棋回退到请求方上次落子之前，并受次数限制', () => {
    const game = newGame(MODES.GOMOKU, 15, { undoLimit: 1 });
    game.start({ myColor: BLACK });
    game.applyMove(BLACK, 7, 7);
    game.applyMove(WHITE, 8, 8);
    game.applyMove(BLACK, 8, 7);

    assert.equal(game.canUndo(WHITE), true);
    assert.equal(game.undoSteps(WHITE), 2);
    const undo = game.performUndo(WHITE);
    assert.equal(undo.ok, true);
    assert.equal(game.moveHistory.length, 1);
    assert.equal(game.turn, WHITE, '回退到白方落子之前，轮到白方');
    assert.equal(game.cells[8][8], 0);
    assert.equal(game.cells[7][8], 0);

    assert.equal(game.canUndo(WHITE), false, '次数用尽');
    assert.equal(game.performUndo(BLACK).ok, true);
});

test('认输直接判对手胜', () => {
    const game = newGame();
    game.start({ myColor: BLACK });
    game.resign(BLACK);
    assert.equal(game.isOver, true);
    assert.equal(game.result.winner, WHITE);
    assert.equal(game.result.reason, 'resign');
});

test('围棋双虚手进入点目，双方确认后结束', () => {
    const game = newGame(MODES.GO, 9, { komi: 5.5 });
    game.start({ myColor: BLACK });
    game.applyMove(BLACK, 2, 2);
    game.applyMove(WHITE, 6, 6);

    assert.equal(game.pass(BLACK).ok, true);
    assert.equal(game.turn, WHITE);
    assert.equal(game.pass(WHITE).ok, true);
    assert.equal(game.phase, PHASES.SCORING);
    assert.equal(game.isOver, false);

    const hash = game.scoreHash();
    assert.equal(game.agreeScore(BLACK, 'wrong-hash').ok, false);

    assert.equal(game.agreeScore(BLACK, hash).ok, true);
    assert.equal(game.phase, PHASES.SCORING, '一方确认不结束');

    const done = game.agreeScore(WHITE, hash);
    assert.equal(done.ok, true);
    assert.equal(done.finished, true);
    assert.equal(game.phase, PHASES.FINISHED);
    assert.ok(game.result.score);
});

test('点目阶段切换死子会清空确认', () => {
    const game = newGame(MODES.GO, 9, { komi: 5.5 });
    game.start({ myColor: BLACK });
    game.applyMove(BLACK, 2, 2);
    game.applyMove(WHITE, 5, 5);
    game.pass(BLACK);
    game.pass(WHITE);
    assert.equal(game.phase, PHASES.SCORING);

    game.agreeScore(BLACK, game.scoreHash());
    assert.equal(game.agreed.size, 1);
    game.toggleDead(5, 5);
    assert.equal(game.agreed.size, 0);
    assert.equal(game.deadStones.size, 1);
});

test('快照/恢复保持盘面与历史一致', () => {
    const game = newGame(MODES.GOMOKU, 15, { undoLimit: 3 });
    game.start({ myColor: BLACK });
    game.applyMove(BLACK, 7, 7);
    game.applyMove(WHITE, 8, 8);
    game.applyMove(BLACK, 8, 7);

    const snapshot = game.snapshot();
    const restored = newGame(MODES.GOMOKU, 15, { undoLimit: 3 });
    restored.restore(snapshot);

    assert.equal(restored.stateHash(), game.stateHash());
    assert.equal(restored.moveHistory.length, 3);
    assert.equal(restored.turn, game.turn);
});

test('恢复终局快照保留结果', () => {
    const game = newGame();
    game.start({ myColor: BLACK });
    for (let x = 0; x < 5; x++) {
        game.applyMove(BLACK, x, 0);
        if (x < 4) game.applyMove(WHITE, x, 10);
    }
    const snapshot = game.snapshot();
    assert.equal(snapshot.result.reason, 'five');

    const restored = newGame();
    restored.restore(snapshot);
    assert.equal(restored.isOver, true);
    assert.equal(restored.result.winner, BLACK);
    assert.equal(restored.phase, PHASES.FINISHED);
});

test('重开重置盘面但保留颜色设置', () => {
    const game = newGame();
    game.start({ myColor: WHITE });
    game.applyMove(BLACK, 1, 1);
    game.applyMove(WHITE, 2, 2);
    game.restart();
    assert.equal(game.moveHistory.length, 0);
    assert.equal(game.turn, BLACK);
    assert.equal(game.myColor, WHITE);
    assert.equal(game.isOver, false);
});
