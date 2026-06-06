// ai.js - AI 主线程：调用 worker、展示结果（支持五子棋和围棋）

import { BLACK, WHITE } from './board.js';
import { findThreats, EMPTY } from './ai-eval.js';
import { findBestMove as goFindBestMove, findThreats as goFindThreats, estimateWinRate as goEstimateWinRate, evaluatePosition as goEvaluatePosition, getCandidateMoves as goGetCandidateMoves, SIZE as GO_SIZE } from './go-ai-eval.js';

export class AIAssistant {
    constructor() {
        this.worker = null;
        this.enabled = false;
        this.onResult = null; // ({bestMove, winRate, threats, topThreats})
        this.cheatMode = false;
        this.gameMode = 'gomoku';
        this._initWorker();
    }

    _initWorker() {
        try {
            this.worker = new Worker('js/ai-worker.js', { type: 'module' });
            this.worker.onmessage = (e) => {
                if (this.onResult) this.onResult(e.data);
            };
            this.worker.onerror = (err) => {
                console.error('AI Worker error:', err);
            };
        } catch (e) {
            console.warn('Web Worker not supported, AI will run in main thread');
            this.worker = null;
        }
    }

    enable(enabled) {
        this.enabled = enabled;
    }

    setCheatMode(enabled) {
        this.cheatMode = enabled;
    }

    setGameMode(mode) {
        this.gameMode = mode;
    }

    analyze(cells, myColor, moveCount, captures) {
        if (!this.enabled) return;

        if (this.gameMode === 'go') {
            return this._analyzeGo(cells, myColor, captures);
        }

        // ===== 五子棋模式 =====
        const opp = myColor === BLACK ? WHITE : BLACK;

        // 作弊模式：快速启发式计算
        if (this.cheatMode) {
            const cellsCopy = cells.map(row => row.slice());

            // 1. 快速找到对手威胁（取前3个）
            const threats = findThreats(cellsCopy, opp);
            const scoredThreats = threats.map(t => {
                const score = scoreThreat(cellsCopy, t.x, t.y, opp);
                return { ...t, score };
            });
            scoredThreats.sort((a, b) => b.score - a.score);
            const topThreats = scoredThreats.slice(0, 3);

            // 2. 快速找到最佳落子位置
            let bestMove = findBestMoveQuick(cellsCopy, myColor);

            // 3. 简单估算胜率
            const winRate = estimateWinRate(cellsCopy, myColor);

            if (this.onResult) {
                this.onResult({
                    bestMove: bestMove,
                    winRate: winRate,
                    threats: threats,
                    topThreats: topThreats
                });
            }
            return;
        }

        // 正常模式：使用 Minimax
        let depth;
        if (moveCount < 10) depth = 4;
        else if (moveCount < 40) depth = 6;
        else depth = 8;

        const cellsCopy = cells.map(row => row.slice());

        if (this.worker) {
            this.worker.postMessage({
                cells: cellsCopy,
                myColor,
                depth
            });
        }
    }

    // ===== 围棋 AI 分析 =====
    _analyzeGo(cells, myColor, captures) {
        const cellsCopy = cells.map(row => row.slice());
        const opp = myColor === BLACK ? WHITE : BLACK;
        const capturesObj = captures || { [BLACK]: 0, [WHITE]: 0 };

        // 围棋始终用启发式（19×19 无法 Minimax）
        const bestMove = goFindBestMove(cellsCopy, myColor, capturesObj);

        // 威胁检测
        const threats = goFindThreats(cellsCopy, opp);

        // 作弊模式：只显示前3个威胁
        let topThreats = null;
        if (this.cheatMode) {
            const scoredThreats = threats.map(t => {
                const score = goEvaluatePosition(cellsCopy, t.x, t.y, opp);
                return { ...t, score };
            });
            scoredThreats.sort((a, b) => b.score - a.score);
            topThreats = scoredThreats.slice(0, 3);
        }

        // 胜率估算
        const winRate = goEstimateWinRate(cellsCopy, myColor, capturesObj);

        if (this.onResult) {
            this.onResult({
                bestMove,
                winRate,
                threats,
                topThreats
            });
        }
    }

    destroy() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
    }
}

// ===== 五子棋作弊模式辅助函数 =====

function scoreThreat(cells, x, y, color) {
    let score = 0;
    const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
    const SIZE = cells.length;

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
        if (count >= 5) score += 1000000;
        else if (count === 4) score += 100000;
        else if (count === 3) score += 5000;
        else if (count === 2) score += 100;
    }
    return score;
}

function findBestMoveQuick(cells, myColor) {
    const SIZE = cells.length;
    const EMPTY = 0;
    const candidates = [];

    const visited = new Set();
    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            if (cells[r][c] !== EMPTY) {
                for (let dr = -2; dr <= 2; dr++) {
                    for (let dc = -2; dc <= 2; dc++) {
                        const nr = r + dr, nc = c + dc;
                        if (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE && cells[nr][nc] === EMPTY) {
                            const key = nr * SIZE + nc;
                            if (!visited.has(key)) {
                                visited.add(key);
                                candidates.push({ x: nc, y: nr });
                            }
                        }
                    }
                }
            }
        }
    }

    if (candidates.length === 0) {
        return { x: Math.floor(SIZE / 2), y: Math.floor(SIZE / 2) };
    }

    let bestScore = -Infinity;
    let bestMove = candidates[0];

    for (const move of candidates) {
        cells[move.y][move.x] = myColor;
        const myScore = quickScorePosition(cells, move.x, move.y, myColor);
        cells[move.y][move.x] = EMPTY;

        const opp = myColor === 1 ? 2 : 1;
        cells[move.y][move.x] = opp;
        const oppScore = quickScorePosition(cells, move.x, move.y, opp);
        cells[move.y][move.x] = EMPTY;

        const totalScore = myScore + oppScore * 1.2;

        if (totalScore > bestScore) {
            bestScore = totalScore;
            bestMove = move;
        }
    }

    return bestMove;
}

function quickScorePosition(cells, x, y, color) {
    let totalScore = 0;
    const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
    const SIZE = cells.length;
    const EMPTY = 0;

    for (const [dx, dy] of directions) {
        let count = 1;
        let leftOpen = false, rightOpen = false;

        for (let i = 1; i < 5; i++) {
            const nx = x + dx * i, ny = y + dy * i;
            if (ny >= 0 && ny < SIZE && nx >= 0 && nx < SIZE && cells[ny][nx] === color) count++;
            else {
                rightOpen = ny >= 0 && ny < SIZE && nx >= 0 && nx < SIZE && cells[ny][nx] === EMPTY;
                break;
            }
        }
        for (let i = 1; i < 5; i++) {
            const nx = x - dx * i, ny = y - dy * i;
            if (ny >= 0 && ny < SIZE && nx >= 0 && nx < SIZE && cells[ny][nx] === color) count++;
            else {
                leftOpen = ny >= 0 && ny < SIZE && nx >= 0 && nx < SIZE && cells[ny][nx] === EMPTY;
                break;
            }
        }

        if (count >= 5) totalScore += 1000000;
        else if (count === 4) {
            if (leftOpen && rightOpen) totalScore += 100000;
            else if (leftOpen || rightOpen) totalScore += 10000;
        }
        else if (count === 3) {
            if (leftOpen && rightOpen) totalScore += 5000;
            else if (leftOpen || rightOpen) totalScore += 500;
        }
        else if (count === 2) {
            if (leftOpen && rightOpen) totalScore += 50;
            else if (leftOpen || rightOpen) totalScore += 5;
        }
    }
    return totalScore;
}

function estimateWinRate(cells, myColor) {
    const opp = myColor === 1 ? 2 : 1;
    let myScore = 0, oppScore = 0;
    const SIZE = cells.length;

    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            if (cells[r][c] === myColor) myScore += 1;
            else if (cells[r][c] === opp) oppScore += 1;
        }
    }

    const diff = myScore - oppScore;
    const winRate = 50 + diff * 2;
    return Math.max(5, Math.min(95, winRate));
}

// 更新 AI 面板 UI
export function updateAIPanel(result, myColor, gameMode = 'gomoku') {
    const recommendEl = document.getElementById('ai-recommend');
    const winrateFill = document.getElementById('winrate-fill');
    const winrateText = document.getElementById('winrate-text');
    const threatEl = document.getElementById('ai-threat');

    if (!result) return;

    // 检查是否是作弊模式结果（有 topThreats）
    if (result.topThreats) {
        // 作弊模式 UI
        if (result.bestMove) {
            const col = String.fromCharCode(65 + (result.bestMove.x >= 8 ? result.bestMove.x + 1 : result.bestMove.x));
            const row = gameMode === 'go' ? (GO_SIZE - result.bestMove.y) : (result.bestMove.y + 1);
            recommendEl.textContent = `${col}${row}`;
        } else {
            recommendEl.textContent = '--';
        }

        const wr = Math.max(5, Math.min(95, result.winRate));
        winrateFill.style.width = wr + '%';
        winrateText.textContent = wr + '%';

        threatEl.textContent = '⚠️ 对手威胁位置（见棋盘）';
        threatEl.className = 'ai-value ai-danger';

        return;
    }

    // 正常模式 UI
    if (result.bestMove) {
        const col = String.fromCharCode(65 + (result.bestMove.x >= 8 ? result.bestMove.x + 1 : result.bestMove.x));
        const row = gameMode === 'go' ? (GO_SIZE - result.bestMove.y) : (result.bestMove.y + 1);
        recommendEl.textContent = `${col}${row}`;
    } else {
        recommendEl.textContent = '--';
    }

    const wr = Math.max(1, Math.min(99, result.winRate));
    winrateFill.style.width = wr + '%';
    winrateText.textContent = wr + '%';

    // 围棋模式的威胁显示
    if (gameMode === 'go') {
        const dangers = result.threats ? result.threats.filter(t => t.level === 'danger') : [];
        if (dangers.length > 0) {
            threatEl.textContent = `紧急！${dangers.length} 处需救援`;
            threatEl.className = 'ai-value ai-danger';
        } else {
            threatEl.textContent = '安全';
            threatEl.className = 'ai-value ai-safe';
        }
        return;
    }

    // 五子棋威胁显示
    const dangers = result.threats ? result.threats.filter(t => t.level === 'danger') : [];
    const warnings = result.threats ? result.threats.filter(t => t.level === 'warning') : [];

    if (dangers.length > 0) {
        threatEl.textContent = `紧急！对手有 ${dangers.length} 个致命威胁`;
        threatEl.className = 'ai-value ai-danger';
    } else if (warnings.length > 0) {
        threatEl.textContent = `注意：对手有 ${warnings.length} 个威胁布局`;
        threatEl.className = 'ai-value ai-warning';
    } else {
        threatEl.textContent = '安全';
        threatEl.className = 'ai-value ai-safe';
    }
}
