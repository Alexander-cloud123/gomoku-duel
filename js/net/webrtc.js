// js/net/webrtc.js - WebRTC 传输层（PeerJS 封装：建连、消息、断线、错误分类）
import { makeEnvelope, TYPES, PROTOCOL_VERSION } from './protocol.js';

const DEFAULT_ICE = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' }
];

export function buildIceServers(turnConfig) {
    const servers = [...DEFAULT_ICE];
    if (turnConfig && turnConfig.url) {
        servers.push({
            urls: turnConfig.url,
            username: turnConfig.username || '',
            credential: turnConfig.credential || ''
        });
    }
    return servers;
}

const PEER_ERRORS = {
    'browser-incompatible': { code: 'BROWSER_INCOMPATIBLE', message: '当前浏览器不支持 WebRTC，无法联机' },
    'invalid-id': { code: 'INVALID_ROOM', message: '房间号格式不合法' },
    'unavailable-id': { code: 'ROOM_CONFLICT', message: '房间号已被占用，请重新创建房间' },
    'peer-unavailable': { code: 'ROOM_NOT_FOUND', message: '房间不存在或已关闭' },
    network: { code: 'NETWORK', message: '网络连接中断，请检查网络后重试' },
    'server-error': { code: 'SIGNALING', message: '信令服务器暂时不可用，请稍后重试' },
    'socket-error': { code: 'SIGNALING', message: '与信令服务器的连接失败' },
    'socket-closed': { code: 'SIGNALING', message: '与信令服务器的连接已关闭' },
    'ssl-unavailable': { code: 'SSL', message: '安全连接不可用，请使用 https 或 localhost' },
    'webrtc-error': { code: 'WEBRTC', message: '点对点连接失败，可能是 NAT / 防火墙限制' }
};

export function classifyPeerError(err) {
    const type = err?.type || err?.code || 'unknown';
    return PEER_ERRORS[type] || {
        code: 'UNKNOWN',
        message: `连接失败（${type}）`
    };
}

function waitFor(condition, timeoutMs, onTimeout) {
    return new Promise((resolve, reject) => {
        let done = false;
        const timer = setTimeout(() => {
            if (done) return;
            done = true;
            reject(onTimeout());
        }, timeoutMs);
        condition(
            () => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                resolve();
            },
            (err) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                reject(err);
            }
        );
    });
}

export class Transport {
    constructor(options = {}) {
        this.peer = null;
        this.conn = null;
        this.role = 'idle';
        this.roomCode = '';
        this.gameMode = 'gomoku';
        this._iceServers = options.iceServers || buildIceServers();
        this._destroyed = false;

        this.onOpen = null;
        this.onIncoming = null;
        this.onMessage = null;
        this.onClose = null;
        this.onError = null;
        this.onPeerStatus = null;
    }

    _peerOptions() {
        return {
            config: { iceServers: this._iceServers },
            serialization: 'json',
            debug: 0
        };
    }

    _ensurePeer() {
        if (this.peer) return;
        this.peer = new Peer(this._peerOptions());
        this.peer.on('error', (err) => {
            const mapped = classifyPeerError(err);
            if (this.onError) this.onError(mapped);
        });
        this.peer.on('disconnected', () => {
            if (this._destroyed || !this.peer) return;
            if (this.onPeerStatus) this.onPeerStatus('disconnected');
            try {
                this.peer.reconnect();
            } catch {
                /* ignore */
            }
        });
    }

    async createRoom(roomCode, gameMode) {
        this.role = 'host';
        this.roomCode = roomCode;
        this.gameMode = gameMode;
        // Peer id 直接使用房间号：棋种由握手协商，便于「模式不匹配 → 切换后重入」
        const peerId = roomCode;

        return new Promise((resolve, reject) => {
            let settled = false;
            let peer;
            try {
                peer = new Peer(peerId, this._peerOptions());
            } catch (err) {
                reject(classifyPeerError(err));
                return;
            }
            this.peer = peer;

            const fail = (err) => {
                const mapped = classifyPeerError(err);
                if (this.onError) this.onError(mapped);
                if (!settled) {
                    settled = true;
                    reject(mapped);
                }
            };

            peer.on('open', () => {
                if (settled) return;
                settled = true;
                resolve();
            });
            peer.on('error', fail);
            peer.on('disconnected', () => {
                if (this._destroyed) return;
                if (this.onPeerStatus) this.onPeerStatus('disconnected');
                if (peer && !peer.destroyed) {
                    try {
                        peer.reconnect();
                    } catch {
                        /* ignore */
                    }
                }
            });
            peer.on('connection', (conn) => {
                if (this._destroyed) {
                    try { conn.close(); } catch { /* ignore */ }
                    return;
                }
                if (this.onIncoming) this.onIncoming(conn);
            });

            setTimeout(() => {
                if (!settled) {
                    settled = true;
                    reject({ code: 'TIMEOUT', message: '连接信令服务器超时，请检查网络' });
                }
            }, 15000);
        });
    }

    async joinRoom(roomCode, gameMode) {
        this.role = 'guest';
        this.roomCode = roomCode;
        this.gameMode = gameMode;

        this._ensurePeer();

        await waitFor(
            (success, failure) => {
                const peer = this.peer;
                if (!peer) {
                    failure({ code: 'NO_PEER', message: '无法创建连接' });
                    return;
                }
                if (peer.open) success();
                else {
                    peer.once('open', success);
                    peer.once('error', (err) => failure(classifyPeerError(err)));
                }
            },
            15000,
            () => ({ code: 'TIMEOUT', message: '连接信令服务器超时，请检查网络' })
        );

        const targetId = roomCode;
        const conn = this.peer.connect(targetId, { reliable: true, serialization: 'json' });

        await waitFor(
            (success, failure) => {
                if (conn.open) success();
                else {
                    conn.once('open', success);
                    conn.once('error', (err) => failure(classifyPeerError(err)));
                    const peerErrHandler = (err) => {
                        if (err?.type === 'peer-unavailable') {
                            failure({ code: 'ROOM_NOT_FOUND', message: '房间不存在或已关闭' });
                        }
                    };
                    this.peer.once('error', peerErrHandler);
                }
            },
            20000,
            () => ({ code: 'TIMEOUT', message: '连接房间超时：请确认房间号、模式与网络' })
        );

        this._attach(conn);
    }

    /** 房主接受新连接；如果已有连接则交由调用方拒绝。 */
    accept(conn) {
        this._attach(conn);
    }

    hasConnection() {
        return Boolean(this.conn && this.conn.open);
    }

    reject(conn, payload) {
        try {
            conn.send(makeEnvelope(2147483647, TYPES.REJECT, {
                code: payload.code,
                message: payload.message,
                actualMode: payload.actualMode,
                proto: PROTOCOL_VERSION
            }));
        } catch {
            /* ignore */
        }
        setTimeout(() => {
            try { conn.close(); } catch { /* ignore */ }
        }, 150);
    }

    _attach(conn) {
        if (this.conn && this.conn !== conn) {
            try { this.conn.close(); } catch { /* ignore */ }
        }
        this.conn = conn;

        conn.on('data', (data) => {
            if (this._destroyed) return;
            if (this.onMessage) this.onMessage(data);
        });
        conn.on('close', () => {
            if (this.conn !== conn) return;
            this.conn = null;
            if (this.onClose) this.onClose();
        });
        conn.on('error', () => {
            // 具体错误由 close 事件统一处理，避免重复提示
        });

        if (conn.open) {
            this._emitOpen();
        } else {
            conn.once('open', () => this._emitOpen());
        }
    }

    _emitOpen() {
        if (this._destroyed) return;
        if (this.onOpen) this.onOpen();
    }

    sendRaw(data) {
        if (!this.conn || !this.conn.open) return false;
        try {
            this.conn.send(data);
            return true;
        } catch {
            return false;
        }
    }

    async reconnect() {
        if (this.role !== 'guest' || !this.peer || this._destroyed) {
            throw { code: 'NO_PEER', message: '无法重连' };
        }
        const conn = this.peer.connect(this.roomCode, { reliable: true, serialization: 'json' });
        await waitFor(
            (success, failure) => {
                if (conn.open) success();
                else {
                    conn.once('open', success);
                    conn.once('error', () => failure({ code: 'RECONNECT_FAILED', message: '重连失败' }));
                }
            },
            8000,
            () => ({ code: 'RECONNECT_FAILED', message: '重连超时' })
        );
        this._attach(conn);
    }

    /** 只关闭当前连接，保留 peer（房主拒绝某个访客后房间仍可加入）。 */
    closeConnection() {
        if (this.conn) {
            try { this.conn.close(); } catch { /* ignore */ }
            this.conn = null;
        }
    }

    close() {
        this.closeConnection();
        this._destroyed = true;
        if (this.peer) {
            try { this.peer.destroy(); } catch { /* ignore */ }
            this.peer = null;
        }
    }
}
