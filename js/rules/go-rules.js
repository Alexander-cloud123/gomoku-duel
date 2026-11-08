// js/rules/go-rules.js - 围棋纯规则：提子、自杀、劫、位置超级劫、中国规则数子
import { EMPTY, BLACK, WHITE, inBounds, createEmptyBoard, cloneBoard, colorName } from './constants.js';

export function neighbors(size, x, y) {
    const result = [];
    if (x > 0) result.push({ x: x - 1, y });
    if (x < size - 1) result.push({ x: x + 1, y });
    if (y > 0) result.push({ x, y: y - 1 });
    if (y < size - 1) result.push({ x, y: y + 1 });
    return result;
}

export function boardKey(cells) {
    return cells.map((row) => row.join('')).join('|');
}

/**
 * 取 (x,y) 所在棋组及全部气。
 */
export function groupAt(cells, x, y, size = cells.length) {
    if (!inBounds(size, x, y)) return null;
    const color = cells[y][x];
    if (color === EMPTY) return null;

    const visited = new Set();
    const stones = [];
    const libertySet = new Set();
    const queue = [{ x, y }];
    visited.add(y * size + x);

    for (let head = 0; head < queue.length; head++) {
        const curr = queue[head];
        stones.push(curr);
        for (const nb of neighbors(size, curr.x, curr.y)) {
            const cell = cells[nb.y][nb.x];
            if (cell === EMPTY) {
                libertySet.add(nb.y * size + nb.x);
            } else if (cell === color) {
                const key = nb.y * size + nb.x;
                if (!visited.has(key)) {
                    visited.add(key);
                    queue.push({ x: nb.x, y: nb.y });
                }
            }
        }
    }

    const liberties = [];
    for (const key of libertySet) {
        liberties.push({ x: key % size, y: Math.floor(key / size) });
    }

    return { color, stones, liberties, libertiesCount: liberties.length };
}

/**
 * 创建一个围棋局面状态（含位置超级劫历史）。
 */
export function createGoState(size, options = {}) {
    const cells = createEmptyBoard(size);
    return {
        size,
        cells,
        koPoint: null,
        superko: options.superko ?? true,
        historyKeys: new Set([boardKey(cells)])
    };
}

/**
 * 落子（会修改 state.cells / koPoint / historyKeys）。
 * @returns {{ok:true, captured:Array<{x:number,y:number,color:number}>, koPoint:?{x,y}, key:string}
 *          | {ok:false, reason:'out-of-bounds'|'occupied'|'ko'|'suicide'|'superko'}}
 */
export function placeStone(state, x, y, color) {
    const { size, cells } = state;

    if (!inBounds(size, x, y)) return { ok: false, reason: 'out-of-bounds' };
    if (cells[y][x] !== EMPTY) return { ok: false, reason: 'occupied' };
    if (state.koPoint && state.koPoint.x === x && state.koPoint.y === y) {
        return { ok: false, reason: 'ko' };
    }

    const opp = color === BLACK ? WHITE : BLACK;
    cells[y][x] = color;

    const captured = [];
    const capturedGroups = new Set();
    for (const nb of neighbors(size, x, y)) {
        if (cells[nb.y][nb.x] !== opp) continue;
        const group = groupAt(cells, nb.x, nb.y, size);
        if (!group || group.libertiesCount !== 0) continue;
        const groupKey = group.stones[0].y * size + group.stones[0].x;
        if (capturedGroups.has(groupKey)) continue;
        capturedGroups.add(groupKey);
        for (const stone of group.stones) {
            cells[stone.y][stone.x] = EMPTY;
            captured.push({ x: stone.x, y: stone.y, color: opp });
        }
    }

    // 自杀着（提子之后不可能仍无气，仅在无提子时判断）
    if (captured.length === 0) {
        const myGroup = groupAt(cells, x, y, size);
        if (!myGroup || myGroup.libertiesCount === 0) {
            cells[y][x] = EMPTY;
            return { ok: false, reason: 'suicide' };
        }
    }

    const key = boardKey(cells);

    if (state.superko !== false && state.historyKeys.has(key)) {
        cells[y][x] = EMPTY;
        for (const stone of captured) cells[stone.y][stone.x] = opp;
        return { ok: false, reason: 'superko' };
    }

    let koPoint = null;
    if (captured.length === 1) {
        const myGroup = groupAt(cells, x, y, size);
        if (myGroup && myGroup.stones.length === 1 && myGroup.libertiesCount === 1) {
            koPoint = { x: captured[0].x, y: captured[0].y };
        }
    }

    state.koPoint = koPoint;
    state.historyKeys.add(key);

    return { ok: true, captured, koPoint: state.koPoint, key };
}

/**
 * 点目：中国规则（子 + 目），白方贴目。死子先移除再数。
 */
export function scoreArea(cells, options = {}) {
    const size = cells.length;
    const komi = options.komi ?? 7.5;
    const deadStones = options.deadStones ?? new Set();
    const board = cloneBoard(cells);

    let blackDead = 0;
    let whiteDead = 0;
    for (const key of deadStones) {
        const [xs, ys] = String(key).split(',');
        const x = Number(xs);
        const y = Number(ys);
        if (!inBounds(size, x, y)) continue;
        const stone = board[y][x];
        if (stone === BLACK) blackDead++;
        else if (stone === WHITE) whiteDead++;
        board[y][x] = EMPTY;
    }

    let blackStones = 0;
    let whiteStones = 0;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            if (board[y][x] === BLACK) blackStones++;
            else if (board[y][x] === WHITE) whiteStones++;
        }
    }

    let blackTerritory = 0;
    let whiteTerritory = 0;
    let neutral = 0;
    const visited = new Array(size * size).fill(false);

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            if (board[y][x] !== EMPTY || visited[y * size + x]) continue;

            let touchesBlack = false;
            let touchesWhite = false;
            let area = 0;
            const queue = [{ x, y }];
            visited[y * size + x] = true;

            for (let head = 0; head < queue.length; head++) {
                const curr = queue[head];
                area++;
                for (const nb of neighbors(size, curr.x, curr.y)) {
                    const cell = board[nb.y][nb.x];
                    if (cell === BLACK) touchesBlack = true;
                    else if (cell === WHITE) touchesWhite = true;
                    else {
                        const key = nb.y * size + nb.x;
                        if (!visited[key]) {
                            visited[key] = true;
                            queue.push({ x: nb.x, y: nb.y });
                        }
                    }
                }
            }

            if (touchesBlack && !touchesWhite) blackTerritory += area;
            else if (touchesWhite && !touchesBlack) whiteTerritory += area;
            else neutral += area;
        }
    }

    const blackTotal = blackStones + blackTerritory;
    const whiteTotal = whiteStones + whiteTerritory + komi;
    const diff = blackTotal - whiteTotal;

    return {
        size,
        komi,
        black: {
            stones: blackStones,
            territory: blackTerritory,
            total: blackTotal,
            dead: blackDead
        },
        white: {
            stones: whiteStones,
            territory: whiteTerritory,
            total: whiteTotal,
            dead: whiteDead
        },
        deadRemoved: blackDead + whiteDead,
        neutral,
        diff,
        winner: diff > 0 ? BLACK : WHITE,
        // 中国规则贴目后白方胜的天平数值
        marginText: blackTotal === whiteTotal
            ? '和棋（不可能出现，贴目为半目）'
            : `${colorName(diff > 0 ? BLACK : WHITE)}胜 ${Math.abs(diff).toFixed(1)} 目`
    };
}

/**
 * 点击棋组切换死子标记；返回是否发生了改变。
 */
export function toggleDeadGroup(cells, x, y, deadSet, size = cells.length) {
    const group = groupAt(cells, x, y, size);
    if (!group) return false;
    const keys = group.stones.map((s) => `${s.x},${s.y}`);
    const anyDead = keys.some((k) => deadSet.has(k));
    if (anyDead) {
        for (const k of keys) deadSet.delete(k);
    } else {
        for (const k of keys) deadSet.add(k);
    }
    return true;
}

/**
 * 终局确认用的哈希：盘面 + 死子标记。
 */
export function scoreHash(cells, deadSet) {
    const deadKeys = Array.from(deadSet).sort().join(';');
    return `${boardKey(cells)}#${deadKeys}`;
}
