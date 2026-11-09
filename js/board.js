// js/board.js - 棋盘视图（Canvas 渲染 + 指针/键盘输入，不含规则）
import { EMPTY, BLACK, WHITE, inBounds, columnLabel, rowLabel } from './rules/constants.js';

const STAR_POINTS = {
    9: [2, 4, 6],
    13: [3, 6, 9],
    15: [3, 7, 11],
    19: [3, 9, 15]
};

const COLORS = {
    wood: '#F4ECD8',
    woodEdge: '#E8DCC0',
    line: '#3D3D3D',
    label: '#7F8C8D',
    black: '#1A1A1A',
    white: '#FFFFFF',
    accent: '#4A90E2',
    gold: '#E8B33C',
    danger: '#E74C3C',
    win: '#FF4444'
};

function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
}

function clamp01(v) {
    return Math.max(0, Math.min(1, v));
}

export class BoardView {
    constructor(canvas, options = {}) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.size = options.size || 15;
        this.mode = options.mode || 'gomoku';
        this.interactive = options.interactive !== false;

        this.onMove = null;
        this.onDeadClick = null;

        this.cells = [];
        for (let y = 0; y < this.size; y++) this.cells.push(new Array(this.size).fill(EMPTY));

        this.lastMove = null;
        this.winLine = null;
        this.koPoint = null;
        this.deadStones = new Set();
        this.hints = null;
        this.deadMarking = false;

        this._hover = null;
        this._cursor = null;
        this._animations = new Map();
        this._motionQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
            ? window.matchMedia('(prefers-reduced-motion: reduce)')
            : null;
        this._raf = 0;
        this._layout = { side: 0, padding: 0, cell: 0 };
        this._static = null;
        this._dpr = 1;

        this._bindEvents();
        this._observeResize();
        this._resize();
    }

    setSize(size, mode = this.mode) {
        this.size = size;
        this.mode = mode;
        this.cells = [];
        for (let y = 0; y < size; y++) this.cells.push(new Array(size).fill(EMPTY));
        this.lastMove = null;
        this.winLine = null;
        this.koPoint = null;
        this.deadStones = new Set();
        this.hints = null;
        this._hover = null;
        this._cursor = null;
        this._animations.clear();
        this._resize();
    }

    /**
     * 用对局快照更新视图。
     */
    setState(state) {
        const previous = this.cells;
        this.cells = state.cells;
        this.lastMove = state.lastMove || null;
        this.winLine = state.winLine || null;
        this.koPoint = state.koPoint || null;
        this.deadStones = new Set(state.deadStones || []);

        const lm = this.lastMove;
        if (!this._reducedMotion() && lm && previous.length === this.size && previous[lm.y] && previous[lm.y][lm.x] === EMPTY &&
            this.cells[lm.y][lm.x] !== EMPTY) {
            const color = this.cells[lm.y][lm.x];
            this._animations.set(`${lm.x},${lm.y}`, {
                x: lm.x, y: lm.y, color, start: performance.now()
            });
        }
        for (const key of this._animations.keys()) {
            const [x, y] = key.split(',').map(Number);
            if (this.cells[y] && this.cells[y][x] === EMPTY) this._animations.delete(key);
        }

        this._startAnimationLoop();
        this.render();
    }

    setHints(hints) {
        this.hints = hints || null;
        this.render();
    }

    setInteractive(interactive) {
        this.interactive = interactive;
        this.canvas.classList.toggle('not-interactive', !interactive);
        this.render();
    }

    setDeadMarking(marking) {
        this.deadMarking = marking;
        this.canvas.classList.toggle('marking', marking);
        this.render();
    }

    _observeResize() {
        if (typeof ResizeObserver !== 'undefined') {
            this._resizeObserver = new ResizeObserver(() => this._resize());
            this._resizeObserver.observe(this.canvas);
        } else {
            this._windowResize = () => this._resize();
            window.addEventListener('resize', this._windowResize);
        }
    }

    _resize() {
        const rect = this.canvas.getBoundingClientRect();
        const cssSide = Math.max(240, Math.round(rect.width || 600));
        const dpr = Math.min(3, window.devicePixelRatio || 1);
        if (this._dpr !== dpr || this.canvas.width !== Math.round(cssSide * dpr)) {
            this._dpr = dpr;
            this.canvas.width = Math.round(cssSide * dpr);
            this.canvas.height = Math.round(cssSide * dpr);
            this.canvas.style.height = `${cssSide}px`;
        }

        const marginCells = 0.9;
        const cell = cssSide / (this.size - 1 + marginCells * 2);
        this._layout = {
            side: cssSide,
            cell,
            padding: cell * marginCells
        };

        this._buildStaticLayer();
        this.render();
    }

    _buildStaticLayer() {
        const { side, cell, padding } = this._layout;
        const dpr = this._dpr;
        if (!this._static) this._static = document.createElement('canvas');
        const layer = this._static;
        layer.width = Math.round(side * dpr);
        layer.height = Math.round(side * dpr);
        const ctx = layer.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, side, side);

        // 木质底色
        const gradient = ctx.createLinearGradient(0, 0, side, side);
        gradient.addColorStop(0, COLORS.wood);
        gradient.addColorStop(1, COLORS.woodEdge);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, side, side);

        const gridEnd = padding + (this.size - 1) * cell;

        // 网格
        ctx.strokeStyle = COLORS.line;
        ctx.lineWidth = Math.max(1, cell * 0.035);
        ctx.lineCap = 'round';
        for (let i = 0; i < this.size; i++) {
            const pos = padding + i * cell;
            ctx.beginPath();
            ctx.moveTo(padding, pos);
            ctx.lineTo(gridEnd, pos);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(pos, padding);
            ctx.lineTo(pos, gridEnd);
            ctx.stroke();
        }

        // 星位
        const stars = STAR_POINTS[this.size] || [];
        ctx.fillStyle = COLORS.line;
        for (const r of stars) {
            for (const c of stars) {
                ctx.beginPath();
                ctx.arc(padding + c * cell, padding + r * cell, Math.max(2, cell * 0.11), 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // 坐标：列字母在下方，行号在左侧
        const fontSize = Math.max(9, Math.min(15, cell * 0.38));
        ctx.fillStyle = COLORS.label;
        ctx.font = `${fontSize}px -apple-system, "Segoe UI", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (let i = 0; i < this.size; i++) {
            ctx.fillText(columnLabel(i), padding + i * cell, gridEnd + cell * 0.55);
            ctx.textAlign = 'right';
            ctx.fillText(String(rowLabel(i, this.size)), padding - cell * 0.5, padding + i * cell);
            ctx.textAlign = 'center';
        }
    }

    _reducedMotion() {
        return Boolean(this._motionQuery && this._motionQuery.matches);
    }

    _startAnimationLoop() {
        if (this._reducedMotion()) {
            this._animations.clear();
            return;
        }
        if (this._raf || this._animations.size === 0) return;
        const tick = () => {
            this._raf = 0;
            this.render();
            let alive = false;
            const now = performance.now();
            for (const anim of this._animations.values()) {
                if (now - anim.start < 200) alive = true;
            }
            if (alive) this._raf = requestAnimationFrame(tick);
            else this._animations.clear();
        };
        this._raf = requestAnimationFrame(tick);
    }

    _stoneGeometry(x, y) {
        const { padding, cell } = this._layout;
        return {
            cx: padding + x * cell,
            cy: padding + y * cell,
            radius: cell * 0.42
        };
    }

    _eventToCell(e) {
        const rect = this.canvas.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        const { padding, cell, side } = this._layout;
        const col = Math.round((px - padding) / cell);
        const row = Math.round((py - padding) / cell);
        if (!inBounds(this.size, col, row)) return null;
        const cx = padding + col * cell;
        const cy = padding + row * cell;
        const dist = Math.hypot(px - cx, py - cy);
        if (dist > cell * 0.52) return null;
        if (px < 0 || py < 0 || px > side || py > side) return null;
        return { x: col, y: row };
    }

    _bindEvents() {
        this._onPointerDown = (e) => {
            if (!this.interactive) return;
            const cellPos = this._eventToCell(e);
            if (!cellPos) return;
            e.preventDefault();
            if (this.deadMarking) {
                if (this.onDeadClick) this.onDeadClick(cellPos.x, cellPos.y);
                return;
            }
            if (this.onMove) this.onMove(cellPos.x, cellPos.y);
        };

        this._onPointerMove = (e) => {
            if (!this.interactive) return;
            const next = this._eventToCell(e);
            const changed = (!this._hover && next) ||
                (this._hover && !next) ||
                (this._hover && next && (this._hover.x !== next.x || this._hover.y !== next.y));
            this._hover = next;
            if (changed) this.render();
        };

        this._onPointerLeave = () => {
            if (this._hover) {
                this._hover = null;
                this.render();
            }
        };

        this._onKeyDown = (e) => {
            if (!this.interactive) return;
            const cursor = this._cursor || { x: Math.floor(this.size / 2), y: Math.floor(this.size / 2) };
            let next = null;
            const deltas = {
                ArrowLeft: [-1, 0],
                ArrowRight: [1, 0],
                ArrowUp: [0, -1],
                ArrowDown: [0, 1]
            };
            if (deltas[e.key]) {
                next = { x: cursor.x + deltas[e.key][0], y: cursor.y + deltas[e.key][1] };
                e.preventDefault();
            }
            if (next) {
                this._cursor = {
                    x: Math.max(0, Math.min(this.size - 1, next.x)),
                    y: Math.max(0, Math.min(this.size - 1, next.y))
                };
                this.render();
                return;
            }
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                const pos = this._cursor || { x: Math.floor(this.size / 2), y: Math.floor(this.size / 2) };
                if (this.deadMarking) {
                    if (this.onDeadClick) this.onDeadClick(pos.x, pos.y);
                } else if (this.onMove) {
                    this.onMove(pos.x, pos.y);
                }
            }
        };

        this.canvas.addEventListener('pointerdown', this._onPointerDown);
        this.canvas.addEventListener('pointermove', this._onPointerMove);
        this.canvas.addEventListener('pointerleave', this._onPointerLeave);
        this.canvas.addEventListener('keydown', this._onKeyDown);
    }

    render() {
        if (!this.ctx) return;
        const { side } = this._layout;
        const dpr = this._dpr;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.ctx.clearRect(0, 0, side, side);

        if (this._static) this.ctx.drawImage(this._static, 0, 0, side, side);

        this._renderHints();
        this._renderStones();
        this._renderMarks();
        this._renderCursor();

        this.canvas.setAttribute('aria-label',
            `${this.mode === 'go' ? '围棋' : '五子棋'}棋盘，${this.size} 路，共 ${this.size * this.size} 个交叉点`);
    }

    _renderHints() {
        if (!this.hints) return;
        const ctx = this.ctx;
        const { cell } = this._layout;

        for (const threat of this.hints.threats || []) {
            const p = this._stoneGeometry(threat.x, threat.y);
            ctx.fillStyle = threat.level === 'danger' ? 'rgba(255, 68, 68, 0.42)' : 'rgba(243, 156, 18, 0.4)';
            ctx.beginPath();
            ctx.arc(p.cx, p.cy, cell * 0.4, 0, Math.PI * 2);
            ctx.fill();
        }

        for (const alt of this.hints.alternates || []) {
            const p = this._stoneGeometry(alt.x, alt.y);
            ctx.fillStyle = 'rgba(74, 144, 226, 0.55)';
            ctx.beginPath();
            ctx.arc(p.cx, p.cy, cell * 0.14, 0, Math.PI * 2);
            ctx.fill();
        }

        if (this.hints.recommend) {
            const r = this.hints.recommend;
            const p = this._stoneGeometry(r.x, r.y);
            ctx.save();
            ctx.strokeStyle = COLORS.gold;
            ctx.lineWidth = Math.max(2, cell * 0.09);
            ctx.shadowColor = 'rgba(232, 179, 60, 0.65)';
            ctx.shadowBlur = cell * 0.4;
            ctx.beginPath();
            ctx.arc(p.cx, p.cy, cell * 0.44, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }
    }

    _renderStones() {
        const now = performance.now();
        const ctx = this.ctx;

        for (let y = 0; y < this.size; y++) {
            for (let x = 0; x < this.size; x++) {
                const color = this.cells[y][x];
                if (color === EMPTY) continue;
                const anim = this._animations.get(`${x},${y}`);
                let scale = 1;
                let alpha = 1;
                if (anim) {
                    const progress = clamp01((now - anim.start) / 180);
                    scale = 0.62 + 0.38 * easeOutCubic(progress);
                    alpha = 0.6 + 0.4 * progress;
                }
                ctx.globalAlpha = alpha;
                this._drawStone(x, y, color, scale);
                ctx.globalAlpha = 1;

                if (this.deadStones.has(`${x},${y}`)) {
                    this._drawDeadMark(x, y);
                }
            }
        }
    }

    _drawStone(x, y, color, scale = 1) {
        const ctx = this.ctx;
        const p = this._stoneGeometry(x, y);
        const radius = p.radius * scale;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
        ctx.beginPath();
        ctx.arc(p.cx + radius * 0.08, p.cy + radius * 0.12, radius, 0, Math.PI * 2);
        ctx.fill();

        const gradient = ctx.createRadialGradient(
            p.cx - radius * 0.35, p.cy - radius * 0.35, radius * 0.2,
            p.cx, p.cy, radius
        );

        if (color === BLACK) {
            gradient.addColorStop(0, '#4A4A4A');
            gradient.addColorStop(1, COLORS.black);
        } else {
            gradient.addColorStop(0, '#FFFFFF');
            gradient.addColorStop(1, '#E6E6E6');
        }

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(p.cx, p.cy, radius, 0, Math.PI * 2);
        ctx.fill();

        if (color === WHITE) {
            ctx.strokeStyle = 'rgba(26, 26, 26, 0.35)';
            ctx.lineWidth = 1;
            ctx.stroke();
        }
    }

    _drawDeadMark(x, y) {
        const ctx = this.ctx;
        const p = this._stoneGeometry(x, y);
        const r = p.radius * 0.45;
        ctx.strokeStyle = 'rgba(231, 76, 60, 0.9)';
        ctx.lineWidth = Math.max(1.5, this._layout.cell * 0.06);
        ctx.beginPath();
        ctx.moveTo(p.cx - r, p.cy - r);
        ctx.lineTo(p.cx + r, p.cy + r);
        ctx.moveTo(p.cx + r, p.cy - r);
        ctx.lineTo(p.cx - r, p.cy + r);
        ctx.stroke();
    }

    _renderMarks() {
        const ctx = this.ctx;
        const { cell } = this._layout;

        if (this.lastMove && this.cells[this.lastMove.y] && this.cells[this.lastMove.y][this.lastMove.x] !== EMPTY) {
            const p = this._stoneGeometry(this.lastMove.x, this.lastMove.y);
            ctx.fillStyle = this.cells[this.lastMove.y][this.lastMove.x] === BLACK ? '#FFFFFF' : '#1A1A1A';
            ctx.beginPath();
            ctx.arc(p.cx, p.cy, cell * 0.1, 0, Math.PI * 2);
            ctx.fill();
        }

        if (this.koPoint) {
            const p = this._stoneGeometry(this.koPoint.x, this.koPoint.y);
            const s = cell * 0.22;
            ctx.strokeStyle = 'rgba(231, 76, 60, 0.85)';
            ctx.lineWidth = Math.max(1.5, cell * 0.06);
            ctx.strokeRect(p.cx - s, p.cy - s, s * 2, s * 2);
        }

        if (this.winLine && this.winLine.length >= 2) {
            const first = this._stoneGeometry(this.winLine[0].x, this.winLine[0].y);
            const last = this._stoneGeometry(this.winLine[this.winLine.length - 1].x, this.winLine[this.winLine.length - 1].y);
            ctx.save();
            ctx.strokeStyle = COLORS.win;
            ctx.lineWidth = Math.max(2, cell * 0.08);
            ctx.shadowColor = 'rgba(255, 68, 68, 0.8)';
            ctx.shadowBlur = cell * 0.35;
            ctx.beginPath();
            ctx.moveTo(first.cx, first.cy);
            ctx.lineTo(last.cx, last.cy);
            ctx.stroke();
            ctx.restore();
        }

        if (this._hover && this.interactive && !this.deadMarking) {
            const x = this._hover.x;
            const y = this._hover.y;
            if (this.cells[y][x] === EMPTY) {
                ctx.globalAlpha = 0.3;
                this._drawStone(x, y, this._hoverColor || BLACK);
                ctx.globalAlpha = 1;
            }
        }
    }

    _renderCursor() {
        if (!this._cursor || !this.interactive) return;
        const p = this._stoneGeometry(this._cursor.x, this._cursor.y);
        const ctx = this.ctx;
        ctx.strokeStyle = COLORS.accent;
        ctx.lineWidth = 2;
        const s = this._layout.cell * 0.5;
        ctx.strokeRect(p.cx - s, p.cy - s, s * 2, s * 2);
    }

    setHoverColor(color) {
        this._hoverColor = color;
    }

    dispose() {
        this.canvas.removeEventListener('pointerdown', this._onPointerDown);
        this.canvas.removeEventListener('pointermove', this._onPointerMove);
        this.canvas.removeEventListener('pointerleave', this._onPointerLeave);
        this.canvas.removeEventListener('keydown', this._onKeyDown);
        if (this._resizeObserver) this._resizeObserver.disconnect();
        if (this._windowResize) window.removeEventListener('resize', this._windowResize);
        if (this._raf) cancelAnimationFrame(this._raf);
        this._raf = 0;
    }
}
