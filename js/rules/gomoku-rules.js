// js/rules/gomoku-rules.js - 五子棋纯规则（无 DOM、无渲染）
import { EMPTY, inBounds } from './constants.js';

const DIRECTIONS = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1]
];

export const GOMOKU_DIRECTIONS = DIRECTIONS;

/**
 * 落子到棋盘（不校验回合，只校验坐标与占用）。
 * @returns {boolean} 是否成功
 */
export function place(cells, x, y, color) {
    if (!inBounds(cells.length, x, y)) return false;
    if (cells[y][x] !== EMPTY) return false;
    cells[y][x] = color;
    return true;
}

export function remove(cells, x, y) {
    if (!inBounds(cells.length, x, y)) return false;
    cells[y][x] = EMPTY;
    return true;
}

export function isOccupied(cells, x, y) {
    return inBounds(cells.length, x, y) && cells[y][x] !== EMPTY;
}

export function isLegal(cells, x, y) {
    return inBounds(cells.length, x, y) && cells[y][x] === EMPTY;
}

/**
 * 取得 (x,y) 所在方向上连续同色棋子（含自身），从负方向到正方向排序。
 */
export function getRun(cells, x, y, dx, dy, color) {
    const size = cells.length;
    if (!inBounds(size, x, y) || cells[y][x] !== color) return [];

    const negative = [];
    for (let i = 1; i < size; i++) {
        const nx = x - dx * i;
        const ny = y - dy * i;
        if (!inBounds(size, nx, ny) || cells[ny][nx] !== color) break;
        negative.push({ x: nx, y: ny });
    }
    negative.reverse();

    const run = [...negative, { x, y }];

    for (let i = 1; i < size; i++) {
        const nx = x + dx * i;
        const ny = y + dy * i;
        if (!inBounds(size, nx, ny) || cells[ny][nx] !== color) break;
        run.push({ x: nx, y: ny });
    }

    return run;
}

/**
 * 五连判定。默认无禁手：连五或更长都算赢（overlineWins=true）。
 * @returns {null | {winner:number, line:Array<{x,y}>, direction:[number,number], length:number}}
 */
export function checkWin(cells, x, y, color, options = {}) {
    const winLength = options.winLength ?? 5;
    const overlineWins = options.overlineWins ?? true;
    if (!inBounds(cells.length, x, y) || cells[y][x] !== color) return null;

    for (const [dx, dy] of DIRECTIONS) {
        const run = getRun(cells, x, y, dx, dy, color);
        if (run.length >= winLength && (overlineWins || run.length === winLength)) {
            return {
                winner: color,
                line: run,
                direction: [dx, dy],
                length: run.length
            };
        }
    }
    return null;
}

export function isFull(cells) {
    const size = cells.length;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            if (cells[y][x] === EMPTY) return false;
        }
    }
    return true;
}

/**
 * 扫描全盘是否已有连五（用于回放/校验快照）。
 */
export function scanWin(cells, options = {}) {
    const size = cells.length;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const color = cells[y][x];
            if (color === EMPTY) continue;
            const result = checkWin(cells, x, y, color, options);
            if (result) return result;
        }
    }
    return null;
}
