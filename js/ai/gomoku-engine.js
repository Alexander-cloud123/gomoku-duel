// js/ai/gomoku-engine.js - 五子棋搜索：迭代加深 + Alpha-Beta + 置换表 + 棋型排序
import { EMPTY, BLACK, WHITE, opponent } from '../rules/constants.js';
import { createZobrist } from '../rules/zobrist.js';
import {
    generateCandidates,
    scoreMove,
    evaluateBoard,
    findThreats,
    hasWinningMove,
    SHAPE_SCORES
} from './patterns.js';

const WIN_SCORE = 1e9;
const TIMEOUT = Symbol('timeout');
const DEFAULT_BUDGET = 500;

const LEVEL_PRESETS = {
    easy: { maxDepth: 2, timeBudgetMs: 120, topK: 4 },
    medium: { maxDepth: 4, timeBudgetMs: 350, topK: 1 },
    hard: { maxDepth: 8, timeBudgetMs: 900, topK: 1 },
    hint: { maxDepth: 8, timeBudgetMs: 1100, topK: 1 }
};

function levelOptions(level) {
    return LEVEL_PRESETS[level] || LEVEL_PRESETS.hard;
}

function hashKey(ctx, color) {
    return `${ctx.h1.toString(36)}:${ctx.h2.toString(36)}:${color}`;
}

function placeStone(ctx, x, y, color) {
    ctx.cells[y][x] = color;
    const key = ctx.zobrist.table[color][y][x];
    ctx.h1 ^= key[0];
    ctx.h2 ^= key[1];
}

function undoStone(ctx, x, y) {
    const stone = ctx.cells[y][x];
    ctx.cells[y][x] = EMPTY;
    if (stone === EMPTY) return;
    const key = ctx.zobrist.table[stone][y][x];
    ctx.h1 ^= key[0];
    ctx.h2 ^= key[1];
}

function orderingScore(cells, x, y, color, opp) {
    cells[y][x] = color;
    const attack = scoreMove(cells, x, y, color);
    cells[y][x] = opp;
    const defense = scoreMove(cells, x, y, opp);
    cells[y][x] = EMPTY;

    let score = attack.score + defense.score * 0.9;
    if (attack.five) score += WIN_SCORE / 2;
    if (defense.five) score += WIN_SCORE / 3;
    return score;
}

function orderedMoves(ctx, color, limit) {
    const candidates = generateCandidates(ctx.cells);
    const opp = color === BLACK ? WHITE : BLACK;
    const scored = [];
    for (const move of candidates) {
        scored.push({
            x: move.x,
            y: move.y,
            score: orderingScore(ctx.cells, move.x, move.y, color, opp)
        });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
}

function negamax(ctx, depth, color, alpha, beta, ply) {
    ctx.nodes++;
    if ((ctx.nodes & 1023) === 0 && Date.now() > ctx.deadline) throw TIMEOUT;

    const key = hashKey(ctx, color);
    const cached = ctx.tt.get(key);
    if (cached && cached.depth >= depth) {
        if (cached.flag === 'exact') return cached.score;
        if (cached.flag === 'lower' && cached.score > alpha) alpha = cached.score;
        else if (cached.flag === 'upper' && cached.score < beta) beta = cached.score;
        if (alpha >= beta) return cached.score;
    }

    if (depth <= 0) return evaluateBoard(ctx.cells, color);

    const moves = orderedMoves(ctx, color, depth >= 4 ? 12 : 16);
    if (moves.length === 0) return evaluateBoard(ctx.cells, color);

    let best = -WIN_SCORE;
    let bestMove = null;
    const alphaOrig = alpha;

    for (const move of moves) {
        placeStone(ctx, move.x, move.y, color);
        let value;
        if (hasWinningMove(ctx.cells, move.x, move.y, color)) {
            value = WIN_SCORE - ply;
        } else {
            value = -negamax(ctx, depth - 1, opponent(color), -beta, -alpha, ply + 1);
        }
        undoStone(ctx, move.x, move.y);

        if (value > best) {
            best = value;
            bestMove = move;
        }
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;
    }

    let flag = 'exact';
    if (best <= alphaOrig) flag = 'upper';
    else if (best >= beta) flag = 'lower';

    if (ctx.tt.size < 120000) {
        ctx.tt.set(key, { depth, score: best, flag, move: bestMove });
    }

    return best;
}

function rootSearch(ctx, depth, orderCache) {
    const myColor = ctx.myColor;
    const opp = ctx.opp;
    let alpha = -WIN_SCORE;
    const beta = WIN_SCORE;
    const results = [];

    for (const move of orderCache) {
        placeStone(ctx, move.x, move.y, myColor);
        let score;
        if (hasWinningMove(ctx.cells, move.x, move.y, myColor)) {
            score = WIN_SCORE;
        } else {
            score = -negamax(ctx, depth - 1, opp, -beta, -alpha, 1);
        }
        undoStone(ctx, move.x, move.y);

        results.push({ x: move.x, y: move.y, score });
        if (score > alpha) alpha = score;
    }

    results.sort((a, b) => b.score - a.score);
    const best = results[0];
    return {
        bestMove: { x: best.x, y: best.y },
        score: best.score,
        alternates: results.slice(1, 4),
        depth
    };
}

/**
 * @param {number[][]} cells 当前盘面（不会被永久修改）
 * @param {number} myColor 1 黑 / 2 白
 * @param {object} options level/timeBudgetMs/maxDepth/rng
 */
export function search(cells, myColor, options = {}) {
    const level = options.level || 'hint';
    const preset = levelOptions(level);
    const board = options.cloneBoard === false ? cells : cells.map((row) => row.slice());
    const size = board.length;
    const opp = opponent(myColor);
    const startedAt = Date.now();
    const deadline = startedAt + (options.timeBudgetMs ?? preset.timeBudgetMs ?? DEFAULT_BUDGET);
    const maxDepth = Math.min(8, Math.max(2, options.maxDepth ?? preset.maxDepth));
    const rng = options.rng || Math.random;

    const ctx = {
        cells: board,
        myColor,
        opp,
        zobrist: createZobrist(size),
        h1: 0,
        h2: 0,
        nodes: 0,
        deadline,
        tt: new Map()
    };
    [ctx.h1, ctx.h2] = ctx.zobrist.hash(board);

    const candidates = generateCandidates(board);
    if (board.every((row) => row.every((cell) => cell === EMPTY))) {
        const mid = Math.floor(size / 2);
        return {
            bestMove: { x: mid, y: mid },
            alternates: [],
            score: 0,
            winRate: 50,
            threats: [],
            topThreats: [],
            depth: 0,
            nodes: 0,
            elapsedMs: Date.now() - startedAt
        };
    }

    // 1. 己方立刻连五
    for (const move of candidates) {
        placeStone(ctx, move.x, move.y, myColor);
        const win = hasWinningMove(board, move.x, move.y, myColor);
        undoStone(ctx, move.x, move.y);
        if (win) {
            const threats = findThreats(board, opp);
            return resultWith({
                bestMove: move, alternates: [], score: WIN_SCORE, depth: 1,
                board, myColor, opp, threats, startedAt, nodes: ctx.nodes
            });
        }
    }

    // 2. 对手立刻连五点：必须堵
    const oppWins = [];
    for (const move of candidates) {
        placeStone(ctx, move.x, move.y, opp);
        const win = hasWinningMove(board, move.x, move.y, opp);
        undoStone(ctx, move.x, move.y);
        if (win) oppWins.push(move);
    }
    if (oppWins.length > 0) {
        const threats = findThreats(board, opp);
        return resultWith({
            bestMove: oppWins[0],
            alternates: oppWins.slice(1),
            score: oppWins.length > 1 ? -WIN_SCORE / 2 : -SHAPE_SCORES.FOUR,
            depth: 1,
            board, myColor, opp, threats, startedAt, nodes: ctx.nodes
        });
    }

    // 3. 根节点走法排序
    const orderCache = [];
    for (const move of candidates) {
        orderCache.push({
            x: move.x,
            y: move.y,
            score: orderingScore(board, move.x, move.y, myColor, opp)
        });
    }
    orderCache.sort((a, b) => b.score - a.score);
    const rootMoves = orderCache.slice(0, options.rootLimit ?? 18);

    let bestResult = {
        bestMove: rootMoves[0] ? { x: rootMoves[0].x, y: rootMoves[0].y } : null,
        alternates: rootMoves.slice(1, 4).map((m) => ({ x: m.x, y: m.y })),
        score: 0,
        depth: 1
    };
    let completedDepth = 0;

    for (let depth = 2; depth <= maxDepth; depth += 1) {
        try {
            const layer = rootSearch(ctx, depth, rootMoves);
            if (layer) {
                bestResult = layer;
                completedDepth = depth;
            }
        } catch (err) {
            if (err !== TIMEOUT) throw err;
            break;
        }
        if (bestResult.score >= WIN_SCORE / 2) break;
        if (Date.now() > deadline) break;
    }

    // 简单难度：在靠前的候选中做随机扰动，避免每局完全一致
    if (preset.topK > 1 && rootMoves.length > 1) {
        const topK = rootMoves.slice(0, Math.min(preset.topK, rootMoves.length));
        const pick = topK[Math.floor(rng() * topK.length)];
        bestResult = {
            bestMove: { x: pick.x, y: pick.y },
            alternates: topK.filter((m) => m !== pick).slice(0, 3).map((m) => ({ x: m.x, y: m.y })),
            score: bestResult.score,
            depth: bestResult.depth
        };
    }

    const threats = findThreats(board, opp);
    return resultWith({
        ...bestResult,
        board,
        myColor,
        opp,
        threats,
        startedAt,
        nodes: ctx.nodes,
        completedDepth
    });
}

function winRateFromScore(score) {
    if (score >= WIN_SCORE / 2) return 99;
    if (score <= -WIN_SCORE / 2) return 1;
    const rate = 50 + 49 * Math.tanh(score / 150000);
    return Math.max(1, Math.min(99, Math.round(rate)));
}

function resultWith(options) {
    const { board, myColor, opp, threats, startedAt, nodes, depth } = options;
    const topThreats = threats.filter((t) => t.level === 'danger').slice(0, 3);
    return {
        bestMove: options.bestMove || null,
        alternates: options.alternates || [],
        score: options.score || 0,
        winRate: winRateFromScore(options.score || 0),
        threats,
        topThreats,
        depth: depth || options.completedDepth || 0,
        nodes: nodes || 0,
        elapsedMs: Date.now() - startedAt,
        evaluation: evaluateBoard(board, myColor),
        _opp: opp
    };
}

export { LEVEL_PRESETS };
