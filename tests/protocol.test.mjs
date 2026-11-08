// tests/protocol.test.mjs - 联机协议校验
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    PROTOCOL_VERSION,
    TYPES,
    makeEnvelope,
    validateEnvelope,
    validateHelloPayload,
    validateSnapshot,
    isMessageTooLarge,
    REJECT_CODES
} from '../js/net/protocol.js';
import { Game } from '../js/game.js';
import { BLACK, WHITE, MODES } from '../js/rules/constants.js';

const hello = (overrides = {}) => ({
    mode: MODES.GOMOKU,
    size: 15,
    komi: 7.5,
    assist: true,
    undoLimit: 3,
    proto: PROTOCOL_VERSION,
    name: '玩家',
    playerId: 'p-1',
    ...overrides
});

test('合法信封通过校验', () => {
    const env = makeEnvelope(1, TYPES.MOVE, { x: 7, y: 7, color: BLACK, turnSeq: 0 });
    const checked = validateEnvelope(env);
    assert.equal(checked.ok, true);
    assert.equal(checked.type, TYPES.MOVE);
    assert.equal(checked.seq, 1);
});

test('协议版本不符被拒绝', () => {
    const env = { ...makeEnvelope(1, TYPES.PING, { ts: 1 }), v: 0 };
    assert.equal(validateEnvelope(env).ok, false);
    assert.equal(validateEnvelope(env).reason, 'version');
});

test('未知消息类型与非法序号被拒绝', () => {
    assert.equal(validateEnvelope({ v: 1, seq: 1, t: 'HACK' }).ok, false);
    assert.equal(validateEnvelope({ v: 1, seq: 0, t: TYPES.PING }).ok, false);
    assert.equal(validateEnvelope(null).ok, false);
});

test('落子坐标与颜色范围校验', () => {
    assert.equal(validateEnvelope(makeEnvelope(2, TYPES.MOVE, { x: -1, y: 0, color: BLACK, turnSeq: 0 })).ok, false);
    assert.equal(validateEnvelope(makeEnvelope(2, TYPES.MOVE, { x: 19, y: 0, color: BLACK, turnSeq: 0 })).ok, false);
    assert.equal(validateEnvelope(makeEnvelope(2, TYPES.MOVE, { x: 0, y: 0, color: 3, turnSeq: 0 })).ok, false);
    assert.equal(validateEnvelope(makeEnvelope(2, TYPES.MOVE, { x: 0, y: 0, color: BLACK })).ok, false);
});

test('HELLO 载荷校验模式与棋盘尺寸', () => {
    assert.equal(validateHelloPayload(hello()), null);
    assert.equal(validateHelloPayload(hello({ mode: 'chess' })), 'mode');
    assert.equal(validateHelloPayload(hello({ mode: MODES.GO, size: 15 })), 'size');
    assert.equal(validateHelloPayload(hello({ komi: 99 })), 'komi');
    assert.equal(validateHelloPayload(hello({ undoLimit: 100 })), 'undoLimit');
});

test('快照校验拒绝篡改的盘面', () => {
    const game = new Game({ mode: MODES.GOMOKU });
    game.start({ myColor: BLACK });
    game.applyMove(BLACK, 7, 7);
    const snapshot = game.snapshot();
    assert.equal(validateSnapshot(snapshot), null);

    const broken = { ...snapshot, cells: snapshot.cells.slice(0, 3) };
    assert.equal(validateSnapshot(broken), 'snapshot.cells');

    const badValue = JSON.parse(JSON.stringify(snapshot));
    badValue.cells[0][0] = 9;
    assert.equal(validateSnapshot(badValue), 'snapshot.cells');

    const badMove = JSON.parse(JSON.stringify(snapshot));
    badMove.moveHistory.push({ x: -1, y: -1, color: WHITE });
    assert.equal(validateSnapshot(badMove), 'snapshot.move');
});

test('消息体积上限可判定', () => {
    assert.equal(isMessageTooLarge({ v: 1, t: 'PING', p: { ts: 1 } }), false);
    assert.equal(isMessageTooLarge({ v: 1, t: 'BIG', p: { pad: 'x'.repeat(70000) } }), true);
});

test('拒绝码常量覆盖关键场景', () => {
    assert.ok(Object.values(REJECT_CODES).includes('ROOM_FULL'));
    assert.ok(Object.values(REJECT_CODES).includes('MODE_MISMATCH'));
});
