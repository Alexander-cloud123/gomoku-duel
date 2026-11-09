// js/net/session.js - 联机会话：握手、序列号、心跳、请求协商、断线重连与重同步
import {
    TYPES,
    REJECT_CODES,
    PROTOCOL_VERSION,
    makeEnvelope,
    validateEnvelope,
    validateSnapshot,
    helloPayload,
    isMessageTooLarge
} from './protocol.js';
import { BLACK, opponent } from '../rules/constants.js';

export const HEARTBEAT_INTERVAL = 3000;
export const HEARTBEAT_TIMEOUT = 12000;
export const RECONNECT_WINDOW = 60000;
export const REQUEST_COOLDOWN = 5000;

let playerCounter = 0;

// 让 Node 测试进程不被心跳定时器挂住（浏览器环境无 unref，可安全跳过）
function detachTimer(timer) {
    if (timer && typeof timer.unref === 'function') timer.unref();
    return timer;
}

function makePlayerId() {
    playerCounter++;
    return `p${Date.now().toString(36)}-${playerCounter}`;
}

export class Session {
    /**
     * @param {object} options
     * @param {object} options.transport Transport 实例
     * @param {object} options.game Game 实例
     * @param {'host'|'guest'} options.role
     * @param {object} options.callbacks onStatus/onReady/onReject/onNotice/onRequest/onPeerLeft/onRemoteSettings
     */
    constructor(options = {}) {
        const { transport, game, role = 'guest', name = '玩家', callbacks = {} } = options;
        this.transport = transport;
        this.game = game;
        this.role = role;
        this.callbacks = callbacks;
        this.name = name;
        this.playerId = makePlayerId();

        this.state = 'idle';
        this.roomCode = '';
        this.seq = 0;
        this.lastSeq = 0;
        this.remoteHello = null;
        this.remoteAck = false;
        this.pendingRequest = null;
        this.lastRequestAt = 0;
        this.lastPongAt = Date.now();
        this.lastMessageAt = Date.now();
        this.lastSyncRequestAt = 0;
        this.reconnectUntil = 0;
        this._reconnecting = false;
        this._versionRejected = false;
        this._rejectTimer = null;
        this._heartbeatTimer = null;
        this._reconnectTimer = null;
        this._guestReconnectTimer = null;

        this.timing = {
            heartbeatInterval: options.timing?.heartbeatInterval ?? HEARTBEAT_INTERVAL,
            heartbeatTimeout: options.timing?.heartbeatTimeout ?? HEARTBEAT_TIMEOUT,
            reconnectWindow: options.timing?.reconnectWindow ?? RECONNECT_WINDOW,
            reconnectInterval: options.timing?.reconnectInterval ?? 5000
        };

        this._bindTransport();
    }

    get isReady() {
        return this.state === 'ready';
    }

    get opponentColor() {
        return opponent(this.game.myColor);
    }

    _bindTransport() {
        this.transport.onOpen = () => this._onTransportOpen();
        this.transport.onMessage = (data) => this._onRawMessage(data);
        this.transport.onClose = () => this._onTransportClose();
        this.transport.onIncoming = (conn) => this._onIncoming(conn);
        this.transport.onError = (err) => {
            this._notify('error', err.message);
            this.callbacks.onError?.(err);
        };
        this.transport.onPeerStatus = (status) => {
            if (status === 'disconnected' && this.state === 'ready') {
                this._notify('warning', '与信令服务器断开，正在重连…');
            }
        };
    }

    // ===== 建立房间 =====

    async hostRoom(roomCode) {
        this.role = 'host';
        this.roomCode = roomCode;
        this.state = 'waiting';
        this.callbacks.onStatus?.({ state: 'waiting', message: '等待对手加入…' });
        try {
            await this.transport.createRoom(roomCode, this.game.mode);
        } catch (err) {
            this.state = 'failed';
            this.callbacks.onStatus?.({ state: 'failed', message: err.message || '创建房间失败' });
            throw err;
        }
    }

    async joinRoom(roomCode) {
        this.role = 'guest';
        this.roomCode = roomCode;
        this.state = 'joining';
        this.callbacks.onStatus?.({ state: 'joining', message: '正在连接房间…' });
        try {
            await this.transport.joinRoom(roomCode, this.game.mode);
        } catch (err) {
            this.state = 'failed';
            this.callbacks.onStatus?.({ state: 'failed', message: err.message || '加入房间失败' });
            throw err;
        }
    }

    _onIncoming(conn) {
        if (this.transport.hasConnection()) {
            this.transport.reject(conn, {
                code: REJECT_CODES.ROOM_FULL,
                message: '房间已满（仅支持两人对战）'
            });
            return;
        }
        this.transport.accept(conn);
    }

    _onTransportOpen() {
        if (this.state === 'ready') return;
        // 新连接从序号 0 重新协商：房主可能先后接待多个握手尝试
        this.seq = 0;
        this.lastSeq = 0;
        this.state = 'handshaking';
        this.remoteHello = null;
        this.remoteAck = false;
        this.pendingRequest = null;
        this._sendHello();
    }

    _sendHello() {
        this._send(TYPES.HELLO, helloPayload(this.game, { name: this.name, playerId: this.playerId }));
    }

    // ===== 消息收发 =====

    _send(type, payload) {
        const envelope = makeEnvelope(this.seq + 1, type, payload);
        this.seq += 1;
        if (isMessageTooLarge(envelope)) {
            this._notify('error', '消息体积过大，已取消发送');
            return false;
        }
        const sent = this.transport.sendRaw(envelope);
        if (!sent && this.state === 'ready') {
            this._notify('warning', '消息发送失败，连接可能已中断');
        }
        return sent;
    }

    _onRawMessage(data) {
        this.lastMessageAt = Date.now();
        const checked = validateEnvelope(data);
        if (!checked.ok) {
            if (checked.reason === 'version' && !this._versionRejected) {
                this._versionRejected = true;
                this._notify('error', '协议版本不一致，已终止会话');
                this._send(TYPES.REJECT, {
                    code: REJECT_CODES.PROTO_MISMATCH,
                    message: '双方协议版本不一致，请刷新页面后重试'
                });
                this._rejectSession({
                    code: REJECT_CODES.PROTO_MISMATCH,
                    message: '双方协议版本不一致'
                }, { keepRoom: this.role === 'host' });
                return;
            }
            this._notify('warning', `收到无法识别的消息（${checked.reason}）`);
            return;
        }
        if (checked.seq <= this.lastSeq) return;

        if (checked.seq > this.lastSeq + 1 && this.state === 'ready') {
            this._handleSequenceGap();
        }
        this.lastSeq = checked.seq;
        this._dispatch(checked.type, checked.payload);
    }

    _dispatch(type, payload) {
        switch (type) {
            case TYPES.PING:
                this._send(TYPES.PONG, { ts: Date.now() });
                return;
            case TYPES.PONG:
                this.lastPongAt = Date.now();
                return;
            case TYPES.HELLO:
                this._onHello(payload);
                return;
            case TYPES.HELLO_ACK:
                this._onHelloAck();
                return;
            case TYPES.REJECT:
                this._onReject(payload);
                return;
            case TYPES.ERROR:
                this._notify('error', payload.message || '对端报告错误');
                return;
            default:
                break;
        }

        if (this.state !== 'ready') {
            this._notify('warning', '会话尚未就绪，已忽略该消息');
            return;
        }

        switch (type) {
            case TYPES.BYE:
                this._onPeerLeft('对手已离开房间');
                break;
            case TYPES.MOVE:
                this._onMove(payload);
                break;
            case TYPES.PASS:
                this._onPass(payload);
                break;
            case TYPES.UNDO_REQUEST:
                this._onUndoRequest(payload);
                break;
            case TYPES.UNDO_ACCEPT:
                this._onUndoAccept(payload);
                break;
            case TYPES.UNDO_REJECT:
                this._onUndoReject(payload);
                break;
            case TYPES.DRAW_REQUEST:
                this._onDrawRequest(payload);
                break;
            case TYPES.DRAW_ACCEPT:
                this._onDrawAccept();
                break;
            case TYPES.DRAW_REJECT:
                this._onDrawReject();
                break;
            case TYPES.RESIGN:
                this._onResign(payload);
                break;
            case TYPES.RESTART_REQUEST:
                this._onRestartRequest();
                break;
            case TYPES.RESTART_ACCEPT:
                this._onRestartAccept();
                break;
            case TYPES.RESTART_REJECT:
                this._onRestartReject();
                break;
            case TYPES.SYNC_REQUEST:
                this._onSyncRequest();
                break;
            case TYPES.SYNC_STATE:
                this._onSyncState(payload);
                break;
            case TYPES.MARK_DEAD:
                this._onMarkDead(payload);
                break;
            case TYPES.SCORE_CONFIRM:
                this._onScoreConfirm(payload);
                break;
            default:
                break;
        }
    }

    // ===== 握手 =====

    _onHello(payload) {
        if (this.state !== 'handshaking' && this.state !== 'reconnecting') return;

        if (payload.proto !== PROTOCOL_VERSION) {
            this._send(TYPES.REJECT, {
                code: REJECT_CODES.PROTO_MISMATCH,
                message: '双方游戏版本不一致，请刷新页面后重试'
            });
            this._rejectSession({
                code: REJECT_CODES.PROTO_MISMATCH,
                message: '双方游戏版本不一致'
            }, { keepRoom: this.role === 'host' });
            return;
        }

        if (payload.mode !== this.game.mode) {
            if (this.role === 'host') {
                this._send(TYPES.REJECT, {
                    code: REJECT_CODES.MODE_MISMATCH,
                    message: '房间模式与请求模式不一致',
                    actualMode: this.game.mode
                });
                this._notify('warning', '对方选择的模式与本房间不一致');
                this._rejectSession({
                    code: REJECT_CODES.MODE_MISMATCH,
                    actualMode: this.game.mode,
                    message: '对手选择的模式与本房间不一致'
                }, { keepRoom: true });
            } else {
                this._send(TYPES.REJECT, {
                    code: REJECT_CODES.MODE_MISMATCH,
                    message: '房间模式不匹配'
                });
                this._rejectSession({
                    code: REJECT_CODES.MODE_MISMATCH,
                    actualMode: payload.mode,
                    message: '房间模式不匹配'
                });
            }
            return;
        }

        if (this.role === 'guest') {
            this._applyRemoteSettings(payload);
        }

        this.remoteHello = payload;
        this._send(TYPES.HELLO_ACK, helloPayload(this.game, { name: this.name, playerId: this.playerId }));
        this._maybeReady();
    }

    _applyRemoteSettings(payload) {
        if (payload.size === this.game.size && payload.komi === this.game.settings.komi &&
            payload.assist === this.game.settings.assist && payload.undoLimit === this.game.settings.undoLimit) {
            return;
        }
        const newGame = this.callbacks.onRemoteSettings?.({
            mode: payload.mode,
            size: payload.size,
            komi: payload.komi,
            assist: payload.assist,
            undoLimit: payload.undoLimit
        });
        if (newGame) {
            this.game = newGame;
            this.game.myColor = opponent(BLACK);
        }
    }

    _onHelloAck() {
        this.remoteAck = true;
        this._maybeReady();
    }

    _maybeReady() {
        if (this.state !== 'handshaking' && this.state !== 'reconnecting') return;
        if (!this.remoteHello || !this.remoteAck) return;

        const wasReconnecting = this._reconnecting;
        this._reconnecting = false;
        this.state = 'ready';
        if (this._rejectTimer) {
            clearTimeout(this._rejectTimer);
            this._rejectTimer = null;
        }
        this.pendingRequest = null;
        this.lastPongAt = Date.now();
        this.lastMessageAt = Date.now();
        this._clearReconnectTimers();
        this._startHeartbeat();

        this.callbacks.onStatus?.({ state: 'connected', message: '已连接' });
        this.callbacks.onReady?.({ reconnecting: wasReconnecting });

        if (wasReconnecting) this.requestSync();
    }

    _onReject(payload) {
        this.state = 'failed';
        this._stopHeartbeat();
        this._clearReconnectTimers();
        this.transport.close();
        this.callbacks.onReject?.(payload);
        this.callbacks.onStatus?.({ state: 'failed', message: payload.message || '连接被拒绝' });
    }

    /** 主动拒绝/终止会话（不触发「对手已离开」提示）。keepRoom 用于房主拒绝单个访客时保留房间。 */
    _rejectSession(info, { keepRoom = false } = {}) {
        this._stopHeartbeat();
        this._clearReconnectTimers();
        this._reconnecting = false;
        if (keepRoom && this.role === 'host') {
            this.state = 'waiting';
            // 先让 REJECT 送达；访客收到后会主动断开，这里只做兜底清理
            this._rejectTimer = detachTimer(setTimeout(() => {
                if (this.state === 'waiting' && this.transport.hasConnection?.()) {
                    this.transport.closeConnection?.();
                }
            }, 2000));
            this.callbacks.onStatus?.({ state: 'waiting', message: '等待对手加入…' });
            return;
        }
        this.state = 'failed';
        this.transport.close();
        this.callbacks.onReject?.(info);
        this.callbacks.onStatus?.({ state: 'failed', message: info.message || '连接已终止' });
    }

    // ===== 心跳与重连 =====

    _startHeartbeat() {
        this._stopHeartbeat();
        this.lastPongAt = Date.now();
        this._heartbeatTimer = detachTimer(setInterval(() => this._heartbeatTick(), this.timing.heartbeatInterval));
    }

    _heartbeatTick() {
        if (this.state !== 'ready') return;
        this._send(TYPES.PING, { ts: Date.now() });
        if (Date.now() - this.lastPongAt > this.timing.heartbeatTimeout) {
            this._enterReconnecting('心跳超时，正在尝试恢复连接…');
        }
    }

    _stopHeartbeat() {
        if (this._heartbeatTimer) {
            clearInterval(this._heartbeatTimer);
            this._heartbeatTimer = null;
        }
    }

    _clearReconnectTimers() {
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }
        if (this._guestReconnectTimer) {
            clearInterval(this._guestReconnectTimer);
            this._guestReconnectTimer = null;
        }
    }

    _onTransportClose() {
        if (this.state === 'ready' || this.state === 'handshaking') {
            this._enterReconnecting('连接中断，正在尝试恢复…');
        }
    }
    _enterReconnecting(message) {
        if (this.state === 'reconnecting' || this.state === 'left' || this.state === 'failed') return;
        this._stopHeartbeat();
        this.state = 'reconnecting';
        this._reconnecting = true;
        this.reconnectUntil = Date.now() + this.timing.reconnectWindow;
        this._notify('warning', message);
        this.callbacks.onStatus?.({ state: 'reconnecting', message });

        this._clearReconnectTimers();
        this._reconnectTimer = detachTimer(setTimeout(() => {
            if (this.state === 'reconnecting') this._onPeerLeft('与对手的连接已断开');
        }, this.timing.reconnectWindow));

        if (this.role === 'guest') this._startGuestReconnect();
    }

    _startGuestReconnect() {
        if (this._guestReconnectTimer) return;
        this._guestReconnectTimer = detachTimer(setInterval(async () => {
            if (this.state !== 'reconnecting' || Date.now() > this.reconnectUntil) {
                return;
            }
            try {
                await this.transport.reconnect();
            } catch {
                /* 继续重试直到超时 */
            }
        }, this.timing.reconnectInterval));
    }

    _onPeerLeft(message) {
        if (this.state === 'left') return;
        this.state = 'left';
        this._reconnecting = false;
        this._stopHeartbeat();
        this._clearReconnectTimers();
        this.transport.close();
        this.callbacks.onStatus?.({ state: 'left', message });
        this.callbacks.onPeerLeft?.({ message });
    }

    // ===== 落子 =====

    _onMove(payload) {
        if (payload.color !== this.opponentColor) {
            this._notify('warning', '收到颜色异常的落子，正在同步…');
            this.requestSync();
            return;
        }
        if (payload.turnSeq !== this.game.moveHistory.length) {
            this.requestSync();
            return;
        }
        const result = this.game.applyMove(payload.color, payload.x, payload.y);
        if (!result.ok) {
            this._notify('warning', '对手落子与本地状态不一致，正在同步…');
            this.requestSync();
        }
    }

    _onPass(payload) {
        if (payload.color !== this.opponentColor) {
            this.requestSync();
            return;
        }
        const result = this.game.pass(payload.color);
        if (!result.ok) this.requestSync();
    }

    sendMove(x, y) {
        if (this.state !== 'ready') return { ok: false, reason: 'not-connected' };
        const result = this.game.applyMove(this.game.myColor, x, y);
        if (!result.ok) return result;
        this._send(TYPES.MOVE, {
            x,
            y,
            color: this.game.myColor,
            turnSeq: this.game.moveHistory.length - 1
        });
        return result;
    }

    sendPass() {
        if (this.state !== 'ready') return { ok: false, reason: 'not-connected' };
        const result = this.game.pass(this.game.myColor);
        if (!result.ok) return result;
        this._send(TYPES.PASS, { color: this.game.myColor });
        return result;
    }

    // ===== 悔棋 =====

    requestUndo() {
        if (this.pendingRequest) return { ok: false, reason: 'busy' };
        if (!this.game.canUndo(this.game.myColor)) return { ok: false, reason: 'limit' };
        if (Date.now() - this.lastRequestAt < REQUEST_COOLDOWN) return { ok: false, reason: 'cooldown' };
        this.lastRequestAt = Date.now();
        this.pendingRequest = { kind: 'undo-sent', color: this.game.myColor };
        this._send(TYPES.UNDO_REQUEST, { color: this.game.myColor });
        return { ok: true };
    }

    _onUndoRequest(payload) {
        if (this.pendingRequest) {
            this._send(TYPES.UNDO_REJECT, { color: payload.color });
            return;
        }
        if (!this.game.canUndo(payload.color)) {
            this._send(TYPES.UNDO_REJECT, { color: payload.color });
            return;
        }
        this.pendingRequest = { kind: 'undo-request', color: payload.color };
        this.callbacks.onRequest?.({
            kind: 'undo',
            color: payload.color,
            message: `${payload.color === BLACK ? '黑方' : '白方'}申请悔棋，是否同意？`
        }, (accept) => this.respondPending(accept));
    }

    _respondUndo(color, accept) {
        if (accept) {
            this._send(TYPES.UNDO_ACCEPT, { color });
            const result = this.game.performUndo(color);
            if (!result.ok) this.requestSync();
        } else {
            this._send(TYPES.UNDO_REJECT, { color });
        }
    }

    _onUndoAccept(payload) {
        if (!this.pendingRequest || this.pendingRequest.kind !== 'undo-sent') return;
        this.pendingRequest = null;
        const result = this.game.performUndo(payload.color ?? this.game.myColor);
        if (!result.ok) this.requestSync();
    }

    _onUndoReject() {
        if (!this.pendingRequest || this.pendingRequest.kind !== 'undo-sent') return;
        this.pendingRequest = null;
        this._notify('info', '对手拒绝了悔棋申请');
    }

    // ===== 和棋 =====

    requestDraw() {
        if (this.game.phase !== 'playing') return { ok: false, reason: 'not-playing' };
        if (this.pendingRequest) return { ok: false, reason: 'busy' };
        if (this.game.isOver) return { ok: false, reason: 'finished' };
        if (Date.now() - this.lastRequestAt < REQUEST_COOLDOWN) return { ok: false, reason: 'cooldown' };
        this.lastRequestAt = Date.now();
        this.pendingRequest = { kind: 'draw-sent' };
        this._send(TYPES.DRAW_REQUEST, {});
        return { ok: true };
    }

    _onDrawRequest() {
        if (this.game.phase !== 'playing') return;
        if (this.pendingRequest) {
            this._send(TYPES.DRAW_REJECT, {});
            return;
        }
        this.pendingRequest = { kind: 'draw-request' };
        this.callbacks.onRequest?.({
            kind: 'draw',
            message: '对手申请和棋，是否同意？'
        }, (accept) => this.respondPending(accept));
    }

    _respondDraw(accept) {
        if (accept) {
            this._send(TYPES.DRAW_ACCEPT, {});
            this.game.finishDraw();
        } else {
            this._send(TYPES.DRAW_REJECT, {});
        }
    }

    _onDrawAccept() {
        if (this.game.phase !== 'playing') return;
        if (!this.pendingRequest || this.pendingRequest.kind !== 'draw-sent') return;
        this.pendingRequest = null;
        this.game.finishDraw();
    }

    _onDrawReject() {
        if (!this.pendingRequest || this.pendingRequest.kind !== 'draw-sent') return;
        this.pendingRequest = null;
        this._notify('info', '对手拒绝了和棋申请');
    }

    // ===== 认输 =====

    resign() {
        if (this.state !== 'ready') return { ok: false, reason: 'not-connected' };
        if (this.game.isOver) return { ok: false, reason: 'finished' };
        const result = this.game.resign(this.game.myColor);
        if (!result.ok) return result;
        this._send(TYPES.RESIGN, { color: this.game.myColor });
        return result;
    }

    _onResign(payload) {
        if (payload.color !== this.opponentColor) return;
        const result = this.game.resign(payload.color);
        if (!result.ok) this.requestSync();
    }

    // ===== 再来一局 =====

    requestRestart() {
        if (this.pendingRequest) return { ok: false, reason: 'busy' };
        if (Date.now() - this.lastRequestAt < REQUEST_COOLDOWN) return { ok: false, reason: 'cooldown' };
        this.lastRequestAt = Date.now();
        this.pendingRequest = { kind: 'restart-sent' };
        this._send(TYPES.RESTART_REQUEST, {});
        return { ok: true };
    }

    _onRestartRequest() {
        if (this.pendingRequest) {
            this._send(TYPES.RESTART_REJECT, {});
            return;
        }
        this.pendingRequest = { kind: 'restart-request' };
        this.callbacks.onRequest?.({
            kind: 'restart',
            message: '对手想再来一局，是否同意？'
        }, (accept) => this.respondPending(accept));
    }

    _respondRestart(accept) {
        if (accept) {
            this._send(TYPES.RESTART_ACCEPT, {});
            this.game.restart();
        } else {
            this._send(TYPES.RESTART_REJECT, {});
        }
    }

    _onRestartAccept() {
        if (!this.pendingRequest || this.pendingRequest.kind !== 'restart-sent') return;
        this.pendingRequest = null;
        this.game.restart();
    }

    _onRestartReject() {
        if (!this.pendingRequest || this.pendingRequest.kind !== 'restart-sent') return;
        this.pendingRequest = null;
        this._notify('info', '对手拒绝了再来一局');
    }

    respondPending(accept) {
        const pending = this.pendingRequest;
        if (!pending) return;
        this.pendingRequest = null;
        if (pending.kind === 'undo-request') this._respondUndo(pending.color, accept);
        else if (pending.kind === 'draw-request') this._respondDraw(accept);
        else if (pending.kind === 'restart-request') this._respondRestart(accept);
    }

    // ===== 终局点目 =====

    toggleDead(x, y) {
        if (!this.game.toggleDead(x, y)) return false;
        this._send(TYPES.MARK_DEAD, {
            x,
            y,
            dead: Array.from(this.game.deadStones)
        });
        return true;
    }

    _onMarkDead(payload) {
        if (this.game.phase !== 'scoring') return;
        this.game.setDeadStones(payload.dead);
    }

    confirmScore() {
        if (this.game.phase !== 'scoring') return { ok: false, reason: 'not-scoring' };
        const hash = this.game.scoreHash();
        const result = this.game.agreeScore(this.game.myColor, hash);
        if (result.ok) this._send(TYPES.SCORE_CONFIRM, { color: this.game.myColor, hash });
        return result;
    }

    _onScoreConfirm(payload) {
        if (payload.color !== this.opponentColor) return;
        if (this.game.phase !== 'scoring') return;
        const result = this.game.agreeScore(payload.color, payload.hash);
        if (!result.ok) {
            if (result.reason === 'hash-mismatch') {
                this._notify('error', '终局计分不一致，正在重新同步盘面…');
                this.requestSync();
            }
        }
    }

    // ===== 同步 =====

    _handleSequenceGap() {
        this._notify('warning', '检测到消息序号缺口，正在重新同步…');
        if (this.role === 'host') this.sendState();
        else this.requestSync();
    }

    requestSync() {
        if (this.state !== 'ready') return;
        if (Date.now() - this.lastSyncRequestAt < 2000) return;
        this.lastSyncRequestAt = Date.now();
        this._send(TYPES.SYNC_REQUEST, {});
    }

    _onSyncRequest() {
        if (this.role !== 'host') return;
        this.sendState();
    }

    sendState() {
        const snapshot = this.game.snapshot();
        const hash = this.game.stateHash();
        const sent = this._send(TYPES.SYNC_STATE, { snapshot, hash });
        if (!sent) this._notify('error', '同步数据发送失败');
    }

    _onSyncState(payload) {
        if (this.role !== 'guest') return;
        const reason = validateSnapshot(payload.snapshot);
        if (reason) {
            this._notify('error', `同步数据无效（${reason}）`);
            return;
        }
        try {
            const snapshot = { ...payload.snapshot, myColor: this.game.myColor };
            this.game.restore(snapshot);
            if (this.game.stateHash() !== payload.hash) {
                this._notify('warning', '同步后状态哈希不一致，可能仍有偏差');
            } else {
                this._notify('info', '已与对手重新同步');
            }
        } catch (err) {
            this._notify('error', `同步失败：${err.message}`);
        }
    }

    // ===== 通知 =====

    _notify(kind, message) {
        this.callbacks.onNotice?.({ kind, message });
    }

    destroy() {
        if (this.state === 'ready') this._send(TYPES.BYE, {});
        this.state = 'left';
        this._reconnecting = false;
        this._stopHeartbeat();
        this._clearReconnectTimers();
        if (this._rejectTimer) {
            clearTimeout(this._rejectTimer);
            this._rejectTimer = null;
        }
        this.transport.close();
    }
}
