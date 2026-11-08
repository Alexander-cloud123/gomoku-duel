// tests/helpers/memory-transport.mjs - 内存版 Transport，用于双端联机集成测试
import { TYPES, makeEnvelope } from '../../js/net/protocol.js';

function clone(data) {
    return JSON.parse(JSON.stringify(data));
}

class MemoryConn {
    constructor() {
        this.open = true;
        this.peer = null;
        this.onData = null;
        this.onClose = null;
    }

    send(data) {
        if (!this.open || !this.peer || !this.peer.open) return;
        const copy = clone(data);
        setTimeout(() => {
            if (this.peer.open && this.peer.onData) this.peer.onData(copy);
        }, 0);
    }

    close() {
        if (!this.open) return;
        this.open = false;
        const peer = this.peer;
        if (peer && peer.open) {
            peer.open = false;
            setTimeout(() => {
                if (peer.onClose) peer.onClose();
                if (this.onClose) this.onClose();
            }, 0);
        } else {
            setTimeout(() => {
                if (this.onClose) this.onClose();
            }, 0);
        }
    }
}

export class MemoryTransport {
    constructor(name = 'transport') {
        this.name = name;
        this.role = 'idle';
        this.roomCode = '';
        this.gameMode = 'gomoku';
        this.conn = null;
        this.peerTransport = null;

        this.onOpen = null;
        this.onIncoming = null;
        this.onMessage = null;
        this.onClose = null;
        this.onError = null;
        this.onPeerStatus = null;
    }

    link(other) {
        this.peerTransport = other;
        other.peerTransport = this;
    }

    async createRoom(roomCode, gameMode) {
        this.role = 'host';
        this.roomCode = roomCode;
        this.gameMode = gameMode;
    }

    async joinRoom(roomCode, gameMode) {
        this.role = 'guest';
        this.roomCode = roomCode;
        this.gameMode = gameMode;
        await new Promise((resolve) => setTimeout(resolve, 0));
        this._connectToHost();
    }

    async reconnect() {
        if (!this.peerTransport) throw new Error('无法重连：没有对端');
        this._connectToHost();
        await new Promise((resolve) => setTimeout(resolve, 0));
    }

    _connectToHost() {
        if (this.conn && this.conn.open) this.conn.close();
        const hostConn = new MemoryConn();
        const guestConn = new MemoryConn();
        hostConn.peer = guestConn;
        guestConn.peer = hostConn;

        this._attach(guestConn);
        if (this.peerTransport.onIncoming) this.peerTransport.onIncoming(hostConn);
        else this.peerTransport.accept(hostConn);
    }

    accept(conn) {
        this._attach(conn);
    }

    _attach(conn) {
        this.conn = conn;
        conn.onData = (data) => {
            if (this.onMessage) this.onMessage(data);
        };
        conn.onClose = () => {
            if (this.conn !== conn) return;
            this.conn = null;
            if (this.onClose) this.onClose();
        };
        if (conn.open) {
            setTimeout(() => {
                if (this.conn === conn && this.onOpen) this.onOpen();
            }, 0);
        }
    }

    hasConnection() {
        return Boolean(this.conn && this.conn.open);
    }

    sendRaw(data) {
        if (!this.conn || !this.conn.open) return false;
        this.conn.send(data);
        return true;
    }

    reject(conn, payload) {
        conn.send(makeEnvelope(2147483647, TYPES.REJECT, payload));
        setTimeout(() => conn.close(), 20);
    }

    /** 模拟网络中断：关闭当前连接但保留传输层。 */
    disconnect() {
        if (this.conn) this.conn.close();
    }

    close() {
        if (this.conn) this.conn.close();
        this.conn = null;
    }
}

export function waitFor(predicate, timeoutMs = 3000, label = '条件') {
    return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        const timer = setInterval(() => {
            if (predicate()) {
                clearInterval(timer);
                resolve();
                return;
            }
            if (Date.now() - startedAt > timeoutMs) {
                clearInterval(timer);
                reject(new Error(`等待超时：${label}`));
            }
        }, 10);
    });
}

export function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
