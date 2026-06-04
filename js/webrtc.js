// webrtc.js - WebRTC 封装（基于 PeerJS）

import { createRoomId } from './room.js';

export class GameNet {
    constructor() {
        this.peer = null;
        this.conn = null;
        this.onMessage = null;
        this.onConnected = null;
        this.onDisconnected = null;
        this.onError = null;
        this._heartbeatTimer = null;
    }

    async createRoom(roomCode) {
        return new Promise((resolve, reject) => {
            const peerId = createRoomId(roomCode);

            this.peer = new Peer(peerId, {
                config: {
                    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
                },
                serialization: 'json'
            });

            this.peer.on('open', () => {
                this.peer.on('connection', (conn) => {
                    this.conn = conn;
                    this._setupConnection();
                });
                resolve();
            });

            this.peer.on('error', (err) => {
                console.error('PeerJS create error:', err);
                if (this.onError) this.onError(err);
                reject(err);
            });
        });
    }

    async joinRoom(roomCode) {
        return new Promise((resolve, reject) => {
            this.peer = new Peer({
                config: {
                    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
                },
                serialization: 'json'
            });

            this.peer.on('open', () => {
                const peerId = createRoomId(roomCode);
                this.conn = this.peer.connect(peerId, { reliable: true, serialization: 'json' });

                this.conn.on('open', () => {
                    this._setupConnection();
                    resolve();
                });

                this.conn.on('error', (err) => {
                    console.error('Connection error:', err);
                    if (this.onError) this.onError(err);
                    reject(err);
                });
            });

            this.peer.on('error', (err) => {
                console.error('PeerJS join error:', err);
                if (this.onError) this.onError(err);
                reject(err);
            });
        });
    }

    _setupConnection() {
        this.conn.on('data', (data) => {
            if (data.type === 'PING') {
                this.send({ type: 'PONG' });
                return;
            }
            if (data.type === 'PONG') return;
            if (this.onMessage) this.onMessage(data);
        });

        this.conn.on('close', () => {
            this._stopHeartbeat();
            if (this.onDisconnected) this.onDisconnected();
        });

        this._startHeartbeat();
        if (this.onConnected) this.onConnected();
    }

    send(message) {
        if (this.conn && this.conn.open) {
            this.conn.send(message);
        }
    }

    _startHeartbeat() {
        this._heartbeatTimer = setInterval(() => {
            this.send({ type: 'PING' });
        }, 5000);
    }

    _stopHeartbeat() {
        if (this._heartbeatTimer) {
            clearInterval(this._heartbeatTimer);
            this._heartbeatTimer = null;
        }
    }

    destroy() {
        this._stopHeartbeat();
        if (this.conn) this.conn.close();
        if (this.peer) this.peer.destroy();
        this.conn = null;
        this.peer = null;
    }
}
