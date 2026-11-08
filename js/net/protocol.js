// js/net/protocol.js - 联机消息协议：版本、信封、逐类型校验
import { BLACK, WHITE, MODES, ALLOWED_SIZES } from '../rules/constants.js';

export const PROTOCOL_VERSION = 1;

export const TYPES = Object.freeze({
    HELLO: 'HELLO',
    HELLO_ACK: 'HELLO_ACK',
    REJECT: 'REJECT',
    ERROR: 'ERROR',
    MOVE: 'MOVE',
    PASS: 'PASS',
    UNDO_REQUEST: 'UNDO_REQUEST',
    UNDO_ACCEPT: 'UNDO_ACCEPT',
    UNDO_REJECT: 'UNDO_REJECT',
    DRAW_REQUEST: 'DRAW_REQUEST',
    DRAW_ACCEPT: 'DRAW_ACCEPT',
    DRAW_REJECT: 'DRAW_REJECT',
    RESIGN: 'RESIGN',
    RESTART_REQUEST: 'RESTART_REQUEST',
    RESTART_ACCEPT: 'RESTART_ACCEPT',
    RESTART_REJECT: 'RESTART_REJECT',
    SYNC_REQUEST: 'SYNC_REQUEST',
    SYNC_STATE: 'SYNC_STATE',
    MARK_DEAD: 'MARK_DEAD',
    SCORE_CONFIRM: 'SCORE_CONFIRM',
    PING: 'PING',
    PONG: 'PONG',
    BYE: 'BYE'
});

export const REJECT_CODES = Object.freeze({
    ROOM_FULL: 'ROOM_FULL',
    MODE_MISMATCH: 'MODE_MISMATCH',
    PROTO_MISMATCH: 'PROTO_MISMATCH',
    BUSY: 'BUSY',
    NOT_ALLOWED: 'NOT_ALLOWED',
    HASH_MISMATCH: 'HASH_MISMATCH',
    ILLEGAL_MOVE: 'ILLEGAL_MOVE'
});

export const MAX_MESSAGE_BYTES = 64 * 1024;
export const MAX_NAME_LENGTH = 24;

function isInt(value, min, max) {
    return Number.isInteger(value) && value >= min && value <= max;
}

function isColor(value) {
    return value === BLACK || value === WHITE;
}

function isMode(value) {
    return value === MODES.GOMOKU || value === MODES.GO;
}

function isSizeForMode(mode, size) {
    const list = ALLOWED_SIZES[mode];
    return Array.isArray(list) && list.includes(size);
}

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateHelloPayload(p) {
    if (!isPlainObject(p)) return 'payload';
    if (!isMode(p.mode)) return 'mode';
    if (!isInt(p.size, 5, 19) || !isSizeForMode(p.mode, p.size)) return 'size';
    if (typeof p.komi !== 'number' || !Number.isFinite(p.komi) || p.komi < 0 || p.komi > 15) return 'komi';
    if (typeof p.assist !== 'boolean') return 'assist';
    if (!isInt(p.undoLimit, 0, 10)) return 'undoLimit';
    if (!isInt(p.proto, 0, 99)) return 'proto';
    if (typeof p.name !== 'string' || p.name.length > MAX_NAME_LENGTH) return 'name';
    if (typeof p.playerId !== 'string' || p.playerId.length > 40) return 'playerId';
    return null;
}

export function validateSnapshot(snapshot) {
    if (!isPlainObject(snapshot)) return 'snapshot';
    if (!isMode(snapshot.mode)) return 'snapshot.mode';
    if (!isInt(snapshot.size, 5, 19)) return 'snapshot.size';
    if (!Array.isArray(snapshot.cells) || snapshot.cells.length !== snapshot.size) return 'snapshot.cells';
    for (const row of snapshot.cells) {
        if (!Array.isArray(row) || row.length !== snapshot.size) return 'snapshot.cells';
        for (const value of row) {
            if (value !== 0 && value !== BLACK && value !== WHITE) return 'snapshot.cells';
        }
    }
    if (!Array.isArray(snapshot.moveHistory) || snapshot.moveHistory.length > snapshot.size * snapshot.size) {
        return 'snapshot.moveHistory';
    }
    for (const move of snapshot.moveHistory) {
        if (!isPlainObject(move)) return 'snapshot.move';
        if (move.pass) {
            if (!isColor(move.color)) return 'snapshot.move.color';
            continue;
        }
        if (!isInt(move.x, 0, snapshot.size - 1) || !isInt(move.y, 0, snapshot.size - 1)) return 'snapshot.move';
        if (!isColor(move.color)) return 'snapshot.move.color';
    }
    if (!isColor(snapshot.turn)) return 'snapshot.turn';
    if (snapshot.phase !== 'playing' && snapshot.phase !== 'scoring' && snapshot.phase !== 'finished' && snapshot.phase !== 'idle') {
        return 'snapshot.phase';
    }
    return null;
}

function validatePayload(type, payload) {
    if (type === TYPES.PING || type === TYPES.PONG) {
        return isPlainObject(payload) && (payload.ts === undefined || (typeof payload.ts === 'number' && Number.isFinite(payload.ts)))
            ? null
            : 'payload';
    }

    if (type === TYPES.BYE || type === TYPES.DRAW_REQUEST || type === TYPES.DRAW_ACCEPT ||
        type === TYPES.DRAW_REJECT || type === TYPES.RESTART_REQUEST || type === TYPES.RESTART_ACCEPT ||
        type === TYPES.RESTART_REJECT || type === TYPES.SYNC_REQUEST) {
        return payload === undefined || isPlainObject(payload) ? null : 'payload';
    }

    switch (type) {
        case TYPES.HELLO:
        case TYPES.HELLO_ACK:
            return validateHelloPayload(payload);
        case TYPES.REJECT:
            return isPlainObject(payload) && typeof payload.code === 'string' && payload.code.length <= 24 ? null : 'payload';
        case TYPES.ERROR:
            return isPlainObject(payload) && typeof payload.code === 'string' ? null : 'payload';
        case TYPES.MOVE:
            if (!isPlainObject(payload)) return 'payload';
            if (!isInt(payload.x, 0, 18) || !isInt(payload.y, 0, 18)) return 'move.xy';
            if (!isColor(payload.color)) return 'move.color';
            if (!isInt(payload.turnSeq, 0, 100000)) return 'move.turnSeq';
            return null;
        case TYPES.PASS:
        case TYPES.RESIGN:
        case TYPES.UNDO_REQUEST:
        case TYPES.UNDO_ACCEPT:
        case TYPES.UNDO_REJECT:
        case TYPES.SCORE_CONFIRM:
            if (!isPlainObject(payload)) return 'payload';
            if (!isColor(payload.color)) return `${type}.color`;
            if (type === TYPES.SCORE_CONFIRM && (typeof payload.hash !== 'string' || payload.hash.length > 4096)) {
                return 'score.hash';
            }
            return null;
        case TYPES.MARK_DEAD:
            if (!isPlainObject(payload)) return 'payload';
            if (!isInt(payload.x, 0, 18) || !isInt(payload.y, 0, 18)) return 'mark.xy';
            if (!Array.isArray(payload.dead)) return 'mark.dead';
            for (const key of payload.dead) {
                if (typeof key !== 'string' || !/^\d{1,2},\d{1,2}$/.test(key)) return 'mark.dead';
            }
            return null;
        case TYPES.SYNC_STATE:
            if (!isPlainObject(payload)) return 'payload';
            if (typeof payload.hash !== 'string' || payload.hash.length > 4096) return 'sync.hash';
            return validateSnapshot(payload.snapshot);
        default:
            return 'unknown-type';
    }
}

/**
 * 校验完整信封。
 * @returns {{ok:true, type:string, seq:number, payload:object} | {ok:false, reason:string}}
 */
export function validateEnvelope(raw) {
    if (!isPlainObject(raw)) return { ok: false, reason: 'not-object' };
    if (raw.v !== PROTOCOL_VERSION) return { ok: false, reason: 'version' };
    if (typeof raw.t !== 'string' || !TYPES[raw.t]) return { ok: false, reason: 'unknown-type' };
    if (!isInt(raw.seq, 1, Number.MAX_SAFE_INTEGER)) return { ok: false, reason: 'seq' };

    const reason = validatePayload(raw.t, raw.p);
    if (reason) return { ok: false, reason };

    return { ok: true, type: raw.t, seq: raw.seq, payload: raw.p || {} };
}

export function makeEnvelope(seq, type, payload) {
    const envelope = { v: PROTOCOL_VERSION, seq, t: type };
    if (payload !== undefined) envelope.p = payload;
    return envelope;
}

export function helloPayload(game, { name, playerId }) {
    return {
        mode: game.mode,
        size: game.size,
        komi: game.settings.komi,
        assist: game.settings.assist,
        undoLimit: game.settings.undoLimit,
        proto: PROTOCOL_VERSION,
        name: name || '玩家',
        playerId: playerId || ''
    };
}

export function isMessageTooLarge(data) {
    try {
        return JSON.stringify(data).length > MAX_MESSAGE_BYTES;
    } catch {
        return true;
    }
}
