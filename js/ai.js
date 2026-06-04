// ai.js - AI 主线程：调用 worker、展示结果

import { BLACK, WHITE, SIZE } from './board.js';

export class AIAssistant {
    constructor() {
        this.worker = null;
        this.enabled = false;
        this.onResult = null; // ({bestMove, winRate, threats})
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

    analyze(cells, myColor, moveCount) {
        if (!this.enabled) return;

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

// 更新 AI 面板 UI
export function updateAIPanel(result, myColor) {
    const recommendEl = document.getElementById('ai-recommend');
    const winrateFill = document.getElementById('winrate-fill');
    const winrateText = document.getElementById('winrate-text');
    const threatEl = document.getElementById('ai-threat');

    if (!result) return;

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
