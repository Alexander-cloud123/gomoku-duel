// js/ai/patterns.js - 五子棋棋型识别（提示、威胁标记与搜索共用）
import { EMPTY, BLACK, WHITE, inBounds } from '../rules/constants.js';

export const DIRECTIONS = Object.freeze([
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1]
]);

export const SHAPE_SCORES = Object.freeze({
    FIVE: 10000000,
    OPEN_FOUR: 1000000,
    FOUR: 100000,
    OPEN_THREE: 50000,
    THREE: 5000,
    OPEN_TWO: 1000,
    TWO: 100
});

/**
 * 在指定方向统计连子与开放端；用于走法排序与威胁识别。
 */
export function scoreDirection(cells, x, y, dx, dy, color) {
    const size = cells.length;
    let run = 1;

    const forward = { open: false, blocked: false, gap: 0 };
    let count = 0;
    for (let i = 1; i <= 4; i++) {
        const nx = x + dx * i;
        const ny = y + dy * i;
        if (!inBounds(size, nx, ny)) {
            forward.blocked = true;
            break;
        }
        const cell = cells[ny][nx];
        if (cell === color) count++;
        else {
            forward.open = cell === EMPTY;
            forward.blocked = cell !== EMPTY;
            break;
        }
    }
    run += count;
    forward.run = count;

    const backward = { open: false, blocked: false, gap: 0 };
    count = 0;
    for (let i = 1; i <= 4; i++) {
        const nx = x - dx * i;
        const ny = y - dy * i;
        if (!inBounds(size, nx, ny)) {
            backward.blocked = true;
            break;
        }
        const cell = cells[ny][nx];
        if (cell === color) count++;
        else {
            backward.open = cell === EMPTY;
            backward.blocked = cell !== EMPTY;
            break;
        }
    }
    run += count;
    backward.run = count;

    const openEnds = (forward.open ? 1 : 0) + (backward.open ? 1 : 0);

    if (run >= 5) return { score: SHAPE_SCORES.FIVE, shape: 'FIVE', run, openEnds };

    // 跳四（如 ●●_● 或 ●_●●●），等价于冲四
    if (run === 3 || run === 2) {
        const gapFour = checkBrokenFour(cells, x, y, dx, dy, color);
        if (gapFour) return { score: SHAPE_SCORES.FOUR, shape: 'FOUR', run: 4, openEnds: 1 };
    }

    if (run === 4) {
        if (openEnds === 2) return { score: SHAPE_SCORES.OPEN_FOUR, shape: 'OPEN_FOUR', run, openEnds };
        if (openEnds === 1) return { score: SHAPE_SCORES.FOUR, shape: 'FOUR', run, openEnds };
        return { score: 0, shape: 'DEAD', run, openEnds };
    }

    if (run === 3) {
        if (openEnds === 2) return { score: SHAPE_SCORES.OPEN_THREE, shape: 'OPEN_THREE', run, openEnds };
        if (openEnds === 1) return { score: SHAPE_SCORES.THREE, shape: 'THREE', run, openEnds };
        return { score: 0, shape: 'DEAD', run, openEnds };
    }

    if (run === 2) {
        if (openEnds === 2) return { score: SHAPE_SCORES.OPEN_TWO, shape: 'OPEN_TWO', run, openEnds };
        if (openEnds === 1) return { score: SHAPE_SCORES.TWO, shape: 'TWO', run, openEnds };
        return { score: 0, shape: 'DEAD', run, openEnds };
    }

    if (openEnds === 2) return { score: 10, shape: 'ONE', run, openEnds };
    return { score: 0, shape: 'DEAD', run, openEnds };
}

function checkBrokenFour(cells, x, y, dx, dy, color) {
    let code = '';
    for (let i = -4; i <= 4; i++) {
        const nx = x + dx * i;
        const ny = y + dy * i;
        if (!inBounds(cells.length, nx, ny)) code += '2';
        else if (cells[ny][nx] === color) code += '1';
        else if (cells[ny][nx] === EMPTY) code += '0';
        else code += '2';
    }
    return /11011|10111|11101/.test(code);
}

/**
 * 临时落子后的候选评分（0-4 方向累加）。
 */
export function scoreMove(cells, x, y, color) {
    let total = 0;
    let openThrees = 0;
    let fours = 0;
    let five = false;
    let openFour = false;

    for (const [dx, dy] of DIRECTIONS) {
        const result = scoreDirection(cells, x, y, dx, dy, color);
        total += result.score;
        if (result.shape === 'FIVE') five = true;
        if (result.shape === 'OPEN_FOUR') openFour = true;
        if (result.shape === 'FOUR' || result.shape === 'OPEN_FOUR') fours++;
        if (result.shape === 'OPEN_THREE') openThrees++;
    }

    return { score: total, five, openFour, fours, openThrees };
}

export function evaluateMove(cells, x, y, color, opponent = null) {
    const attack = scoreMove(cells, x, y, color);
    const opp = opponent ?? (color === BLACK ? WHITE : BLACK);
    const defense = scoreMove(cells, x, y, opp);
    return {
        attack,
        defense,
        score: attack.score + defense.score * 0.85
    };
}

/** 全盘静态评估（从 color 视角，正值有利）。 */
export function evaluateBoard(cells, color) {
    const opp = color === BLACK ? WHITE : BLACK;
    const size = cells.length;
    let myScore = 0;
    let oppScore = 0;

    for (let y = 0; y < size; y++) {
        myScore += evaluateLine(cells[y], color);
        oppScore += evaluateLine(cells[y], opp);
    }
    for (let x = 0; x < size; x++) {
        const col = [];
        for (let y = 0; y < size; y++) col.push(cells[y][x]);
        myScore += evaluateLine(col, color);
        oppScore += evaluateLine(col, opp);
    }
    for (let start = -(size - 5); start <= size - 1; start++) {
        const diagDown = [];
        const diagUp = [];
        for (let y = 0; y < size; y++) {
            const xDown = start + y;
            if (xDown >= 0 && xDown < size) diagDown.push(cells[y][xDown]);
            const xUp = start + (size - 1) - y;
            if (xUp >= 0 && xUp < size) diagUp.push(cells[y][xUp]);
        }
        if (diagDown.length >= 5) {
            myScore += evaluateLine(diagDown, color);
            oppScore += evaluateLine(diagDown, opp);
        }
        if (diagUp.length >= 5) {
            myScore += evaluateLine(diagUp, color);
            oppScore += evaluateLine(diagUp, opp);
        }
    }

    return myScore - oppScore;
}

function evaluateLine(line, color) {
    let score = 0;
    const size = line.length;
    let i = 0;
    while (i < size) {
        if (line[i] !== color) {
            i++;
            continue;
        }
        let j = i;
        while (j < size && line[j] === color) j++;
        const run = j - i;
        const leftOpen = i > 0 && line[i - 1] === EMPTY;
        const rightOpen = j < size && line[j] === EMPTY;
        const openEnds = (leftOpen ? 1 : 0) + (rightOpen ? 1 : 0);

        if (run >= 5) score += SHAPE_SCORES.FIVE;
        else if (run === 4) {
            if (openEnds === 2) score += SHAPE_SCORES.OPEN_FOUR;
            else if (openEnds === 1) score += SHAPE_SCORES.FOUR;
        } else if (run === 3) {
            if (openEnds === 2) score += SHAPE_SCORES.OPEN_THREE;
            else if (openEnds === 1) score += SHAPE_SCORES.THREE;
        } else if (run === 2) {
            if (openEnds === 2) score += SHAPE_SCORES.OPEN_TWO;
            else if (openEnds === 1) score += SHAPE_SCORES.TWO;
        } else if (openEnds === 2) {
            score += 10;
        }

        i = j;
    }
    return score;
}

export function hasWinningMove(cells, x, y, color) {
    for (const [dx, dy] of DIRECTIONS) {
        const result = scoreDirection(cells, x, y, dx, dy, color);
        if (result.shape === 'FIVE') return true;
    }
    return false;
}

/** 生成棋子周围 2 格内的空点候选。 */
export function generateCandidates(cells) {
    const size = cells.length;
    const result = [];
    const seen = new Uint8Array(size * size);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            if (cells[y][x] === EMPTY) continue;
            for (let dy = -2; dy <= 2; dy++) {
                for (let dx = -2; dx <= 2; dx++) {
                    const nx = x + dx;
                    const ny = y + dy;
                    if (!inBounds(size, nx, ny)) continue;
                    if (cells[ny][nx] !== EMPTY) continue;
                    const key = ny * size + nx;
                    if (seen[key]) continue;
                    seen[key] = 1;
                    result.push({ x: nx, y: ny });
                }
            }
        }
    }
    if (result.length === 0) {
        const mid = Math.floor(size / 2);
        result.push({ x: mid, y: mid });
    }
    return result;
}

/**
 * 对手（或指定颜色）的威胁点：危险 = 立刻连五/活四/双四/四三/双活三。
 */
export function findThreats(cells, color, options = {}) {
    const limit = options.limit ?? 12;
    const radius = options.radius ?? 2;
    const size = cells.length;
    const seen = new Set();
    const threats = [];

    const consider = (x, y) => {
        if (!inBounds(size, x, y)) return;
        if (cells[y][x] !== EMPTY) return;
        const key = y * size + x;
        if (seen.has(key)) return;
        seen.add(key);
        const shape = scoreMove(cells, x, y, color);
        if (!shape.five && !shape.openFour && shape.fours < 2 && !(shape.fours >= 1 && shape.openThrees >= 1) && shape.openThrees < 2) {
            if (shape.fours === 1 || shape.openThrees === 1) {
                threats.push({ x, y, level: 'warning', score: shape.score });
            }
            return;
        }
        const level = shape.five || shape.openFour || shape.fours >= 2 ||
            (shape.fours >= 1 && shape.openThrees >= 1) || shape.openThrees >= 2
            ? 'danger'
            : 'warning';
        threats.push({ x, y, level, score: shape.score });
    };

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            if (cells[y][x] === EMPTY) continue;
            for (let dy = -radius; dy <= radius; dy++) {
                for (let dx = -radius; dx <= radius; dx++) {
                    consider(x + dx, y + dy);
                }
            }
        }
    }

    threats.sort((a, b) => b.score - a.score);
    return threats.slice(0, limit);
}
