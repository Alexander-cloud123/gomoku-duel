// game.js - 游戏状态机

import { Board, BLACK, WHITE, EMPTY, SIZE } from './board.js';

export class Game {
    constructor(board) {
        this.board = board;
        this.myColor = null;      // BLACK or WHITE
        this.oppColor = null;
        this.currentTurn = BLACK;  // 黑先
        this.moveHistory = [];     // [{x, y, color}]
        this.isOver = false;
        this.hasAssistant = false;

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
    }

    start(myColor, hasAssistant) {
        this.myColor = myColor;
        this.oppColor = myColor === BLACK ? WHITE : BLACK;
        this.hasAssistant = hasAssistant;
        this.currentTurn = BLACK;
        this.moveHistory = [];
        this.isOver = false;
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
        if (!this.board.place(x, y, this.myColor)) return false;

        this.moveHistory.push({ x, y, color: this.myColor });

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

    receiveMove(x, y, color) {
        if (this.isOver) return;
        if (color !== this.oppColor) return;
        if (!this.board.place(x, y, color)) return;

        this.moveHistory.push({ x, y, color });

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

    requestUndo() {
        if (this.moveHistory.length === 0 || this.isOver) return;
        if (this.onUndoRequest) this.onUndoRequest({ type: 'UNDO_REQUEST' });
    }

    handleUndoRequest() {
        // 同意悔棋：撤销最近 2 步（对手一步 + 自己一步），或 1 步（如果只有 1 步）
        const stepsToUndo = this.moveHistory.length >= 2 ? 2 : 1;
        for (let i = 0; i < stepsToUndo; i++) {
            const move = this.moveHistory.pop();
            if (move) this.board.undo(move.x, move.y);
        }
        this.currentTurn = this.moveHistory.length % 2 === 0 ? BLACK : WHITE;
        this._updateTurnUI();
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
        this.board.setHoverColor(this.myColor);
        this._updateTurnUI();
    }

    getMoveHistoryText() {
        return this.moveHistory.map((m, i) => {
            const col = String.fromCharCode(65 + m.x);
            const row = m.y + 1;
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
            indicator.textContent = '轮到你落子';
            indicator.className = 'turn-indicator my-turn';
        } else {
            indicator.textContent = '等待对手落子...';
            indicator.className = 'turn-indicator';
        }
    }
}
