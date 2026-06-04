// ai.js - AI 主线程：调用 worker、展示结果

import { BLACK, WHITE, SIZE } from './board.js';
import { findThreats, EMPTY } from './ai-eval.js';

export class AIAssistant {
    constructor() {
        this.worker = null;
        this.enabled = false;
        this.onResult = null; // ({bestMove, winRate, threats, topThreats})
        this.cheatMode = false;
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

    analyze(cells, myColor, moveCount) {
        if (!this.enabled) return;

        const opp = myColor === BLACK ? WHITE : BLACK;

        // 作弊模式：快速启发式计算，超快
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
            
            // 2. 快速找到最佳落子位置（启发式，不使用 Minimax）
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
        // 自适应深度：开局 4 层，中局 6 层，残局 8 层
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
        // 如果 worker 不可用，则不分析（避免阻塞主线程）
    }

    destroy() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
    }
}

// 简单的威胁评分函数（用于作弊模式）
function scoreThreat(cells, x, y, color) {
    let score = 0;
    const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
    
    for (const [dx, dy] of directions) {
        let count = 1;
        // 正向
        for (let i = 1; i < 5; i++) {
            const nx = x + dx * i, ny = y + dy * i;
            if (ny >= 0 && ny < 15 && nx >= 0 && nx < 15 && cells[ny][nx] === color) count++;
            else break;
        }
        // 反向
        for (let i = 1; i < 5; i++) {
            const nx = x - dx * i, ny = y - dy * i;
            if (ny >= 0 && ny < 15 && nx >= 0 && nx < 15 && cells[ny][nx] === color) count++;
            else break;
        }
        // 五连/四连/三连分数很高
        if (count >= 5) score += 1000000;
        else if (count === 4) score += 100000;
        else if (count === 3) score += 5000;
        else if (count === 2) score += 100;
    }
    return score;
}

// 快速找到最佳落子位置（作弊模式用，不使用 Minimax
function findBestMoveQuick(cells, myColor) {
    const SIZE = 15;
    const EMPTY = 0;
    const candidates = [];
    
    // 找到所有候选位置（已有棋子周围2格）
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
    
    // 如果棋盘为空，返回中心
    if (candidates.length === 0) {
        return { x: 7, y: 7 };
    }
    
    // 给每个候选位置评分
    let bestScore = -Infinity;
    let bestMove = candidates[0];
    
    for (const move of candidates) {
        // 先假设这里下这个位置，看自己的进攻得分
        cells[move.y][move.x] = myColor;
        const myScore = quickScorePosition(cells, move.x, move.y, myColor);
        cells[move.y][move.x] = EMPTY;
        
        // 再看如果不下这里，对手下这里的得分
        const opp = myColor === 1 ? 2 : 1;
        cells[move.y][move.x] = opp;
        const oppScore = quickScorePosition(cells, move.x, move.y, opp);
        cells[move.y][move.x] = EMPTY;
        
        // 总得分 = 自己进攻 + 防守
        const totalScore = myScore + oppScore * 1.2;
        
        if (totalScore > bestScore) {
            bestScore = totalScore;
            bestMove = move;
        }
    }
    
    return bestMove;
}

// 快速评分单个位置的棋型
function quickScorePosition(cells, x, y, color) {
    let totalScore = 0;
    const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
    const SIZE = 15;
    const EMPTY = 0;
    
    for (const [dx, dy] of directions) {
        let count = 1;
        let leftOpen = false, rightOpen = false;
        
        // 正向
        for (let i = 1; i < 5; i++) {
            const nx = x + dx * i, ny = y + dy * i;
            if (ny >= 0 && ny < SIZE && nx >= 0 && nx < SIZE && cells[ny][nx] === color) count++;
            else {
                rightOpen = ny >= 0 && ny < SIZE && nx >= 0 && nx < SIZE && cells[ny][nx] === EMPTY;
                break;
            }
        }
        // 反向
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

// 简单估算胜率
function estimateWinRate(cells, myColor) {
    const opp = myColor === 1 ? 2 : 1;
    let myScore = 0, oppScore = 0;
    const SIZE = 15;
    const EMPTY = 0;
    
    // 简单统计双方棋子数量
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
export function updateAIPanel(result, myColor) {
    const recommendEl = document.getElementById('ai-recommend');
    const winrateFill = document.getElementById('winrate-fill');
    const winrateText = document.getElementById('winrate-text');
    const threatEl = document.getElementById('ai-threat');

    if (!result) return;

    // 检查是否是作弊模式结果（有 topThreats）
    if (result.topThreats) {
        // 作弊模式 UI：显示推荐位置（和正常模式一样）
        if (result.bestMove) {
            const col = String.fromCharCode(65 + result.bestMove.x);
            const row = result.bestMove.y + 1;
            recommendEl.textContent = `${col}${row}`;
        } else {
            recommendEl.textContent = '--';
        }
        
        // 胜率
        const wr = Math.max(5, Math.min(95, result.winRate));
        winrateFill.style.width = wr + '%';
        winrateText.textContent = wr + '%';
        
        // 威胁提示
        threatEl.textContent = '⚠️ 对手威胁位置（见棋盘）';
        threatEl.className = 'ai-value ai-danger';
        
        return;
    }

    // 正常模式 UI
    // 推荐位置
    if (result.bestMove) {
        const col = String.fromCharCode(65 + result.bestMove.x);
        const row = result.bestMove.y + 1;
        recommendEl.textContent = `${col}${row}`;
    } else {
        recommendEl.textContent = '--';
    }

    // 胜率
    const wr = Math.max(1, Math.min(99, result.winRate));
    winrateFill.style.width = wr + '%';
    winrateText.textContent = wr + '%';

    // 威胁
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
