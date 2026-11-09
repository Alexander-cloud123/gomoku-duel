// tests/session.test.mjs - 双端联机会话集成测试（内存传输）
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../js/game.js';
import { Session } from '../js/net/session.js';
import { TYPES, makeEnvelope } from '../js/net/protocol.js';
import { BLACK, WHITE, MODES } from '../js/rules/constants.js';
import { MemoryTransport, waitFor, delay } from './helpers/memory-transport.mjs';

const FAST_TIMING = {
    heartbeatInterval: 5000,
    heartbeatTimeout: 6000,
    reconnectWindow: 3000,
    reconnectInterval: 100
};

function createPair(options = {}) {
    const mode = options.mode || MODES.GOMOKU;
    const size = options.size;
    const settings = options.settings || {};
    const timing = options.timing || FAST_TIMING;

    const hostGame = new Game({ mode, size, settings });
    hostGame.start({ myColor: BLACK });
    const guestGame = new Game({ mode, size, settings });
    guestGame.start({ myColor: WHITE });

    const hostTransport = new MemoryTransport('host');
    const guestTransport = new MemoryTransport('guest');
    hostTransport.link(guestTransport);

    const hostEvents = { statuses: [], notices: [], requests: [], reject: null, peerLeft: null };
    const guestEvents = { statuses: [], notices: [], requests: [], reject: null, peerLeft: null };

    const hostSession = new Session({
        transport: hostTransport,
        game: hostGame,
        role: 'host',
        name: '房主',
        timing,
        callbacks: {
            onStatus: (s) => hostEvents.statuses.push(s),
            onNotice: (n) => hostEvents.notices.push(n),
            onRequest: (req, respond) => hostEvents.requests.push({ req, respond }),
            onReject: (info) => { hostEvents.reject = info; },
            onPeerLeft: (info) => { hostEvents.peerLeft = info; }
        }
    });

    const guestSession = new Session({
        transport: guestTransport,
        game: guestGame,
        role: 'guest',
        name: '访客',
        timing,
        callbacks: {
            onStatus: (s) => guestEvents.statuses.push(s),
            onNotice: (n) => guestEvents.notices.push(n),
            onRequest: (req, respond) => guestEvents.requests.push({ req, respond }),
            onReject: (info) => { guestEvents.reject = info; },
            onPeerLeft: (info) => { guestEvents.peerLeft = info; }
        }
    });

    return { hostGame, guestGame, hostSession, guestSession, hostTransport, guestTransport, hostEvents, guestEvents };
}

async function connect(pair) {
    await pair.hostSession.hostRoom('ABCDEF');
    await pair.guestSession.joinRoom('ABCDEF');
    await waitFor(() => pair.hostSession.isReady && pair.guestSession.isReady, 3000, '握手完成');
}

test('握手完成后双方进入对局，颜色分配正确', async () => {
    const pair = createPair();
    await connect(pair);
    assert.equal(pair.hostGame.myColor, BLACK);
    assert.equal(pair.guestGame.myColor, WHITE);
    assert.equal(pair.hostSession.state, 'ready');
    assert.equal(pair.guestSession.state, 'ready');
});

test('落子在双端同步，回合正确切换', async () => {
    const pair = createPair();
    await connect(pair);

    pair.hostSession.sendMove(7, 7);
    await waitFor(() => pair.guestGame.moveHistory.length === 1, 2000, '访客收到落子');
    assert.equal(pair.guestGame.cells[7][7], BLACK);
    assert.equal(pair.guestGame.turn, WHITE);

    pair.guestSession.sendMove(8, 8);
    await waitFor(() => pair.hostGame.moveHistory.length === 2, 2000, '房主收到落子');
    assert.equal(pair.hostGame.cells[8][8], WHITE);
    assert.equal(pair.hostGame.turn, BLACK);
});

test('重复序号的消息被去重，不会重复落子', async () => {
    const pair = createPair();
    await connect(pair);
    pair.hostSession.sendMove(7, 7);
    await waitFor(() => pair.guestGame.moveHistory.length === 1, 2000, '第一手同步');
    pair.guestSession.sendMove(8, 8);
    await waitFor(() => pair.hostGame.moveHistory.length === 2 && pair.guestGame.moveHistory.length === 2,
        2000, '第二手同步');

    const third = makeEnvelope(pair.hostSession.seq + 1, TYPES.MOVE, {
        x: 3, y: 3, color: BLACK, turnSeq: 2
    });
    pair.hostSession.seq += 1;
    pair.hostTransport.sendRaw(third);
    await waitFor(() => pair.guestGame.moveHistory.length === 3, 2000, '第三手生效');

    pair.hostTransport.sendRaw(third);
    await delay(50);
    assert.equal(pair.guestGame.moveHistory.length, 3);
});

test('颜色/回合不符的伪造落子不会改变棋盘并触发重同步', async () => {
    const pair = createPair();
    await connect(pair);
    pair.hostSession.sendMove(7, 7);
    await waitFor(() => pair.guestGame.moveHistory.length === 1, 2000, '第一手同步');
    pair.guestSession.sendMove(8, 8);
    await waitFor(() => pair.hostGame.moveHistory.length === 2 && pair.guestGame.moveHistory.length === 2,
        2000, '第二手同步');

    // 现在轮到黑方（房主），伪造一条"白方落子"
    pair.hostSession._send(TYPES.MOVE, { x: 0, y: 0, color: WHITE, turnSeq: 2 });
    await delay(150);
    assert.equal(pair.guestGame.cells[0][0], 0);
    assert.ok(pair.guestGame.moveHistory.length <= 2, '伪造落子不得生效');
    assert.ok(pair.guestEvents.notices.some((n) => n.kind === 'warning'), '应提示并触发同步');
});

test('悔棋需对方同意，双端同时回退', async () => {
    const pair = createPair();
    await connect(pair);
    pair.hostSession.sendMove(7, 7);
    await waitFor(() => pair.guestGame.moveHistory.length === 1, 2000, '第一手同步');
    pair.guestSession.sendMove(8, 8);
    await waitFor(() => pair.hostGame.moveHistory.length === 2 && pair.guestGame.moveHistory.length === 2,
        2000, '两步同步');

    pair.guestSession.requestUndo();
    await waitFor(() => pair.hostEvents.requests.length === 1, 2000, '房主收到悔棋请求');
    assert.equal(pair.hostEvents.requests[0].req.kind, 'undo');

    pair.hostEvents.requests[0].respond(true);
    await waitFor(() => pair.hostGame.moveHistory.length === 1 && pair.guestGame.moveHistory.length === 1,
        2000, '双端悔棋完成');
    assert.equal(pair.hostGame.cells[8][8], 0);
    assert.equal(pair.guestGame.cells[8][8], 0);
});

test('认输同步到对手', async () => {
    const pair = createPair();
    await connect(pair);
    pair.guestSession.resign();
    await waitFor(() => pair.hostGame.isOver, 2000, '房主收到认输');
    assert.equal(pair.hostGame.result.winner, BLACK);
    assert.equal(pair.guestGame.result.winner, BLACK);
});

test('和棋需双方确认', async () => {
    const pair = createPair();
    await connect(pair);
    pair.hostSession.requestDraw();
    await waitFor(() => pair.guestEvents.requests.length === 1, 2000, '访客收到和棋请求');
    pair.guestEvents.requests[0].respond(true);
    await waitFor(() => pair.hostGame.result && pair.hostGame.result.reason === 'draw', 2000, '和棋成立');
    assert.equal(pair.guestGame.result.reason, 'draw');
});

test('再来一局被拒绝时不重置，接受后双端重置', async () => {
    const pair = createPair();
    await connect(pair);
    pair.hostSession.sendMove(7, 7);
    await waitFor(() => pair.guestGame.moveHistory.length === 1, 2000, '落子同步');

    pair.hostSession.requestRestart();    await waitFor(() => pair.guestEvents.requests.length === 1, 2000, '访客收到重开请求');
    pair.guestEvents.requests[0].respond(false);
    await delay(50);
    assert.equal(pair.hostGame.moveHistory.length, 1);

    pair.hostSession.lastRequestAt = 0;
    pair.hostSession.requestRestart();
    await waitFor(() => pair.guestEvents.requests.length === 2, 2000, '再次收到重开请求');
    pair.guestEvents.requests[1].respond(true);
    await waitFor(() => pair.hostGame.moveHistory.length === 0 && pair.guestGame.moveHistory.length === 0,
        2000, '双端重置');
});

test('围棋双虚手进入点目，死子标记与确认双端一致', async () => {
    const pair = createPair({ mode: MODES.GO, size: 9, settings: { komi: 5.5 } });
    await connect(pair);

    pair.hostSession.sendMove(2, 2);
    await waitFor(() => pair.guestGame.moveHistory.length === 1, 2000, '第一手同步');
    pair.guestSession.sendMove(5, 5);
    await waitFor(() => pair.hostGame.moveHistory.length === 2, 2000, '第二手同步');

    pair.hostSession.sendPass();
    await waitFor(() => pair.guestGame.moveHistory.length === 3, 2000, '虚手同步');
    pair.guestSession.sendPass();
    await waitFor(() => pair.hostGame.phase === 'scoring' && pair.guestGame.phase === 'scoring',
        2000, '进入点目');

    pair.hostSession.toggleDead(5, 5);
    await waitFor(() => pair.guestGame.deadStones.size === 1, 2000, '访客同步死子');
    assert.equal(pair.guestGame.scoreHash(), pair.hostGame.scoreHash());

    pair.hostSession.confirmScore();
    pair.guestSession.confirmScore();
    await waitFor(() => pair.hostGame.isOver && pair.guestGame.isOver, 2000, '双方确认结束');
    assert.equal(pair.hostGame.result.reason, 'score');
    assert.equal(pair.guestGame.result.reason, 'score');
});

test('断线后自动重连并重同步', async () => {
    const pair = createPair({
        timing: { heartbeatInterval: 100, heartbeatTimeout: 500, reconnectWindow: 2500, reconnectInterval: 100 }
    });
    await connect(pair);
    pair.hostSession.sendMove(7, 7);
    await waitFor(() => pair.guestGame.moveHistory.length === 1, 2000, '落子同步');

    pair.guestTransport.disconnect();
    await waitFor(() => pair.hostSession.state === 'reconnecting' && pair.guestSession.state === 'reconnecting',
        2000, '双方进入重连');

    await waitFor(() => pair.hostSession.isReady && pair.guestSession.isReady, 2500, '重连完成');
    await waitFor(() => pair.hostGame.stateHash() === pair.guestGame.stateHash(), 2000, '状态一致');
    assert.equal(pair.guestGame.moveHistory.length, 1);
});

test('模式不匹配：房主拒绝后保留房间，访客切模后可重新加入', async () => {
    const hostGame = new Game({ mode: MODES.GOMOKU });
    hostGame.start({ myColor: BLACK });
    const guestGame = new Game({ mode: MODES.GO, size: 9 });
    guestGame.start({ myColor: WHITE });

    const hostTransport = new MemoryTransport('host');
    const guestTransport = new MemoryTransport('guest');
    hostTransport.link(guestTransport);

    const hostEvents = { reject: null, statuses: [] };
    const guestEvents = { reject: null, statuses: [] };

    const hostSession = new Session({
        transport: hostTransport,
        game: hostGame,
        role: 'host',
        name: '房主',
        timing: FAST_TIMING,
        callbacks: {
            onStatus: (s) => hostEvents.statuses.push(s),
            onReject: (info) => { hostEvents.reject = info; }
        }
    });
    const guestSession = new Session({
        transport: guestTransport,
        game: guestGame,
        role: 'guest',
        name: '访客',
        timing: FAST_TIMING,
        callbacks: {
            onStatus: (s) => guestEvents.statuses.push(s),
            onReject: (info) => { guestEvents.reject = info; }
        }
    });

    await hostSession.hostRoom('ABCDEF');
    await guestSession.joinRoom('ABCDEF');
    await waitFor(() => guestEvents.reject !== null, 2000, '访客收到模式不一致拒绝');

    assert.equal(guestEvents.reject.code, 'MODE_MISMATCH');
    assert.equal(guestEvents.reject.actualMode, MODES.GOMOKU);
    assert.equal(hostSession.state, 'waiting', '房主应回到等待态而非结束会话');
    assert.equal(hostTransport.hasConnection(), false, '房主应只关闭本次连接');
    assert.equal(hostEvents.reject, null, '房主不应触发会话级拒绝回调');
    await waitFor(() => hostTransport.hasConnection() === false, 1000, '房主连接已释放');

    // 访客按 actualMode 重新加入同一房间
    const retryGame = new Game({ mode: MODES.GOMOKU });
    retryGame.start({ myColor: WHITE });
    const retryTransport = new MemoryTransport('guest-retry');
    retryTransport.link(hostTransport);
    const retrySession = new Session({
        transport: retryTransport,
        game: retryGame,
        role: 'guest',
        name: '访客2',
        timing: FAST_TIMING,
        callbacks: {}
    });

    await retrySession.joinRoom('ABCDEF');
    await waitFor(() => hostSession.isReady && retrySession.isReady, 3000, '正确模式重新握手成功');
    assert.equal(hostSession.isReady, true);
});

test('点目阶段的和棋申请被忽略，不会结束未确认的数子', async () => {
    const pair = createPair({ mode: MODES.GO, size: 9 });
    await connect(pair);
    pair.hostSession.sendPass();
    await waitFor(() => pair.guestGame.moveHistory.length === 1, 2000, '房主虚手同步');
    pair.guestSession.sendPass();
    await waitFor(() => pair.hostGame.phase === 'scoring' && pair.guestGame.phase === 'scoring', 2000, '进入点目');

    assert.deepEqual(pair.hostSession.requestDraw(), { ok: false, reason: 'not-playing' });
    pair.guestSession._onDrawRequest();
    assert.equal(pair.guestEvents.requests.length, 0, '点目阶段不应弹出和棋确认');
    pair.guestSession._onDrawAccept();
    assert.equal(pair.guestGame.isOver, false);
});

test('断线期间认输被拒绝，不会单端结算', async () => {
    const pair = createPair();
    await connect(pair);
    pair.guestTransport.disconnect();
    await waitFor(() => pair.guestSession.state === 'reconnecting', 2000, '访客进入重连');

    assert.deepEqual(pair.guestSession.resign(), { ok: false, reason: 'not-connected' });
    assert.equal(pair.guestGame.isOver, false);
    assert.equal(pair.hostGame.isOver, false);
});

test('信封协议版本不一致时发送 REJECT 并终止会话', async () => {
    const pair = createPair();
    await connect(pair);

    pair.guestSession._onRawMessage({ v: 2, seq: 999, t: TYPES.PING, p: {} });
    await waitFor(() => pair.guestEvents.reject !== null, 1000, '访客收到协议拒绝');

    assert.equal(pair.guestEvents.reject.code, 'PROTO_MISMATCH');
    assert.equal(pair.guestSession.state, 'failed');
    const reject = pair.guestTransport.sent.filter((m) => m.t === TYPES.REJECT).at(-1);
    assert.equal(reject.p.code, 'PROTO_MISMATCH');
});
