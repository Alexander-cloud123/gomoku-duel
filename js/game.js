// js/game.js - 对局状态机（纯逻辑，不依赖 DOM / Canvas）
import {
    EMPTY,
    BLACK,
    WHITE,
    MODES,
    DEFAULT_KOMI,
    normalizeSize,
    opponent,
    createEmptyBoard,
    cloneBoard,
    inBounds,
    formatMove
} from './rules/constants.js';
import * as gomoku from './rules/gomoku-rules.js';
import * as go from './rules/go-rules.js';

export const PHASES = Object.freeze({
    IDLE: 'idle',
    PLAYING: 'playing',
    SCORING: 'scoring',
    FINISHED: 'finished'
});

export const UNDO_LIMIT_DEFAULT = 3;

function normalizeSettings(mode, size, input = {}) {
    const komiNum = Number(input.komi);
    const komi = Number.isFinite(komiNum)
        ? Math.min(15, Math.max(0, komiNum))
        : (DEFAULT_KOMI[size] ?? 7.5);
    const undoNum = Number(input.undoLimit);
    const undoLimit = Number.isFinite(undoNum)
        ? Math.min(10, Math.max(0, Math.floor(undoNum)))
        : UNDO_LIMIT_DEFAULT;

    return {
        winLength: 5,
        overlineWins: input.overlineWins ?? true,
        komi,
        superko: input.superko ?? true,
        undoLimit,
        assist: input.assist ?? true
    };
}

export class Game {
    /**
     * @param {object} options
     * @param {'gomoku'|'go'} options.mode
     * @param {number} [options.size]
     * @param {object} [options.settings]
     * @param {object} [options.events] onChange/onGameOver/onPhase
     */
    constructor(options = {}) {
        this.mode = options.mode === MODES.GO ? MODES.GO : MODES.GOMOKU;
        this.size = normalizeSize(this.mode, options.size);
        this.settings = normalizeSettings(this.mode, this.size, options.settings);
        this.events = options.events || {};
        this.myColor = BLACK;

        this.cells = createEmptyBoard(this.size);
        this.turn = BLACK;
        this.moveHistory = [];
        this.captures = { [BLACK]: 0, [WHITE]: 0 };
        this.koPoint = null;
        this.passCount = 0;
        this.historyKeys = new Set();
        this.deadStones = new Set();
        this.agreed = new Set();
        this.undoUsed = { [BLACK]: 0, [WHITE]: 0 };
        this.phase = PHASES.IDLE;
        this.isOver = false;
        this.result = null;
        this.lastMove = null;
        this.winLine = null;
    }

    start(options = {}) {
        this.myColor = options.myColor ?? BLACK;
        this._resetBoard();
        this.phase = PHASES.PLAYING;
        this._emit({ type: 'start' });
    }

    restart() {
        this._resetBoard();
        this.phase = PHASES.PLAYING;
        this._emit({ type: 'restart' });
    }

    _resetBoard() {
        this.cells = createEmptyBoard(this.size);
        this.turn = BLACK;
        this.moveHistory = [];
        this.captures = { [BLACK]: 0, [WHITE]: 0 };
        this.koPoint = null;
        this.passCount = 0;
        this.deadStones = new Set();
        this.agreed = new Set();
        this.undoUsed = { [BLACK]: 0, [WHITE]: 0 };
        this.isOver = false;
        this.result = null;
        this.lastMove = null;
        this.winLine = null;
        this._refreshHistoryKeys(true);
    }

    _refreshHistoryKeys(initial) {
        if (this.mode !== MODES.GO) {
            this.historyKeys = new Set();
            return;
        }
        this.historyKeys = new Set([go.boardKey(this.cells)]);
        if (initial) return;
        // 由调用方回放时逐手补充
    }

    _goState() {
        return {
            size: this.size,
            cells: this.cells,
            koPoint: this.koPoint,
            superko: this.settings.superko,
            historyKeys: this.historyKeys
        };
    }

    isMyTurn() {
        return this.phase === PHASES.PLAYING && this.turn === this.myColor && !this.isOver;
    }

    canPlay(color) {
        return this.phase === PHASES.PLAYING && !this.isOver && this.turn === color;
    }

    /**
     * 统一落子入口（本地与远端都走这里，负责全部合法性校验）。
     */
    applyMove(color, x, y) {
        if (this.phase !== PHASES.PLAYING || this.isOver) {
            return { ok: false, reason: 'not-playing' };
        }
        if (color !== this.turn) return { ok: false, reason: 'not-your-turn' };
        if (!inBounds(this.size, x, y)) return { ok: false, reason: 'out-of-bounds' };
        if (this.cells[y][x] !== EMPTY) return { ok: false, reason: 'occupied' };

        let move;

        if (this.mode === MODES.GO) {
            const state = this._goState();
            const result = go.placeStone(state, x, y, color);
            if (!result.ok) return { ok: false, reason: result.reason };
            this.koPoint = state.koPoint;
            const captured = result.captured.map((c) => ({ x: c.x, y: c.y }));
            this.captures[color] += captured.length;
            move = { x, y, color, captured };
        } else {
            if (!gomoku.place(this.cells, x, y, color)) return { ok: false, reason: 'occupied' };
            move = { x, y, color };
        }

        this.moveHistory.push(move);
        this.passCount = 0;
        this.lastMove = { x, y, color };

        if (this.mode === MODES.GOMOKU) {
            const win = gomoku.checkWin(this.cells, x, y, color, this.settings);
            if (win) {
                this.winLine = win.line;
                this._finish({ winner: color, reason: 'five', line: win.line });
            } else if (gomoku.isFull(this.cells)) {
                this._finish({ winner: null, reason: 'full' });
            }
        }

        if (this.phase === PHASES.PLAYING) this.turn = opponent(color);

        this._emit({ type: 'move', color, move });
        return { ok: true, move };
    }

    /** 远端落子（与 applyMove 相同校验，保留语义化名字）。 */
    receiveMove(color, x, y) {
        return this.applyMove(color, x, y);
    }

    pass(color) {
        if (this.mode !== MODES.GO) return { ok: false, reason: 'not-go' };
        if (!this.canPlay(color)) return { ok: false, reason: 'not-your-turn' };

        const move = { x: -1, y: -1, color, pass: true };
        this.moveHistory.push(move);
        this.passCount++;
        this.lastMove = null;
        this.winLine = null;

        if (this.passCount >= 2) {
            this.phase = PHASES.SCORING;
            this.agreed.clear();
            this._emit({ type: 'scoring', color });
        } else {
            this.turn = opponent(color);
            this._emit({ type: 'pass', color, move });
        }
        return { ok: true, move };
    }

    receivePass(color) {
        return this.pass(color);
    }

    /** 终局点目阶段：点击棋组切换死子标记（双方均可标记，变更会清空确认）。 */
    toggleDead(x, y) {
        if (this.phase !== PHASES.SCORING) return false;
        if (this.mode !== MODES.GO) return false;
        const changed = go.toggleDeadGroup(this.cells, x, y, this.deadStones, this.size);
        if (changed) {
            this.agreed.clear();
            this._emit({ type: 'dead', x, y });
        }
        return changed;
    }

    getScore() {
        return go.scoreArea(this.cells, {
            komi: this.settings.komi,
            deadStones: this.deadStones
        });
    }

    scoreHash() {
        return go.scoreHash(this.cells, this.deadStones);
    }

    /**
     * 双方确认点目结果；哈希不一致时拒绝（说明两端盘面不同步）。
     */
    agreeScore(color, hash) {
        if (this.phase !== PHASES.SCORING) return { ok: false, reason: 'not-scoring' };
        if (this.agreed.has(color)) return { ok: false, reason: 'already-agreed' };
        if (hash && hash !== this.scoreHash()) return { ok: false, reason: 'hash-mismatch' };

        this.agreed.add(color);
        this._emit({ type: 'agree', color });

        if (this.agreed.has(BLACK) && this.agreed.has(WHITE)) {
            const score = this.getScore();
            this._finish({
                winner: score.winner,
                reason: 'score',
                score
            });
            return { ok: true, finished: true, score };
        }
        return { ok: true, finished: false };
    }

    finishDraw() {
        if (this.phase !== PHASES.PLAYING || this.isOver) return false;
        this._finish({ winner: null, reason: 'draw' });
        return true;
    }

    /** 点目阶段用对端同步过来的死子集合替换本地标记（幂等，避免双端点击互相抵消）。 */
    setDeadStones(keys) {
        if (this.phase !== PHASES.SCORING || this.mode !== MODES.GO) return false;
        this.deadStones = new Set(keys);
        this.agreed.clear();
        this._emit({ type: 'dead' });
        return true;
    }

    resign(color) {
        if (this.phase === PHASES.IDLE || this.phase === PHASES.FINISHED || this.phase === PHASES.SCORING) {
            return { ok: false, reason: 'not-playing' };
        }
        this._finish({ winner: opponent(color), reason: 'resign' });
        this._emit({ type: 'resign', color });
        return { ok: true };
    }

    _finish(result) {
        this.isOver = true;
        this.result = result;
        this.phase = PHASES.FINISHED;
        this._emit({ type: 'finished' });
        if (this.events.onGameOver) this.events.onGameOver(result, this.snapshot());
    }

    canUndo(color) {
        if (this.phase !== PHASES.PLAYING || this.isOver) return false;
        if (this.undoUsed[color] >= this.settings.undoLimit) return false;
        return this.moveHistory.some((m) => m.color === color);
    }

    /** 撤销到请求方上一次落子之前需要回退的步数。 */
    undoSteps(color) {
        let steps = 0;
        for (let i = this.moveHistory.length - 1; i >= 0; i--) {
            steps++;
            if (this.moveHistory[i].color === color) break;
        }
        return steps;
    }

    performUndo(color) {
        if (!this.canUndo(color)) return { ok: false, reason: 'undo-not-allowed' };
        const steps = this.undoSteps(color);
        if (steps <= 0) return { ok: false, reason: 'nothing-to-undo' };

        this.moveHistory.splice(this.moveHistory.length - steps, steps);
        this.undoUsed[color]++;
        this._rebuild();
        this._emit({ type: 'undo', color, steps });
        return { ok: true, steps };
    }

    /** 从 moveHistory 完全重建盘面（用于悔棋与同步，避免逐手恢复的边界 bug）。 */
    _rebuild() {
        const history = this.moveHistory;

        this.cells = createEmptyBoard(this.size);
        this.captures = { [BLACK]: 0, [WHITE]: 0 };
        this.koPoint = null;
        this.passCount = 0;
        this.deadStones = new Set();
        this.agreed = new Set();
        this.isOver = false;
        this.result = null;
        this.phase = PHASES.PLAYING;
        this.lastMove = null;
        this.winLine = null;
        this.turn = BLACK;
        this._refreshHistoryKeys(true);

        for (const move of history) {
            if (move.pass) {
                this.passCount++;
                this.turn = opponent(move.color);
                continue;
            }

            this.passCount = 0;

            if (this.mode === MODES.GO) {
                const state = this._goState();
                const result = go.placeStone(state, move.x, move.y, move.color);
                if (!result.ok) throw new Error(`历史回放失败: ${result.reason} @ ${move.x},${move.y}`);
                this.koPoint = state.koPoint;
                move.captured = result.captured.map((c) => ({ x: c.x, y: c.y }));
                this.captures[move.color] += result.captured.length;
            } else {
                gomoku.place(this.cells, move.x, move.y, move.color);
            }

            this.turn = opponent(move.color);
            this.lastMove = { x: move.x, y: move.y, color: move.color };
        }

        if (this.mode === MODES.GO && this.passCount >= 2) {
            this.phase = PHASES.SCORING;
        }
    }

    snapshot() {
        return {
            mode: this.mode,
            size: this.size,
            settings: { ...this.settings },
            cells: cloneBoard(this.cells),
            turn: this.turn,
            myColor: this.myColor,
            moveHistory: this.moveHistory.map((m) => ({
                x: m.x,
                y: m.y,
                color: m.color,
                pass: m.pass || false,
                captured: m.captured ? m.captured.map((c) => ({ x: c.x, y: c.y })) : undefined
            })),
            captures: { ...this.captures },
            koPoint: this.koPoint ? { ...this.koPoint } : null,
            passCount: this.passCount,
            phase: this.phase,
            isOver: this.isOver,
            result: this.result ? JSON.parse(JSON.stringify(this.result)) : null,
            deadStones: Array.from(this.deadStones),
            agreed: Array.from(this.agreed),
            undoUsed: { ...this.undoUsed },
            lastMove: this.lastMove ? { ...this.lastMove } : null,
            winLine: this.winLine ? this.winLine.map((p) => ({ ...p })) : null
        };
    }

    stateHash() {
        return [
            this.mode,
            this.size,
            this.cells.map((row) => row.join('')).join(''),
            this.turn,
            this.captures[BLACK],
            this.captures[WHITE],
            this.koPoint ? `${this.koPoint.x},${this.koPoint.y}` : '-',
            this.passCount,
            this.phase
        ].join('~');
    }

    /**
     * 从快照恢复（用于断线重连 / 重同步）。回放历史后再覆盖终局阶段信息。
     */
    restore(snapshot) {
        if (!snapshot || !Object.values(MODES).includes(snapshot.mode)) {
            throw new Error('非法快照');
        }
        if (snapshot.mode !== this.mode || snapshot.size !== this.size) {
            throw new Error('快照模式/棋盘尺寸不匹配');
        }

        this.settings = normalizeSettings(this.mode, this.size, snapshot.settings || this.settings);
        this.myColor = snapshot.myColor ?? this.myColor;
        this.moveHistory = (snapshot.moveHistory || []).map((m) => ({
            x: m.x,
            y: m.y,
            color: m.color,
            pass: m.pass || false,
            captured: Array.isArray(m.captured) ? m.captured.map((c) => ({ x: c.x, y: c.y })) : undefined
        }));
        this.undoUsed = snapshot.undoUsed
            ? { [BLACK]: snapshot.undoUsed[BLACK] || 0, [WHITE]: snapshot.undoUsed[WHITE] || 0 }
            : { [BLACK]: 0, [WHITE]: 0 };

        this._rebuild();

        this.cells = cloneBoard(snapshot.cells);
        this.turn = snapshot.turn ?? this.turn;
        this.captures = { [BLACK]: snapshot.captures?.[BLACK] || 0, [WHITE]: snapshot.captures?.[WHITE] || 0 };
        this.koPoint = snapshot.koPoint ? { ...snapshot.koPoint } : null;
        this.passCount = snapshot.passCount ?? 0;
        this.phase = snapshot.phase || PHASES.PLAYING;
        this.isOver = Boolean(snapshot.isOver);
        this.result = snapshot.result ? JSON.parse(JSON.stringify(snapshot.result)) : null;
        this.deadStones = new Set(snapshot.deadStones || []);
        this.agreed = new Set(snapshot.agreed || []);
        this.lastMove = snapshot.lastMove ? { ...snapshot.lastMove } : null;
        this.winLine = Array.isArray(snapshot.winLine) ? snapshot.winLine.map((p) => ({ ...p })) : null;

        this._emit({ type: 'restore' });
        if (this.isOver && this.result && this.events.onGameOver) {
            this.events.onGameOver(this.result, this.snapshot());
        }
    }

    getMoveHistoryText() {
        return this.moveHistory
            .map((m) => {
                const symbol = m.color === BLACK ? '●' : '○';
                if (m.pass) return `${symbol}Pass`;
                return `${symbol}${formatMove(m, this.size)}`;
            })
            .join(' ');
    }

    _emit(meta) {
        if (this.events.onChange) this.events.onChange(this.snapshot(), meta);
        if (this.events.onPhase && meta.type === 'scoring') this.events.onPhase(this.phase, this.snapshot());
    }
}
