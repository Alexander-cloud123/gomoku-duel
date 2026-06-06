// game.js - 游戏状态机（支持五子棋和围棋）

import { Board, BLACK, WHITE, EMPTY } from './board.js';

export class Game {
    constructor(board, gameMode = 'gomoku') {
        this.board = board;
        this.gameMode = gameMode;
        this.myColor = null;      // BLACK or WHITE
        this.oppColor = null;
        this.currentTurn = BLACK;  // 黑先
        this.moveHistory = [];     // [{x, y, color, captured}]
        this.isOver = false;
        this.hasAssistant = false;

        // 围棋特有状态
        this.captures = { [BLACK]: 0, [WHITE]: 0 }; // 提子数
        this.passCount = 0; // 连续虚手计数

        this.onMyTurn = null;
        this.onOppTurn = null;
        this.onWin = null;
        this.onDraw = null;
        this.onMoveSent = null;
        this.onUndoRequest = null;
        this.onUndoResponse = null;
        this.onDrawRequest = null;
        this.onDrawResponse = null;
        this.onRestart = null;
        this.onPass = null;       // 围棋：虚手回调
        this.onGameEnd = null;    // 围棋：终局计分回调
    }

    start(myColor, hasAssistant) {
        this.myColor = myColor;
        this.oppColor = myColor === BLACK ? WHITE : BLACK;
        this.hasAssistant = hasAssistant;
        this.currentTurn = BLACK;
        this.moveHistory = [];
        this.isOver = false;
        this.captures = { [BLACK]: 0, [WHITE]: 0 };
        this.passCount = 0;
        this.board.reset();
        this.board.setHoverColor(myColor);

        this._updateTurnUI();
    }

    isMyTurn() {
        return this.currentTurn === this.myColor && !this.isOver;
    }

    placeStone(x, y) {
        if (this.isOver) return false;
        if (!this.isMyTurn()) return false;

        if (this.gameMode === 'go') {
            return this._placeGo(x, y);
        }

        // 五子棋模式
        if (!this.board.place(x, y, this.myColor)) return false;

        this.moveHistory.push({ x, y, color: this.myColor });
        this.passCount = 0; // 重置虚手计数

        if (this.board.checkWin(x, y, this.myColor)) {
            this.isOver = true;
            if (this.onWin) this.onWin(this.myColor);
        } else if (this.board.isFull()) {
            this.isOver = true;
            if (this.onDraw) this.onDraw();
        } else {
            this.currentTurn = this.oppColor;
            this._updateTurnUI();
        }

        if (this.onMoveSent) this.onMoveSent({ type: 'MOVE', x, y, color: this.myColor });
        return true;
    }

    // 围棋落子
    _placeGo(x, y) {
        const result = this.board.place(x, y, this.myColor);
        if (!result) return false;

        this.moveHistory.push({
            x, y,
            color: this.myColor,
            captured: result.captured || []
        });
        this.passCount = 0; // 重置虚手计数

        // 更新提子数
        if (result.captured) {
            this.captures[this.myColor] += result.captured.length;
        }

        // 围棋无即时胜负，切换回合
        this.currentTurn = this.oppColor;
        this._updateTurnUI();

        if (this.onMoveSent) this.onMoveSent({ type: 'MOVE', x, y, color: this.myColor });
        return true;
    }

    receiveMove(x, y, color) {
        if (this.isOver) return;
        if (color !== this.oppColor) return;

        if (this.gameMode === 'go') {
            return this._receiveGoMove(x, y, color);
        }

        // 五子棋模式
        if (!this.board.place(x, y, color)) return;

        this.moveHistory.push({ x, y, color });
        this.passCount = 0;

        if (this.board.checkWin(x, y, color)) {
            this.isOver = true;
            if (this.onWin) this.onWin(color);
        } else if (this.board.isFull()) {
            this.isOver = true;
            if (this.onDraw) this.onDraw();
        } else {
            this.currentTurn = this.myColor;
            this._updateTurnUI();
        }
    }

    // 围棋接收对手落子
    _receiveGoMove(x, y, color) {
        const result = this.board.place(x, y, color);
        if (!result) return;

        this.moveHistory.push({
            x, y,
            color,
            captured: result.captured || []
        });
        this.passCount = 0;

        if (result.captured) {
            this.captures[color] += result.captured.length;
        }

        this.currentTurn = this.myColor;
        this._updateTurnUI();
    }

    // 虚手（Pass）— 围棋专用
    pass() {
        if (this.isOver) return false;
        if (!this.isMyTurn()) return false;
        if (this.gameMode !== 'go') return false;

        this.passCount++;
        this.moveHistory.push({ x: -1, y: -1, color: this.myColor, pass: true });

        if (this.passCount >= 2) {
            // 双方连续虚手，终局
            this.isOver = true;
            const score = this.board.calculateScore(this.captures);
            if (this.onGameEnd) this.onGameEnd(score);
        } else {
            this.currentTurn = this.oppColor;
            this._updateTurnUI();
        }

        if (this.onMoveSent) this.onMoveSent({ type: 'PASS', color: this.myColor });
        if (this.onPass) this.onPass(this.myColor);
        return true;
    }

    // 接收对手虚手
    receivePass(color) {
        if (this.isOver) return;
        if (color !== this.oppColor) return;

        this.passCount++;
        this.moveHistory.push({ x: -1, y: -1, color, pass: true });

        if (this.passCount >= 2) {
            this.isOver = true;
            const score = this.board.calculateScore(this.captures);
            if (this.onGameEnd) this.onGameEnd(score);
        } else {
            this.currentTurn = this.myColor;
            this._updateTurnUI();
        }
    }

    // 终局计分（也可手动触发）
    calculateScore() {
        return this.board.calculateScore(this.captures);
    }

    requestUndo() {
        if (this.moveHistory.length === 0 || this.isOver) return;
        if (this.onUndoRequest) this.onUndoRequest({ type: 'UNDO_REQUEST' });
    }

    handleUndoRequest() {
        if (this.gameMode === 'go') {
            // 围棋悔棋：撤销最近 2 步，恢复被提棋子
            const stepsToUndo = this.moveHistory.length >= 2 ? 2 : 1;
            for (let i = 0; i < stepsToUndo; i++) {
                const move = this.moveHistory.pop();
                if (!move) break;
                if (move.pass) {
                    this.passCount = Math.max(0, this.passCount - 1);
                } else {
                    // 恢复被提走的棋子
                    const restoreStones = (move.captured || []).map(s => ({ ...s, color: s.color || (move.color === BLACK ? WHITE : BLACK) }));
                    this.board.undo(move.x, move.y, restoreStones.length > 0 ? restoreStones : null);
                    // 更新提子数
                    if (move.captured && move.captured.length > 0) {
                        this.captures[move.color] -= move.captured.length;
                    }
                }
            }
            this.currentTurn = this.moveHistory.length % 2 === 0 ? BLACK : WHITE;
            this._updateTurnUI();
        } else {
            // 五子棋悔棋
            const stepsToUndo = this.moveHistory.length >= 2 ? 2 : 1;
            for (let i = 0; i < stepsToUndo; i++) {
                const move = this.moveHistory.pop();
                if (move) this.board.undo(move.x, move.y);
            }
            this.currentTurn = this.moveHistory.length % 2 === 0 ? BLACK : WHITE;
            this._updateTurnUI();
        }
    }

    requestDraw() {
        if (this.isOver) return;
        if (this.onDrawRequest) this.onDrawRequest({ type: 'DRAW_REQUEST' });
    }

    surrender() {
        if (this.isOver) return;
        this.isOver = true;
        if (this.onWin) this.onWin(this.oppColor);
    }

    restart() {
        this.board.reset();
        this.moveHistory = [];
        this.isOver = false;
        this.currentTurn = BLACK;
        this.captures = { [BLACK]: 0, [WHITE]: 0 };
        this.passCount = 0;
        this.board.setHoverColor(this.myColor);
        this._updateTurnUI();
    }

    getMoveHistoryText() {
        return this.moveHistory.map((m, i) => {
            if (m.pass) {
                const symbol = m.color === BLACK ? '●' : '○';
                return `${symbol}Pass`;
            }
            const col = String.fromCharCode(65 + (m.x >= 8 ? m.x + 1 : m.x)); // 跳过 I
            const row = this.board.size - m.y;
            const symbol = m.color === BLACK ? '●' : '○';
            return `${symbol}${col}${row}`;
        }).join(' ');
    }

    _updateTurnUI() {
        const indicator = document.getElementById('turn-indicator');
        if (this.isOver) {
            indicator.textContent = '对局结束';
            indicator.className = 'turn-indicator';
        } else if (this.isMyTurn()) {
            indicator.textContent = this.gameMode === 'go' ? '轮到你落子（或虚手）' : '轮到你落子';
            indicator.className = 'turn-indicator my-turn';
        } else {
            indicator.textContent = '等待对手落子...';
            indicator.className = 'turn-indicator';
        }
    }
}
