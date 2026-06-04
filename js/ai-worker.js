// ai-worker.js - AI 搜索线程（Minimax + Alpha-Beta）

import { evaluateBoard, getCandidateMoves, scoreToWinRate, findThreats, EMPTY, BLACK, WHITE, SCORES } from './ai-eval.js';

const SIZE = 15;

self.onmessage = function(e) {
    const { cells, myColor, depth } = e.data;
    const opp = myColor === BLACK ? WHITE : BLACK;

    const result = searchBestMove(cells, myColor, depth);
    self.postMessage(result);
};

function searchBestMove(cells, myColor, depth) {
    const candidates = getCandidateMoves(cells);
    const opp = myColor === BLACK ? WHITE : BLACK;

    if (candidates.length === 0) {
        return { bestMove: null, winRate: 50, threats: [] };
    }

    // 先排序：评估每个候选位的即时得分，优先搜高分位
    const scored = candidates.map(move => {
        cells[move.y][move.x] = myColor;
        const s = evaluateBoard(cells, myColor);
        cells[move.y][move.x] = EMPTY;
        return { ...move, score: s };
    });
    scored.sort((a, b) => b.score - a.score);

    // 只取前 15 个候选
    const topCandidates = scored.slice(0, 15);

    let bestMove = topCandidates[0];
    let bestScore = -Infinity;

    for (const move of topCandidates) {
        cells[move.y][move.x] = myColor;

        // 即时胜利检查
        if (checkWinAt(cells, move.x, move.y, myColor)) {
            cells[move.y][move.x] = EMPTY;
            return {
                bestMove: move,
                winRate: 99,
                threats: findThreats(cells, opp)
            };
        }

        const score = minimax(cells, depth - 1, false, myColor, -Infinity, Infinity);
        cells[move.y][move.x] = EMPTY;

        if (score > bestScore) {
            bestScore = score;
            bestMove = move;
        }
    }

    const winRate = scoreToWinRate(bestScore);
    const threats = findThreats(cells, opp);

    return { bestMove, winRate, threats };
}

function minimax(cells, depth, isMaximizing, myColor, alpha, beta) {
    const opp = myColor === BLACK ? WHITE : BLACK;

    if (depth === 0) {
        return evaluateBoard(cells, myColor);
    }

    const currentColor = isMaximizing ? myColor : opp;
    const candidates = getCandidateMoves(cells);

    // 限制候选数
    const limit = isMaximizing ? 12 : 10;
    const topMoves = getTopMoves(cells, candidates, currentColor, limit);

    if (topMoves.length === 0) {
        return evaluateBoard(cells, myColor);
    }

    if (isMaximizing) {
        let maxEval = -Infinity;
        for (const move of topMoves) {
            cells[move.y][move.x] = currentColor;

            if (checkWinAt(cells, move.x, move.y, currentColor)) {
                cells[move.y][move.x] = EMPTY;
                return SCORES.FIVE;
            }

            const eval_ = minimax(cells, depth - 1, false, myColor, alpha, beta);
            cells[move.y][move.x] = EMPTY;

            maxEval = Math.max(maxEval, eval_);
            alpha = Math.max(alpha, eval_);
            if (beta <= alpha) break;
        }
        return maxEval;
    } else {
        let minEval = Infinity;
        for (const move of topMoves) {
            cells[move.y][move.x] = currentColor;

            if (checkWinAt(cells, move.x, move.y, currentColor)) {
                cells[move.y][move.x] = EMPTY;
                return -SCORES.FIVE;
            }

            const eval_ = minimax(cells, depth - 1, true, myColor, alpha, beta);
            cells[move.y][move.x] = EMPTY;

            minEval = Math.min(minEval, eval_);
            beta = Math.min(beta, eval_);
            if (beta <= alpha) break;
        }
        return minEval;
    }
}

function getTopMoves(cells, candidates, color, limit) {
    const scored = candidates.map(move => {
        cells[move.y][move.x] = color;
        const s = evaluateBoard(cells, color);
        cells[move.y][move.x] = EMPTY;
        return { ...move, score: s };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
}

function checkWinAt(cells, x, y, color) {
    const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
    for (const [dx, dy] of directions) {
        let count = 1;
        for (let i = 1; i < 5; i++) {
            const nx = x + dx * i, ny = y + dy * i;
            if (ny >= 0 && ny < SIZE && nx >= 0 && nx < SIZE && cells[ny][nx] === color) count++;
            else break;
        }
        for (let i = 1; i < 5; i++) {
            const nx = x - dx * i, ny = y - dy * i;
            if (ny >= 0 && ny < SIZE && nx >= 0 && nx < SIZE && cells[ny][nx] === color) count++;
            else break;
        }
        if (count >= 5) return true;
    }
    return false;
}
