// js/ai/go-engine.js - 围棋启发式 AI（一手评估，按难度加入噪声与预算）
import {
    EMPTY,
    opponent,
    cloneBoard,
    DEFAULT_KOMI,
    inBounds
} from '../rules/constants.js';
import {
    placeStone,
    groupAt,
    neighbors,
    boardKey
} from '../rules/go-rules.js';

export const GO_LEVELS = Object.freeze({
    easy: { noise: 0.45, timeBudgetMs: 400, candidates: 45 },
    medium: { noise: 0.18, timeBudgetMs: 800, candidates: 70 },
    hard: { noise: 0.04, timeBudgetMs: 1500, candidates: 110 }
});

function starPoints(size) {
    if (size === 19) return [3, 9, 15];
    if (size === 13) return [3, 6, 9];
    if (size === 9) return [2, 4, 6];
    return [];
}

function candidatesFor(cells) {
    const size = cells.length;
    const result = [];
    const seen = new Uint8Array(size * size);
    let hasStone = false;

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            if (cells[y][x] === EMPTY) continue;
            hasStone = true;
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

    if (!hasStone) {
        const mid = Math.floor(size / 2);
        const stars = starPoints(size);
        const points = [{ x: mid, y: mid }];
        for (const s of stars) {
            points.push({ x: s, y: s }, { x: size - 1 - s, y: s }, { x: s, y: size - 1 - s }, { x: size - 1 - s, y: size - 1 - s });
        }
        return points;
    }
    return result;
}

function positionWeight(size, x, y) {
    const mid = (size - 1) / 2;
    const distance = Math.abs(x - mid) + Math.abs(y - mid);
    const edgeDistance = Math.min(x, y, size - 1 - x, size - 1 - y);
    let weight = Math.max(1, 12 - distance * 0.5);
    if (edgeDistance === 0) weight -= 6;
    else if (edgeDistance === 1) weight -= 2;
    return weight;
}

function atariBonus(cells, x, y, color, size) {
    const opp = opponent(color);
    let score = 0;
    for (const nb of neighbors(size, x, y)) {
        if (cells[nb.y][nb.x] !== opp) continue;
        const group = groupAt(cells, nb.x, nb.y, size);
        if (!group) continue;
        if (group.libertiesCount === 1) score += 45;
        else if (group.libertiesCount === 2) score += 12;
    }
    return score;
}

/**
 * 评估一次落子（不修改原盘面）。
 */
function evaluateCandidate(cells, x, y, color, koPoint, historyKeys) {
    const size = cells.length;
    const trial = {
        size,
        cells: cloneBoard(cells),
        koPoint,
        superko: true,
        historyKeys: new Set(historyKeys)
    };
    const result = placeStone(trial, x, y, color);
    if (!result.ok) return null;

    let score = positionWeight(size, x, y);
    score += result.captured.length * 90;

    const group = groupAt(trial.cells, x, y, size);
    if (!group) return null;
    if (group.libertiesCount === 0) return null;
    else if (group.libertiesCount === 1) score -= 60;
    else if (group.libertiesCount === 2) score += 4;
    else score += Math.min(18, group.libertiesCount * 3);

    score += atariBonus(trial.cells, x, y, color, size);

    // 连接：与己方棋子相邻越多越有价值（避免十字/拆边的散着）
    let friendly = 0;
    for (const nb of neighbors(size, x, y)) {
        if (cells[nb.y][nb.x] === color) friendly++;
    }
    score += Math.min(18, friendly * 6);

    // 避免填自己的眼：四周都是己方且己方棋组气数少
    if (friendly >= 3 && group.libertiesCount <= 2) score -= 35;

    return score;
}

function collectThreats(cells, myColor, size) {
    const threats = [];
    const seen = new Set();
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const color = cells[y][x];
            if (color === EMPTY) continue;
            const groupKey = `${x},${y}`;
            if (seen.has(groupKey)) continue;
            const group = groupAt(cells, x, y, size);
            if (!group) continue;
            for (const s of group.stones) seen.add(`${s.x},${s.y}`);
            if (group.libertiesCount === 1) {
                const liberty = group.liberties[0];
                threats.push({
                    x: liberty.x,
                    y: liberty.y,
                    level: color === myColor ? 'danger' : 'warning',
                    reason: color === myColor ? '己方棋组仅剩一气' : '可提对手棋'
                });
            }
        }
    }
    return threats.slice(0, 10);
}

/**
 * 围棋出招：返回 bestMove；若判断应虚手则 bestMove 为 null。
 */
export function search(cells, myColor, options = {}) {
    const size = cells.length;
    const level = options.level || 'medium';
    const preset = GO_LEVELS[level] || GO_LEVELS.medium;
    const startedAt = Date.now();
    const rng = options.rng || Math.random;
    const komi = options.komi ?? DEFAULT_KOMI[size] ?? 7.5;
    const koPoint = options.koPoint || null;
    const historyKeys = new Set(options.historyKeys || []);

    const candidates = candidatesFor(cells).slice(0, preset.candidates);
    const scored = [];
    let maxScore = -Infinity;

    for (const move of candidates) {
        if (Date.now() - startedAt > preset.timeBudgetMs) break;
        const attack = evaluateCandidate(cells, move.x, move.y, myColor, koPoint, historyKeys);
        if (attack === null) continue;
        const defense = evaluateCandidate(cells, move.x, move.y, opponent(myColor), koPoint, historyKeys) ?? 0;
        const total = attack + defense * 0.6;
        scored.push({ ...move, score: total });
        if (total > maxScore) maxScore = total;
    }

    if (scored.length === 0) {
        return {
            bestMove: null,
            pass: true,
            score: 0,
            threats: collectThreats(cells, myColor, size),
            winRate: 50,
            elapsedMs: Date.now() - startedAt
        };
    }

    scored.sort((a, b) => b.score - a.score);
    const topK = Math.max(1, Math.min(scored.length, Math.round(1 + preset.noise * 5)));
    const pool = scored.slice(0, topK);
    const pick = pool[Math.floor(rng() * pool.length)] || scored[0];

    // 盘面空旷或分数过低时选择虚手（避免到处乱填）
    const filledRatio = 1 - candidates.length / (size * size);
    if (maxScore < 12 && filledRatio > 0.55) {
        return {
            bestMove: null,
            pass: true,
            score: maxScore,
            threats: collectThreats(cells, myColor, size),
            winRate: 48,
            elapsedMs: Date.now() - startedAt
        };
    }

    const threats = collectThreats(cells, myColor, size);
    let stones = 0;
    const captured = options.captures?.[myColor] || 0;
    let oppStones = 0;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            if (cells[y][x] === myColor) stones++;
            else if (cells[y][x] === opponent(myColor)) oppStones++;
        }
    }
    const diff = stones - oppStones + (captured - (options.captures?.[opponent(myColor)] || 0)) * 2;
    const winRate = Math.max(5, Math.min(95, Math.round(50 + diff * 0.6 + (komi > 0 ? 2 : 0))));

    return {
        bestMove: { x: pick.x, y: pick.y },
        pass: false,
        score: pick.score,
        threats,
        winRate,
        elapsedMs: Date.now() - startedAt
    };
}

export { candidatesFor, starPoints, boardKey };
