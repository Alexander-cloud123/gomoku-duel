// js/rules/constants.js - 棋盘常量、尺寸、贴目与统一记谱
export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;

export const MODES = Object.freeze({
    GOMOKU: 'gomoku',
    GO: 'go'
});

export const DEFAULT_SIZE = Object.freeze({
    [MODES.GOMOKU]: 15,
    [MODES.GO]: 19
});

export const ALLOWED_SIZES = Object.freeze({
    [MODES.GOMOKU]: [15],
    [MODES.GO]: [9, 13, 19]
});

// 中国规则数子，白方贴目
export const DEFAULT_KOMI = Object.freeze({ 9: 5.5, 13: 6.5, 19: 7.5 });

export const LIMITS = Object.freeze({
    minKomi: 0,
    maxKomi: 15,
    maxUndo: 10,
    maxBoardSize: 19
});

export function opponent(color) {
    return color === BLACK ? WHITE : BLACK;
}

export function colorName(color) {
    if (color === BLACK) return '黑';
    if (color === WHITE) return '白';
    return '无';
}

export function inBounds(size, x, y) {
    return x >= 0 && x < size && y >= 0 && y < size;
}

export function createEmptyBoard(size) {
    const rows = [];
    for (let y = 0; y < size; y++) rows.push(new Array(size).fill(EMPTY));
    return rows;
}

export function cloneBoard(cells) {
    return cells.map((row) => row.slice());
}

export function isValidSize(mode, size) {
    const list = ALLOWED_SIZES[mode];
    return Array.isArray(list) && list.includes(size);
}

export function normalizeSize(mode, size) {
    return isValidSize(mode, size) ? size : DEFAULT_SIZE[mode];
}

// 列标记 A-S，跳过字母 I（与棋盘底部标注一致）
export function columnLabel(x) {
    return String.fromCharCode(65 + (x >= 8 ? x + 1 : x));
}

// 行号自下而上：最上面一行 = size，最下面一行 = 1
export function rowLabel(y, size) {
    return size - y;
}

// 统一记谱：五子棋/围棋都用「列 + 自下而上行号」
export function formatCoord(x, y, size) {
    return `${columnLabel(x)}${rowLabel(y, size)}`;
}

export function formatMove(move, size) {
    if (move.pass) return 'Pass';
    return formatCoord(move.x, move.y, size);
}
