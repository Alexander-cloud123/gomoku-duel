// room.js - 房间号生成与状态管理

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉容易混淆的 I/O/0/1

export function generateRoomCode() {
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += CHARS[Math.floor(Math.random() * CHARS.length)];
    }
    return code;
}

export function createRoomId(code, gameMode = 'gomoku') {
    const prefix = gameMode === 'go' ? 'go-' : 'gomoku-';
    return prefix + code;
}

export function hasAssistant(roomCode) {
    return roomCode.endsWith('*');
}

export function stripAssistant(code) {
    return code.replace(/\*$/, '');
}
